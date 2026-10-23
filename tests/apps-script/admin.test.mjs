// Admin page (Phase 2): who may use it, shop create / edit, temporary passwords, disable, logo.
// The page calls these functions through google.script.run, which passes plain JSON: call() does the same round trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { loadBackend, guestOrder } from '../helpers/apps-script.mjs';

const OWNER = 'owner@example.com';
const TEMP = /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/;
const DAY = 24 * 3600 * 1000;
const isDate = v => Object.prototype.toString.call(v) === '[object Date]'; // dates made inside the vm are another realm's Date

function ready(opts = {}) {
  const b = loadBackend({ user: OWNER, ...opts });
  b.ctx.setup();
  b.call = (fn, ...args) => JSON.parse(JSON.stringify(b.ctx[fn](...args)));
  // Same check Phase 3's login will make: the shop types the temp password with or without the dash.
  b.matches = (password, hash) => new Script(`bcrypt_.compareSync(${JSON.stringify(password.replace(/-/g, ''))}, ${JSON.stringify(hash)})`).runInContext(b.ctx);
  return b;
}

const SHOP = { name: 'Café Sukhumvit', phone: '081-234-5678', contact: 'Ken', line: 'ken.cafe', address: '22 Sukhumvit Soi 22' };
const allCells = ss => JSON.stringify([...ss.sheets].map(([, s]) => s.cells));
const ADMIN_FNS = [
  ['adminListShops'], ['adminCreateShop', SHOP], ['adminUpdateShop', 'CUS-W001', SHOP], ['adminIssuePassword', 'CUS-W001'],
  ['adminDisableAccount', 'CUS-W001'], ['adminSetLogo', 'CUS-W001', { mime: 'image/png', base64: 'iVBORw0KGgo=' }], ['adminGetLogo', 'CUS-W001'],
];

// ---------- who may use it ----------
test('nobody signed in: doGet is still the public health check and every admin call is refused', () => {
  const b = ready({ user: '' });
  assert.deepEqual(JSON.parse(b.ctx.doGet().getContent()), { ok: true, service: 'smartmenu-order', contract: 'order.v1' });
  b.post(guestOrder());
  const before = allCells(b.ss);
  for (const [fn, ...args] of ADMIN_FNS) assert.deepEqual(b.call(fn, ...args), { ok: false, error: 'not_admin' }, fn);
  assert.equal(allCells(b.ss), before);
});

test('another Google account is refused unless it is listed in ADMIN_EMAILS', () => {
  const b = ready({ user: 'stranger@example.com' });
  assert.equal(b.call('adminListShops').error, 'not_admin');
  assert.equal(typeof b.ctx.doGet().getContent, 'function', 'not the admin page');
  b.properties.set('ADMIN_EMAILS', 'staff@example.com, Stranger@Example.com');
  assert.equal(b.call('adminListShops').ok, true);
});

test('the script owner gets the admin page from doGet', () => {
  const b = ready();
  assert.equal(b.ctx.doGet().file, 'Admin');
});

// ---------- create ----------
test('create shop: Master row, shop code, and a temporary password stored only as a bcrypt hash', () => {
  const b = ready();
  const before = Date.now();
  const res = b.call('adminCreateShop', SHOP);
  assert.equal(res.ok, true);
  assert.match(res.temp_password, TEMP);

  const [m] = b.sheet('Master').records();
  assert.equal(m.Code, 'CUS-W001');
  assert.equal(m.Type, 'Customer');
  assert.equal(m.Active, 'Yes');
  assert.equal(m.Source, 'Admin');
  assert.equal(m.Name, 'Café Sukhumvit');
  assert.equal(m.Phone, '0812345678');
  assert.equal(m.Contact_Name, 'Ken');
  assert.equal(m.LINE_Name, 'ken.cafe');
  assert.equal(m.Address, '22 Sukhumvit Soi 22');
  assert.equal(m.Member_Status, 'active');
  assert.match(m.Shop_Code, /^[A-HJKMNP-Z2-9]{10}$/);
  assert.equal(m.Shop_Link, 'https://kittanunr.github.io/SmartMenu/?shop=' + m.Shop_Code);

  const [a] = b.sheet('Member_Auth').records();
  assert.equal(a.Customer_ID, 'CUS-W001');
  assert.equal(a.Login_Phone, '0812345678');
  assert.match(a.Password_Hash, /^\$2[ab]\$12\$/);
  assert.ok(b.matches(res.temp_password, a.Password_Hash));
  assert.ok(b.matches(res.temp_password.toLowerCase().replace(/-/g, '').toUpperCase(), a.Password_Hash));
  assert.equal(a.Must_Change, true);
  assert.equal(a.Password_Set_At, '');
  const exp = new Date(a.Temp_Expires_At).getTime();
  assert.ok(exp >= before + 7 * DAY - 1000 && exp <= Date.now() + 7 * DAY + 1000);

  // Shown once: the password is in this answer only, never in the sheet; the hash never leaves the server.
  assert.ok(!allCells(b.ss).includes(res.temp_password.replace('-', '')));
  assert.ok(!allCells(b.ss).includes(res.temp_password));
  assert.ok(!JSON.stringify(res).includes('$2'));
  assert.equal(res.shop.account, 'temp');
  assert.equal(res.shop.id, 'CUS-W001');
});

