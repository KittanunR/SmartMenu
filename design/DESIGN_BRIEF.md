# Design brief — SmartMenu v2 (2026-10-22)

Sources applied: `skills/frontend-design` (Anthropic, Apache-2.0), `skills/taste-skill` (MIT), `skills/ui-refactor/SOURCE.md` (Refactoring UI, link only), and the Betagro catalogue study `reference/catalogue-style.md` + `reference/style-*.jpg`.

Petch's verdict on v1 (2026-10-22): "works, but has no style". Hard rule: every priced product shows its photo.

## Direction (one sentence)
**A pocket edition of the Betagro trade catalogue** — premium, airy, photo-led; deep forest green as the only strong colour, everything else white and warm grey. It should feel like flipping a printed catalogue, not like a delivery app.

## Who / where
B2B buyer (café, bar, school; Thai or foreign owner) scanning a QR while a salesperson stands there. Goal: within 5 seconds see *what it is* (photo) and *how much* (price + bulk tiers). One hand, phone, often in a dim bar → high contrast, big tap targets.

## Tokens (restrictive scales — no ad-hoc values)
- Colour: `--forest #1A4A20`, `--forest-2 #20602F`, `--leaf #78B040` (Thai names, pills, badges), `--paper #F4F5F1`, `--mint #E7EFE2`, `--ink #1B1F1A`, `--grey #6B7268`, `--line #DDE3D8`. Orange is NOT used (catalogue reserves it for processed food).
- Space: 4, 8, 12, 16, 24, 32, 48, 64.
- Radius: 2 (photos, hairline cards), 999 (pills/badges). No mid-size rounded "app cards".
- Type scale: 12 / 14 / 16 / 20 / 28 / 40.
- Shadow: one soft drop shadow under product photos only (catalogue "pack on paper" look), light source from top.

## Type
- Self-host (no Google CDN): `@fontsource/prompt` (Thai+Latin geometric) — 300 wide-tracked ALL-CAPS for English section titles ("PORK"), 600 for Thai product names in `--leaf`/`--forest`.
- Body/meta: `@fontsource/ibm-plex-sans-thai` 400/500. Prices: Prompt 600, tabular figures.
- Keep the Thai font already in `assets/fonts/` only if it is one of these; otherwise replace.

## Layout (390 px first)
1. **Cover header**: forest-green band with Betagro Shop wordmark (text, not a copied logo), week range "17–23 ต.ค. 2569", TH/EN toggle.
2. **Category opener** per tab: thin wide-tracked "PORK" + green Thai "หมู", hairline rule to a round green badge (simple self-drawn SVG icon). Sticky category tabs below cover.
3. **Product grid: 2 columns**, catalogue style. Each tile: square photo (hero, ~170 px, on `--paper` with soft shadow) → green Thai name → grey English name → hairline → price block.
4. **Price block**: big `฿175` + `/kg`; below, a compact tier strip of pills: `3+ kg ฿170 · 6+ kg ฿165`. The 1–2 kg price is the hero; tiers are scannable, not a table.
5. Tap tile → bottom sheet with large photo, description, full tier table, "Order via LINE".
6. Search: slim field under the opener; results keep the grid.
7. Footer: "Prices in THB, confirm on order" + small catalogue-style note. Sticky LINE button stays, but slimmer (forest outline on paper, not neon LINE green).

## Motion (subtle)
Tiles fade/rise 8 px on first paint (stagger 30 ms, max 300 ms). Tab switch cross-fade 150 ms. Respect `prefers-reduced-motion`.

## Performance / a11y
`loading="lazy"` + width/height on every `<img>`; WebP 600 px; first 4 images eager. Contrast ≥ 4.5:1 for text; tap targets ≥ 44 px; `alt` = Thai + English name.

## Do / Don't
- DO let photos carry the page; lots of white space; hairlines instead of boxes.
- DO keep green the single accent; prices in `--forest`, never red.
- DON'T use generic app-card look (big radius, grey shadow on every card), emoji, gradient blobs, Inter/Roboto, neon LINE green as a page colour.
- DON'T copy Betagro's logo artwork; use the text wordmark.
- DON'T show a product without a photo (validator already errors).
