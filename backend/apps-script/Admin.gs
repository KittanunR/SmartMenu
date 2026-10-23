/**
 * Admin page for shop accounts (Phase 2): list / add / edit shops, temporary passwords, disable, logo.
 * doGet (Code.gs) serves Admin.html only to a signed-in admin. The page calls the admin* functions below through
 * google.script.run, and every one of them checks the caller again, so the public order deployment (nobody signed
 * in) can never reach them.
 * Deploy as a SECOND web-app deployment of this project: Execute as = Me, Who has access = Only myself.
 * A temporary password is returned to the page once and stored only as a bcrypt hash; hashes never leave the server.
 * Every value written to the sheet goes through plain_ (Code.gs), so nothing typed here can become a formula.
 * See wiki/member-accounts.md.
 */
const BCRYPT_COST = 12;              // ≈0.47 s per check in Apps Script (Phase 0, 2026-10-23)
const TEMP_DAYS = 7;
const TEMP_LENGTH = 10;              // from CODE_ALPHABET ≈ 49 bits; shown as XXXXX-XXXXX, the dash is not part of it
const LOGO_MAX_BYTES = 300 * 1024;   // the page shrinks logos to 512 px before upload, so this is generous
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const DAY_MS = 24 * 3600 * 1000;

/**
 * The caller's email if they may use the admin page, else ''. Allowed: the script owner, plus anyone listed in the
 * script property ADMIN_EMAILS (comma separated). The list only matters if the deployment lets other accounts in;
 * with "Only myself" it is the owner alone. Nobody signed in → '' (Session gives no email on the public deployment).
 */
function adminEmail_() {
  const me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!me) return '';
  const owner = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  const extra = String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '')
    .toLowerCase().split(/[\s,]+/).filter(Boolean);
  return me === owner || extra.indexOf(me) !== -1 ? me : '';
}

