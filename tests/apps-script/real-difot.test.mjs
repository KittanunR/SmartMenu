// The real DIFOT app (2026-11-04): what a web order looks like in the teammate's tables, and moving member shops over
// from the old sandbox sheet (Migrate.gs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, guestOrder, SANDBOX_HEADERS } from '../helpers/apps-script.mjs';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

function ready() {
  const b = loadBackend();
  b.ctx.setup();
  return b;
}
const addMaster = (b, row) => { const m = b.sheet('Master'); m.appendRow(m.header().map(h => row[h] ?? '')); };

test('a web order is Accepted at once and fills the columns the DIFOT app reads', () => {
  const b = ready();
  addMaster(b, { Code: 'SET-SLOT-END', Type: 'Setting', Name: 'รอบส่งสุดท้ายของวัน', Value: '17:00', Active: 'Yes' });
  const res = b.post(guestOrder());
  assert.equal(res.ok, true, JSON.stringify(res));
  const [o] = b.sheet('Order').records();
  assert.equal(o.Status, 'Accepted');
  assert.equal(typeof o.T_Accept.getTime, 'function');
  assert.equal(o.Source, 'SmartMenu');
  assert.equal(o.Channel, 'เว็บ');
  assert.equal(o.Delivery_Mode, 'ไรเดอร์ร้าน');
  assert.equal(o.Req_Date, '2026-10-25');
  assert.equal(o.Req_Slot, '17:00');
  assert.equal(typeof o.T1_Ordered.getTime, 'function');
  assert.equal(typeof o.T2_Saved.getTime, 'function');
  assert.equal(o.Customer_Issue, false);
  assert.equal(o.Created_By, '');            // no staff made it
  assert.match(o.Note, /^Soi 22 \| ติดต่อ: Ken \| โทร 0812345678$/);
  assert.equal(o.Web_Total, 370);
  assert.equal(o.Auth, 'guest');
  assert.ok(!('Web_Note' in o) && !('Web_Delivery_Date' in o), 'Note / Req_Date replace them in the real sheet');
});

test('a web order without a delivery date is for today; the slot falls back to 17:00 without the setting', () => {
  const b = ready();
  assert.equal(b.post(guestOrder({ delivery: { address_note: 'Soi 22' } })).ok, true);
  const [o] = b.sheet('Order').records();
  assert.equal(o.Req_Date, today());
  assert.equal(o.Req_Slot, '17:00');
});

test('order lines go to the app\'s Order_Line (for picking) as well as our Order_Items', () => {
  const b = ready();
  const res = b.post(guestOrder());
  const lines = b.sheet('Order_Line').records();
  assert.deepEqual(lines.map(l => [l.Line_ID, l.Order_ID, l.SKU_Code, l.Unit, l.Qty_Ordered, l.Unit_Price, l.Qty_Picked, l.Line_Status]), [
    [res.order_id + '-1', res.order_id, 'PK-001', 'กก.', 3, 80, '', ''],
    [res.order_id + '-2', res.order_id, 'CK-001', 'กก.', 2, 65, '', ''],
  ]);
  assert.equal(b.sheet('Order_Items').records().length, 2);
});

test('our SKUs are added to Master once, as active SKUs the app can pick', () => {
  const b = ready();
  addMaster(b, { Code: 'SKU-001', Type: 'SKU', Name: 'หมูสามชั้นสไลซ์', Category: 'Pork', Sort_Order: 1, Active: 'Yes', Unit: 'แพ็ค' });
  b.post(guestOrder());
  b.post(guestOrder({ client_order_id: 'second-order-0001',
    items: [{ sku: 'EG-001', name_th: 'ไข่ไก่ เบอร์ 0', name_en: 'Egg', qty: 2, qty_unit: 'tray', unit_price: 120, line_total: 240 },
      { sku: 'PK-001', name_th: 'มันแข็งหมู', name_en: 'Pork back fat', qty: 1, qty_unit: 'kg', unit_price: 80, line_total: 80 }],
    total: 320 }));
  const skus = b.sheet('Master').records().filter(r => r.Type === 'SKU');
  assert.deepEqual(skus.map(r => [r.Code, r.Name, r.Category, r.Unit, r.Active, r.Shop_ID]), [
    ['SKU-001', 'หมูสามชั้นสไลซ์', 'Pork', 'แพ็ค', 'Yes', ''],
    ['PK-001', 'มันแข็งหมู', 'Pork', 'กก.', 'Yes', 'SU22'],
    ['CK-001', 'ไก่', 'Chicken', 'กก.', 'Yes', 'SU22'],
    ['EG-001', 'ไข่ไก่ เบอร์ 0', 'Egg', 'แผง', 'Yes', 'SU22'],
  ]);
  assert.deepEqual(skus.slice(1).map(r => r.Sort_Order), [2, 3, 4]);   // after the app's own SKUs
});

