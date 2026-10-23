/**
 * Shop login (Phase 3). The site (member.html / app.js) calls these through doPost with
 * { action: 'login' | 'set_password' | 'me' | 'logout', ... }; orders carry { session: token }.
 * - First login uses the temporary password from the admin page and must set the shop's own password.
 * - A session token is 32 random bytes (64 hex). Only its SHA-256 is stored (Sessions.Token_Hash).
 * - Same answer for a wrong phone and a wrong password; 5 wrong tries lock a phone for 15 min.
 * Needs Admin.gs (table_, customerRow_, digits_, isDate_, isTrue_) and Bcrypt.gs. See wiki/member-accounts.md.
 */
const SESSION_DAYS = 90;              // fixed from login (decided 2026-10-23), then log in again
const CHANGE_TTL_S = 900;             // a temp-password login has 15 min to set the new password
const LOGIN_FAILS_PER_PHONE = 5;      // then that phone is locked for LOGIN_LOCK_S
const LOGIN_LOCK_S = 900;
const LOGIN_FAILS_ALL = 100;          // failed logins per hour across the site, then login pauses
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72;        // bcrypt ignores anything after 72 bytes
const LAST_SEEN_EVERY_MS = 12 * 3600 * 1000;
const TOKEN_RE = /^[0-9a-f]{64}$/;
// Checked when no account matches, so a wrong phone takes as long as a wrong password. Hash of random text.
const DUMMY_HASH = '$2a$12$HQFAX./GkC1uj8/cE2UqyON/ovY/BEYSFGOhB08kdn8oH.he/VcKq';
const COMMON_PASSWORDS = ['password', 'password1', 'password123', '12345678', '123456789', '1234567890', '87654321',
  '11111111', '00000000', '12341234', 'qwertyui', 'qwerty123', 'iloveyou', 'abcd1234', 'abc12345', 'admin123',
  'welcome1', 'sukhumvit', 'betagro1', 'betagro123', 'smartmenu', 'bangkok1'];
const MEMBER_ACTIONS = { login: true, set_password: true, me: true, logout: true };

const failKeyAll_ = () => 'lf:all:' + Utilities.formatDate(new Date(), TZ, 'yyMMddHH');
const hex_ = bytes => bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
const sha256Hex_ = s => hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s));
const randomHex_ = n => hex_(randomBytes_(n));
// The temp password is shown as XXXXX-XXXXX; shops may type it with or without the dash, spaces or capitals.
const normTemp_ = p => String(p).replace(/[\s-]/g, '').toUpperCase();
const utf8Length_ = s => unescape(encodeURIComponent(s)).length;

function memberAction_(o) {
  if (o.action === 'login') return login_(o);
  if (o.action === 'set_password') return setPassword_(o);
  if (o.action === 'me') return me_(o);
  return logout_(o);
}

function login_(o) {
  const bad = { ok: false, error: 'bad_login' };
  const phone = digits_(o.phone);
  const password = typeof o.password === 'string' ? o.password : '';
  if (!/^0\d{8,9}$/.test(phone) || !password || password.length > 200) return bad;
  const cache = CacheService.getScriptCache();
  const kPhone = 'lf:p:' + phone, kAll = failKeyAll_();
  const nPhone = Number(cache.get(kPhone)) || 0, nAll = Number(cache.get(kAll)) || 0;
  if (nPhone >= LOGIN_FAILS_PER_PHONE) return { ok: false, error: 'locked' };
  if (nAll >= LOGIN_FAILS_ALL) return { ok: false, error: 'rate' };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const acct = memberAccount_(ss, a => digits_(a.get('Login_Phone')) === phone);
  const typed = acct && acct.mustChange ? normTemp_(password) : password;
  const good = bcrypt_.compareSync(typed, acct && acct.hash ? acct.hash : DUMMY_HASH) && !!acct && !!acct.hash;
  if (!good) {
    cache.put(kPhone, String(nPhone + 1), LOGIN_LOCK_S);
    cache.put(kAll, String(nAll + 1), 3700);
    return bad;
  }
  cache.remove(kPhone);
  if (acct.mustChange) {
    // Only said after the right temp password, so it tells a stranger nothing.
    if (!(isDate_(acct.expires) && acct.expires.getTime() > Date.now())) return { ok: false, error: 'temp_expired' };
    const change = randomHex_(32);
    cache.put('chg:' + sha256Hex_(change), acct.id, CHANGE_TTL_S);
    return { ok: true, must_change: true, change_token: change };
  }
  return newSession_(ss, acct.id);
}

