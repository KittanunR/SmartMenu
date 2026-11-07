/**
 * SmartMenu → DIFOT order intake (Google Apps Script, standalone project in btgs.sukhumvit Drive).
 * Writes to the REAL DIFOT app's sheet (teammate's "BiTFODG Pilot", DIFOT_Pilot_SU22) since 2026-11-04; before that a
 * sandbox copy. A web order lands as Status "Accepted" (Petch, 2026-11-04), so it goes straight to the app's packing list.
 * Contract: docs/ORDER_CONTRACT.md (order.v1). Orders only ever APPEND rows; never edit or delete.
 * One exception (2026-11-03): a shop's complaint (Member.gs complain_) sets Status = Issue and Customer_Issue on that
 * shop's own delivered order, as the DIFOT app's own "Customer Issue" step does.
 * The exceptions are run by hand and only fill EMPTY cells: makeShopCodes() (Master.Shop_Code / Shop_Link) and
 * backfillCategories() (Order_Items.Category).
 */
const SHEET_ID = '1UEIDEDJOoue21ClryiWv55b1SnfrPN_gw6yE3ktxvx8';          // REAL: DIFOT_Pilot_SU22 (from 2026-11-04)
const SANDBOX_SHEET_ID = '1e8xEJsYsWDT4ffvOkiqvVAJVeeSobtkU9wJMN1lISAg';  // old sandbox copy; Migrate.gs reads members from it
const SHOP_ID = 'SU22';
const TZ = 'Asia/Bangkok';
const SITE_URL = 'https://kittanunr.github.io/SmartMenu/';
// Auth = how the order was identified: 'guest' (typed form), 'shop_qr' (shop's own link), 'member' (logged in).
// The real Order has its own Source, Note and Req_Date (2026-11-04), so only what it has no column for is added.
const ORDER_EXTRA_COLS = ['Source', 'Web_Shop_Name', 'Web_Phone', 'Web_Total', 'Web_Client_ID', 'Auth'];
// A web order in the DIFOT app's own terms (read from its column rules 2026-11-04). Status Accepted = what the app
// gives every order not from LINE OA; Created_By / Accepted_By stay empty (no staff made it). The site asks for a day,
// not a time: Req_Slot = the last delivery round of the day (Master Setting SET-SLOT-END).
const WEB_ORDER = { status: 'Accepted', source: 'SmartMenu', channel: 'เว็บ', deliveryMode: 'ไรเดอร์ร้าน',
  slotSetting: 'SET-SLOT-END', slotDefault: '17:00' };
// Our SKUs become Master rows (Type SKU) the first time they are ordered, so the app can pick their Order_Line rows.
const SKU_MASTER_CATEGORY = { PK: 'Pork', CK: 'Chicken', EG: 'Egg', FS: 'Fish' };
const UNIT_TH = { kg: 'กก.', tray: 'แผง', pack: 'แพ็ค' };
// Who may order and how much (Petch, 2026-11-07): only a logged-in shop (Member.gs session), and the goods must come
// to at least ฿500. Delivery is free, so there is no fee to add: the check is on the goods only. app.js shows the same
// rules (MIN_ORDER_THB); this is the check that counts. A guest or shop-QR order is refused with 'login_required'.
const ORDER_RULES = { loginRequired: true, minTotal: 500 };
const MAX_BODY = 30000;            // chars; a real 40-line order is ~8,000
const MAX_COMPLAINT_BODY = 2700000; // a complaint carries up to 3 photos of ≤ 600 KB (base64 ≈ 800 K chars each)
const LOCK_WAIT_MS = 20000;        // then answer 'busy' and let the site retry
const LIMIT_PER_PHONE = 5;         // orders per phone per hour
const LIMIT_ALL = 40;              // orders per hour from the whole site (stops a flood filling the sheet)
const DEDUPE_SCAN_ROWS = 500;      // recent Order rows checked for a repeated client_order_id
const MASTER_EXTRA_COLS = ['Phone', 'Source', 'Address', 'Contact_Name', 'LINE_Name', 'Shop_Code', 'Shop_Link',
  'Logo_File_ID', 'Member_Status', 'Logo_Image'];
