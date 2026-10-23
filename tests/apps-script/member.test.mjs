// Shop login (Phase 3): temp password → own password → session token; me / logout; orders as a member.
// The site calls these through doPost exactly like an order: post({ action: 'login', ... }).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { loadBackend, guestOrder, addShop } from '../helpers/apps-script.mjs';

const OWNER = 'owner@example.com';
const PHONE = '0812345678';
const DAY = 24 * 3600 * 1000;
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';

function ready() {
  const b = loadBackend();
  b.ctx.setup();
  // Admin work runs as the owner; everything the site does runs as nobody (the public order deployment).
  b.admin = (fn, ...args) => {
    b.session.user = OWNER;
    try { return JSON.parse(JSON.stringify(b.ctx[fn](...args))); } finally { b.session.user = ''; }
  };
  b.newShop = (over = {}) => {
    const res = b.admin('adminCreateShop', { name: 'Café Sukhumvit', phone: PHONE, contact: 'Ken', address: '22 Sukhumvit Soi 22', ...over });
    return { id: res.shop.id, temp: res.temp_password };
  };
  b.login = (phone, password) => b.post({ action: 'login', phone, password });
  b.setPassword = (change_token, new_password) => b.post({ action: 'set_password', change_token, new_password });
  // A shop that has finished its first login: returns its session token.
  b.member = (over = {}, password = 'mango-sticky-rice') => {
    const s = b.newShop(over);
    const first = b.login(over.phone || PHONE, s.temp);
    const res = b.setPassword(first.change_token, password);
    return { ...s, token: res.token, password };
  };
  b.matches = (password, hash) => new Script(`bcrypt_.compareSync(${JSON.stringify(password)}, ${JSON.stringify(hash)})`).runInContext(b.ctx);
  b.authRow = () => b.sheet('Member_Auth').records()[0];
  b.setCell = (tab, row, col, v) => { const s = b.sheet(tab); s.set(row + 1, s.header().indexOf(col) + 1, v); };
  return b;
}
const allCells = ss => JSON.stringify([...ss.sheets].map(([, s]) => s.cells));

// ---------- first login with the temporary password ----------
test('temp password login asks for a new password and gives a short-lived change token, not a session', () => {
  const b = ready();
  const { temp } = b.newShop();
  const res = b.login(PHONE, temp);
  assert.equal(res.ok, true);
  assert.equal(res.must_change, true);
  assert.match(res.change_token, HEX64);
  assert.equal(res.token, undefined);
  assert.equal(b.sheet('Sessions').records().length, 0);
});

test('the temp password works typed without the dash, in small letters, with spaces, and with a formatted phone', () => {
  const b = ready();
  const { temp } = b.newShop();
  for (const typed of [temp.replace('-', ''), temp.toLowerCase(), ` ${temp.slice(0, 5)} ${temp.slice(6)} `]) {
    assert.equal(b.login('081-234-5678', typed).must_change, true, typed);
  }
});

test('setting the new password: hash replaced, temp state cleared, session made, only the token hash stored', () => {
  const b = ready();
  const { id, temp } = b.newShop();
  const before = Date.now();
  const res = b.setPassword(b.login(PHONE, temp).change_token, 'mango-sticky-rice');
  assert.equal(res.ok, true);
  assert.match(res.token, HEX64);
  assert.equal(res.shop.name, 'Café Sukhumvit');

  const a = b.authRow();
  assert.ok(b.matches('mango-sticky-rice', a.Password_Hash));
  assert.ok(!b.matches(temp.replace('-', ''), a.Password_Hash));
  assert.equal(a.Must_Change, false);
  assert.equal(a.Temp_Expires_At, '');
  assert.ok(isDate(a.Password_Set_At));

  const [s] = b.sheet('Sessions').records();
  assert.equal(s.Customer_ID, id);
  assert.equal(s.Token_Hash, sha256(res.token));
  const exp = new Date(s.Expires_At).getTime();
  assert.ok(exp >= before + 90 * DAY - 1000 && exp <= Date.now() + 90 * DAY + 1000);
  assert.equal(s.Revoked_At, '');
  assert.ok(!allCells(b.ss).includes(res.token), 'the token itself is never stored');
  assert.ok(!allCells(b.ss).includes('mango-sticky-rice'), 'the password itself is never stored');
});

