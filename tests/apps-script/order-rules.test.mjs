// Ordering rules (Petch, 2026-11-07) — Code.gs ORDER_RULES, checked on the server whatever the site shows:
// 1) only a logged-in shop may order (no guest, no shop-QR-only order) → 'login_required';
// 2) the goods must come to ฿500 or more (delivery is free, so goods only) → 'min_order'.
// A refused order writes nothing. These tests run with the real rules (no oldOrderRules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, guestOrder, addShop } from '../helpers/apps-script.mjs';

const OWNER = 'owner@example.com';
const PHONE = '0812345678';

function ready() {
  const b = loadBackend();
  b.ctx.setup();
  const admin = (fn, ...args) => {
    b.session.user = OWNER;
    try { return JSON.parse(JSON.stringify(b.ctx[fn](...args))); } finally { b.session.user = ''; }
  };
  // A shop that has finished its first login: its session token.
  b.member = () => {
    const shop = admin('adminCreateShop', { name: 'Café Sukhumvit', phone: PHONE, address: '22 Sukhumvit Soi 22' });
    const first = b.post({ action: 'login', phone: PHONE, password: shop.temp_password });
    return b.post({ action: 'set_password', change_token: first.change_token, new_password: 'mango-sticky-rice' }).token;
  };
  b.written = () => ['Order', 'Order_Items', 'Order_Line', 'Event'].reduce((n, t) => n + (b.sheet(t) ? b.sheet(t).records().length : 0), 0);
  return b;
}

/** An order of `qty` kg of PK-001 at ฿80 (line total qty × 80), sent with this session (or none). */
function orderOf(qty, session, over = {}) {
  const o = guestOrder({
    items: [{ sku: 'PK-001', name_th: 'มันแข็งหมู', name_en: 'Pork back fat', qty, qty_unit: 'kg', unit_price: 80, line_total: qty * 80 }],
    total: qty * 80,
    ...over,
  });
  if (session) { o.session = session; o.customer = {}; }
  return o;
}

// ---------- 1. login ----------
test('a guest order (typed shop name and phone, no login) is refused and writes nothing', () => {
  const b = ready();
  assert.deepEqual(b.post(orderOf(10)), { ok: false, error: 'login_required' });   // ฿800: big enough, still refused
  assert.equal(b.written(), 0);
  assert.equal(b.sheet('Master').records().filter(r => r.Type === 'Customer').length, 0, 'no customer row made');
});

test('a shop-QR order without a login is refused: the QR shows who you are, it does not let you order', () => {
  const b = ready();
  addShop(b.sheet('Master'), { shopCode: 'ABCDEFGH23' });
  assert.deepEqual(b.post(orderOf(10, null, { shop_code: 'ABCDEFGH23', customer: {} })), { ok: false, error: 'login_required' });
  assert.equal(b.written(), 0);
});

test('an empty or dead login is refused', () => {
  const b = ready();
  const token = b.member();
  b.post({ action: 'logout', token });
  assert.deepEqual(b.post(orderOf(10, '')), { ok: false, error: 'login_required' });
  assert.deepEqual(b.post(orderOf(10, token)), { ok: false, error: 'session' });
  assert.equal(b.written(), 0);
});

test('looking up a shop QR and logging in still work without a login (only ordering is closed)', () => {
  const b = ready();
  addShop(b.sheet('Master'), { shopCode: 'ABCDEFGH23' });
  assert.equal(b.post({ contract: 'order.v1', action: 'shop', shop_code: 'ABCDEFGH23' }).ok, true);
  assert.match(b.member(), /^[0-9a-f]{64}$/);
});

// ---------- 2. minimum ฿500 ----------
test('a logged-in order under ฿500 is refused and writes nothing', () => {
  const b = ready();
  const token = b.member();
  assert.deepEqual(b.post(orderOf(6, token)), { ok: false, error: 'min_order' });   // ฿480
  const cents = orderOf(1, token, {
    items: [{ sku: 'PK-001', name_th: 'มันแข็งหมู', name_en: 'x', qty: 1, qty_unit: 'kg', unit_price: 499.99, line_total: 499.99 }],
    total: 499.99,
  });
  cents.session = token; cents.customer = {};
  assert.deepEqual(b.post(cents), { ok: false, error: 'min_order' });
  assert.equal(b.written(), 0);
});

test('a logged-in order of exactly ฿500, or more, goes through as a member order', () => {
  const b = ready();
  const token = b.member();
  const exact = orderOf(1, token, {
    items: [
      { sku: 'PK-001', name_th: 'มันแข็งหมู', name_en: 'x', qty: 5, qty_unit: 'kg', unit_price: 80, line_total: 400 },
      { sku: 'CK-001', name_th: 'ขาไก่', name_en: 'y', qty: 2, qty_unit: 'kg', unit_price: 50, line_total: 100 },
    ],
    total: 500,
  });
  exact.session = token; exact.customer = {};
  const a = b.post(exact);
  assert.equal(a.ok, true);
  const res = b.post(orderOf(10, token, { client_order_id: 'second-order-0001' }));   // ฿800
  assert.equal(res.ok, true);
  const orders = b.sheet('Order').records();
  assert.deepEqual(orders.map(o => [o.Web_Total, o.Auth]), [[500, 'member'], [800, 'member']]);
});

test('the minimum is on the goods the server re-adds, not on a total the browser claims', () => {
  const b = ready();
  const token = b.member();
  // ฿480 of goods claiming ฿500: the line sum does not match the total → refused before anything else.
  assert.deepEqual(b.post(orderOf(6, token, { total: 500 })), { ok: false, error: 'total' });
  assert.equal(b.written(), 0);
});