// Shop codes: no 0/O, 1/I/L, so a code read off a sticker is never ambiguous. 10 chars ≈ 49 bits.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
const LIMIT_BAD_CODES = 60;        // wrong shop codes per hour from the whole site, then lookups pause
const ITEM_COLS = ['Item_ID', 'Order_ID', 'SKU', 'Name_TH', 'Qty', 'Qty_Unit', 'Unit_Price', 'Line_Total', 'Category'];
// Shop accounts. Password_Hash is bcrypt only; no password, temporary or chosen, is ever written anywhere.
// Login_Name (2026-10-27): a shop may log in with its phone or this name; added at the far right on older sheets.
const AUTH_COLS = ['Customer_ID', 'Login_Phone', 'Password_Hash', 'Must_Change', 'Temp_Expires_At', 'Password_Set_At',
  'Login_Name'];
const SESSION_COLS = ['Token_Hash', 'Customer_ID', 'Created_At', 'Expires_At', 'Last_Seen', 'Revoked_At'];
// Who changed which shop in the admin page (Admin.gs). Never holds a password.
const ADMIN_LOG_COLS = ['Timestamp', 'User', 'Action', 'Customer_ID', 'Note'];
// Same rule as the catalog check (scripts/lib/checks.mjs SKU_PREFIX): a SKU's prefix names its category.
const SKU_CATEGORY = { PK: 'pork', CK: 'chicken', EG: 'egg', FS: 'fish' };
// DIFOT's own Exception table (first 9) + what a web complaint adds (2026-11-03). Photos are AppSheet Image paths.
// SKU_Code holds our SKU (PK-001…), which DIFOT's Master does not list, so Web_Item carries the product name.
const EXCEPTION_COLS = ['Exception_ID', 'Order_ID', 'Shop_ID', 'Stage', 'SKU_Code', 'Reason_Code', 'Other_Note',
  'Logged_At', 'Logged_By', 'Source', 'Complaint_ID', 'Web_Item', 'Photo', 'Photo_2', 'Photo_3'];

/** Run by hand after each Code.gs update: adds missing tabs, and missing columns at the far right. Safe to re-run. */
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  addColsIfMissing_(ss.getSheetByName('Order'), ORDER_EXTRA_COLS);
  addColsIfMissing_(ss.getSheetByName('Master'), MASTER_EXTRA_COLS);
  ensureTab_(ss, 'Order_Items', ITEM_COLS);
  ensureTab_(ss, 'Member_Auth', AUTH_COLS);
  ensureTab_(ss, 'Sessions', SESSION_COLS);
  ensureTab_(ss, 'Admin_Log', ADMIN_LOG_COLS);
  ensureTab_(ss, 'Exception', EXCEPTION_COLS);
  return 'ok';
}

function ensureTab_(ss, name, cols) {
  const sheet = ss.getSheetByName(name);
  if (sheet) addColsIfMissing_(sheet, cols);
  else ss.insertSheet(name).getRange(1, 1, 1, cols.length).setValues([cols]);
}

function categoryOf_(sku) {
  return SKU_CATEGORY[String(sku).slice(0, 2)] || 'other';
}

/** Run by hand once after setup(): order lines written before Category existed get it from their SKU. */
function backfillCategories() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Order_Items');
  const data = sh.getDataRange().getValues();
  const iSku = data[0].indexOf('SKU'), iCat = data[0].indexOf('Category');
  if (iCat === -1) throw new Error('Run setup() first: Order_Items has no Category column.');
  let filled = 0;
  for (let r = 1; r < data.length; r++) {
    if (data[r][iCat] || !data[r][iSku]) continue;
    sh.getRange(r + 1, iCat + 1, 1, 1).setValue(categoryOf_(data[r][iSku]));
    filled++;
  }
  console.log(filled + ' order line(s) got a category');
  return filled;
}

function addColsIfMissing_(sheet, cols) {
  const lastCol = sheet.getLastColumn();
  const head = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const missing = cols.filter(c => head.indexOf(c) === -1);
  if (missing.length) sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
}

/**
 * Run by hand after adding customers to Master (Type = Customer): every active customer without a Shop_Code
 * gets a new random code, and Shop_Link gets the menu link that goes into that shop's QR.
 * Never changes a code that is already there. To retire a leaked code: clear that row's Shop_Code and
 * Shop_Link, run this again, and give the shop its new QR (the old one stops working at once).
 */
