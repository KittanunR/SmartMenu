// Order History (Phase 4): a logged-in shop sees its own web orders (login or its own QR), newest first, with lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, guestOrder } from '../helpers/apps-script.mjs';

const OWNER = 'owner@example.com';
const PHONE = '0812345678';
const DAY = 24 * 3600 * 1000;

function ready() {
  const b = loadBackend();
  b.ctx.setup();
  b.admin = (fn, ...args) => {
    b.session.user = OWNER;
    try { return JSON.parse(JSON.stringify(b.ctx[fn](...args))); } finally { b.session.user = ''; }
  };
  // A shop that has finished its first login: { id, token, shopCode }.
  b.member = (over = {}) => {
    const res = b.admin('adminCreateShop', { name: 'Café Sukhumvit', phone: PHONE, contact: 'Ken', address: '22 Sukhumvit Soi 22', ...over });
    const first = b.post({ action: 'login', phone: over.phone || PHONE, password: res.temp_password });
    const done = b.post({ action: 'set_password', change_token: first.change_token, new_password: 'mango-sticky-rice' });
    return { id: res.shop.id, token: done.token, shopCode: res.shop.shop_code };
  };
  b.history = token => b.post({ action: 'history', token });
  // Writes an order row straight into the sheet (skips the per-phone hourly limit), with one line.
  b.addOrder = ({ id, customer, auth, daysAgo = 0, status = 'Received', delivery = '2026-10-25', total = 100, sku = 'PK-001' }) => {
    const put = (tab, row) => { const s = b.sheet(tab); s.appendRow(s.header().map(h => row[h] ?? '')); };
    put('Order', { Order_ID: id, Shop_ID: 'SU22', Order_Date: new Date(Date.now() - daysAgo * DAY), Customer_ID: customer,
      Status: status, Source: 'Web', Web_Phone: PHONE, Web_Note: '22 Sukhumvit Soi 22 | LINE: ken', Web_Delivery_Date: delivery,
      Web_Total: total, Auth: auth });
    put('Order_Items', { Item_ID: id + '-1', Order_ID: id, SKU: sku, Name_TH: 'หมู', Qty: 2, Qty_Unit: 'kg', Unit_Price: 50, Line_Total: total });
  };
  return b;
}

test('history: the shop\'s own member and shop-QR orders, newest first, each with its lines at the price paid', () => {
  const b = ready();
  const m = b.member();
  assert.equal(b.post(guestOrder({ session: m.token, customer: {} })).ok, true);   // a real member order, today
  b.addOrder({ id: 'W261001-001', customer: m.id, auth: 'shop_qr', daysAgo: 20, status: 'Delivered' });
  b.addOrder({ id: 'W261010-001', customer: m.id, auth: 'member', daysAgo: 10, status: 'Out' });

  const res = b.history(m.token);
  assert.equal(res.ok, true);
  assert.equal(res.days, 90);
  assert.deepEqual(res.orders.map(o => o.id).slice(1), ['W261010-001', 'W261001-001']);
  const [today] = res.orders;
  assert.equal(today.total, 370);
  assert.equal(today.status, 'Received');
  assert.equal(today.delivery_date, '2026-10-25');
  assert.ok(!Number.isNaN(Date.parse(today.ordered_at)));
  assert.deepEqual(today.items, [
    { sku: 'PK-001', name_th: 'มันแข็งหมู', qty: 3, qty_unit: 'kg', unit_price: 80, line_total: 240 },
    { sku: 'CK-001', name_th: 'ไก่', qty: 2, qty_unit: 'kg', unit_price: 65, line_total: 130 },
  ]);
  assert.equal(res.orders[1].status, 'Out');
  assert.equal(res.orders[2].items.length, 1);
});

test('history leaves out guest orders filed under the shop by a typed phone, and other shops\' orders', () => {
  const b = ready();
  const m = b.member();
  const other = b.member({ name: 'Other', phone: '0899999999' });
  // Anyone can type the shop's phone into the guest form: the order lands under this Customer_ID as Auth = guest.
  assert.equal(b.post(guestOrder({ customer: { shop_name: 'Stranger', phone: PHONE } })).ok, true);
  assert.equal(b.sheet('Order').records()[0].Customer_ID, m.id);
  b.addOrder({ id: 'W261020-001', customer: m.id, auth: '' });              // before Phase 1: no Auth
  b.addOrder({ id: 'W261020-002', customer: other.id, auth: 'member' });
  b.addOrder({ id: 'W261020-003', customer: m.id, auth: 'member' });

  assert.deepEqual(b.history(m.token).orders.map(o => o.id), ['W261020-003']);
  assert.deepEqual(b.history(other.token).orders.map(o => o.id), ['W261020-002']);
});

test('history goes back 90 days and at most 50 orders', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ id: 'OLD', customer: m.id, auth: 'member', daysAgo: 91 });
  b.addOrder({ id: 'EDGE', customer: m.id, auth: 'member', daysAgo: 89 });
  assert.deepEqual(b.history(m.token).orders.map(o => o.id), ['EDGE']);

  for (let i = 1; i <= 55; i++) b.addOrder({ id: `N${i}`, customer: m.id, auth: 'member', daysAgo: 80 - i });
  const ids = b.history(m.token).orders.map(o => o.id);
  assert.equal(ids.length, 50);
  assert.equal(ids[0], 'N55');
  assert.ok(!ids.includes('EDGE'));
});

test('history sends no phone, address or note, and turns a sheet date into yyyy-MM-dd', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ id: 'W1', customer: m.id, auth: 'member', delivery: new Date('2026-10-26T00:00:00+07:00') });
  const res = b.history(m.token);
  assert.deepEqual(Object.keys(res.orders[0]).sort(), ['delivery_date', 'id', 'items', 'ordered_at', 'status', 'total']);
  assert.equal(res.orders[0].delivery_date, '2026-10-26');
  assert.doesNotMatch(JSON.stringify(res), /0812345678|Sukhumvit Soi|LINE/);
});

test('history needs a live login: a bad, logged-out or reset session gets nothing', () => {
  const b = ready();
  const m = b.member();
  b.addOrder({ id: 'W1', customer: m.id, auth: 'member' });
  assert.deepEqual(b.history('nope'), { ok: false, error: 'session' });
  assert.deepEqual(b.history(''), { ok: false, error: 'session' });
  // A shop QR code is for ordering only: it never opens History.
  assert.deepEqual(b.post({ action: 'history', shop_code: m.shopCode }), { ok: false, error: 'session' });
  b.admin('adminIssuePassword', m.id);
  assert.deepEqual(b.history(m.token), { ok: false, error: 'session' });
});

test('history with no orders is an empty list', () => {
  const b = ready();
  const m = b.member();
  assert.deepEqual(b.history(m.token), { ok: true, days: 90, orders: [] });
});
