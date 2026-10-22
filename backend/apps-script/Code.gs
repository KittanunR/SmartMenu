/**
 * SmartMenu → DIFOT order intake (Google Apps Script, standalone project in btgs.sukhumvit Drive, writes to the SANDBOX sheet).
 * Contract: docs/ORDER_CONTRACT.md (order.v1). Only ever APPENDS rows; never edits or deletes.
 * Sandbox sheet id 1e8xEJsYsWDT4ffvOkiqvVAJVeeSobtkU9wJMN1lISAg (2026-10-22).
 */
const SHEET_ID = '1e8xEJsYsWDT4ffvOkiqvVAJVeeSobtkU9wJMN1lISAg'; // SANDBOX copy. Never the original DIFOT_Pilot_SU22.
const SHOP_ID = 'SU22';
const TZ = 'Asia/Bangkok';
const ORDER_EXTRA_COLS = ['Source', 'Web_Shop_Name', 'Web_Phone', 'Web_Delivery_Date', 'Web_Note', 'Web_Total'];
const MASTER_EXTRA_COLS = ['Phone', 'Source'];
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

function doGet() {
  return json_({ ok: true, service: 'smartmenu-order', contract: 'order.v1' });
}

function doPost(e) {
  let o;
  try { o = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  const bad = validate_(o);
  if (bad) return json_({ ok: false, error: bad });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const now = new Date();
    const customerId = findOrCreateCustomer_(ss, o.customer, now);
    const orderId = nextOrderId_(ss.getSheetByName('Order'), now);

    appendByHeader_(ss.getSheetByName('Order'), {
      Order_ID: orderId, Shop_ID: SHOP_ID, Order_Date: now, Customer_ID: customerId,
      T1_Ordered: now, Status: 'Received', Customer_Issue: false,
      Source: 'Web', Web_Shop_Name: o.customer.shop_name, Web_Phone: "'" + o.customer.phone,
      Web_Delivery_Date: (o.delivery && o.delivery.date) || '',
      Web_Note: [o.delivery && o.delivery.address_note, o.note, o.customer.line_name && ('LINE: ' + o.customer.line_name)].filter(Boolean).join(' | '),
      Web_Total: o.total
    });

    const items = ss.getSheetByName('Order_Items');
    o.items.forEach((it, i) => appendByHeader_(items, {
      Item_ID: orderId + '-' + (i + 1), Order_ID: orderId, SKU: it.sku, Name_TH: it.name_th,
      Qty: it.qty, Qty_Unit: it.qty_unit, Unit_Price: it.unit_price, Line_Total: it.line_total
    }));

    appendByHeader_(ss.getSheetByName('Event'), {
      Event_ID: 'EW' + Utilities.getUuid().slice(0, 8), Order_ID: orderId, Shop_ID: SHOP_ID,
      Station: 'Web', Action: 'Ordered', Timestamp: now, User: 'web',
      Note: o.items.length + ' items, ฿' + o.total
    });
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
  const c = o.customer || {};
  if (!c.shop_name || String(c.shop_name).length > 120) return 'shop_name';
  if (!/^0\d{8,9}$/.test(String(c.phone || ''))) return 'phone';
  if (!Array.isArray(o.items) || o.items.length < 1 || o.items.length > 40) return 'items';
  for (const it of o.items) {
    if (!/^[A-Z]{2}-\d{3}$/.test(String(it.sku))) return 'sku';
    if (!(it.qty > 0 && it.qty <= 500)) return 'qty';
    if (!(it.unit_price > 0)) return 'price';
  }
  return null;
}

function findOrCreateCustomer_(ss, c, now) {
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
    Active: 'Yes', Shop_ID: SHOP_ID, Phone: "'" + c.phone, Source: 'Web'
  });
  return code;
}

function nextOrderId_(sheet, now) {
  const prefix = 'W' + Utilities.formatDate(now, TZ, 'yyMMdd') + '-';
  const ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues().flat();
  const n = ids.filter(id => String(id).indexOf(prefix) === 0).length + 1;
  return prefix + String(n).padStart(3, '0');
}

function appendByHeader_(sheet, obj) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(head.map(k => (k in obj ? obj[k] : '')));
}

function json_(x) {
  return ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON);
}