function makeShopCodes() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Master');
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const iType = h.indexOf('Type'), iActive = h.indexOf('Active'), iCode = h.indexOf('Shop_Code'), iLink = h.indexOf('Shop_Link');
  if (iCode === -1 || iLink === -1) throw new Error('Run setup() first: Master has no Shop_Code / Shop_Link column.');
  const used = {};
  data.forEach(r => { if (r[iCode]) used[r[iCode]] = true; });
  let made = 0;
  for (let r = 1; r < data.length; r++) {
    if (data[r][iType] !== 'Customer' || data[r][iCode] || isInactive_(data[r][iActive])) continue;
    let code;
    do { code = newShopCode_(); } while (used[code]);
    used[code] = true;
    sh.getRange(r + 1, iCode + 1, 1, 1).setValue("'" + code);   // ' = text: a code like 2E45678923 would otherwise become a number
    sh.getRange(r + 1, iLink + 1, 1, 1).setValue(SITE_URL + '?shop=' + code);
    made++;
  }
  console.log(made + ' new shop code(s)');
  return made;
}

function newShopCode_() {
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/[^0-9a-f]/g, '');
  let out = '';
  for (let i = 0; out.length < CODE_LENGTH; i += 2) out += CODE_ALPHABET[parseInt(hex.substr(i, 2), 16) % CODE_ALPHABET.length];
  return out;
}

const isInactive_ = v => ['no', 'false', 'n', '0'].indexOf(String(v).trim().toLowerCase()) !== -1;

/** The active customer whose Shop_Code is `code` (or whose Code is `code` when field = 'code'), or null. */
function findShop_(ss, code, field) {
  const data = ss.getSheetByName('Master').getDataRange().getValues();
  const h = data[0];
  const col = name => h.indexOf(name);
  const i = { code: col('Code'), type: col('Type'), name: col('Name'), active: col('Active'), phone: col('Phone'),
    address: col('Address'), contact: col('Contact_Name'), line: col('LINE_Name'), shop: col('Shop_Code') };
  if (i.shop === -1) return null;
  const get = (row, k) => (i[k] === -1 ? '' : String(row[i[k]] == null ? '' : row[i[k]]).trim());
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (get(row, field === 'code' ? 'code' : 'shop') !== code || get(row, 'type') !== 'Customer' || isInactive_(row[i.active])) continue;
    return { id: get(row, 'code'), name: get(row, 'name'), phone: get(row, 'phone').replace(/\D/g, ''),
      address: get(row, 'address'), contact: get(row, 'contact'), line: get(row, 'line') };
  }
  return null;
}

/** What the site may show for a shop code: the shop name, and phone / address only partly. */
function shopLookup_(code) {
  const cache = CacheService.getScriptCache();
  const kBad = 'rl:badcode:' + Utilities.formatDate(new Date(), TZ, 'yyMMddHH');
  const nBad = Number(cache.get(kBad)) || 0;
  if (nBad >= LIMIT_BAD_CODES) return { ok: false, error: 'rate' };
  const shop = /^[A-Z2-9]{10}$/.test(String(code || '')) ? findShop_(SpreadsheetApp.openById(SHEET_ID), code) : null;
  if (!shop) {
    cache.put(kBad, String(nBad + 1), 3700);
    return { ok: false, error: 'unknown_shop' };
  }
  return { ok: true, shop: { name: shop.name, phone_masked: maskPhone_(shop.phone), address_masked: maskAddress_(shop.address) } };
}