test('after the change: the temp password is dead, the own password logs straight in and is case-sensitive', () => {
  const b = ready();
  const m = b.member();
  assert.deepEqual(b.login(PHONE, m.temp), { ok: false, error: 'bad_login' });
  const res = b.login(PHONE, 'mango-sticky-rice');
  assert.equal(res.ok, true);
  assert.equal(res.must_change, undefined);
  assert.match(res.token, HEX64);
  assert.notEqual(res.token, m.token, 'each login is its own session');
  assert.deepEqual(b.login(PHONE, 'MANGO-STICKY-RICE'), { ok: false, error: 'bad_login' });
});

test('a change token works once and only for set_password', () => {
  const b = ready();
  const { temp } = b.newShop();
  const change = b.login(PHONE, temp).change_token;
  assert.equal(b.setPassword(change, 'mango-sticky-rice').ok, true);
  assert.deepEqual(b.setPassword(change, 'another-good-one'), { ok: false, error: 'change_expired' });
  assert.deepEqual(b.setPassword('f'.repeat(64), 'another-good-one'), { ok: false, error: 'change_expired' });
  assert.deepEqual(b.setPassword('not-a-token', 'another-good-one'), { ok: false, error: 'change_expired' });
  assert.deepEqual(b.post({ action: 'me', token: change }), { ok: false, error: 'session' });
});

test('new password rules: 8+ characters, at most 72 bytes, not the phone, not common, not the temp password', () => {
  const b = ready();
  const { temp } = b.newShop();
  const change = b.login(PHONE, temp).change_token;
  const bad = [
    ['short12', 'password_short'],
    ['', 'password_short'],
    ['ก'.repeat(25), 'password_long'],          // 25 Thai letters = 75 bytes
    [PHONE, 'password_phone'],
    ['my' + PHONE, 'password_phone'],
    ['812345678x', 'password_phone'],            // the phone without its leading 0
    ['12345678', 'password_common'],
    ['Password', 'password_common'],
    ['aaaaaaaaaa', 'password_common'],
    [temp, 'password_same'],
  ];
  for (const [pw, error] of bad) assert.deepEqual(b.setPassword(change, pw), { ok: false, error }, pw);
  assert.equal(b.setPassword(change, 'ข้าวมันไก่ 22').ok, true, 'Thai and spaces are fine');
});

test('the temporary password expires after 7 days; a wrong one still says only bad_login', () => {
  const b = ready();
  const { temp } = b.newShop();
  b.setCell('Member_Auth', 1, 'Temp_Expires_At', new Date(Date.now() - 1000));
  assert.deepEqual(b.login(PHONE, temp), { ok: false, error: 'temp_expired' });
  assert.deepEqual(b.login(PHONE, 'WRONG-WRONG'), { ok: false, error: 'bad_login' });
});

// ---------- refusing logins ----------
test('wrong password, unknown phone, closed account and bad input all give the same answer', () => {
  const b = ready();
  const m = b.member();
  b.newShop({ name: 'Closed', phone: '0822222222' });
  b.admin('adminDisableAccount', 'CUS-W002');
  const same = { ok: false, error: 'bad_login' };
  assert.deepEqual(b.login(PHONE, 'wrong-password'), same);
  assert.deepEqual(b.login('0899999999', m.password), same);
  assert.deepEqual(b.login('0822222222', 'anything-here'), same);
  assert.deepEqual(b.login('12', m.password), same);
  assert.deepEqual(b.login(PHONE, ''), same);
  assert.deepEqual(b.login(PHONE, { not: 'a string' }), same);
  assert.deepEqual(b.login(PHONE, 'x'.repeat(201)), same);
});

test('a shop closed for ordering (Active = No) cannot log in', () => {
  const b = ready();
  const m = b.member();
  b.setCell('Master', 1, 'Active', 'No');
  assert.deepEqual(b.login(PHONE, m.password), { ok: false, error: 'bad_login' });
});

