/**
 * SmartMenu usage statistics (2026-11-12). A SEPARATE Apps Script project, bound to Petch's own Google Sheet
 * "SmartMenu Analytics" (Extensions → Apps Script in that sheet). It is not part of the order backend and never
 * touches the DIFOT sheet.
 *
 * Who can see the data: only the Google account that owns the sheet. The web app is deployed "Execute as: Me" and
 * "Who has access: Anyone" so a visitor's phone can POST events, but the web app only WRITES whitelisted events.
 * There is no action that reads data back. Do not share the sheet.
 *
 * The site (track.js) sends events only after the visitor tapped "ยอมรับ" on the banner. No name, phone, address,
 * LINE name or shop code is ever sent; Apps Script does not see the visitor's IP address.
 *
 * Tabs: Events (one row per event), Consent (accept / withdraw log), Dashboard + S_* (built by buildSummary()).
 * Old rows are deleted after KEEP_DAYS (privacy notice says 13 months).
 */

const TZ = 'Asia/Bangkok';
const POLICY_VERSION = '2026-11-12';
const KEEP_DAYS = 395;                 // ~13 months, as privacy.html says
const MAX_BODY_CHARS = 20000;
const MAX_EVENTS_PER_POST = 50;
const MAX_EVENTS_PER_VISITOR = 400;    // per 10 minutes
const MAX_EVENTS_PER_HOUR = 20000;     // whole site; protects the sheet from a flood
const SUMMARY_DAYS = 30;

const EVENT_COLS = ['Time', 'Day', 'Visitor', 'Session', 'Event', 'Page', 'Category', 'SKU', 'Product', 'Price', 'Unit',
  'Qty', 'Value', 'Detail', 'Lang', 'Member', 'Device', 'Source'];
const CONSENT_COLS = ['Time', 'Visitor', 'Choice', 'Policy', 'Lang', 'Device'];

// Every event the site may send. Anything else is dropped.
const EVENTS = {
  page_view: 1, category_view: 1, product_open: 1, product_close: 1, tiles_seen: 1, search: 1,
  cart_add: 1, cart_qty: 1, cart_remove: 1, cart_open: 1, checkout_start: 1, order_sent: 1,
  login_prompt: 1, line_click: 1, language: 1, consent: 1,
};
const PAGES = { menu: 1, member: 1, history: 1 };
const CATEGORIES = { pork: 1, chicken: 1, egg: 1, fish: 1 };
const UNITS = { kg: 1, tray: 1, pack: 1 };
const LANGS = { th: 1, en: 1, ja: 1, zh: 1, ko: 1, hi: 1 };
const DEVICES = { 'mobile-ios': 1, 'mobile-android': 1, 'mobile-other': 1, tablet: 1, desktop: 1 };
const SOURCES = { direct: 1, line: 1, shop_qr: 1, search: 1, social: 1, other: 1 };
const ID_RE = /^[vs][0-9a-f]{24,40}$/;
const SKU_RE = /^[A-Z]{2}-\d{3}$/;

// ---------- web app ----------

function doGet() {
  return json_({ ok: true, service: 'smartmenu-analytics' });   // nothing is ever read back
}

function doPost(e) {
  const body = (e && e.postData && e.postData.contents) || '';
  if (!body || body.length > MAX_BODY_CHARS) return json_({ ok: false, error: 'too_big' });
  let o;
  try { o = JSON.parse(body); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  if (!o || typeof o !== 'object' || !ID_RE.test(String(o.visitor || '')) || o.visitor[0] !== 'v') {
    return json_({ ok: false, error: 'bad_visitor' });
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: 'busy' });
  try {
    if (o.action === 'forget') return json_(forget_(o.visitor, o));
    return json_(record_(o));
  } finally {
    lock.releaseLock();
  }
}

function record_(o) {
  const session = ID_RE.test(String(o.session || '')) && o.session[0] === 's' ? o.session : '';
  const list = Array.isArray(o.events) ? o.events.slice(0, MAX_EVENTS_PER_POST) : [];
  const ctx = {
    page: pick_(o.page, PAGES), lang: pick_(o.lang, LANGS), member: o.member === true ? 'Y' : 'N',
    device: pick_(o.device, DEVICES), source: pick_(o.source, SOURCES),
  };
  const rows = [];
  const consents = [];
  const now = new Date();
  for (const ev of list) {
    const row = eventRow_(ev, o.visitor, session, ctx, now);
    if (!row) continue;
    rows.push(row);
    if (ev.e === 'consent') consents.push([now, o.visitor, 'accepted', clip_(ev.detail, 20) || POLICY_VERSION, ctx.lang, ctx.device]);
  }
  if (!rows.length) return { ok: true, saved: 0 };
  if (!underLimits_(o.visitor, rows.length)) return { ok: false, error: 'rate' };
  const ss = book_();
  appendRows_(tab_(ss, 'Events', EVENT_COLS), rows);
  if (consents.length) appendRows_(tab_(ss, 'Consent', CONSENT_COLS), consents);
  return { ok: true, saved: rows.length };
}