test('history reads the delivery day from Req_Date (and from the old Web_Delivery_Date on older rows)', () => {
  const b = ready();
  b.session.user = 'owner@example.com';
  const shop = JSON.parse(JSON.stringify(b.ctx.adminCreateShop({ name: 'Café', phone: '0812345678' })));
  b.session.user = '';
  const first = b.post({ action: 'login', phone: '0812345678', password: shop.temp_password });
  const token = b.post({ action: 'set_password', change_token: first.change_token, new_password: 'mango-sticky-rice' }).token;
  assert.equal(b.post(guestOrder({ session: token, customer: {} })).ok, true);
  const [o] = b.post({ action: 'history', token }).orders;
  assert.equal(o.delivery_date, '2026-10-25');
  assert.equal(o.status, 'Accepted');
});

// ---------- moving member shops from the sandbox ----------
const SANDBOX = '1e8xEJsYsWDT4ffvOkiqvVAJVeeSobtkU9wJMN1lISAg';

function withSandbox() {
  const b = ready();
  const sb = b.book(SANDBOX, { ...SANDBOX_HEADERS, Master: [...SANDBOX_HEADERS.Master, 'Phone', 'Source', 'Address', 'Contact_Name',
    'LINE_Name', 'Shop_Code', 'Shop_Link', 'Logo_File_ID', 'Member_Status', 'Logo_Image'] });
  const put = (tab, row, head) => {
    let s = sb.getSheetByName(tab);
    if (!s) { s = sb.insertSheet(tab); s.appendRow(head); }
    s.appendRow(s.header().map(h => row[h] ?? ''));
  };
  // A logo file in the sandbox's Master_Images.
  const old = b.drive.api.createFolder('SmartMenuSandboxDIFOT-93916087').createFolder('Master_Images')
    .createFile(b.ctx.Utilities.newBlob([0x89, 0x50, 0x4e, 0x47, 1, 2, 3], 'image/png', 'CUS-W008-logo.png'));
  const shop = (code, name, phone, status, logo) => put('Master', { Code: code, Type: 'Customer', Name: name, Category: 'Web',
    Active: 'Yes', Shop_ID: 'SU22', Phone: "'" + phone, Source: 'Admin', Address: 'Soi 22', Contact_Name: 'Ken',
    Shop_Code: code === 'CUS-W008' ? "'2E45678923" : 'ABCDEFGH2' + code.slice(-1), Shop_Link: 'https://x/?shop=…',
    Member_Status: status, Logo_File_ID: logo ? old.getId() : '', Logo_Image: logo ? 'Master_Images/CUS-W008-logo.png' : '' });
  shop('CUS-W004', 'Ggg', '0841121255', '', false);                     // a guest test customer: stays behind
  shop('CUS-W008', 'Hotpotman', '0800000099', 'active', true);
  shop('CUS-W010', 'Ruksa Baby', '0830180245', 'disabled', false);
  const authHead = ['Customer_ID', 'Login_Phone', 'Password_Hash', 'Must_Change', 'Temp_Expires_At', 'Password_Set_At', 'Login_Name'];
  put('Member_Auth', { Customer_ID: 'CUS-W008', Login_Phone: "'0800000099", Password_Hash: '$2a$12$abc', Must_Change: false,
    Password_Set_At: new Date('2026-10-23'), Login_Name: 'Hotpotman' }, authHead);
  put('Member_Auth', { Customer_ID: 'CUS-W010', Login_Phone: "'0830180245", Password_Hash: '', Must_Change: false, Login_Name: 'Ruksa' }, authHead);
  const sesHead = ['Token_Hash', 'Customer_ID', 'Created_At', 'Expires_At', 'Last_Seen', 'Revoked_At'];
  const day = 864e5;
  put('Sessions', { Token_Hash: "'1234567890e1234567890123456789012345678901234567890123456789012", Customer_ID: 'CUS-W008',
    Created_At: new Date(), Expires_At: new Date(Date.now() + 30 * day), Last_Seen: new Date() }, sesHead);
  put('Sessions', { Token_Hash: 'b'.repeat(64), Customer_ID: 'CUS-W008', Created_At: new Date(), Expires_At: new Date(Date.now() - day) }, sesHead);
  put('Sessions', { Token_Hash: 'c'.repeat(64), Customer_ID: 'CUS-W008', Created_At: new Date(), Expires_At: new Date(Date.now() + day),
    Revoked_At: new Date() }, sesHead);
  return { b, sb, old };
}

