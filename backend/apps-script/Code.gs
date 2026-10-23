/**
 * SmartMenu → DIFOT order intake (Google Apps Script, standalone project in btgs.sukhumvit Drive, writes to the SANDBOX sheet).
 * Contract: docs/ORDER_CONTRACT.md (order.v1). Orders only ever APPEND rows; never edit or delete.
 * The one exception is makeShopCodes(), run by hand, which fills EMPTY Shop_Code / Shop_Link cells in Master.
 * Sandbox sheet id 1e8xEJsYsWDT4ffvOkiqvVAJVeeSobtkU9wJMN1lISAg (2026-10-22).
 */
const SHEET_ID = '1e8xEJsYsWDT4ffvOkiqvVAJVeeSobtkU9wJMN1lISAg'; // SANDBOX copy. Never the original DIFOT_Pilot_SU22.
const SHOP_ID = 'SU22';
const TZ = 'Asia/Bangkok';
const SITE_URL = 'https://kittanunr.github.io/SmartMenu/';
const ORDER_EXTRA_COLS = ['Source', 'Web_Shop_Name', 'Web_Phone', 'Web_Delivery_Date', 'Web_Note', 'Web_Total', 'Web_Client_ID'];
const MAX_BODY = 30000;            // chars; a real 40-line order is ~8,000
const LOCK_WAIT_MS = 20000;        // then answer 'busy' and let the site retry
const LIMIT_PER_PHONE = 5;         // orders per phone per hour
const LIMIT_ALL = 40;              // orders per hour from the whole site (stops a flood filling the sheet)
const DEDUPE_SCAN_ROWS = 500;      // recent Order rows checked for a repeated client_order_id
const MASTER_EXTRA_COLS = ['Phone', 'Source', 'Address', 'Contact_Name', 'LINE_Name', 'Shop_Code', 'Shop_Link'];
// Shop codes: no 0/O, 1/I/L, so a code read off a sticker is never ambiguous. 10 chars ≈ 49 bits.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
const LIMIT_BAD_CODES = 60;        // wrong shop codes per hour from the whole site, then lookups pause
const ITEM_COLS = ['Item_ID', 'Order_ID', 'SKU', 'Name_TH', 'Qty', 'Qty_Unit', 'Unit_Price', 'Line_Total'];

/** Run once by hand: adds missing columns at the far right and the Order_Items tab. Safe to re-run. */
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  addColsIfMissing_(ss.getSheetByName('Order'), ORDER_EXTRA_COLS);
  addColsIfMissing_(ss.getSheetByName('Master'), MASTER_EXTRA_COLS);
  let items = ss.getSheetByName('Order_Items');
  if (!items) {
    items = ss.insertSheet('Order_Items');
    items.getRange(1, 1, 1, ITEM_COLS.length).setValues([ITEM_COLS]);
  }
  return 'ok';
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
    sh.getRange(r + 1, iCode + 1, 1, 1).setValue(code);
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