function adminPage_() {
  return HtmlService.createHtmlOutputFromFile('Admin').setTitle('SmartMenu Admin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Runs `work(ss, who)` for an admin under the same lock as orders. Answers are plain JSON (google.script.run drops Dates). */
function adminCall_(work) {
  const who = adminEmail_();
  if (!who) return { ok: false, error: 'not_admin' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' };
  try {
    return work(SpreadsheetApp.openById(SHEET_ID), who);
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'server' };
  } finally {
    lock.releaseLock();
  }
}

// ---------- what the page calls ----------

function adminListShops() {
  return adminCall_(ss => ({ ok: true, shops: shopViews_(ss) }));
}

/** New customer + shop code + account. Answers the temporary password once. */
function adminCreateShop(form) {
  return adminCall_((ss, who) => {
    const c = cleanShop_(form);
    if (c.error) return { ok: false, error: c.error };
    const f = c.shop;
    const m = table_(ss.getSheetByName('Master'));
    const taken = phoneOwner_(m, table_(ss.getSheetByName('Member_Auth')), f.phone, '');
    if (taken) return { ok: false, error: 'phone_taken', customer_id: taken };
    const id = nextCustomerCode_([m.head].concat(m.rows));
    const code = uniqueShopCode_(m);
    appendByHeader_(m.sheet, {
      Code: id, Type: 'Customer', Name: f.name, Category: 'Web', Active: 'Yes', Shop_ID: SHOP_ID,
      Phone: "'" + f.phone, Source: 'Admin', Address: f.address, Contact_Name: f.contact,
      LINE_Name: f.line, Shop_Code: code, Shop_Link: SITE_URL + '?shop=' + code, Member_Status: 'active'
    });
    const now = new Date();
    const temp = setTempPassword_(ss, id, f.phone, now);
    log_(ss, who, 'shop_created', id, f.name, now);
    return { ok: true, shop: shopViews_(ss, id)[0], temp_password: temp };
  });
}

function adminUpdateShop(id, form) {
  return adminCall_((ss, who) => {
    const m = table_(ss.getSheetByName('Master'));
    const r = customerRow_(m, id);
    if (r === -1) return { ok: false, error: 'not_found' };
    const c = cleanShop_(form);
    if (c.error) return { ok: false, error: c.error };
    const f = c.shop;
    const auth = table_(ss.getSheetByName('Member_Auth'));
    const taken = phoneOwner_(m, auth, f.phone, id);
    if (taken) return { ok: false, error: 'phone_taken', customer_id: taken };
    m.set(r, { Name: f.name, Phone: "'" + f.phone, Contact_Name: f.contact, LINE_Name: f.line,
      Address: f.address, Active: f.active ? 'Yes' : 'No' });
    const a = auth.find('Customer_ID', id);
    if (a !== -1) auth.set(a, { Login_Phone: "'" + f.phone });
    log_(ss, who, 'shop_updated', id, '', new Date());
    return { ok: true, shop: shopViews_(ss, id)[0] };
  });
}

/** First account for an existing customer, a forgotten password, or turning a disabled account back on. */
function adminIssuePassword(id) {
  return adminCall_((ss, who) => {
    const m = table_(ss.getSheetByName('Master'));
    const r = customerRow_(m, id);
    if (r === -1) return { ok: false, error: 'not_found' };
    const phone = digits_(m.get(r, 'Phone'));
    if (!/^0\d{8,9}$/.test(phone)) return { ok: false, error: 'phone' };
    const taken = phoneOwner_(m, table_(ss.getSheetByName('Member_Auth')), phone, id);
    if (taken) return { ok: false, error: 'phone_taken', customer_id: taken };
    // A guest customer has no shop code yet; a member gets one so staff can also give it a QR.
    if (!m.str(r, 'Shop_Code')) {
      const code = uniqueShopCode_(m);
      m.set(r, { Shop_Code: code, Shop_Link: SITE_URL + '?shop=' + code });
    }
    m.set(r, { Member_Status: 'active' });
    const now = new Date();
    const temp = setTempPassword_(ss, id, phone, now);
    log_(ss, who, 'password_issued', id, '', now);
    return { ok: true, shop: shopViews_(ss, id)[0], temp_password: temp };
  });
}

/** Login stops at once (hash cleared, every device logged out). The customer and its shop QR stay. */
function adminDisableAccount(id) {
  return adminCall_((ss, who) => {
    const m = table_(ss.getSheetByName('Master'));
    const r = customerRow_(m, id);
    if (r === -1) return { ok: false, error: 'not_found' };
    const auth = table_(ss.getSheetByName('Member_Auth'));
    const a = auth.find('Customer_ID', id);
    if (a === -1) return { ok: false, error: 'no_account' };
    const now = new Date();
    auth.set(a, { Password_Hash: '' });
    m.set(r, { Member_Status: 'disabled' });
    revokeSessions_(ss, id, now);
    log_(ss, who, 'account_disabled', id, '', now);
    return { ok: true, shop: shopViews_(ss, id)[0] };
  });
}

/** logo = { mime, base64 } (no data: prefix). Saved in a private Drive folder; the old logo goes to the bin. */
function adminSetLogo(id, logo) {
  return adminCall_((ss, who) => {
    const m = table_(ss.getSheetByName('Master'));
    const r = customerRow_(m, id);
    if (r === -1) return { ok: false, error: 'not_found' };
    const l = logo && typeof logo === 'object' ? logo : {};
    const ext = LOGO_TYPES[l.mime];
    const b64 = String(l.base64 || '');
    if (!ext || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { ok: false, error: 'logo_type' };
    if (b64.length > Math.ceil(LOGO_MAX_BYTES / 3) * 4) return { ok: false, error: 'logo_size' };
    const bytes = Utilities.base64Decode(b64);
    if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: 'logo_size' };
    if (!isImage_(bytes, l.mime)) return { ok: false, error: 'logo_type' };
    const file = logoFolder_().createFile(Utilities.newBlob(bytes, l.mime, id + '-logo.' + ext));
    const old = m.str(r, 'Logo_File_ID');
    m.set(r, { Logo_File_ID: file.getId() });
    if (old) {
      try { DriveApp.getFileById(old).setTrashed(true); } catch (err) { console.error(err); }
    }
    log_(ss, who, 'logo_set', id, '', new Date());
    return { ok: true, shop: shopViews_(ss, id)[0] };
  });
}

function adminGetLogo(id) {
  return adminCall_(ss => {
    const m = table_(ss.getSheetByName('Master'));
    const r = customerRow_(m, id);
    if (r === -1) return { ok: false, error: 'not_found' };
    const fileId = m.str(r, 'Logo_File_ID');
    if (!fileId) return { ok: false, error: 'no_logo' };
    let blob;
    try { blob = DriveApp.getFileById(fileId).getBlob(); } catch (err) { return { ok: false, error: 'no_logo' }; }
    return { ok: true, data_url: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  });
}

// ---------- helpers ----------

/** A tab as header + rows. set() writes straight to the sheet; a missing column means setup() was not run. */
function table_(sheet) {
  const data = sheet.getDataRange().getValues();
  const head = data[0];
  const rows = data.slice(1);
  const col = name => head.indexOf(name);
  const get = (r, name) => (col(name) === -1 ? '' : rows[r][col(name)]);
  return {
    sheet, head, rows, get,
    str: (r, name) => String(get(r, name) == null ? '' : get(r, name)).trim(),
    find: (name, value) => rows.findIndex(row => String(row[col(name)]) === value),
    set(r, values) {
      Object.keys(values).forEach(k => {
        const c = col(k);
        if (c === -1) throw new Error('Run setup() first: ' + sheet.getName() + ' has no ' + k + ' column.');
        sheet.getRange(r + 2, c + 1, 1, 1).setValue(plain_(values[k])); // plain_: Code.gs
        rows[r][c] = values[k];
      });
    }
  };
}

function customerRow_(m, id) {
  if (typeof id !== 'string' || !id || id.length > 40) return -1;
  return m.rows.findIndex((row, r) => m.str(r, 'Code') === id && m.str(r, 'Type') === 'Customer');
}

const digits_ = v => String(v == null ? '' : v).replace(/\D/g, '');
const isDate_ = v => !!v && typeof v.getTime === 'function';
const iso_ = v => (isDate_(v) ? v.toISOString() : '');
const isTrue_ = v => v === true || String(v).toUpperCase() === 'TRUE';

/** Form → clean fields, or { error: field }. Phone is the login, so it is required. */
function cleanShop_(form) {
  const f = form && typeof form === 'object' ? form : {};
  const s = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const shop = { name: s(f.name), phone: digits_(f.phone), contact: s(f.contact), line: s(f.line), address: s(f.address),
    active: f.active !== false };
  if (!shop.name || shop.name.length > 120) return { error: 'name' };
  if (!/^0\d{8,9}$/.test(shop.phone)) return { error: 'phone' };
  if (shop.contact.length > 120) return { error: 'contact' };
  if (shop.line.length > 120) return { error: 'line' };
  if (shop.address.length > 400) return { error: 'address' };
  return { shop };
}

/** Another customer using this phone (in Master or as a login), or ''. */
function phoneOwner_(m, auth, phone, exceptId) {
  for (let r = 0; r < m.rows.length; r++) {
    const id = m.str(r, 'Code');
    if (id !== exceptId && m.str(r, 'Type') === 'Customer' && digits_(m.get(r, 'Phone')) === phone) return id;
  }
  for (let r = 0; r < auth.rows.length; r++) {
    const id = auth.str(r, 'Customer_ID');
    if (id !== exceptId && digits_(auth.get(r, 'Login_Phone')) === phone) return id;
  }
  return '';
}

function uniqueShopCode_(m) {
  const used = {};
  m.rows.forEach((row, r) => { used[m.str(r, 'Shop_Code')] = true; });
  let code;
  do { code = newShopCode_(); } while (used[code]);
  return code;
}

/** New random temporary password: bcrypt hash into Member_Auth (row added or replaced), every session revoked. */
function setTempPassword_(ss, id, phone, now) {
  const temp = randomCode_(TEMP_LENGTH);
  const values = { Customer_ID: id, Login_Phone: "'" + phone, Password_Hash: bcrypt_.hashSync(temp, BCRYPT_COST),
    Must_Change: true, Temp_Expires_At: new Date(now.getTime() + TEMP_DAYS * DAY_MS), Password_Set_At: '' };
  const auth = table_(ss.getSheetByName('Member_Auth'));
  const a = auth.find('Customer_ID', id);
  if (a === -1) appendByHeader_(auth.sheet, values);
  else auth.set(a, values);
  revokeSessions_(ss, id, now);
  return temp.slice(0, 5) + '-' + temp.slice(5);
}

/** `len` letters from CODE_ALPHABET, each equally likely (bytes ≥ 248 are skipped so 256 % 31 adds no bias). */
function randomCode_(len) {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < len) {
    randomBytes_(len * 2).forEach(b => { if (b < limit && out.length < len) out += CODE_ALPHABET[b % n]; });
  }
  return out;
}

function revokeSessions_(ss, id, now) {
  const s = table_(ss.getSheetByName('Sessions'));
  s.rows.forEach((row, r) => {
    if (s.str(r, 'Customer_ID') === id && !s.get(r, 'Revoked_At')) s.set(r, { Revoked_At: now });
  });
}

function log_(ss, who, action, id, note, now) {
  appendByHeader_(ss.getSheetByName('Admin_Log'), { Timestamp: now, User: who, Action: action, Customer_ID: id, Note: note || '' });
}

/** Every customer (or just `onlyId`) as the page shows it. Never includes Password_Hash. */
function shopViews_(ss, onlyId) {
  const m = table_(ss.getSheetByName('Master'));
  const auth = table_(ss.getSheetByName('Member_Auth'));
  const now = Date.now();
  const out = [];
  m.rows.forEach((row, r) => {
    const id = m.str(r, 'Code');
    if (m.str(r, 'Type') !== 'Customer' || (onlyId && id !== onlyId)) return;
    const a = auth.find('Customer_ID', id);
    let account = 'none';
    if (m.str(r, 'Member_Status') === 'disabled') account = 'disabled';
    else if (a !== -1 && auth.str(a, 'Password_Hash')) {
      const expires = auth.get(a, 'Temp_Expires_At');
      if (!isTrue_(auth.get(a, 'Must_Change'))) account = 'active';
      else account = isDate_(expires) && expires.getTime() > now ? 'temp' : 'temp_expired';
    }
    out.push({
      id, name: m.str(r, 'Name'), phone: digits_(m.get(r, 'Phone')), contact: m.str(r, 'Contact_Name'),
      line: m.str(r, 'LINE_Name'), address: m.str(r, 'Address'), active: !isInactive_(m.get(r, 'Active')),
      shop_code: m.str(r, 'Shop_Code'), shop_link: m.str(r, 'Shop_Link'), has_logo: !!m.str(r, 'Logo_File_ID'),
      account, temp_expires_at: a === -1 ? '' : iso_(auth.get(a, 'Temp_Expires_At')),
      password_set_at: a === -1 ? '' : iso_(auth.get(a, 'Password_Set_At'))
    });
  });
  return out;
}

function isImage_(bytes, mime) {
  const b = i => (bytes[i] == null ? -1 : bytes[i] & 0xff);
  const ascii = (at, s) => s.split('').every((ch, i) => b(at + i) === ch.charCodeAt(0));
  if (mime === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b(i) === v);
  if (mime === 'image/jpeg') return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  if (mime === 'image/webp') return ascii(0, 'RIFF') && ascii(8, 'WEBP');
  return false;
}

/** Private Drive folder for logos (made on first upload, id kept in the script property LOGO_FOLDER_ID). */
function logoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('LOGO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { console.error(err); } // folder deleted: make a new one
  }
  const folder = DriveApp.createFolder('SmartMenu shop logos (private)');
  props.setProperty('LOGO_FOLDER_ID', folder.getId());
  return folder;
}
