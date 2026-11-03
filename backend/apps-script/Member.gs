/**
 * Shop login (Phase 3), order History (Phase 4) and complaints (2026-11-03). The site (member.html / history.html / app.js)
 * calls these through doPost with { action: 'login' | 'set_password' | 'me' | 'logout' | 'history' | 'complain', ... };
 * orders carry { session: token }.
 * - First login uses the temporary password from the admin page and must set the shop's own password.
 * - A session token is 32 random bytes (64 hex). Only its SHA-256 is stored (Sessions.Token_Hash).
 * - A shop logs in with its phone or its login name (Member_Auth.Login_Name, 2026-10-27) and the same password.
 * - Same answer for a wrong phone / name and a wrong password; 5 wrong tries lock that account for 15 min, whichever
 *   of the two was typed.
 * Needs Admin.gs (table_, customerRow_, digits_, isDate_, isTrue_, looksLikePhone_, loginKey_) and Bcrypt.gs.
 * See wiki/member-accounts.md.
 */
const SESSION_DAYS = 90;              // fixed from login (decided 2026-10-23), then log in again
const SHORT_SESSION_HOURS = 12;       // 'remember me' unticked (2026-10-24): the phone keeps it for this tab only
const CHANGE_TTL_S = 900;             // a temp-password login has 15 min to set the new password
const LOGIN_FAILS_PER_ACCOUNT = 5;    // then that account is locked for LOGIN_LOCK_S
const LOGIN_LOCK_S = 900;
const LOGIN_FAILS_ALL = 100;          // failed logins per hour across the site, then login pauses
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72;        // bcrypt ignores anything after 72 bytes
const LAST_SEEN_EVERY_MS = 12 * 3600 * 1000;
const TOKEN_RE = /^[0-9a-f]{64}$/;
// Checked when no account matches, so a wrong phone or name takes as long as a wrong password. Hash of random text.
const DUMMY_HASH = '$2a$12$HQFAX./GkC1uj8/cE2UqyON/ovY/BEYSFGOhB08kdn8oH.he/VcKq';
const COMMON_PASSWORDS = ['password', 'password1', 'password123', '12345678', '123456789', '1234567890', '87654321',
  '11111111', '00000000', '12341234', 'qwertyui', 'qwerty123', 'iloveyou', 'abcd1234', 'abc12345', 'admin123',
  'welcome1', 'sukhumvit', 'betagro1', 'betagro123', 'smartmenu', 'bangkok1'];
const MEMBER_ACTIONS = { login: true, set_password: true, me: true, logout: true, history: true, complain: true };
// History (decided 2026-10-24): only orders the shop itself placed (login or its own QR). A guest order is filed under a
// shop by the typed phone alone, so anyone could put one there; those stay out.
const HISTORY_DAYS = 90;
const HISTORY_MAX = 50;
const HISTORY_AUTH = { member: true, shop_qr: true };
// Complaints (2026-11-03): only on the shop's own History orders, once delivered, for 7 days after delivery; 1–3 photos.
// Reasons are DIFOT's own (Master Type = Reason_Delivery, RD-01…), so the teammate's app reads them as its own.
const COMPLAIN_DAYS = 7;
const COMPLAINTS_PER_ORDER = 3;
const COMPLAINTS_PER_SHOP_DAY = 10;
const COMPLAIN_STATUS = { Delivered: true, Issue: true };
const COMPLAINT_REASON_TYPE = 'Reason_Delivery';
const COMPLAINT_STAGE = 'After_Delivery';
const COMPLAINT_FOLDER = 'Exception_Images';   // next to the sheet; AppSheet's own name for an Exception table's images
const PHOTO_MAX = 3;
const PHOTO_MAX_BYTES = 600 * 1024;            // the page shrinks photos to 1600 px JPEG first (~200–400 KB)
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const NOTE_MAX = 400;

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
  if (o.action === 'history') return history_(o);
  if (o.action === 'complain') return complain_(o);
  return logout_(o);
}