/** One sheet row from one event, or null when the event is not one we know. Only known values pass. */
function eventRow_(ev, visitor, session, ctx, now) {
  if (!ev || typeof ev !== 'object' || EVENTS[ev.e] !== 1) return null;
  const sku = SKU_RE.test(String(ev.sku || '')) ? ev.sku : '';
  const lang = pick_(ev.lang, LANGS) || ctx.lang;
  let detail = '';
  if (ev.e === 'tiles_seen') {
    detail = (Array.isArray(ev.skus) ? ev.skus : []).filter(s => SKU_RE.test(String(s))).slice(0, 80).join(',');
    if (!detail) return null;
  } else if (ev.e === 'search') {
    detail = clip_(ev.detail, 40);
    if (!detail) return null;
  } else {
    detail = clip_(ev.detail, 40);
  }
  return [
    now, Utilities.formatDate(now, TZ, 'yyyy-MM-dd'), visitor, session, ev.e, ctx.page,
    pick_(ev.category, CATEGORIES), sku, sku ? clip_(ev.product, 60) : '', num_(ev.price, 100000), pick_(ev.unit, UNITS),
    num_(ev.qty, 1000), num_(ev.value, 1000000), detail, lang, ctx.member, ctx.device, ctx.source,
  ].map(plain_);
}

/** Withdrawn consent: delete this visitor's events and log the withdrawal (the log keeps only the random id). */
function forget_(visitor, o) {
  const ss = book_();
  const sheet = tab_(ss, 'Events', EVENT_COLS);
  const removed = keepRows_(sheet, r => r[2] !== visitor);
  appendRows_(tab_(ss, 'Consent', CONSENT_COLS),
    [[new Date(), visitor, 'withdrawn', POLICY_VERSION, pick_(o.lang, LANGS), pick_(o.device, DEVICES)]]);
  return { ok: true, removed };
}

function underLimits_(visitor, n) {
  const cache = CacheService.getScriptCache();
  const bump = (key, max, secs) => {
    const used = Number(cache.get(key) || 0);
    if (used + n > max) return false;
    cache.put(key, String(used + n), secs);
    return true;
  };
  const hour = 'h' + Utilities.formatDate(new Date(), TZ, 'yyyyMMddHH');
  return bump(hour, MAX_EVENTS_PER_HOUR, 3600) && bump('v' + visitor, MAX_EVENTS_PER_VISITOR, 600);
}

// ---------- setup, clean-up, summary (run from the editor or by triggers) ----------

/** Run once from the editor: makes the tabs and the two triggers (daily clean-up, hourly summary). */
function setup() {
  const ss = book_();
  tab_(ss, 'Events', EVENT_COLS);
  tab_(ss, 'Consent', CONSENT_COLS);
  buildSummary();
  if (typeof ScriptApp !== 'undefined' && ScriptApp.getProjectTriggers) {
    const have = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
    if (have.indexOf('cleanup') < 0) ScriptApp.newTrigger('cleanup').timeBased().everyDays(1).atHour(3).create();
    if (have.indexOf('buildSummary') < 0) ScriptApp.newTrigger('buildSummary').timeBased().everyHours(1).create();
  }
  addCharts_(ss);
  return 'ok';
}

/** Adds the menu "SmartMenu" in the sheet so Petch can refresh the summary by hand. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('SmartMenu').addItem('อัปเดตสรุปตอนนี้', 'buildSummary').addToUi();
}

/** Daily: deletes events and consent rows older than KEEP_DAYS. */
function cleanup() {
  const ss = book_();
  const cut = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  const fresh = r => (isDate_(r[0]) ? r[0].getTime() >= cut : true);
  return keepRows_(tab_(ss, 'Events', EVENT_COLS), fresh) + keepRows_(tab_(ss, 'Consent', CONSENT_COLS), fresh);
}