function setPassword_(o) {
  const expired = { ok: false, error: 'change_expired' };
  const change = String(o.change_token || '');
  if (!TOKEN_RE.test(change)) return expired;
  const cache = CacheService.getScriptCache();
  const kChange = 'chg:' + sha256Hex_(change);
  const id = cache.get(kChange);
  if (!id) return expired;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const acct = memberAccount_(ss, a => a.str('Customer_ID') === id);
  if (!acct || !acct.mustChange || !acct.hash) return expired;
  const pw = typeof o.new_password === 'string' ? o.new_password : '';
  const problem = passwordProblem_(pw, acct.phone);
  if (problem) return { ok: false, error: problem };
  if (bcrypt_.compareSync(normTemp_(pw), acct.hash)) return { ok: false, error: 'password_same' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    const now = new Date();
    acct.auth.set(acct.row, { Password_Hash: bcrypt_.hashSync(pw, BCRYPT_COST), Must_Change: false,
      Temp_Expires_At: '', Password_Set_At: now });
    cache.remove(kChange);
    revokeSessions_(ss, id, now);
    return newSession_(ss, id);
  } finally {
    lock.releaseLock();
  }
}

/** '' or why the shop's chosen password is refused (rules decided 2026-10-23: length, not phone, not common). */
function passwordProblem_(pw, phone) {
  if (utf8Length_(pw) > PASSWORD_MAX_BYTES) return 'password_long';
  if (Array.from(pw).length < PASSWORD_MIN) return 'password_short';
  const squashed = pw.replace(/[\s-]/g, '');
  if (squashed.indexOf(phone) !== -1 || squashed.indexOf(phone.slice(1)) !== -1) return 'password_phone';
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.indexOf(lower) !== -1 || /^(.)\1+$/.test(pw)) return 'password_common';
  return '';
}

function me_(o) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const s = sessionOf_(ss, o.token);
  if (!s) return { ok: false, error: 'session' };
  const seen = s.sessions.get(s.row, 'Last_Seen');
  if (!isDate_(seen) || Date.now() - seen.getTime() > LAST_SEEN_EVERY_MS) s.sessions.set(s.row, { Last_Seen: new Date() });
  return { ok: true, shop: memberProfile_(ss, s.id, typeof o.logo_id === 'string' ? o.logo_id : '') };
}

function logout_(o) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const s = sessionOf_(ss, o.token);
  if (s) s.sessions.set(s.row, { Revoked_At: new Date() });
  return { ok: true };
}

function newSession_(ss, id) {
  const token = randomHex_(32);
  const now = new Date();
  appendByHeader_(ss.getSheetByName('Sessions'), { Token_Hash: sha256Hex_(token), Customer_ID: id, Created_At: now,
    Expires_At: new Date(now.getTime() + SESSION_DAYS * DAY_MS), Last_Seen: now, Revoked_At: '' });
  return { ok: true, token, shop: memberProfile_(ss, id, '') };
}

/**
 * The account whose Member_Auth row passes `match`, if it may log in: its customer exists, is open for
 * ordering and is not disabled. { id, phone, hash, mustChange, expires, auth, row } or null.
 */
function memberAccount_(ss, match) {
  const auth = table_(ss.getSheetByName('Member_Auth'));
  for (let r = 0; r < auth.rows.length; r++) {
    const view = { get: k => auth.get(r, k), str: k => auth.str(r, k) };
    if (!match(view)) continue;
    const id = auth.str(r, 'Customer_ID');
    const m = table_(ss.getSheetByName('Master'));
    const c = customerRow_(m, id);
    if (c === -1 || isInactive_(m.get(c, 'Active')) || m.str(c, 'Member_Status') === 'disabled') return null;
    return { id, phone: digits_(auth.get(r, 'Login_Phone')), hash: auth.str(r, 'Password_Hash'),
      mustChange: isTrue_(auth.get(r, 'Must_Change')), expires: auth.get(r, 'Temp_Expires_At'), auth, row: r };
  }
  return null;
}

/** The live session for `token`: { id, sessions, row }, or null (unknown, expired, revoked, or the account can't log in now). */
function sessionOf_(ss, token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const sessions = table_(ss.getSheetByName('Sessions'));
  const r = sessions.find('Token_Hash', sha256Hex_(String(token)));
  if (r === -1 || sessions.get(r, 'Revoked_At')) return null;
  const exp = sessions.get(r, 'Expires_At');
  if (!isDate_(exp) || exp.getTime() <= Date.now()) return null;
  const id = sessions.str(r, 'Customer_ID');
  const acct = memberAccount_(ss, a => a.str('Customer_ID') === id);
  if (!acct || !acct.hash || acct.mustChange) return null;
  return { id, sessions, row: r };
}

/** What the logged-in shop's own phone shows: name, masked phone / address, and the logo if it has not got it yet. */
function memberProfile_(ss, id, knownLogoId) {
  const shop = findShop_(ss, id, 'code');
  const m = table_(ss.getSheetByName('Master'));
  const logoId = m.str(customerRow_(m, id), 'Logo_File_ID');
  const out = { name: shop.name, phone_masked: maskPhone_(shop.phone), address_masked: maskAddress_(shop.address), logo_id: logoId };
  if (logoId && logoId !== knownLogoId) {
    try {
      const blob = DriveApp.getFileById(logoId).getBlob();
      out.logo_data_url = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (err) {
      console.error(err);
      out.logo_id = '';
    }
  }
  return out;
}