function login_(o) {
  const bad = { ok: false, error: 'bad_login' };
  // o.user = phone or login name; login pages from before 2026-10-27 send o.phone.
  const user = String(typeof o.user === 'string' ? o.user : o.phone == null ? '' : o.phone).trim();
  const password = typeof o.password === 'string' ? o.password : '';
  if (!user || user.length > 200 || !password || password.length > 200) return bad;
  const isPhone = looksLikePhone_(user);
  const phone = digits_(user), key = loginKey_(user);
  if (isPhone ? !/^0\d{8,9}$/.test(phone) : !key) return bad;
  const cache = CacheService.getScriptCache();
  const kAll = failKeyAll_(), nAll = Number(cache.get(kAll)) || 0;
  if (nAll >= LOGIN_FAILS_ALL) return { ok: false, error: 'rate' };

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const acct = memberAccount_(ss, isPhone ? a => digits_(a.get('Login_Phone')) === phone
    : a => loginKey_(a.get('Login_Name')) === key);
  // Counted per account, so switching between phone and name gives no extra tries; per typed text when none matches.
  const kFail = acct ? 'lf:a:' + acct.id : 'lf:u:' + sha256Hex_(isPhone ? phone : key);
  const nFail = Number(cache.get(kFail)) || 0;
  if (nFail >= LOGIN_FAILS_PER_ACCOUNT) return { ok: false, error: 'locked' };
  const typed = acct && acct.mustChange ? normTemp_(password) : password;
  const good = bcrypt_.compareSync(typed, acct && acct.hash ? acct.hash : DUMMY_HASH) && !!acct && !!acct.hash;
  if (!good) {
    cache.put(kFail, String(nFail + 1), LOGIN_LOCK_S);
    cache.put(kAll, String(nAll + 1), 3700);
    return bad;
  }
  cache.remove(kFail);
  if (acct.mustChange) {
    // Only said after the right temp password, so it tells a stranger nothing.
    if (!(isDate_(acct.expires) && acct.expires.getTime() > Date.now())) return { ok: false, error: 'temp_expired' };
    const change = randomHex_(32);
    cache.put('chg:' + sha256Hex_(change), acct.id, CHANGE_TTL_S);
    return { ok: true, must_change: true, change_token: change };
  }
  return newSession_(ss, acct.id, o.remember !== false);
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
  const problem = passwordProblem_(pw, acct.phone, acct.loginName);
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
    return newSession_(ss, id, o.remember !== false);
  } finally {
    lock.releaseLock();
  }
}

/**
 * '' or why the shop's chosen password is refused (rules decided 2026-10-23: length, not phone, not common;
 * 2026-10-27: not the login name either, which is no secret).
 */
function passwordProblem_(pw, phone, loginName) {
  if (utf8Length_(pw) > PASSWORD_MAX_BYTES) return 'password_long';
  if (Array.from(pw).length < PASSWORD_MIN) return 'password_short';
  const squashed = pw.replace(/[\s-]/g, '');
  if (squashed.indexOf(phone) !== -1 || squashed.indexOf(phone.slice(1)) !== -1) return 'password_phone';
  const name = loginKey_(loginName);
  if (name.length >= 3 && loginKey_(pw).indexOf(name) !== -1) return 'password_name';
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

/**
 * The logged-in shop's own web orders, newest first: when, delivery date, total, DIFOT status and the lines at the
 * price paid. The shop comes from the session only. No phone, address or note is sent back.
 */
function history_(o) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const s = sessionOf_(ss, o.token);
  if (!s) return { ok: false, error: 'session' };
  const orders = table_(ss.getSheetByName('Order'));
  const since = Date.now() - HISTORY_DAYS * DAY_MS;
  const picked = [];
  for (let r = 0; r < orders.rows.length; r++) {
    if (orders.str(r, 'Customer_ID') !== s.id || HISTORY_AUTH[orders.str(r, 'Auth')] !== true) continue;
    const at = orders.get(r, 'Order_Date');
    if (isDate_(at) && at.getTime() >= since) picked.push({ r, at });
  }
  picked.sort((a, b) => b.at.getTime() - a.at.getTime());
  const byId = {};
  const rows = picked.slice(0, HISTORY_MAX);
  const counts = rows.length ? complaintCounts_(ss) : {};
  const out = rows.map(({ r, at }) => {
    const id = orders.str(r, 'Order_ID');
    const until = complainUntil_(orders, r);
    const n = counts[id] || 0;
    byId[id] = { id, ordered_at: iso_(at), delivery_date: dayText_(orders.get(r, 'Web_Delivery_Date')),
      total: Number(orders.get(r, 'Web_Total')) || 0, status: orders.str(r, 'Status'), items: [],
      complain_until: until && until.getTime() > Date.now() && n < COMPLAINTS_PER_ORDER ? iso_(until) : '', complaints: n };
    return byId[id];
  });
  if (out.length) {
    const items = table_(ss.getSheetByName('Order_Items'));
    for (let r = 0; r < items.rows.length; r++) {
      const order = byId[items.str(r, 'Order_ID')];
      if (!order) continue;
      order.items.push({ sku: items.str(r, 'SKU'), name_th: items.str(r, 'Name_TH'), qty: Number(items.get(r, 'Qty')) || 0,
        qty_unit: items.str(r, 'Qty_Unit'), unit_price: Number(items.get(r, 'Unit_Price')) || 0,
        line_total: Number(items.get(r, 'Line_Total')) || 0 });
    }
  }
  return { ok: true, days: HISTORY_DAYS, orders: out };
}

