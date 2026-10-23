// Shared rules for validate.mjs and publish-prices.mjs.
// Every function returns { errors: string[], warnings: string[] } and never throws on bad data.
// Errors block a publish; warnings are printed for a human to eyeball.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { checkSchema } from './schema-check.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CATALOG_PATH = join(ROOT, 'data', 'catalog.json');
export const PRICES_DIR = join(ROOT, 'data', 'prices');
export const LATEST_PATH = join(PRICES_DIR, 'latest.json');

export const MAX_WEEKLY_CHANGE = 0.30; // 30% week-over-week move of the base (smallest-qty) price = warning
export const OUTLIER_FACTOR = 2;       // base price > 2x the median of its category = warning
export const SAP_CODE_LENGTH = 10;     // Betagro SAP codes on the sheet are 10 digits
const SKU_PREFIX = { pork: 'PK', chicken: 'CK', egg: 'EG', fish: 'FS' };
const DATED_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const DAY_MS = 86400000;

const catalogSchema = JSON.parse(readFileSync(join(ROOT, 'schema', 'catalog.schema.json'), 'utf8'));
const pricesSchema = JSON.parse(readFileSync(join(ROOT, 'schema', 'prices.schema.json'), 'utf8'));

export function readJson(path) {
  try {
    // Strip a UTF-8 BOM (Notepad/PowerShell add one); browsers ignore it, JSON.parse does not.
    return { data: JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) };
  } catch (e) {
    return { error: `${path}: ${e.code === 'ENOENT' ? 'file not found' : e.message}` };
  }
}

