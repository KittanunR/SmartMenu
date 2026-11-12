// Usage statistics backend (backend/analytics/Analytics.gs, 2026-11-12): a separate Apps Script bound to Petch's own
// sheet. Runs against the in-memory sheet from tests/helpers/apps-script.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, Script } from 'node:vm';
import { FakeSpreadsheet, FakeSheet } from '../helpers/apps-script.mjs';
import { ROOT } from '../../scripts/lib/checks.mjs';

// What Analytics.gs needs on top of the shared fakes: clearing, like Sheets (empty rows at the end stop counting).
const proto = Object.getPrototypeOf(new FakeSheet('x').getRange(1, 1));
proto.clearContent = function () {
  for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.sheet.set(this.row + r, this.col + c, '');
  trim(this.sheet);
  return this;
};
FakeSheet.prototype.clearContents = function () { this.cells = []; return this; };
function trim(sheet) {
  while (sheet.cells.length && sheet.cells[sheet.cells.length - 1].every(v => v === '')) sheet.cells.pop();
}

function formatDate(date, tz, fmt) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(x => [x.type, x.value]));
  return fmt.replace(/yyyy|MM|dd|HH|mm/g, t => ({ yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute }[t]));
}

function load() {
  const ss = new FakeSpreadsheet({});
  const cache = new Map();
  const ctx = createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, String(v)) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }) },
    Utilities: { formatDate },
  });
  new Script(readFileSync(join(ROOT, 'backend', 'analytics', 'Analytics.gs'), 'utf8'), { filename: 'Analytics.gs' }).runInContext(ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());
  return { ctx, ss, cache, post, sheet: n => ss.getSheetByName(n) };
}

const V1 = 'v' + 'a'.repeat(32);
const V2 = 'v' + 'b'.repeat(32);
const S1 = 's' + 'c'.repeat(32);
const batch = (events, over = {}) => ({ v: 1, visitor: V1, session: S1, page: 'menu', lang: 'th', member: false, device: 'mobile-ios', source: 'direct', events, ...over });

test('setup makes Events, Consent and the summary tabs', () => {
  const b = load();
  assert.equal(b.ctx.setup(), 'ok');
  for (const t of ['Events', 'Consent', 'Dashboard', 'S_Daily', 'S_Products', 'S_Categories', 'S_Search', 'S_Sources']) assert.ok(b.sheet(t), t);
  assert.equal(b.sheet('Events').header()[2], 'Visitor');
});

test('known events are saved with the visit context; unknown ones are dropped', () => {
  const b = load();
  const res = b.post(batch([
    { e: 'page_view' },
    { e: 'product_open', sku: 'PK-001', product: 'มันแข็งหมู', category: 'pork', price: 80, unit: 'kg' },
    { e: 'steal_data', sku: 'PK-001' },
    { e: 'cart_add', sku: 'PK-001', product: 'มันแข็งหมู', qty: 3, price: 80, value: 240 },
  ]));
  assert.deepEqual(res, { ok: true, saved: 3 });
  const rows = b.sheet('Events').records();
  assert.deepEqual(rows.map(r => r.Event), ['page_view', 'product_open', 'cart_add']);
  assert.equal(rows[1].Price, 80);
  assert.equal(rows[1].Category, 'pork');
  assert.equal(rows[2].Value, 240);
  assert.ok(rows.every(r => r.Visitor === V1 && r.Session === S1 && r.Lang === 'th' && r.Device === 'mobile-ios' && r.Member === 'N'));
});

test('values outside the lists are blanked, typed text cannot become a formula', () => {
  const b = load();
  b.post(batch([
    { e: 'product_open', sku: 'DROP TABLE', product: 'x', category: 'cars', price: -5, unit: 'tonne' },
    { e: 'search', detail: '=IMPORTXML("http://evil")' },
    { e: 'product_open', sku: 'CK-002', product: '+ไก่', price: 1e9 },
  ], { device: 'hacker', source: 'evil', lang: 'xx' }));
  const [a, s, c] = b.sheet('Events').records();
  assert.equal(a.SKU, ''); assert.equal(a.Product, ''); assert.equal(a.Category, ''); assert.equal(a.Price, ''); assert.equal(a.Unit, '');
  assert.equal(a.Device, ''); assert.equal(a.Source, ''); assert.equal(a.Lang, '');
  assert.equal(s.Detail, '=IMPORTXML("http://evil")');          // stored as text, not FORMULA(...)
  assert.equal(c.Product, '+ไก่');
  assert.equal(c.Price, '');
});

test('a bad visitor id, bad json or a huge body is refused and nothing is written', () => {
  const b = load();
  assert.equal(b.post(batch([{ e: 'page_view' }], { visitor: 'v123' })).error, 'bad_visitor');
  assert.equal(b.post(batch([{ e: 'page_view' }], { visitor: 's' + 'a'.repeat(32) })).error, 'bad_visitor');
  assert.equal(b.post('{nope').error, 'bad_json');
  assert.equal(b.post('x'.repeat(20001)).error, 'too_big');
  assert.equal(b.sheet('Events'), null);
});

