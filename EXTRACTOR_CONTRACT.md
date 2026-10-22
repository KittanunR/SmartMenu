# Extractor contract

An **extractor** turns the weekly price sheet (PDF or image) into one JSON file.
Today the extractor is Claude. Later it will be Betagro's internal AI, Benny.
A person typing numbers by hand is also an extractor.

The website never knows which one ran. It only reads `data/prices/latest.json`.
Swapping extractors needs **no change to the site**.

```
price sheet (PDF / image)
        │
        ▼
  [ extractor ]  ── claude | benny | manual
        │  writes prices JSON (schema/prices.schema.json)
        ▼
  node scripts/publish-prices.mjs incoming.json
        │  checks → writes data/prices/YYYY-MM-DD.json + latest.json
        ▼
  git commit + push  →  GitHub Pages  →  customers scan the QR
```

## Input

- One price sheet per week (ใบเสนอราคาขาย). Its validity range is printed at the top,
  e.g. `DATE : 17/10/2026 - 23/10/2026` (Saturday to Friday).
- Format: PDF, or a photo/screenshot (PNG/JPG). The sheet has a table per category with columns:
  `รหัสอ้างอิง` (SAP code) · `รายการสินค้า` (Thai name) · `ราคา 1-2 กก.` · `ราคา 3 กก.ขึ้น` · `ราคา 6 กก.ขึ้น` ·
  `ราคา 10 กก.ขึ้น` (often empty) · `ลักษณะสินค้า` (description). Eggs are priced per tray
  (ถาด, 30 eggs) with the same 1-2 / 3+ / 6+ / 10+ breaks, and have no SAP code.
- `data/catalog.json` — the products we sell. The extractor maps each sheet line to a catalog `sku`
  (by `sap_code` + `name_th`, because one SAP code can appear twice on a sheet). It must not invent SKUs.

## Output

One JSON file that passes `schema/prices.schema.json`:

```json
{
  "effective_date": "2026-10-17",
  "valid_from": "2026-10-17",
  "valid_to": "2026-10-23",
  "source_file": "BTG-price-2026-10-17.pdf",
  "extracted_by": "benny",
  "currency": "THB",
  "prices": [
    {
      "sku": "PK-001",
      "qty_unit": "kg",
      "tiers": [
        { "min_qty": 1, "max_qty": 2, "price": 87 },
        { "min_qty": 3, "max_qty": 5, "price": 80 },
        { "min_qty": 6, "price": 75 }
      ]
    }
  ]
}
```

| Field | Rule |
|---|---|
| `valid_from` / `valid_to` | First and last day (inclusive) from the sheet's DATE line, `YYYY-MM-DD`, Gregorian (convert พ.ศ. → ค.ศ.: subtract 543). |
| `effective_date` | Always the same as `valid_from`. It names the file `data/prices/<effective_date>.json`. |
| `source_file` | File name(s) of the sheet you read. Used for audit. |
| `extracted_by` | `claude`, `benny` or `manual`. |
| `currency` | Always `THB`. |
| `prices[].sku` | Must exist in `data/catalog.json`. |
| `prices[].qty_unit` | `kg`, `tray` (30 eggs) or `pack`. What both the quantities and the price are counted in. Should match the catalog `unit`. |
| `prices[].tiers` | One entry per price column that has a number, **ascending by `min_qty`**. |
| `tiers[].min_qty` | Column start: 1, 3, 6, 10. |
| `tiers[].max_qty` | Optional, inclusive: the next present column's start minus 1 (1-2 → `2`; 3+ followed by 6+ → `5`). Leave it out on the last tier. |
| `tiers[].price` | Number, > 0, baht per `qty_unit`, max 2 decimals. No `฿`, no commas. |

No other fields are allowed (`additionalProperties: false`).

### Extraction rules

1. Only include products that are on the sheet **and** in the catalog.
   Sheet lines with no matching SKU: list them in your hand-off message, do not output them.
2. If a catalog product is missing from the sheet, leave it out. The menu shows "Ask for price".
3. Empty price cells are simply not tiers. Never copy a neighbour's price into an empty cell.
4. If the sheet quotes a different unit than the catalog (e.g. per pack instead of per kg),
   output what the sheet says. The checker will flag it for a human.
5. If a number is unreadable, leave that SKU out and say so. Never guess a price.
6. If the PDF has no text layer (a scan), read the image at high zoom and cross-check every
   number with a second method (e.g. OCR per cell); report every disagreement in the hand-off.
7. Never copy the sheet's phone number or contact person into any file.

## Publish (the only way in)

```bash
node scripts/publish-prices.mjs incoming.json --dry-run   # check only
node scripts/publish-prices.mjs incoming.json             # write files
```

| Result | Meaning |
|---|---|
| exit `0` | Written to `data/prices/<effective_date>.json` and `latest.json`. Warnings may be printed. |
| exit `1` | Rejected, nothing written. Fix the JSON and run again. |
| exit `2` | Bad command usage. |

**Errors** (block): schema violation, unknown SKU, duplicate SKU, price ≤ 0, impossible date,
`effective_date` ≠ `valid_from`, `valid_to` before `valid_from`, tiers not ascending by `min_qty`,
overlapping tiers (`max_qty` ≥ next `min_qty`, or `max_qty` < `min_qty`).

**Warnings** (review, then decide): price goes *up* as quantity rises, first tier not starting at 1,
active product without a price, base (smallest-qty) price moved more than 30% from last week,
base price more than 2× its category median (outlier), `qty_unit` differs from the catalog unit or
from last week, validity not exactly 7 days, `valid_from` in the future or `valid_to` already past.
From the catalog: one SAP code used by two products, SAP code not 10 digits, placeholders left.

Never edit `latest.json` or a dated file by hand. To fix a mistake, publish a corrected file
with the same `effective_date`; it replaces the old one.

## How Benny plugs in

Benny only has to produce the JSON above. Pick one route; the site stays the same.

**Route A — GitHub Actions (recommended).**
Benny uploads `incoming/<date>.json` to the repo through the GitHub API
(`PUT /repos/{owner}/{repo}/contents/incoming/<date>.json`) on a branch, then opens a pull request.
A small workflow (add it when Benny is ready, next to `.github/workflows/validate.yml`) runs
`publish-prices.mjs incoming/<date>.json`, commits the result to the PR, and `validate.yml` re-checks.
A person reviews the warnings and merges. Merge = live.

**Route B — direct script.**
If Benny runs somewhere with a checkout of this repo and Node 18+, it runs
`publish-prices.mjs`, commits `data/prices/`, and pushes. Same checks, no PR review.

**Route C — human relay.**
Benny gives the JSON to a person, who runs the publish command. Useful while Benny is in trial.

In every route set `"extracted_by": "benny"` so the history shows who produced each week.