test('create shop gets the next CUS-W number after guest customers', () => {
  const b = ready();
  b.post(guestOrder());
  assert.equal(b.call('adminCreateShop', { ...SHOP, phone: '0899999999' }).shop.id, 'CUS-W002');
});

test('create shop checks its input', () => {
  const b = ready();
  const bad = [
    [{ ...SHOP, name: '  ' }, 'name'],
    [{ ...SHOP, name: 'x'.repeat(121) }, 'name'],
    [{ ...SHOP, phone: '12345' }, 'phone'],
    [{ ...SHOP, phone: '' }, 'phone'],
    [{ ...SHOP, contact: 'x'.repeat(121) }, 'contact'],
    [{ ...SHOP, line: 'x'.repeat(121) }, 'line'],
    [{ ...SHOP, address: 'x'.repeat(401) }, 'address'],
    [null, 'name'],
  ];
  for (const [form, error] of bad) assert.deepEqual(b.call('adminCreateShop', form), { ok: false, error }, error);
  assert.equal(b.sheet('Master').records().length, 0);
});

test('create shop refuses a phone another customer already has (use "make member" on that row instead)', () => {
  const b = ready();
  b.post(guestOrder()); // guest customer with 0812345678
  assert.deepEqual(b.call('adminCreateShop', SHOP), { ok: false, error: 'phone_taken', customer_id: 'CUS-W001' });
  assert.equal(b.sheet('Member_Auth').records().length, 0);
});

test('text that looks like a formula is written as plain text', () => {
  const b = ready();
  b.call('adminCreateShop', { ...SHOP, name: '=IMPORTDATA("https://evil.example")', address: '+66 road' });
  const [m] = b.sheet('Master').records();
  assert.equal(m.Name, '=IMPORTDATA("https://evil.example")');
  assert.equal(m.Address, '+66 road');
});

// ---------- list ----------
test('list shows customers with account state, never a password hash', () => {
  const b = ready();
  b.post(guestOrder({ customer: { shop_name: 'Guest shop', contact_name: '', phone: '0800000001', line_name: '' } }));
  b.call('adminCreateShop', SHOP);
  const res = b.call('adminListShops');
  assert.equal(res.ok, true);
  assert.deepEqual(res.shops.map(s => [s.id, s.name, s.account]), [['CUS-W001', 'Guest shop', 'none'], ['CUS-W002', 'Café Sukhumvit', 'temp']]);
  const s = res.shops[1];
  assert.equal(s.phone, '0812345678');
  assert.equal(s.active, true);
  assert.equal(s.has_logo, false);
  assert.match(s.temp_expires_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!JSON.stringify(res).includes('$2'));
  assert.ok(!JSON.stringify(res).includes('Password_Hash'));
});

test('list marks an expired temporary password and a password the shop set itself', () => {
  const b = ready();
  b.call('adminCreateShop', SHOP);
  b.call('adminCreateShop', { ...SHOP, name: 'B', phone: '0822222222' });
  const auth = b.sheet('Member_Auth');
  const head = auth.header();
  auth.set(2, head.indexOf('Temp_Expires_At') + 1, new Date(Date.now() - DAY));
  auth.set(3, head.indexOf('Must_Change') + 1, false);
  auth.set(3, head.indexOf('Password_Set_At') + 1, new Date());
  assert.deepEqual(b.call('adminListShops').shops.map(s => s.account), ['temp_expired', 'active']);
});

test('list leaves out suppliers and other Master rows', () => {
  const b = ready();
  const m = b.sheet('Master');
  m.appendRow(m.header().map(h => ({ Code: 'SUP-1', Type: 'Supplier', Name: 'Farm' }[h] ?? '')));
  assert.deepEqual(b.call('adminListShops').shops, []);
});

