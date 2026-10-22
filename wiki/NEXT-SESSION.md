# Next session — pick up here (written 2026-10-22 20:50)

Open a new chat, connect folder `Documents\Smart menu`, and say: "อ่าน SmartMenu/wiki/NEXT-SESSION.md แล้วทำต่อ" (or `/chief-of-staff` with that).

## Where things stand (2026-10-22)
- Live site: https://kittanunr.github.io/SmartMenu/ — v2 menu, real prices 17–23/10/2026, LINE OA @897izxro.
- Local repo (this folder) has UNPUSHED changes: cart/checkout, Apps Script source, order contract, wiki. See wiki/ordering.md.
- DIFOT sandbox: AppSheet app "SmartMenu Sandbox DIFOT" + sheet "Event" (id 1e8x…ISAg). Teammate's original app/sheet untouched.

## Next steps, in order
1. ~~Deploy Apps Script web app~~ DONE 2026-10-22 23:47 (URL in config.json; backend test order W261022-001 OK). Old note: (script.google.com, account btgs.sukhumvit = authuser 1): Deploy → New deployment → Web app, Execute as me, Anyone → Petch clicks Authorize access → Allow. Copy the `/exec` URL.
2. ~~Put the URL into config.json~~ DONE.
3. DONE 2026-10-23 00:10 — AppSheet sandbox: Order + Master regenerated; Slip_Photo Require? = [Source]<>"Web" (Petch); Order_Items added (Item_ID key, Order_ID Ref→Order, Is a part of = yes) → Order got virtual col "Related Order_Items"; saved, no issues. Old note: Master → Regenerate structure; add table Order_Items (ref Order_ID → Order); Slip_Photo Require? = `[Source]<>"Web"`; show Order_Items inside the order detail; Save.
4. DONE 2026-10-23 00:11 (W261023-001 passed; see ordering.md). Old note: one order from the site → check Order/Order_Items/Event/Master rows in the sandbox sheet → appears in "เคาน์เตอร์" → LINE message opens with summary.
5. DONE 2026-10-23 00:10 (pushed). NEW 5b: fix AppSheet cosmetics (Web_Phone type Phone, Unit_Price ฿) + delete test rows.
6. Later: show teammate → apply same changes to the real DIFOT; map SmartMenu SKUs (PK-/CK-/EG-) to Master SKU codes (SKU-001…).

## Things to remember
- Ordering auto-pauses after the price sheet's `valid_to` (Friday). New prices must be published every Friday or ordering stops Saturday.
- Never write to the original sheet DIFOT_Pilot_SU22 (id 1UEI…xvx8).
- Lesson plan for API key / Benny: `Documents\Smart menu\learn-smartmenu\NEXT-SESSION.md`.