/**
 * Rebuilds Dashboard and the S_* tabs from Events (last SUMMARY_DAYS days; Dashboard also shows all time).
 * Every number counts distinct visitors where it says "คน".
 */
function buildSummary() {
  const ss = book_();
  const events = tab_(ss, 'Events', EVENT_COLS);
  const all = events.getLastRow() > 1 ? events.getRange(2, 1, events.getLastRow() - 1, EVENT_COLS.length).getValues() : [];
  const col = {};
  EVENT_COLS.forEach((h, i) => { col[h] = i; });
  const since = Date.now() - SUMMARY_DAYS * 24 * 3600 * 1000;
  const recent = all.filter(r => isDate_(r[col.Time]) && r[col.Time].getTime() >= since);
  const dayOf = r => Utilities.formatDate(r[col.Time], TZ, 'yyyy-MM-dd');
  const uniq = (rows, k = col.Visitor) => new Set(rows.map(r => r[k])).size;
  const of = (rows, name) => rows.filter(r => r[col.Event] === name);

  // Dashboard: the headline numbers.
  const kpi = (rows) => [uniq(rows), uniq(rows, col.Session), of(rows, 'page_view').length, uniq(of(rows, 'product_open')),
    uniq(of(rows, 'cart_add')), uniq(of(rows, 'order_sent'))];
  const k30 = kpi(recent);
  const kAll = kpi(all);
  const labels = ['ผู้เข้าชม (คน)', 'ครั้งที่เข้า (session)', 'เปิดหน้าเมนู (ครั้ง)', 'คนที่เปิดดูสินค้า', 'คนที่ใส่ตะกร้า', 'คนที่ส่งออเดอร์'];
  const updated = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  write_(ss, 'Dashboard', [['ตัวเลข', `${SUMMARY_DAYS} วันล่าสุด`, 'ทั้งหมด'],
    ...labels.map((l, i) => [l, k30[i], kAll[i]]),
    ['', '', ''],
    ['อัปเดตล่าสุด', updated, ''],
    ['ผู้เข้าชม = นับคนไม่ซ้ำ (เครื่องที่กดยอมรับ)', '', '']]);

  // S_Daily: one row per day, oldest first (chart reads it).
  const days = [];
  for (let i = SUMMARY_DAYS - 1; i >= 0; i--) days.push(Utilities.formatDate(new Date(Date.now() - i * 24 * 3600 * 1000), TZ, 'yyyy-MM-dd'));
  const byDay = group_(recent, dayOf);
  write_(ss, 'S_Daily', [['วันที่', 'ผู้เข้าชม (คน)', 'Session', 'เปิดดูสินค้า (ครั้ง)', 'ใส่ตะกร้า (ครั้ง)', 'ส่งออเดอร์']]
    .concat(days.map(d => {
      const rows = byDay[d] || [];
      return ["'" + d, uniq(rows), uniq(rows, col.Session), of(rows, 'product_open').length, of(rows, 'cart_add').length, of(rows, 'order_sent').length];
    })));

  // S_Products: what people look at most — opens, people, seconds, seen on screen, cart adds.
  const seen = {};
  of(recent, 'tiles_seen').forEach(r => String(r[col.Detail]).split(',').forEach(s => { if (s) seen[s] = (seen[s] || 0) + 1; }));
  const prod = {};
  const P = sku => (prod[sku] = prod[sku] || { name: '', cat: '', price: '', opens: 0, who: new Set(), secs: [], adds: 0, kg: 0 });
  recent.forEach(r => {
    const sku = r[col.SKU];
    if (!sku) return;
    const p = P(sku);
    if (r[col.Product]) p.name = r[col.Product];
    if (r[col.Category]) p.cat = r[col.Category];
    if (r[col.Event] === 'product_open') { p.opens++; p.who.add(r[col.Visitor]); if (r[col.Price] !== '') p.price = r[col.Price]; }
    if (r[col.Event] === 'product_close' && r[col.Value] !== '') p.secs.push(Number(r[col.Value]));
    if (r[col.Event] === 'cart_add') p.adds++;
  });
  Object.keys(seen).forEach(s => P(s));
  const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '');
  const prodRows = Object.keys(prod).map(s => {
    const p = prod[s];
    return [s, p.name, p.cat, p.opens, p.who.size, avg(p.secs), seen[s] || 0, p.adds, p.price];
  }).sort((a, b) => b[3] - a[3] || b[6] - a[6]);
  write_(ss, 'S_Products', [['SKU', 'สินค้า', 'หมวด', 'เปิดดู (ครั้ง)', 'เปิดดู (คน)', 'ดูนาน (วินาที เฉลี่ย)', 'เห็นบนจอ (ครั้ง)', 'ใส่ตะกร้า (ครั้ง)', 'ราคาที่เห็นล่าสุด']].concat(prodRows));

  // S_Categories and S_Search.
  const cats = group_(of(recent, 'category_view'), r => r[col.Category]);
  write_(ss, 'S_Categories', [['หมวด', 'กดดู (ครั้ง)', 'กดดู (คน)']]
    .concat(Object.keys(cats).filter(Boolean).map(c => [c, cats[c].length, uniq(cats[c])]).sort((a, b) => b[1] - a[1])));
  const terms = group_(of(recent, 'search'), r => String(r[col.Detail]).trim().toLowerCase());
  write_(ss, 'S_Search', [['คำค้น', 'ครั้ง', 'คน', 'เจอสินค้า (ล่าสุด)']]
    .concat(Object.keys(terms).filter(Boolean).map(q => [q, terms[q].length, uniq(terms[q]), terms[q][terms[q].length - 1][col.Value]])
      .sort((a, b) => b[1] - a[1]).slice(0, 50)));

  // S_Sources: where people came from, and on what.
  const pv = of(recent, 'page_view');
  const src = group_(pv, r => r[col.Source] || 'other');
  const dev = group_(pv, r => r[col.Device] || 'other');
  write_(ss, 'S_Sources', [['มาจาก', 'คน'], ...Object.keys(src).map(s => [s, uniq(src[s])]), ['', ''],
    ['อุปกรณ์', 'คน'], ...Object.keys(dev).map(d => [d, uniq(dev[d])])]);
  return 'ok';
}

