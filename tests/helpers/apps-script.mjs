// Runs backend/apps-script/*.gs in Node against an in-memory Google Sheet, so the order and account rules can be
// tested without touching the real sandbox. Only the Apps Script calls our code uses are faked; Code.gs itself is real.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, Script } from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT } from '../../scripts/lib/checks.mjs';

// Headers as they were in the sandbox sheet before setup() (2026-10-22 read of DIFOT_Pilot_SU22 copy).
export const ORIGINAL_HEADERS = {
  Order: ['Order_ID', 'Shop_ID', 'Order_Date', 'Customer_ID', 'Slip_Photo', 'T1_Ordered', 'T2_Slip_Saved', 'Promise_P',
    'Pick_Result', 'T3_Packed', 'Bag_Photo', 'T4_Pickup', 'Rider_Type', 'T5_Delivered', 'Delivery_Photo', 'Customer_Issue', 'Status'],
  Master: ['Code', 'Type', 'Name', 'Category', 'Sort_Order', 'Value', 'Active', 'Shop_ID'],
  Event: ['Event_ID', 'Order_ID', 'Shop_ID', 'Station', 'Action', 'Timestamp', 'User', 'Photo', 'Note'],
};

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    if (rows < 1 || cols < 1) throw new Error(`The number of rows/columns in the range must be at least 1 (${rows}x${cols})`);
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const src = this.sheet.cells[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.cols; c++) line.push(src[this.col - 1 + c] ?? '');
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.rows || values.some(v => v.length !== this.cols)) throw new Error('setValues: size does not match the range');
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
}

// Sheets stores "'0812345678" as the text 0812345678 (the apostrophe only stops it becoming a number or a formula).
// Any other text starting with = becomes a formula; it is kept as FORMULA(...) so a test can see it happened.
const stored = v => {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  return v.startsWith('=') ? `FORMULA(${v})` : v;
};

export class FakeSheet {
  constructor(name, rows = []) { this.name = name; this.cells = rows.map(r => r.map(stored)); }
  set(row, col, v) {
    while (this.cells.length < row) this.cells.push([]);
    const line = this.cells[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = stored(v);
  }
  getName() { return this.name; }
  getLastRow() { return this.cells.length; }
  getLastColumn() { return this.cells.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(row, col, rows = 1, cols = 1) { return new FakeRange(this, row, col, rows, cols); }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  appendRow(values) { this.cells.push(values.map(stored)); return this; }
  /** Test helper: data rows as objects keyed by header. */
  records() {
    const [head, ...rows] = this.getDataRange().getValues();
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  header() { return this.getRange(1, 1, 1, this.getLastColumn()).getValues()[0]; }
}

export class FakeSpreadsheet {
  constructor() {
    this.sheets = new Map(Object.entries(ORIGINAL_HEADERS).map(([n, h]) => [n, new FakeSheet(n, [h])]));
  }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  insertSheet(n) {
    if (this.sheets.has(n)) throw new Error(`A sheet with the name "${n}" already exists`);
    const s = new FakeSheet(n);
    this.sheets.set(n, s);
    return s;
  }
}

const signed = buf => Array.from(buf, b => (b > 127 ? b - 256 : b)); // Apps Script hands back Java (signed) bytes
const bytes = v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => b & 0xff)));

/** yy MM dd HH mm ss in a time zone, the subset of SimpleDateFormat that Code.gs uses. */
function formatDate(date, tz, fmt) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(x => [x.type, x.value]));
  return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, t => ({ yyyy: p.year, yy: p.year.slice(2), MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second }[t]));
}

class FakeBlob {
  constructor(data, type, name) { Object.assign(this, { data: Buffer.from(data.map(b => b & 0xff)), type, name }); }
  getBytes() { return signed(this.data); }
  getContentType() { return this.type; }
  getName() { return this.name; }
}

/**
 * Drive: folders and files in memory. `files` / `folders` are exposed so tests can look at what was saved, moved or
 * trashed. `addFile(id, name, folderId)` puts an existing file (e.g. the spreadsheet itself) into a folder.
 */
function fakeDrive() {
  const files = new Map();
  const folders = new Map();
  let n = 0;
  const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const file = (blob, folderId, fixedId, fixedName) => {
    const id = fixedId || `file${++n}`;
    const f = {
      id, blob, folderId, trashed: false, getId: () => id, getBlob: () => blob,
      getName: () => fixedName || blob.getName(),
      getParents: () => iter(folders.has(f.folderId) ? [folders.get(f.folderId)] : []),
      moveTo(folder) { f.folderId = folder.getId(); return f; },
      setTrashed(v) { f.trashed = v; return f; },
    };
    files.set(id, f);
    return f;
  };
  const folder = (name, parentId = 'root') => {
    const id = `folder${++n}`;
    const f = {
      id, name, parentId, getId: () => id, getName: () => name,
      createFile: blob => file(blob, id),
      createFolder: child => folder(child, id),
      getFoldersByName: child => iter([...folders.values()].filter(x => x.parentId === id && x.name === child)),
    };
    folders.set(id, f);
    return f;
  };
  const get = (map, id) => { if (!map.has(id)) throw new Error(`No item with the given ID could be found: ${id}`); return map.get(id); };
  const root = folder('My Drive', null);
  return {
    files, folders, root,
    addFile: (id, name, folderId) => file(null, folderId, id, name),
    api: { createFolder: name => folder(name, root.id), getRootFolder: () => root, getFolderById: id => get(folders, id), getFileById: id => get(files, id) },
  };
}

