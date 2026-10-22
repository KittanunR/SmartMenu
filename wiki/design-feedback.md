# Design feedback
- 2026-10-22: Petch reviewed the first live draft (`4a60a14`): impressed overall, but the site "has no style". Wants it to look as attractive as the Betagro product catalogue (Betagro_Trade_MKT_.pdf).
- 2026-10-22: Hard requirement from Petch — **every product that shows a price must show a photo**, photos sourced from that catalogue PDF.
- 2026-10-22: Petch asked Claude to search the internet for design-related SKILL.md files and rebuild the UI using them.
- 2026-10-22: Petch: match catalogue photos by **name only** — catalogue SAP codes do not correspond to the price-sheet codes.
- 2026-10-22: Product photos added for all 65 SKUs (`assets/products/<SKU>.webp`), cut from catalogue pages 5, 6, 9, 10, 11, 13 and matched by Thai name. Betagro-brand packs preferred; S-Pure packs used where Betagro has no pack for that cut. Each catalog entry carries `photo_match` (exact / close / similar); validator now errors if an active, priced product has no real photo. Mapping: work/photo-map.csv.
- 2026-10-22: Petch: when catalogue and price sheet disagree on names, **the price sheet wins** (e.g. CK-012 ปีกปลายไก่ stays "Wing tip", not catalogue "2-joint wing").
- 2026-10-22: v2 UI built (cloud `6f56e48`) from design/DESIGN_BRIEF.md: 2-column catalogue grid, photo per product, tier pills, bottom-sheet tier table. Deviations: Thai names dark green (leaf failed 4.5:1 contrast); tier pills drop the unit to avoid wrapping. Copied into local clone, awaiting Petch review + push.