test('5 wrong tries lock that phone (even the right password) without touching other phones', () => {
  const b = ready();
  const m = b.member();
  const other = b.member({ name: 'B', phone: '0822222222' }, 'papaya-salad-77');
  for (let i = 0; i < 5; i++) assert.equal(b.login(PHONE, 'wrong-' + i).error, 'bad_login');
  assert.deepEqual(b.login(PHONE, m.password), { ok: false, error: 'locked' });
  assert.equal(b.login('0822222222', other.password).ok, true);
});

test('a good login clears the wrong-try count', () => {
  const b = ready();
  const m = b.member();
  for (let i = 0; i < 4; i++) b.login(PHONE, 'wrong-' + i);
  assert.equal(b.login(PHONE, m.password).ok, true);
  for (let i = 0; i < 4; i++) b.login(PHONE, 'wrong-' + i);
  assert.equal(b.login(PHONE, m.password).ok, true);
});

test('too many failed logins across the site pause login for everyone', () => {
  const b = ready();
  const m = b.member();
  const key = new Script('failKeyAll_()').runInContext(b.ctx);
  b.login('0899999999', 'wrong-password');
  assert.equal(b.cache.get(key), '1', 'a failed login counts towards the site-wide limit');
  b.cache.set(key, '100');   // as if 100 failed logins happened this hour (each costs a 0.5 s bcrypt check)
  assert.deepEqual(b.login(PHONE, m.password), { ok: false, error: 'rate' });
});

// ---------- me / logout / session lifetime ----------
test('me answers the shop for a good token, with masked phone and address', () => {
  const b = ready();
  const m = b.member();
  const res = b.post({ action: 'me', token: m.token });
  assert.deepEqual(res, { ok: true, shop: { name: 'Café Sukhumvit', phone_masked: 'xxx-xxx-5678', address_masked: '22 Sukh…', logo_id: '' } });
});

test('me refuses a bad, unknown, expired or revoked token', () => {
  const b = ready();
  const m = b.member();
  const gone = { ok: false, error: 'session' };
  assert.deepEqual(b.post({ action: 'me', token: 'nope' }), gone);
  assert.deepEqual(b.post({ action: 'me', token: 'a'.repeat(64) }), gone);
  assert.deepEqual(b.post({ action: 'me' }), gone);
  b.setCell('Sessions', 1, 'Expires_At', new Date(Date.now() - 1000));
  assert.deepEqual(b.post({ action: 'me', token: m.token }), gone);
});

test('an admin reset or disable logs every device out at once', () => {
  const b = ready();
  const m = b.member();
  const second = b.login(PHONE, m.password).token;
  b.admin('adminIssuePassword', m.id);
  assert.deepEqual(b.post({ action: 'me', token: m.token }), { ok: false, error: 'session' });
  assert.deepEqual(b.post({ action: 'me', token: second }), { ok: false, error: 'session' });

  const n = b.member({ name: 'B', phone: '0822222222' });
  b.admin('adminDisableAccount', n.id);
  assert.deepEqual(b.post({ action: 'me', token: n.token }), { ok: false, error: 'session' });
});

test('a session also dies if the account is changed by hand in the sheet (hash cleared, back on a temp password, closed)', () => {
  const b = ready();
  const gone = { ok: false, error: 'session' };
  const m = b.member();
  b.setCell('Member_Auth', 1, 'Password_Hash', '');
  assert.deepEqual(b.post({ action: 'me', token: m.token }), gone);

  const n = b.member({ name: 'B', phone: '0822222222' });
  b.setCell('Member_Auth', 2, 'Must_Change', true);
  assert.deepEqual(b.post({ action: 'me', token: n.token }), gone);

  const k = b.member({ name: 'C', phone: '0833333333' });
  b.setCell('Master', 3, 'Member_Status', 'disabled');
  assert.deepEqual(b.post({ action: 'me', token: k.token }), gone);
});