/**
 * A fresh Apps Script world with Code.gs + Admin.gs + Member.gs + Bcrypt.gs loaded. Returns the context (call its functions
 * directly), the fake spreadsheet, and post(body) which goes through doPost exactly like the site's fetch does.
 * `user` is who opened the web app ('' = not signed in, as on the public order deployment); `owner` runs the script.
 */
export function loadBackend({ files = ['Bcrypt.gs', 'Code.gs', 'Admin.gs', 'Member.gs'], user = '', owner = 'owner@example.com', props = {} } = {}) {
  const ss = new FakeSpreadsheet();
  const cache = new Map();
  const properties = new Map(Object.entries(props));
  const drive = fakeDrive();
  const session = { user, owner };
  const ctx = createContext({
    console: { log() {}, error: console.error },
    SpreadsheetApp: { openById: () => ss, flush() {} },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, String(v)); }, remove: k => { cache.delete(k); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }) },
    Session: {
      getActiveUser: () => ({ getEmail: () => session.user }),
      getEffectiveUser: () => ({ getEmail: () => session.owner }),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: k => (properties.has(k) ? properties.get(k) : null), setProperty(k, v) { properties.set(k, String(v)); return this; } }),
    },
    HtmlService: {
      createHtmlOutputFromFile: file => {
        const out = { file, title: '', meta: {}, setTitle(t) { out.title = t; return out; }, addMetaTag(k, v) { out.meta[k] = v; return out; } };
        return out;
      },
    },
    DriveApp: drive.api,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      getUuid: () => randomUUID(),
      computeDigest: (alg, v) => signed(createHash(alg).update(bytes(v)).digest()),
      base64Decode: s => signed(Buffer.from(s, 'base64')),
      base64Encode: b => Buffer.from(b.map(x => x & 0xff)).toString('base64'),
      newBlob: (data, type, name) => new FakeBlob(data, type, name),
      formatDate,
    },
  });
  for (const f of files) {
    new Script(readFileSync(join(ROOT, 'backend', 'apps-script', f), 'utf8'), { filename: f }).runInContext(ctx);
  }
  // The spreadsheet itself sits in the AppSheet app's data folder, as in the real sandbox.
  if (files.includes('Code.gs')) {
    const appFolder = drive.api.createFolder('SmartMenuSandboxDIFOT-93916087');
    drive.addFile(new Script('SHEET_ID').runInContext(ctx), 'DIFOT sandbox', appFolder.getId());
  }
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());
  return { ctx, ss, cache, post, sheet: n => ss.getSheetByName(n), drive, properties, session };
}

/** A valid guest order (order.v1) with hand-checked totals: 3 kg × ฿80 + 2 kg × ฿65 = ฿370. */
export function guestOrder(over = {}) {
  return {
    contract: 'order.v1', shop_id: 'SU22', price_week: '2026-10-24',
    customer: { shop_name: 'Café Test', contact_name: 'Ken', phone: '0812345678', line_name: '' },
    delivery: { date: '2026-10-25', address_note: 'Soi 22' },
    note: '',
    items: [
      { sku: 'PK-001', name_th: 'มันแข็งหมู', name_en: 'Pork back fat', qty: 3, qty_unit: 'kg', unit_price: 80, line_total: 240 },
      { sku: 'CK-001', name_th: 'ไก่', name_en: 'Chicken', qty: 2, qty_unit: 'kg', unit_price: 65, line_total: 130 },
    ],
    total: 370, lang: 'th', client_ts: '2026-10-24T10:00:00+07:00', hp: '',
    ...over,
  };
}

/** Adds an active customer with a shop code to Master (call after setup()). */
export function addShop(sheet, { code = 'CUS-W010', name = 'Shop A', phone = '0811111111', shopCode = 'ABCDEFGH23', address = '1 Sukhumvit Rd' } = {}) {
  const head = sheet.header();
  const row = { Code: code, Type: 'Customer', Name: name, Active: 'Yes', Shop_ID: 'SU22', Phone: "'" + phone, Address: address, Shop_Code: shopCode };
  sheet.appendRow(head.map(h => row[h] ?? ''));
}