// ---------- temporary password: new account and reset ----------
test('reset gives a new temporary password and logs every device out', () => {
  const b = ready();
  const first = b.call('adminCreateShop', SHOP);
  const sessions = b.sheet('Sessions');
  const head = sessions.header();
  const row = o => head.map(h => o[h] ?? '');
  sessions.appendRow(row({ Token_Hash: 'aaa', Customer_ID: 'CUS-W001', Created_At: new Date() }));
  sessions.appendRow(row({ Token_Hash: 'bbb', Customer_ID: 'CUS-W009', Created_At: new Date() }));
  const auth = b.sheet('Member_Auth');
  auth.set(2, auth.header().indexOf('Must_Change') + 1, false);

  const res = b.call('adminIssuePassword', 'CUS-W001');
  assert.equal(res.ok, true);
  assert.match(res.temp_password, TEMP);
  assert.notEqual(res.temp_password, first.temp_password);
  const [a] = auth.records();
  assert.equal(auth.records().length, 1);
  assert.ok(b.matches(res.temp_password, a.Password_Hash));
  assert.ok(!b.matches(first.temp_password, a.Password_Hash));
  assert.equal(a.Must_Change, true);
  const s = sessions.records();
  assert.ok(isDate(s[0].Revoked_At), 'this shop\'s session is revoked');
  assert.equal(s[1].Revoked_At, '', 'another shop\'s session is untouched');
});

test('make member: an existing guest customer gets an account with its Master phone', () => {
  const b = ready();
  b.post(guestOrder());
  const res = b.call('adminIssuePassword', 'CUS-W001');
  assert.equal(res.ok, true);
  assert.equal(res.shop.account, 'temp');
  const [a] = b.sheet('Member_Auth').records();
  assert.equal(a.Login_Phone, '0812345678');
  const [m] = b.sheet('Master').records();
  assert.equal(m.Member_Status, 'active');
  assert.match(m.Shop_Code, /^[A-HJKMNP-Z2-9]{10}$/, 'a guest customer also gets a shop code');
});

test('issue password refuses an unknown customer and a customer without a valid phone', () => {
  const b = ready();
  assert.deepEqual(b.call('adminIssuePassword', 'CUS-W404'), { ok: false, error: 'not_found' });
  assert.deepEqual(b.call('adminIssuePassword', { evil: 1 }), { ok: false, error: 'not_found' });
  const m = b.sheet('Master');
  m.appendRow(m.header().map(h => ({ Code: 'CUS-001', Type: 'Customer', Name: 'Old shop', Active: 'Yes' }[h] ?? '')));
  assert.deepEqual(b.call('adminIssuePassword', 'CUS-001'), { ok: false, error: 'phone' });
});

// ---------- disable ----------
test('disable: login stops (hash cleared, sessions revoked) but the shop still exists', () => {
  const b = ready();
  b.call('adminCreateShop', SHOP);
  const sessions = b.sheet('Sessions');
  sessions.appendRow(sessions.header().map(h => ({ Token_Hash: 'aaa', Customer_ID: 'CUS-W001' }[h] ?? '')));
  const res = b.call('adminDisableAccount', 'CUS-W001');
  assert.equal(res.ok, true);
  assert.equal(res.shop.account, 'disabled');
  assert.equal(b.sheet('Member_Auth').records()[0].Password_Hash, '');
  assert.equal(b.sheet('Master').records()[0].Member_Status, 'disabled');
  assert.equal(b.sheet('Master').records()[0].Active, 'Yes');
  assert.ok(isDate(sessions.records()[0].Revoked_At));
  // Turning it back on = a fresh temporary password.
  const again = b.call('adminIssuePassword', 'CUS-W001');
  assert.equal(again.shop.account, 'temp');
  assert.equal(b.sheet('Master').records()[0].Member_Status, 'active');
});

test('disable refuses a customer that has no account', () => {
  const b = ready();
  b.post(guestOrder());
  assert.deepEqual(b.call('adminDisableAccount', 'CUS-W001'), { ok: false, error: 'no_account' });
});