test('migrateMembers copies member shops with their login, live sessions and logo; guests stay behind', () => {
  const { b, old } = withSandbox();
  const res = JSON.parse(JSON.stringify(b.ctx.migrateMembers()));
  assert.deepEqual(res, { shops: 2, logins: 2, sessions: 1, logos: 1, skipped: 0 });

  const shops = b.sheet('Master').records().filter(r => r.Type === 'Customer');
  assert.deepEqual(shops.map(r => r.Code), ['CUS-W008', 'CUS-W010']);
  const hot = shops[0];
  assert.equal(hot.Phone, '0800000099');                 // kept as text: the leading 0 survives
  assert.equal(hot.Shop_Code, '2E45678923');             // kept as text: not read as 2×10^45678923
  assert.equal(hot.Member_Status, 'active');
  assert.equal(hot.Logo_Image, 'Master_Images/CUS-W008-logo.png');
  assert.notEqual(hot.Logo_File_ID, old.getId());        // a copy next to the REAL sheet
  const copy = b.drive.files.get(hot.Logo_File_ID);
  assert.equal(copy.getName(), 'CUS-W008-logo.png');
  const folder = b.drive.folders.get(copy.folderId);
  assert.equal(folder.name, 'Master_Images');
  assert.equal(b.drive.folders.get(folder.parentId).name, 'SmartMenuSandboxDIFOT-93916087',
    'the folder of the sheet the script writes to (the test world has one sheet folder)');
  assert.equal(shops[1].Member_Status, 'disabled');

  const auth = b.sheet('Member_Auth').records();
  assert.deepEqual(auth.map(a => [a.Customer_ID, a.Login_Phone, a.Login_Name]), [['CUS-W008', '0800000099', 'Hotpotman'], ['CUS-W010', '0830180245', 'Ruksa']]);
  assert.equal(auth[0].Password_Hash, '$2a$12$abc');
  const ses = b.sheet('Sessions').records();
  assert.deepEqual(ses.map(s => s.Token_Hash), ['1234567890e1234567890123456789012345678901234567890123456789012']);
});

test('migrateMembers can run again safely: nothing is copied twice', () => {
  const { b } = withSandbox();
  b.ctx.migrateMembers();
  const again = JSON.parse(JSON.stringify(b.ctx.migrateMembers()));
  assert.deepEqual(again, { shops: 0, logins: 0, sessions: 0, logos: 0, skipped: 2 });
  assert.equal(b.sheet('Master').records().filter(r => r.Type === 'Customer').length, 2);
  assert.equal(b.sheet('Member_Auth').records().length, 2);
  assert.equal(b.sheet('Sessions').records().length, 1);
});

test('migrateMembers refuses before setup() made the account tabs in the real sheet', () => {
  const b = loadBackend();
  b.book(SANDBOX);
  assert.throws(() => b.ctx.migrateMembers(), /setup\(\)/);
});

test('a moved member can log in and order in the real sheet', () => {
  const { b } = withSandbox();
  b.ctx.migrateMembers();
  // The moved hash is fake; set a real password through the admin reset to check the login path end to end.
  b.session.user = 'owner@example.com';
  const reset = JSON.parse(JSON.stringify(b.ctx.adminIssuePassword('CUS-W008')));
  b.session.user = '';
  const first = b.post({ action: 'login', user: 'hotpotman', password: reset.temp_password });
  const token = b.post({ action: 'set_password', change_token: first.change_token, new_password: 'mango-sticky-rice' }).token;
  const res = b.post(guestOrder({ session: token, customer: {} }));
  assert.equal(res.ok, true);
  const o = b.sheet('Order').records().at(-1);
  assert.equal(o.Customer_ID, 'CUS-W008');
  assert.equal(o.Auth, 'member');
  assert.equal(o.Status, 'Accepted');
});