/** Dated price files, oldest first: [{ date, path }] */
export function listPriceFiles() {
  if (!existsSync(PRICES_DIR)) return [];
  return readdirSync(PRICES_DIR)
    .map((f) => f.match(DATED_FILE))
    .filter(Boolean)
    .map((m) => ({ date: m[1], path: join(PRICES_DIR, m[0]) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function isRealDate(s) {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The price a customer pays for the smallest order: the tier with the lowest min_qty. */
export function basePrice(row) {
  return row.tiers.reduce((a, b) => (b.min_qty < a.min_qty ? b : a)).price;
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function checkCatalog(catalog) {
  const errors = checkSchema(catalogSchema, catalog).map((e) => `catalog ${e}`);
  const warnings = [];
  if (errors.length) return { errors, warnings };

  const seen = new Set();
  const bySap = new Map();
  for (const p of catalog.products) {
    if (seen.has(p.sku)) errors.push(`catalog: duplicate sku ${p.sku}`);
    seen.add(p.sku);
    if (!p.sku.startsWith(`${SKU_PREFIX[p.category]}-`)) {
      errors.push(`catalog: ${p.sku} is in "${p.category}" so it must start with ${SKU_PREFIX[p.category]}-`);
    }
    // Missing image on an active, priced product is an ERROR in checkPhotos(); here it is only a warning.
    if (!existsSync(join(ROOT, p.image))) warnings.push(`catalog: ${p.sku} image not found: ${p.image}`);
    // Without one the menu falls back to the English name in that language.
    const untranslated = ['ja', 'zh', 'ko', 'hi'].filter((l) => !p[`name_${l}`]);
    if (p.active && untranslated.length) warnings.push(`catalog: ${p.sku} (${p.name_en}) has no name in ${untranslated.join(', ')} — the menu shows English there`);
    if (p.sap_code) {
      if (p.sap_code.length !== SAP_CODE_LENGTH) {
        warnings.push(`catalog: ${p.sku} SAP code ${p.sap_code} has ${p.sap_code.length} digits (expected ${SAP_CODE_LENGTH}) — check the sheet`);
      }
      bySap.set(p.sap_code, [...(bySap.get(p.sap_code) || []), p]);
    }
  }
  for (const [sap, ps] of bySap) {
    if (ps.length > 1) {
      const list = ps.map((p) => `${p.sku} "${p.name_th}"`).join(', ');
      warnings.push(`catalog: SAP code ${sap} is used by ${ps.length} products (${list}) — the sheet lists it twice; confirm with Betagro which product the code belongs to`);
    }
  }
  const placeholders = catalog.products.filter((p) => p.placeholder).length;
  if (placeholders) warnings.push(`catalog: ${placeholders} placeholder product(s) still in the catalog`);
  return { errors, warnings };
}

/**
 * Petch's rule (2026-10-22): every product that shows a price must show a real photo.
 * Active + priced product -> image file must exist and photo_match must be set
 * (a product without photo_match still has a placeholder, not a catalogue photo).
 */
export function checkPhotos(prices, catalog, label = 'prices') {
  const errors = [];
  const bySku = new Map(catalog.products.map((p) => [p.sku, p]));
  for (const row of prices.prices) {
    const p = bySku.get(row.sku);
    if (!p || !p.active) continue;
    if (!existsSync(join(ROOT, p.image))) {
      errors.push(`${label}: ${p.sku} (${p.name_th}) is priced but its image file is missing: ${p.image}`);
    } else if (!p.photo_match) {
      errors.push(`${label}: ${p.sku} (${p.name_th}) is priced but has no real photo (photo_match not set, image ${p.image}) — cut one from the catalogue`);
    }
  }
  return { errors, warnings: [] };
}

function checkTiers(label, row) {
  const errors = [];
  const warnings = [];
  const t = row.tiers;
  t.forEach((tier, i) => {
    const where = `${label}: ${row.sku} tier ${i + 1}`;
    if (tier.max_qty != null && tier.max_qty < tier.min_qty) errors.push(`${where} max_qty ${tier.max_qty} is below min_qty ${tier.min_qty}`);
    if (Math.round(tier.price * 100) !== tier.price * 100) warnings.push(`${where} price ${tier.price} has more than 2 decimals`);
    if (i === 0) {
      if (tier.min_qty !== 1) warnings.push(`${where} starts at ${tier.min_qty} ${row.qty_unit}, not 1 — smaller orders have no price`);
      return;
    }
    const prev = t[i - 1];
    if (!(tier.min_qty > prev.min_qty)) {
      errors.push(`${where} min_qty ${tier.min_qty} must be greater than the tier before (${prev.min_qty}) — list tiers ascending`);
      return;
    }
    if (prev.max_qty != null && prev.max_qty >= tier.min_qty) {
      errors.push(`${where} overlaps the tier before (${prev.min_qty}–${prev.max_qty} vs from ${tier.min_qty})`);
    }
    if (tier.price > prev.price) {
      warnings.push(`${label}: ${row.sku} price goes UP with quantity (${prev.min_qty}+ ${prev.price} -> ${tier.min_qty}+ ${tier.price}) — double-check the source`);
    }
  });
  if (t.length && t[t.length - 1].max_qty != null) {
    warnings.push(`${label}: ${row.sku} last tier has max_qty ${t[t.length - 1].max_qty} — orders above it have no price`);
  }
  return { errors, warnings };
}

/**
 * @param prices    parsed prices JSON
 * @param catalog   parsed catalog JSON (assumed valid)
 * @param previous  parsed prices JSON of the week before, or null
 * @param fileDate  YYYY-MM-DD from the file name, or null when checking an incoming file
 */
export function checkPrices(prices, catalog, previous = null, fileDate = null) {
  const label = fileDate ? `prices ${fileDate}` : 'prices';
  const errors = checkSchema(pricesSchema, prices).map((e) => `${label} ${e}`);
  const warnings = [];
  if (errors.length) return { errors, warnings };

  for (const k of ['effective_date', 'valid_from', 'valid_to']) {
    if (!isRealDate(prices[k])) errors.push(`${label}: ${k} ${prices[k]} is not a real date`);
  }
  if (prices.effective_date !== prices.valid_from) {
    errors.push(`${label}: effective_date ${prices.effective_date} must equal valid_from ${prices.valid_from}`);
  }
  if (fileDate && fileDate !== prices.effective_date) {
    errors.push(`${label}: file name says ${fileDate} but effective_date is ${prices.effective_date}`);
  }
  if (!errors.length) {
    const days = (Date.parse(prices.valid_to) - Date.parse(prices.valid_from)) / DAY_MS + 1;
    if (days < 1) errors.push(`${label}: valid_to ${prices.valid_to} is before valid_from ${prices.valid_from}`);
    else if (days !== 7) warnings.push(`${label}: validity ${prices.valid_from} → ${prices.valid_to} is ${days} day(s), not one week`);
    const today = new Date().toISOString().slice(0, 10);
    if (!fileDate && prices.valid_from > today) {
      warnings.push(`${label}: valid_from ${prices.valid_from} is in the future — the site will show these prices as soon as you push`);
    }
    if (!fileDate && prices.valid_to < today) {
      warnings.push(`${label}: valid_to ${prices.valid_to} has already passed — the menu will show these prices as out of date`);
    }
  }

  const bySku = new Map(catalog.products.map((p) => [p.sku, p]));
  const priced = new Set();
  for (const row of prices.prices) {
    if (priced.has(row.sku)) errors.push(`${label}: ${row.sku} appears more than once`);
    priced.add(row.sku);
    const product = bySku.get(row.sku);
    if (!product) errors.push(`${label}: ${row.sku} is not in data/catalog.json (add it there first)`);
    else {
      if (!product.active) warnings.push(`${label}: ${row.sku} is priced but inactive in the catalog (it will not show)`);
      if (product.unit !== row.qty_unit) {
        warnings.push(`${label}: ${row.sku} is priced per ${row.qty_unit} but the catalog unit is ${product.unit} — the menu shows the catalog unit`);
      }
    }
    const t = checkTiers(label, row);
    errors.push(...t.errors);
    warnings.push(...t.warnings);
  }
  for (const p of catalog.products) {
    if (p.active && !priced.has(p.sku)) warnings.push(`${label}: active product ${p.sku} (${p.name_en}) has no price — menu will show "ask for price"`);
  }

  // Incoming file (publish): every active priced product needs a photo. checkRepo runs this for the newest file.
  if (!fileDate) errors.push(...checkPhotos(prices, catalog, label).errors);

  // Outliers: base price far above the rest of its category (same unit).
  const groups = new Map();
  for (const row of prices.prices) {
    const p = bySku.get(row.sku);
    if (!p) continue;
    const key = `${p.category}/${row.qty_unit}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  for (const [key, rows] of groups) {
    if (rows.length < 5) continue;
    const med = median(rows.map(basePrice));
    for (const row of rows) {
      if (basePrice(row) > OUTLIER_FACTOR * med) {
        warnings.push(`${label}: ${row.sku} (${bySku.get(row.sku).name_th}) ${basePrice(row)} is more than ${OUTLIER_FACTOR}x the ${key} median ${med} — double-check the source`);
      }
    }
  }

  if (previous) {
    const prev = new Map(previous.prices.map((r) => [r.sku, r]));
    for (const row of prices.prices) {
      const old = prev.get(row.sku);
      if (!old) continue;
      if (old.qty_unit !== row.qty_unit) {
        warnings.push(`${label}: ${row.sku} unit changed ${old.qty_unit} -> ${row.qty_unit} since ${previous.effective_date}`);
      }
      const before = basePrice(old);
      const now = basePrice(row);
      const change = (now - before) / before;
      if (Math.abs(change) > MAX_WEEKLY_CHANGE) {
        const pct = `${change > 0 ? '+' : ''}${(change * 100).toFixed(0)}%`;
        warnings.push(`${label}: ${row.sku} base price moved ${pct} (${before} -> ${now}) vs ${previous.effective_date} — double-check the source`);
      }
    }
  }
  return { errors, warnings };
}

/** Full repository check: catalog, every dated file, latest.json. */
export function checkRepo() {
  const errors = [];
  const warnings = [];
  const merge = (r) => { errors.push(...r.errors); warnings.push(...r.warnings); };

  const cat = readJson(CATALOG_PATH);
  if (cat.error) return { errors: [cat.error], warnings };
  merge(checkCatalog(cat.data));
  if (errors.length) return { errors, warnings };

  const files = listPriceFiles();
  if (!files.length) {
    warnings.push('prices: no files in data/prices/ yet — the menu will say prices are not available');
    return { errors, warnings };
  }

  let previous = null;
  files.forEach((f, i) => {
    const r = readJson(f.path);
    if (r.error) { errors.push(r.error); return; }
    const res = checkPrices(r.data, cat.data, previous, f.date);
    errors.push(...res.errors);
    // Only the newest week's warnings matter; older weeks are history.
    if (i === files.length - 1) warnings.push(...res.warnings);
    previous = r.data;
  });

  const newest = files[files.length - 1];
  const newestData = readJson(newest.path);
  if (!newestData.error) errors.push(...checkPhotos(newestData.data, cat.data, `prices ${newest.date}`).errors);
  const latest = readJson(LATEST_PATH);
  if (latest.error) errors.push(`${latest.error} (run scripts/publish-prices.mjs)`);
  else if (JSON.stringify(latest.data) !== JSON.stringify(readJson(newest.path).data)) {
    errors.push(`data/prices/latest.json is not a copy of ${basename(newest.path)} — never edit latest.json by hand, run scripts/publish-prices.mjs`);
  }
  merge(checkSite());
  return { errors, warnings };
}

const PAGES = ['index.html', 'member.html', 'history.html', 'tools/shop-qr.html'];
const SCRIPTS = ['app.js', 'member.js', 'history.js', 'i18n.js', 'backend/apps-script/Code.gs', 'backend/apps-script/Admin.gs', 'backend/apps-script/Member.gs', 'backend/apps-script/Bcrypt.gs'];
const CONFIG_STRINGS = ['shop_name_th', 'shop_name_en', 'line_oa_url', 'line_oa_id', 'shop_id'];
const ENDPOINT = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

/** The site itself: config.json, files the pages load, and that the scripts parse. Never runs them. */
export function checkSite() {
  const errors = [];
  const warnings = [];

  const cfg = readJson(join(ROOT, 'config.json'));
  if (cfg.error) errors.push(cfg.error);
  else {
    for (const k of CONFIG_STRINGS) {
      if (typeof cfg.data[k] !== 'string' || !cfg.data[k].trim()) errors.push(`config.json: "${k}" is missing or empty`);
    }
    if (!(cfg.data.stale_after_days > 0)) errors.push('config.json: "stale_after_days" must be a number above 0');
    if (cfg.data.order_endpoint === undefined) warnings.push('config.json: no "order_endpoint" — the site will only offer ordering through LINE');
    else if (!ENDPOINT.test(String(cfg.data.order_endpoint))) errors.push('config.json: "order_endpoint" is not an Apps Script https://script.google.com/macros/s/…/exec URL');
  }

  for (const page of PAGES) {
    const path = join(ROOT, page);
    if (!existsSync(path)) { errors.push(`${page}: file not found`); continue; }
    const html = readFileSync(path, 'utf8');
    for (const [, ref] of html.matchAll(/\b(?:src|href)="([^"]*)"/g)) {
      if (!ref || /^(#|data:|https?:|mailto:|tel:)/.test(ref)) continue;
      const file = ref.split(/[?#]/)[0];
      if (!existsSync(join(dirname(path), file))) errors.push(`${page}: loads "${ref}" but ${file} does not exist`);
    }
  }

  for (const file of SCRIPTS) {
    const path = join(ROOT, file);
    if (!existsSync(path)) { errors.push(`${file}: file not found`); continue; }
    try {
      new Script(readFileSync(path, 'utf8'), { filename: file });
    } catch (e) {
      errors.push(`${file}: ${e.message} — the file would not run`);
    }
  }
  return { errors, warnings };
}

export function report({ errors, warnings }) {
  for (const w of warnings) console.warn(`WARN  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);
  console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
}