const maskPhone_ = p => (p.length >= 4 ? 'xxx-xxx-' + p.slice(-4) : '');
// Enough of the start for the shop to recognise its own address, not enough to find it.
function maskAddress_(a) {
  const s = String(a || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.slice(0, Math.min(12, Math.ceil(s.length / 3))).trim() + '…';
}

/** The admin page for a signed-in admin (Admin.gs), otherwise the public health check the order deployment answers. */
function doGet() {
  if (adminEmail_()) return adminPage_();
  return json_({ ok: true, service: 'smartmenu-order', contract: 'order.v1' });
}

/**
 * Error codes the site retries: 'busy', 'server'. Everything else is final (the site offers LINE).
 * A repeated client_order_id gets the first order's id back, so a retried request never writes twice.
 */
function doPost(e) {
  const body = (e && e.postData && e.postData.contents) || '';
  if (body.length > MAX_COMPLAINT_BODY) return json_({ ok: false, error: 'too_big' });
  let o;
  try { o = JSON.parse(body); } catch (err) { return json_({ ok: false, error: body.length > MAX_BODY ? 'too_big' : 'bad_json' }); }
  // Only a complaint (photos) may be bigger than an order.
  if (body.length > MAX_BODY && !(o && o.action === 'complain')) return json_({ ok: false, error: 'too_big' });
  if (o && o.action === 'shop') return json_(shopLookup_(o.shop_code));
  if (o && MEMBER_ACTIONS[o.action] === true) return json_(memberAction_(o));   // shop login: Member.gs
  const bad = validate_(o);
  if (bad) return json_({ ok: false, error: bad });

  const cache = CacheService.getScriptCache();
  const cid = o.client_order_id ? 'cid:' + o.client_order_id : '';
  const seen = cid && cache.get(cid);
  if (seen) return json_({ ok: true, order_id: seen, duplicate: true });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return json_({ ok: false, error: 'busy' });
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const orders = ss.getSheetByName('Order');
    // Checked again under the lock: the first request may have finished while this one waited.
    const earlier = (cid && cache.get(cid)) || (o.client_order_id && findByClientId_(orders, o.client_order_id));
    if (earlier) {
      if (cid) cache.put(cid, earlier, 21600);
      return json_({ ok: true, order_id: earlier, duplicate: true });
    }

    // Logged-in shop (Member.gs) or a shop's own QR: name, phone and contact come from Master, not from the browser.
    // A login wins over a QR code in the same order.
    let shop = null;
    const member = !!o.session;
    if (member) {
      const s = sessionOf_(ss, o.session);
      shop = s && findShop_(ss, s.id, 'code');
      if (!shop) return json_({ ok: false, error: 'session' });
    } else if (o.shop_code) {
      shop = findShop_(ss, o.shop_code);
      if (!shop) return json_({ ok: false, error: 'unknown_shop' });
    }
    if (shop) {
      o.customer = { shop_name: shop.name, contact_name: shop.contact, phone: shop.phone, line_name: shop.line };
      o.delivery = o.delivery || {};
      if (!o.delivery.address_note) o.delivery.address_note = shop.address;
    }

    const now = new Date();
    const hour = Utilities.formatDate(now, TZ, 'yyMMddHH');
    const kPhone = 'rl:p:' + (o.customer.phone || o.shop_code) + ':' + hour;
    const kAll = 'rl:all:' + hour;
    const nPhone = Number(cache.get(kPhone)) || 0;
    const nAll = Number(cache.get(kAll)) || 0;
    if (nPhone >= LIMIT_PER_PHONE || nAll >= LIMIT_ALL) return json_({ ok: false, error: 'rate' });

    const customerId = shop ? shop.id : findOrCreateCustomer_(ss, o.customer, (o.delivery && o.delivery.address_note) || '');
    const orderId = nextOrderId_(orders, now);

    // Promise_P is an app formula in the DIFOT app (Req_Date + Req_Slot): AppSheet only fills it for rows made in the
    // app, and its KPI sheet (on time %) reads it, so a web order writes it too.
    const reqDate = (o.delivery && o.delivery.date) || Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    const slot = deliverySlot_(ss);
    appendByHeader_(orders, {
      Order_ID: orderId, Shop_ID: SHOP_ID, Source: WEB_ORDER.source, Channel: WEB_ORDER.channel,
      Order_Date: now, T1_Ordered: now, T2_Saved: now, Customer_ID: customerId,
      Req_Date: reqDate, Req_Slot: slot, Promise_P: reqDate + ' ' + slot,
      Delivery_Mode: WEB_ORDER.deliveryMode, Note: orderNote_(o), T_Accept: now, Customer_Issue: false, Status: WEB_ORDER.status,
      Web_Shop_Name: o.customer.shop_name, Web_Phone: o.customer.phone ? "'" + o.customer.phone : '',
      Web_Total: o.total, Web_Client_ID: o.client_order_id || '', Auth: member ? 'member' : shop ? 'shop_qr' : 'guest'
    });

    appendRowsByHeader_(ss.getSheetByName('Order_Items'), o.items.map((it, i) => ({
      Item_ID: orderId + '-' + (i + 1), Order_ID: orderId, SKU: it.sku, Name_TH: it.name_th,
      Qty: it.qty, Qty_Unit: it.qty_unit, Unit_Price: it.unit_price, Line_Total: it.line_total, Category: categoryOf_(it.sku)
    })));

    // The DIFOT app's own lines (it picks from these): one per item, SKU known to its Master.
    const appLines = ss.getSheetByName('Order_Line');
    if (appLines) {
      ensureSkus_(ss, o.items);
      appendRowsByHeader_(appLines, o.items.map((it, i) => ({
        Line_ID: orderId + '-' + (i + 1), Order_ID: orderId, SKU_Code: it.sku, Unit: UNIT_TH[it.qty_unit] || it.qty_unit,
        Qty_Ordered: it.qty, Unit_Price: it.unit_price
      })));
    }

    appendByHeader_(ss.getSheetByName('Event'), {
      Event_ID: 'EW' + Utilities.getUuid().slice(0, 8), Order_ID: orderId, Shop_ID: SHOP_ID,
      Station: 'Web', Action: 'Ordered', Timestamp: now, User: 'web',
      Note: o.items.length + ' items, ฿' + o.total + (member ? ', member' : shop ? ', shop QR' : '')
    });
    SpreadsheetApp.flush();

    if (cid) cache.put(cid, orderId, 21600);
    cache.put(kPhone, String(nPhone + 1), 3700);
    cache.put(kAll, String(nAll + 1), 3700);
    return json_({ ok: true, order_id: orderId });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

function validate_(o) {
  if (!o || o.contract !== 'order.v1') return 'contract';
  if (o.hp) return 'spam';
  if (ORDER_RULES.loginRequired && !o.session) return 'login_required';
  if (o.client_order_id != null && !/^[A-Za-z0-9-]{8,64}$/.test(String(o.client_order_id))) return 'client_order_id';
  if (o.shop_code != null && !/^[A-Z2-9]{10}$/.test(String(o.shop_code))) return 'shop_code';
  if (o.session != null && !TOKEN_RE.test(String(o.session))) return 'session';
  const c = o.customer || {};
  // With a login or a shop code the shop's details come from Master (see doPost), so the form may leave them out.
  const known = o.shop_code || o.session;
  if (!known && (!c.shop_name || String(c.shop_name).length > 120)) return 'shop_name';
  if (!known && !/^0\d{8,9}$/.test(String(c.phone || ''))) return 'phone';
  if (String(c.contact_name || '').length > 120 || String(c.line_name || '').length > 120) return 'customer';
  const d = o.delivery || {};
  if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) return 'date';
  if (String(d.address_note || '').length > 400 || String(o.note || '').length > 400) return 'note';
  if (!Array.isArray(o.items) || o.items.length < 1 || o.items.length > 40) return 'items';
  let sum = 0;
  for (const it of o.items) {
    if (!/^[A-Z]{2}-\d{3}$/.test(String(it.sku))) return 'sku';
    if (!(it.qty > 0 && it.qty <= 500)) return 'qty';
    if (!(it.unit_price > 0 && it.unit_price < 100000)) return 'price';
    if (Math.abs(it.qty * it.unit_price - it.line_total) > 0.01) return 'line_total';
    sum += it.line_total;
  }
  if (Math.abs(sum - o.total) > 0.05) return 'total';
  if (sum < ORDER_RULES.minTotal - 0.005) return 'min_order';
  return null;
}

/** What the shop staff read on the order: address, note, who to call. */
function orderNote_(o) {
  const c = o.customer || {};
  return [o.delivery && o.delivery.address_note, o.note, c.contact_name && ('ติดต่อ: ' + c.contact_name),
    c.phone && ('โทร ' + c.phone), c.line_name && ('LINE: ' + c.line_name)].filter(Boolean).join(' | ');
}

/** The delivery round a web order gets: Master Setting SET-SLOT-END (e.g. 17:00), else 17:00. */
function deliverySlot_(ss) {
  const m = ss.getSheetByName('Master').getDataRange().getValues();
  const iCode = m[0].indexOf('Code'), iValue = m[0].indexOf('Value');
  for (let r = 1; r < m.length; r++) {
    if (m[r][iCode] !== WEB_ORDER.slotSetting) continue;
    const v = m[r][iValue];
    if (v && typeof v.getTime === 'function') return Utilities.formatDate(v, TZ, 'HH:mm');
    if (/^\d{1,2}:\d{2}/.test(String(v))) return String(v).slice(0, 5).padStart(5, '0');
  }
  return WEB_ORDER.slotDefault;
}

/** Adds each SKU the app's Master does not list yet (Type SKU, active), after its last Sort_Order. */
function ensureSkus_(ss, items) {
  const sh = ss.getSheetByName('Master');
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const known = {};
  let sort = 0;
  data.slice(1).forEach(row => {
    known[row[h.indexOf('Code')]] = true;
    if (row[h.indexOf('Type')] === 'SKU') sort = Math.max(sort, Number(row[h.indexOf('Sort_Order')]) || 0);
  });
  const add = [];
  items.forEach(it => {
    if (known[it.sku]) return;
    known[it.sku] = true;
    add.push({ Code: it.sku, Type: 'SKU', Name: String(it.name_th || it.sku).slice(0, 120),
      Category: SKU_MASTER_CATEGORY[String(it.sku).slice(0, 2)] || 'Other', Sort_Order: ++sort, Value: '',
      Active: 'Yes', Shop_ID: SHOP_ID, Unit: UNIT_TH[it.qty_unit] || it.qty_unit, Source: 'Web' });
  });
  appendRowsByHeader_(sh, add);
}

/** The Order_ID already written for this client_order_id, or '' (only the most recent rows are read). */
function findByClientId_(sheet, clientId) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const iCid = head.indexOf('Web_Client_ID'), iId = head.indexOf('Order_ID');
  const last = sheet.getLastRow();
  if (iCid === -1 || iId === -1 || last < 2) return '';
  const first = Math.max(2, last - DEDUPE_SCAN_ROWS + 1);
  const rows = sheet.getRange(first, 1, last - first + 1, head.length).getValues();
  for (let r = rows.length - 1; r >= 0; r--) {
    if (String(rows[r][iCid]) === clientId) return String(rows[r][iId]);
  }
  return '';
}