/** Charts on Dashboard, made once by setup() (they read S_Daily / S_Products, which keep the same place). */
function addCharts_(ss) {
  const dash = ss.getSheetByName('Dashboard');
  if (!dash || typeof dash.newChart !== 'function' || dash.getCharts().length) return;
  const daily = ss.getSheetByName('S_Daily');
  const products = ss.getSheetByName('S_Products');
  dash.insertChart(dash.newChart().asLineChart().addRange(daily.getRange('A1:B31'))
    .setOption('title', `ผู้เข้าชมต่อวัน (${SUMMARY_DAYS} วัน)`).setOption('colors', ['#1A4A20']).setOption('legend', { position: 'none' })
    .setPosition(1, 5, 0, 0).build());
  dash.insertChart(dash.newChart().asBarChart().addRange(products.getRange('B1:B11')).addRange(products.getRange('D1:D11'))
    .setOption('title', 'สินค้าที่คนเปิดดูมากที่สุด (10 อันดับ)').setOption('colors', ['#78B040']).setOption('legend', { position: 'none' })
    .setPosition(20, 5, 0, 0).build());
}

// ---------- helpers ----------

function book_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function tab_(ss, name, cols) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    if (sheet.setFrozenRows) sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendRows_(sheet, rows) {
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/** Keeps the data rows for which keep(row) is true; returns how many were removed. */
function keepRows_(sheet, keep) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const width = sheet.getLastColumn();
  const rows = sheet.getRange(2, 1, last - 1, width).getValues();
  const kept = rows.filter(keep);
  if (kept.length === rows.length) return 0;
  sheet.getRange(2, 1, rows.length, width).clearContent();
  if (kept.length) sheet.getRange(2, 1, kept.length, width).setValues(kept.map(r => r.map(plain_)));
  return rows.length - kept.length;
}

/** Replaces a summary tab's contents with rows (all rows padded to the same width). */
function write_(ss, name, rows) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clearContents();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 1);
  const full = rows.map(r => r.concat(Array(width - r.length).fill('')).map(plain_));
  sheet.getRange(1, 1, full.length, width).setValues(full);
}

function group_(rows, key) {
  const out = {};
  rows.forEach(r => { const k = key(r); (out[k] = out[k] || []).push(r); });
  return out;
}

const isDate_ = v => Object.prototype.toString.call(v) === '[object Date]';
const pick_ = (v, allowed) => (typeof v === 'string' && allowed[v] === 1 ? v : '');
const clip_ = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');
const num_ = (v, max) => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : '');
// Text starting with = + - @ would become a formula in Sheets; a leading apostrophe keeps it text.
const plain_ = v => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v);

function json_(x) {
  return ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON);
}