// ---------- edit ----------
test('edit changes the shop details and moves the login phone with the phone', () => {
  const b = ready();
  b.call('adminCreateShop', SHOP);
  const res = b.call('adminUpdateShop', 'CUS-W001', { ...SHOP, name: 'Café 22', phone: '0898765432', active: false });
  assert.equal(res.ok, true);
  const [m] = b.sheet('Master').records();
  assert.equal(m.Name, 'Café 22');
  assert.equal(m.Phone, '0898765432');
  assert.equal(m.Active, 'No');
  assert.equal(b.sheet('Member_Auth').records()[0].Login_Phone, '0898765432');
  assert.equal(res.shop.active, false);
});

test('edit refuses a phone that belongs to another customer, and unknown ids', () => {
  const b = ready();
  b.call('adminCreateShop', SHOP);
  b.call('adminCreateShop', { ...SHOP, phone: '0822222222' });
  assert.deepEqual(b.call('adminUpdateShop', 'CUS-W002', SHOP), { ok: false, error: 'phone_taken', customer_id: 'CUS-W001' });
  assert.equal(b.call('adminUpdateShop', 'CUS-W001', SHOP).ok, true, 'keeping its own phone is fine');
  assert.deepEqual(b.call('adminUpdateShop', 'CUS-W404', SHOP), { ok: false, error: 'not_found' });
});

// ---------- logo ----------
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]).toString('base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]).toString('base64');

test('logo goes to a private Drive folder; a new one replaces the old', () => {
  const b = ready();
  b.call('adminCreateShop', SHOP);
  const res = b.call('adminSetLogo', 'CUS-W001', { mime: 'image/png', base64: PNG });
  assert.equal(res.ok, true);
  assert.equal(res.shop.has_logo, true);
  const first = b.sheet('Master').records()[0].Logo_File_ID;
  assert.ok(b.drive.files.has(first));
  const folderId = b.properties.get('LOGO_FOLDER_ID');
  assert.equal(b.drive.files.get(first).folderId, folderId);

  b.call('adminSetLogo', 'CUS-W001', { mime: 'image/jpeg', base64: JPG });
  const second = b.sheet('Master').records()[0].Logo_File_ID;
  assert.notEqual(second, first);
  assert.equal(b.drive.files.get(first).trashed, true);
  assert.equal(b.drive.files.get(second).folderId, folderId, 'same folder reused');
  assert.equal(b.call('adminGetLogo', 'CUS-W001').data_url, 'data:image/jpeg;base64,' + JPG);
});

test('logo upload checks type, content and size', () => {
  const b = ready();
  b.call('adminCreateShop', SHOP);
  const bad = [
    [{ mime: 'image/svg+xml', base64: PNG }, 'logo_type'],
    [{ mime: 'image/png', base64: JPG }, 'logo_type'],              // says PNG, is not
    [{ mime: 'image/png', base64: 'not base64!' }, 'logo_type'],
    [{ mime: 'image/png', base64: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(400 * 1024)]).toString('base64') }, 'logo_size'],
    [null, 'logo_type'],
  ];
  for (const [logo, error] of bad) assert.deepEqual(b.call('adminSetLogo', 'CUS-W001', logo), { ok: false, error }, error);
  assert.equal(b.drive.files.size, 0);
  assert.deepEqual(b.call('adminGetLogo', 'CUS-W001'), { ok: false, error: 'no_logo' });
});

// ---------- audit ----------
test('every change is logged with who did it, and the log never holds a password', () => {
  const b = ready();
  const res = b.call('adminCreateShop', SHOP);
  const again = b.call('adminIssuePassword', 'CUS-W001');
  b.call('adminDisableAccount', 'CUS-W001');
  const log = b.sheet('Admin_Log').records();
  assert.deepEqual(log.map(l => [l.User, l.Action, l.Customer_ID]), [
    [OWNER, 'shop_created', 'CUS-W001'], [OWNER, 'password_issued', 'CUS-W001'], [OWNER, 'account_disabled', 'CUS-W001'],
  ]);
  const text = JSON.stringify(b.sheet('Admin_Log').cells);
  for (const p of [res.temp_password, again.temp_password]) {
    assert.ok(!text.includes(p) && !text.includes(p.replace('-', '')));
  }
});

// ---------- orders still work ----------
test('a shop made in the admin page can order with its shop QR', () => {
  const b = ready();
  b.call('adminCreateShop', SHOP);
  const code = b.sheet('Master').records()[0].Shop_Code;
  const res = b.post(guestOrder({ shop_code: code, customer: {} }));
  assert.equal(res.ok, true);
  assert.equal(b.sheet('Order').records()[0].Customer_ID, 'CUS-W001');
});