function findOrCreateCustomer_(ss, c, address) {
  const sh = ss.getSheetByName('Master');
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const iCode = h.indexOf('Code'), iType = h.indexOf('Type'), iPhone = h.indexOf('Phone');
  for (let r = 1; r < data.length; r++) {
    if (data[r][iType] !== 'Customer') continue;
    if (String(data[r][iPhone]).replace(/\D/g, '') === c.phone) return data[r][iCode];
  }
  const code = nextCustomerCode_(data);
  appendByHeader_(sh, {
    Code: code, Type: 'Customer', Name: c.shop_name, Category: 'Web',
    Active: 'Yes', Shop_ID: SHOP_ID, Phone: "'" + c.phone, Source: 'Web',
    Address: address || '', Contact_Name: c.contact_name || '', LINE_Name: c.line_name || ''
  });
  return code;
}

/** CUS-W + (highest web customer number + 1), from Master's values (header row first). */
function nextCustomerCode_(data) {
  const iCode = data[0].indexOf('Code');
  let maxW = 0;
  for (let r = 1; r < data.length; r++) {
    const m = String(data[r][iCode]).match(/^CUS-W(\d+)$/);
    if (m) maxW = Math.max(maxW, Number(m[1]));
  }
  return 'CUS-W' + String(maxW + 1).padStart(3, '0');
}

function nextOrderId_(sheet, now) {
  const prefix = 'W' + Utilities.formatDate(now, TZ, 'yyMMdd') + '-';
  const ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues().flat();
  // max+1, not count+1: stays unique even after test rows are deleted (fixed 2026-10-23)
  const n = ids.reduce((m, id) => {
    const s = String(id);
    return s.indexOf(prefix) === 0 ? Math.max(m, Number(s.slice(prefix.length)) || 0) : m;
  }, 0) + 1;
  return prefix + String(n).padStart(3, '0');
}

// Sheets turns text starting with = + - @ into a formula (=IMPORTDATA("https://…"&A2) typed into the order form could
// send sheet data out). Every row we write goes through this, so typed text stays text; the apostrophe is not stored.
const plain_ = v => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v);

function appendByHeader_(sheet, obj) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(head.map(k => (k in obj ? plain_(obj[k]) : '')));
}

/** Many rows in one write (faster than appendRow per item, so the lock is held for less time). */
function appendRowsByHeader_(sheet, objs) {
  if (!objs.length) return;
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = objs.map(obj => head.map(k => (k in obj ? plain_(obj[k]) : '')));
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
}

function json_(x) {
  return ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON);
}