test('a token belongs to its own shop only', () => {
  const b = ready();
  const a = b.member();
  const c = b.member({ name: 'Other shop', phone: '0822222222' });
  assert.equal(b.post({ action: 'me', token: a.token }).shop.name, 'Café Sukhumvit');
  assert.equal(b.post({ action: 'me', token: c.token }).shop.name, 'Other shop');
});

test('me sends the logo only when the phone does not have this one yet', () => {
  const b = ready();
  const m = b.member();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)]).toString('base64');
  b.admin('adminSetLogo', m.id, { mime: 'image/png', base64: png });
  const first = b.post({ action: 'me', token: m.token });
  assert.match(first.shop.logo_id, /^file\d+$/);
  assert.equal(first.shop.logo_data_url, 'data:image/png;base64,' + png);
  const again = b.post({ action: 'me', token: m.token, logo_id: first.shop.logo_id });
  assert.equal(again.shop.logo_id, first.shop.logo_id);
  assert.equal(again.shop.logo_data_url, undefined);
});

test('logout ends that session only; logging out twice or with junk is fine', () => {
  const b = ready();
  const m = b.member();
  const second = b.login(PHONE, m.password).token;
  assert.deepEqual(b.post({ action: 'logout', token: m.token }), { ok: true });
  assert.deepEqual(b.post({ action: 'me', token: m.token }), { ok: false, error: 'session' });
  assert.equal(b.post({ action: 'me', token: second }).ok, true);
  assert.deepEqual(b.post({ action: 'logout', token: m.token }), { ok: true });
  assert.deepEqual(b.post({ action: 'logout', token: 'junk' }), { ok: true });
});

// ---------- ordering as a member ----------
test('a member order takes the shop from Master and is marked Auth = member', () => {
  const b = ready();
  const m = b.member();
  const res = b.post(guestOrder({ session: m.token, customer: { shop_name: 'Typed by someone', phone: '' }, delivery: { date: '2026-10-25', address_note: '' } }));
  assert.equal(res.ok, true);
  const [o] = b.sheet('Order').records();
  assert.equal(o.Customer_ID, m.id);
  assert.equal(o.Auth, 'member');
  assert.equal(o.Web_Shop_Name, 'Café Sukhumvit');
  assert.equal(o.Web_Phone, PHONE);
  assert.match(o.Web_Note, /^22 Sukhumvit Soi 22/);
  assert.equal(b.sheet('Master').records().length, 1, 'no new customer row');
  assert.match(b.sheet('Event').records()[0].Note, /member/);
});

test('a member order with a dead token is refused and writes nothing', () => {
  const b = ready();
  const m = b.member();
  b.post({ action: 'logout', token: m.token });
  assert.deepEqual(b.post(guestOrder({ session: m.token, customer: {} })), { ok: false, error: 'session' });
  assert.deepEqual(b.post(guestOrder({ session: 'bad', customer: {} })), { ok: false, error: 'session' });
  assert.equal(b.sheet('Order').records().length, 0);
});

test('the login wins over a shop QR code in the same order', () => {
  const b = ready();
  const m = b.member();
  addShop(b.sheet('Master'), { code: 'CUS-W050', name: 'QR shop', phone: '0833333333', shopCode: 'QQQQQQQQ22' });
  b.post(guestOrder({ session: m.token, shop_code: 'QQQQQQQQ22', customer: {} }));
  assert.equal(b.sheet('Order').records()[0].Customer_ID, m.id);
});

test('guest and shop-QR orders still need no login', () => {
  const b = ready();
  assert.equal(b.post(guestOrder()).ok, true);
  assert.equal(b.sheet('Order').records()[0].Auth, 'guest');
});

// ---------- admin message ----------
test('the admin page gets the login page link to send with the temp password', () => {
  const b = ready();
  const res = b.admin('adminCreateShop', { name: 'X', phone: PHONE });
  assert.equal(res.login_url, 'https://kittanunr.github.io/SmartMenu/member.html');
  assert.equal(b.admin('adminIssuePassword', res.shop.id).login_url, 'https://kittanunr.github.io/SmartMenu/member.html');
});