test('at most 50 events per request and 400 per visitor every 10 minutes', () => {
  const b = load();
  const many = n => Array.from({ length: n }, () => ({ e: 'category_view', category: 'pork' }));
  assert.equal(b.post(batch(many(80))).saved, 50);
  for (let i = 0; i < 7; i++) b.post(batch(many(50)));
  assert.equal(b.sheet('Events').records().length, 400);
  assert.equal(b.post(batch(many(1))).error, 'rate');
  assert.equal(b.post(batch(many(1), { visitor: V2 })).saved, 1);   // someone else is not blocked
});

test('accepting is logged in Consent; withdrawing deletes only that visitor and logs it', () => {
  const b = load();
  b.post(batch([{ e: 'consent', detail: '2026-11-12' }, { e: 'page_view' }]));
  b.post(batch([{ e: 'page_view' }], { visitor: V2 }));
  assert.deepEqual(b.sheet('Consent').records().map(r => r.Choice), ['accepted']);
  const res = b.post({ action: 'forget', visitor: V1, lang: 'th', device: 'mobile-ios' });
  assert.deepEqual(res, { ok: true, removed: 2 });
  assert.deepEqual(b.sheet('Events').records().map(r => r.Visitor), [V2]);
  assert.deepEqual(b.sheet('Consent').records().map(r => [r.Visitor, r.Choice]), [[V1, 'accepted'], [V1, 'withdrawn']]);
});

test('cleanup deletes rows older than 13 months and keeps the rest', () => {
  const b = load();
  b.ctx.setup();
  const ev = b.sheet('Events');
  const old = new Date(Date.now() - 400 * 24 * 3600 * 1000);
  const row = (t, v) => ev.appendRow(ev.header().map(h => ({ Time: t, Visitor: v, Event: 'page_view' }[h] ?? '')));
  row(old, V1); row(new Date(), V2); row(old, V2);
  assert.equal(b.ctx.cleanup(), 2);
  assert.deepEqual(ev.records().map(r => r.Visitor), [V2]);
});

test('summary counts distinct people and ranks the products people look at', () => {
  const b = load();
  const pork = { sku: 'PK-001', product: 'มันแข็งหมู', category: 'pork', price: 80, unit: 'kg' };
  const egg = { sku: 'EG-001', product: 'ไข่ไก่ เบอร์ 0', category: 'egg', price: 120, unit: 'tray' };
  // V1 visits twice (same person), opens pork twice and egg once; V2 opens pork once and orders.
  b.post(batch([{ e: 'page_view' }, { e: 'product_open', ...pork }, { e: 'product_close', sku: 'PK-001', value: 10 },
    { e: 'product_open', ...pork }, { e: 'product_close', sku: 'PK-001', value: 20 }, { e: 'product_open', ...egg },
    { e: 'tiles_seen', skus: ['PK-001', 'EG-001', 'bad'] }, { e: 'search', detail: 'Wing', value: 2 }]));
  b.post(batch([{ e: 'page_view' }, { e: 'category_view', category: 'egg' }], { session: 's' + 'd'.repeat(32) }));
  b.post(batch([{ e: 'page_view' }, { e: 'product_open', ...pork }, { e: 'cart_add', ...pork, qty: 3, value: 240 },
    { e: 'order_sent', qty: 1, value: 600 }, { e: 'search', detail: 'wing ', value: 2 }], { visitor: V2, session: 's' + 'e'.repeat(32), source: 'line' }));
  b.ctx.buildSummary();

  const dash = Object.fromEntries(b.sheet('Dashboard').getDataRange().getValues().map(r => [r[0], r[1]]));
  assert.equal(dash['ผู้เข้าชม (คน)'], 2);
  assert.equal(dash['ครั้งที่เข้า (session)'], 3);
  assert.equal(dash['เปิดหน้าเมนู (ครั้ง)'], 3);
  assert.equal(dash['คนที่เปิดดูสินค้า'], 2);
  assert.equal(dash['คนที่ส่งออเดอร์'], 1);

  const [top, second] = b.sheet('S_Products').records();
  assert.equal(top.SKU, 'PK-001');
  assert.equal(top['เปิดดู (ครั้ง)'], 3);
  assert.equal(top['เปิดดู (คน)'], 2);
  assert.equal(top['ดูนาน (วินาที เฉลี่ย)'], 15);
  assert.equal(top['เห็นบนจอ (ครั้ง)'], 1);
  assert.equal(top['ใส่ตะกร้า (ครั้ง)'], 1);
  assert.equal(second.SKU, 'EG-001');

  const daily = b.sheet('S_Daily').records();
  assert.equal(daily.length, 30);
  assert.equal(daily[29]['ผู้เข้าชม (คน)'], 2);

  assert.deepEqual(b.sheet('S_Search').records().map(r => [r['คำค้น'], r['ครั้ง'], r['คน']]), [['wing', 2, 2]]);
  assert.deepEqual(b.sheet('S_Categories').records().map(r => r['หมวด']), ['egg']);
});

test('nothing in the web app reads data back', () => {
  const b = load();
  b.post(batch([{ e: 'page_view' }]));
  assert.deepEqual(JSON.parse(b.ctx.doGet().getContent()), { ok: true, service: 'smartmenu-analytics' });
  assert.equal(b.post(batch([], { action: 'list' })).saved, 0);
});
