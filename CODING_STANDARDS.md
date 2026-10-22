# Coding standards

Keep this site boring, small and hard to break.

1. **No framework, no build step.** Plain HTML, CSS and one `app.js`. The repo is the website.
2. **Relative paths only** (`data/catalog.json`, never `/data/...`) so it works under a GitHub Pages subpath.
3. **Data is separate from code.** Product info lives in `data/catalog.json`; prices live in
   `data/prices/`. The site never hard-codes a product or a price.
4. **Prices enter only through `scripts/publish-prices.mjs`.** Never hand-edit `data/prices/*.json`.
5. **Schemas are the contract.** If you add a field, change the schema first, then
   `scripts/lib/schema-check.mjs` if it needs a new keyword (it throws on unknown keywords on purpose).
6. **The site must not care who extracted the data.** Do not branch on `extracted_by` in `app.js`.
7. **Fail soft on the page, fail hard in scripts.** Missing prices → friendly message on the menu.
   Bad data → script exits non-zero and writes nothing.
8. **Render with `textContent`, never `innerHTML`,** for anything from JSON.
9. **Every visible string has Thai and English.** Add both in the `TEXT` table in `app.js`.
   Units (`kg`, `tray`, `pack`) are codes in the data; their Thai/English labels live in `TEXT` too.
10. **Prices are tiers.** The headline price is the tier with the smallest `min_qty`; the other tiers
    are shown under it. Never assume a product has more than one tier.
11. **Scripts use Node built-ins only.** The single dev dependency is `qrcode` for `make-qr.mjs`.
12. **No personal contact details from source sheets** (phone numbers, contact names) in any file.
13. **Before you push:** `npm run validate` must pass (CI runs it too).
