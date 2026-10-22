#!/usr/bin/env node
// THE ONLY WAY PRICES GET INTO THE SITE.
// Takes one extractor output file (any producer: claude | benny | manual), checks it,
// writes data/prices/<effective_date>.json and refreshes data/prices/latest.json.
//
// Usage: node scripts/publish-prices.mjs <incoming.json> [--dry-run]
// Exit codes: 0 published (warnings may be printed), 1 rejected, 2 bad usage.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ROOT, CATALOG_PATH, PRICES_DIR, LATEST_PATH,
  readJson, listPriceFiles, checkCatalog, checkPrices, checkRepo, report,
} from './lib/checks.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('Usage: node scripts/publish-prices.mjs <incoming.json> [--dry-run]');
  process.exit(2);
}

const incoming = readJson(input);
if (incoming.error) { console.error(`ERROR ${incoming.error}`); process.exit(1); }
const catalog = readJson(CATALOG_PATH);
if (catalog.error) { console.error(`ERROR ${catalog.error}`); process.exit(1); }
const catRes = checkCatalog(catalog.data);
if (catRes.errors.length) { report(catRes); console.error('Fix data/catalog.json first.'); process.exit(1); }

const prices = incoming.data;
const date = prices.effective_date;

// Compare against the most recent week *before* this one.
const earlier = listPriceFiles().filter((f) => typeof date === 'string' && f.date < date);
const previous = earlier.length ? readJson(earlier[earlier.length - 1].path).data : null;

const res = checkPrices(prices, catalog.data, previous);
res.warnings.unshift(...catRes.warnings);
report(res);
if (res.errors.length) {
  console.error(`\nRejected: nothing was written. Fix the extractor output and run again.`);
  process.exit(1);
}

// Normalise: catalog order, fixed key order, so diffs stay readable.
const order = new Map(catalog.data.products.map((p, i) => [p.sku, i]));
// Tier order is kept as given (the checks already require ascending min_qty).
const normalised = {
  effective_date: prices.effective_date,
  valid_from: prices.valid_from,
  valid_to: prices.valid_to,
  source_file: prices.source_file,
  extracted_by: prices.extracted_by,
  currency: prices.currency,
  prices: [...prices.prices]
    .sort((a, b) => order.get(a.sku) - order.get(b.sku))
    .map(({ sku, qty_unit, tiers }) => ({
      sku,
      qty_unit,
      tiers: tiers.map(({ min_qty, max_qty, price }) => (
        max_qty == null ? { min_qty, price } : { min_qty, max_qty, price }
      )),
    })),
};
const body = `${JSON.stringify(normalised, null, 2)}\n`;

const datedPath = join(PRICES_DIR, `${date}.json`);
const files = listPriceFiles();
const newestDate = files.length ? files[files.length - 1].date : null;
const becomesLatest = !newestDate || date >= newestDate;

if (dryRun) {
  console.log(`\nDry run OK: would write ${relative(ROOT, datedPath)}${becomesLatest ? ' and latest.json' : ''}.`);
  process.exit(0);
}

mkdirSync(PRICES_DIR, { recursive: true });
if (existsSync(datedPath)) console.log(`Replacing existing ${relative(ROOT, datedPath)} (correction).`);
writeFileSync(datedPath, body);
if (becomesLatest) writeFileSync(LATEST_PATH, body);
else console.log(`Note: ${date} is older than ${newestDate}; latest.json left unchanged.`);

const after = checkRepo();
if (after.errors.length) { report(after); process.exit(1); }
console.log(`\nPublished ${relative(ROOT, datedPath)}${becomesLatest ? ' -> latest.json' : ''}. Commit and push data/prices/ to go live.`);