/**
 * A logged-in shop reports a problem with one of its own delivered orders: { order_id, reason (RD-xx), skus: [] (empty =
 * the whole order), note, photos: [{ mime, base64 }] (1–3), client_id }. Writes, under the lock: one Exception row per
 * product (Stage After_Delivery, Source Web, the photos' paths), Order.Status = Issue + Customer_Issue, one Event row.
 * Photos go to <sheet folder>/Exception_Images, private, shown by AppSheet. The same client_id always gives the same
 * complaint id, so a retry never writes twice (the id is found in the sheet even when the cache is gone).
 */
function complain_(o) {
  const fail = error => ({ ok: false, error });
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const s = sessionOf_(ss, o.token);
  if (!s) return fail('session');
  if (o.client_id != null && !/^[A-Za-z0-9-]{8,64}$/.test(String(o.client_id))) return fail('client_id');
  const cid = o.client_id ? 'CW' + sha256Hex_(s.id + '|' + o.client_id).slice(0, 8).toUpperCase()
    : 'CW' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  const cache = CacheService.getScriptCache();
  const kDup = 'cc:' + cid;
  if (o.client_id && cache.get(kDup)) return { ok: true, complaint_id: cid, duplicate: true };

  // The order: this shop's own (login or QR), delivered, not more than 7 days ago.
  const orders = table_(ss.getSheetByName('Order'));
  const orderId = String(o.order_id || '');
  const r = /^W\d{6}-\d{3}$/.test(orderId) ? orders.find('Order_ID', orderId) : -1;
  if (r === -1 || orders.str(r, 'Customer_ID') !== s.id || HISTORY_AUTH[orders.str(r, 'Auth')] !== true) return fail('not_found');
  if (COMPLAIN_STATUS[orders.str(r, 'Status')] !== true) return fail('not_delivered');
  const until = complainUntil_(orders, r);
  const already = o.client_id && complaintCounts_(ss, cid)[orderId];
  if (already) return { ok: true, complaint_id: cid, duplicate: true };
  if (!until || until.getTime() <= Date.now()) return fail('too_late');

  // What and why.
  const reason = complaintReason_(ss, o.reason);
  if (!reason) return fail('reason');
  const note = typeof o.note === 'string' ? o.note.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim() : '';
  if (note.length > NOTE_MAX || (reason.isOther && !note)) return fail('note');
  const names = orderItemNames_(ss, orderId);
  const skus = Array.isArray(o.skus) ? o.skus.map(String) : null;
  if (!skus || skus.length > 40 || skus.some(k => !(k in names)) || new Set(skus).size !== skus.length) return fail('items');
  const photos = Array.isArray(o.photos) ? o.photos : [];
  if (photos.length < 1 || photos.length > PHOTO_MAX) return fail('photo');
  const files = [];
  for (const p of photos) {
    const ext = p && PHOTO_TYPES[p.mime];
    const b64 = String((p && p.base64) || '');
    if (!ext || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return fail('photo_type');
    if (b64.length > Math.ceil(PHOTO_MAX_BYTES / 3) * 4) return fail('photo_size');
    const bytes = Utilities.base64Decode(b64);
    if (bytes.length > PHOTO_MAX_BYTES) return fail('photo_size');
    if (!isImage_(bytes, p.mime)) return fail('photo_type');
    files.push({ bytes, mime: p.mime, ext });
  }

  const now = new Date();
  const kShop = 'cp:' + s.id + ':' + Utilities.formatDate(now, TZ, 'yyMMdd');
  const nShop = Number(cache.get(kShop)) || 0;
  if (nShop >= COMPLAINTS_PER_SHOP_DAY) return fail('rate');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return fail('busy');
  try {
    // Again under the lock: the first try may have finished while this one waited.
    const counts = complaintCounts_(ss);
    if (o.client_id && complaintCounts_(ss, cid)[orderId]) return { ok: true, complaint_id: cid, duplicate: true };
    if ((counts[orderId] || 0) >= COMPLAINTS_PER_ORDER) return fail('rate');

    const folder = imageFolder_(COMPLAINT_FOLDER);   // Admin.gs
    const paths = files.map((f, i) => {
      const name = cid + '-' + (i + 1) + '.' + f.ext;
      folder.createFile(Utilities.newBlob(f.bytes, f.mime, name));
      return COMPLAINT_FOLDER + '/' + name;
    });
    const rowFor = sku => ({
      Exception_ID: 'XW' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(), Order_ID: orderId,
      Shop_ID: SHOP_ID, Stage: COMPLAINT_STAGE, SKU_Code: sku, Reason_Code: reason.code, Other_Note: note,
      Logged_At: now, Logged_By: 'web:' + s.id, Source: 'Web', Complaint_ID: cid, Web_Item: sku ? names[sku] : '',
      Photo: paths[0] || '', Photo_2: paths[1] || '', Photo_3: paths[2] || ''
    });
    appendRowsByHeader_(ss.getSheetByName('Exception'), (skus.length ? skus : ['']).map(rowFor));
    orders.set(r, { Status: 'Issue', Customer_Issue: true });
    appendByHeader_(ss.getSheetByName('Event'), {
      Event_ID: 'EW' + Utilities.getUuid().slice(0, 8), Order_ID: orderId, Shop_ID: SHOP_ID, Station: 'Web',
      Action: 'Customer_Issue', Timestamp: now, User: 'web:' + s.id, Photo: paths[0],
      Note: reason.name + ', ' + (skus.length ? skus.length + ' items' : 'whole order') + ', ' + paths.length + ' photo(s), ' + cid
    });
    SpreadsheetApp.flush();
    if (o.client_id) cache.put(kDup, '1', 21600);
    cache.put(kShop, String(nShop + 1), 90000);
    return { ok: true, complaint_id: cid };
  } catch (err) {
    console.error(err);
    return fail('server');
  } finally {
    lock.releaseLock();
  }
}

/** Last moment a complaint may be sent: 7 days after delivery (T5_Delivered, else the order date), or null. */
function complainUntil_(orders, r) {
  if (COMPLAIN_STATUS[orders.str(r, 'Status')] !== true) return null;
  const done = orders.get(r, 'T5_Delivered');
  const base = isDate_(done) ? done : orders.get(r, 'Order_Date');
  return isDate_(base) ? new Date(base.getTime() + COMPLAIN_DAYS * DAY_MS) : null;
}

/** { Order_ID: number of web complaints } (a complaint with 3 products is 3 rows but counts once); only `onlyCid` if given. */
function complaintCounts_(ss, onlyCid) {
  const sheet = ss.getSheetByName('Exception');
  if (!sheet) return {};
  const ex = table_(sheet);
  const seen = {}, out = {};
  for (let r = 0; r < ex.rows.length; r++) {
    const c = ex.str(r, 'Complaint_ID');
    if (ex.str(r, 'Source') !== 'Web' || !c || seen[c] || (onlyCid && c !== onlyCid)) continue;
    seen[c] = true;
    const id = ex.str(r, 'Order_ID');
    out[id] = (out[id] || 0) + 1;
  }
  return out;
}

/** The active delivery reason with this code: { code, name, isOther }, or null. */
function complaintReason_(ss, code) {
  if (typeof code !== 'string' || !/^[A-Z]{2}-\d{2}$/.test(code)) return null;
  const m = table_(ss.getSheetByName('Master'));
  for (let r = 0; r < m.rows.length; r++) {
    if (m.str(r, 'Code') !== code || m.str(r, 'Type') !== COMPLAINT_REASON_TYPE || isInactive_(m.get(r, 'Active'))) continue;
    const name = m.str(r, 'Name');
    return { code, name, isOther: /อื่น|other/i.test(name) };
  }
  return null;
}

/** { SKU: Thai name } of the order's lines. */
function orderItemNames_(ss, orderId) {
  const items = table_(ss.getSheetByName('Order_Items'));
  const out = {};
  for (let r = 0; r < items.rows.length; r++) {
    if (items.str(r, 'Order_ID') === orderId) out[items.str(r, 'SKU')] = items.str(r, 'Name_TH');
  }
  return out;
}

// Sheets turns a typed 2026-10-25 into a date; either way the site gets yyyy-MM-dd.
const dayText_ = v => (isDate_(v) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v == null ? '' : v).trim());

function logout_(o) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const s = sessionOf_(ss, o.token);
  if (s) s.sessions.set(s.row, { Revoked_At: new Date() });
  return { ok: true };
}

// Pages from before 2026-10-24 send no 'remember': they get the long session, as before.
function newSession_(ss, id, remember) {
  const token = randomHex_(32);
  const now = new Date();
  const life = remember ? SESSION_DAYS * DAY_MS : SHORT_SESSION_HOURS * 3600 * 1000;
  appendByHeader_(ss.getSheetByName('Sessions'), { Token_Hash: sha256Hex_(token), Customer_ID: id, Created_At: now,
    Expires_At: new Date(now.getTime() + life), Last_Seen: now, Revoked_At: '' });
  return { ok: true, token, shop: memberProfile_(ss, id, '') };
}

/**
 * The account whose Member_Auth row passes `match`, if it may log in: its customer exists, is open for
 * ordering and is not disabled. { id, phone, loginName, hash, mustChange, expires, auth, row } or null.
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
    return { id, phone: digits_(auth.get(r, 'Login_Phone')), loginName: auth.str(r, 'Login_Name'),
      hash: auth.str(r, 'Password_Hash'),
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