/** The active customer whose Shop_Code is `code`, or null. */
function findShop_(ss, code) {
  const data = ss.getSheetByName('Master').getDataRange().getValues();
  const h = data[0];
  const col = name => h.indexOf(name);
  const i = { code: col('Code'), type: col('Type'), name: col('Name'), active: col('Active'), phone: col('Phone'),
    address: col('Address'), contact: col('Contact_Name'), line: col('LINE_Name'), shop: col('Shop_Code') };
  if (i.shop === -1) return null;
  const get = (row, k) => (i[k] === -1 ? '' : String(row[i[k]] == null ? '' : row[i[k]]).trim());
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (get(row, 'shop') !== code || get(row, 'type') !== 'Customer' || isInactive_(row[i.active])) continue;
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

function doGet() {
  return json_({ ok: true, service: 'smartmenu-order', contract: 'order.v1' });
}

/**
 * Error codes the site retries: 'busy', 'server'. Everything else is final (the site offers LINE).
 * A repeated client_order_id gets the first order's id back, so a retried request never writes twice.
 */
function doPost(e) {
  const body = (e && e.postData && e.postData.contents) || '';
  if (body.length > MAX_BODY) return json_({ ok: false, error: 'too_big' });
  let o;
  try { o = JSON.parse(body); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  if (o && o.action === 'shop') return json_(shopLookup_(o.shop_code));
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

    // Ordered from a shop's own QR: name, phone and contact come from Master, not from the browser.
    let shop = null;
    if (o.shop_code) {
      shop = findShop_(ss, o.shop_code);
      if (!shop) return json_({ ok: false, error: 'unknown_shop' });
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

    appendByHeader_(orders, {
      Order_ID: orderId, Shop_ID: SHOP_ID, Order_Date: now, Customer_ID: customerId,
      T1_Ordered: now, Status: 'Received', Customer_Issue: false,
      Source: 'Web', Web_Shop_Name: o.customer.shop_name, Web_Phone: o.customer.phone ? "'" + o.customer.phone : '',
      Web_Delivery_Date: (o.delivery && o.delivery.date) || '',
      Web_Note: [o.delivery && o.delivery.address_note, o.note, o.customer.line_name && ('LINE: ' + o.customer.line_name)].filter(Boolean).join(' | '),
      Web_Total: o.total, Web_Client_ID: o.client_order_id || ''
    });

    appendRowsByHeader_(ss.getSheetByName('Order_Items'), o.items.map((it, i) => ({
      Item_ID: orderId + '-' + (i + 1), Order_ID: orderId, SKU: it.sku, Name_TH: it.name_th,
      Qty: it.qty, Qty_Unit: it.qty_unit, Unit_Price: it.unit_price, Line_Total: it.line_total
    })));

    appendByHeader_(ss.getSheetByName('Event'), {
      Event_ID: 'EW' + Utilities.getUuid().slice(0, 8), Order_ID: orderId, Shop_ID: SHOP_ID,
      Station: 'Web', Action: 'Ordered', Timestamp: now, User: 'web',
      Note: o.items.length + ' items, ฿' + o.total + (shop ? ', shop QR' : '')
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
  if (o.client_order_id != null && !/^[A-Za-z0-9-]{8,64}$/.test(String(o.client_order_id))) return 'client_order_id';
  if (o.shop_code != null && !/^[A-Z2-9]{10}$/.test(String(o.shop_code))) return 'shop_code';
  const c = o.customer || {};
  // With a shop code the shop's details come from Master (see doPost), so the form may leave them out.
  if (!o.shop_code && (!c.shop_name || String(c.shop_name).length > 120)) return 'shop_name';
  if (!o.shop_code && !/^0\d{8,9}$/.test(String(c.phone || ''))) return 'phone';
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
  return null;
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
  let maxW = 0;
  for (let r = 1; r < data.length; r++) {
    if (data[r][iType] !== 'Customer') continue;
    if (String(data[r][iPhone]).replace(/\D/g, '') === c.phone) return data[r][iCode];
    const m = String(data[r][iCode]).match(/^CUS-W(\d+)$/);
    if (m) maxW = Math.max(maxW, Number(m[1]));
  }
  const code = 'CUS-W' + String(maxW + 1).padStart(3, '0');
  appendByHeader_(sh, {
    Code: code, Type: 'Customer', Name: c.shop_name, Category: 'Web',
    Active: 'Yes', Shop_ID: SHOP_ID, Phone: "'" + c.phone, Source: 'Web',
    Address: address || '', Contact_Name: c.contact_name || '', LINE_Name: c.line_name || ''
  });
  return code;
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

function appendByHeader_(sheet, obj) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(head.map(k => (k in obj ? obj[k] : '')));
}

/** Many rows in one write (faster than appendRow per item, so the lock is held for less time). */
function appendRowsByHeader_(sheet, objs) {
  if (!objs.length) return;
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = objs.map(obj => head.map(k => (k in obj ? obj[k] : '')));
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
}

function json_(x) {
  return ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON);
}
