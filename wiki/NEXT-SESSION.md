# Next session — pick up here (written 2026-10-23 01:38, updated 2026-10-23 night)

## Latest (2026-10-23 night) — read first: Member accounts project
Petch is building optional shop accounts (Guest vs Member). Full spec, decisions and dated log: **[member-accounts.md](member-accounts.md)** — read it before touching code. Work one phase at a time; end each phase with "what changed + how to test"; Petch does every Apps Script / AppSheet / GitHub click himself.

**Status**
| Phase | What | State |
|---|---|---|
| 0 | bcrypt speed in Apps Script | DONE — cost 12 (check ~0.47 s). `Bcrypt.gs` in the Apps Script project. |
| 1 | Data model + test harness | LIVE — Apps Script Version 5 (same /exec), setup() + backfillCategories() ran, commit 9b57f52, Actions #13 ✓. Live order W261023-008: Auth = guest, Category = pork. |
| fix | Order "not sent" although it arrived | LOCAL, NOT PUSHED — app.js / index.html (`?v=2026-10-23f`), see ordering.md 2026-10-23 (after Phase 1). Petch to push, then test on real phones (Chrome/Safari/LINE in-app; airplane mode → new "may already be in" text + "อ้างอิง:" line in the LINE message; retry → 1 row only). Cause still unknown (seen only in the Claude desktop browser). Optional: put "Try again" above the LINE button. |
| 2 | Admin page | NEXT — after Petch reports the fix test |
| 3–5 | Login + branding → History → Analytics | later |

**Decided (don't re-ask):** guest keeps ordering as today · Shop QR = ordering only, never History · login = phone + password · admin creates shop → random temp password shown once (bcrypt hash only, 7 days) → forced change at first login · forgot = admin presses reset (old password + all sessions die) · no invite QR in v1 · Admin = web page (Claude's plan: Apps Script HtmlService, Google-account protected, not on Pages).

**Phase 2 first step:** check whether a consumer-Gmail Apps Script web app can allow several staff emails (Session.getActiveUser() may be empty outside Workspace); if not, all staff use btgs.sukhumvit ("Only myself"). Then: list/create shop (name, phone, contact, address, logo → Drive), issue/reset temp password, disable — never show Password_Hash. Load the web-security-checklist skill. TDD with `npm test` (tests/helpers/apps-script.mjs fakes the sheet).

**Rules:** Member_Auth / Sessions tabs must never be added to AppSheet · no customer data or logos in this public repo · "shop_id" in config = SU22 (Betagro branch); a customer is Master.Code (Customer_ID) · bump `?v=` on every app.js/styles.css change · `npm test` + `npm run validate` before every push (CI runs both).

Say: "อ่าน SmartMenu/wiki/NEXT-SESSION.md แล้วทำต่อ" in Claude Code opened in `Documents\Smart menu\SmartMenu`.

## Earlier (2026-10-23 evening)
- LIVE since: CI gate (02d6bc7), reorder button + 24–30 Oct prices (fc43524). Next price publish due Fri 30/10.
- Next ideas (Petch picks): full PDPA notice (needs Petch's wording), PWA install, clean sandbox test data (W261023-007, -008, test customers), server-side reorder by shop code only if shops ask.

## Done (2026-10-22/23)
- Live site https://kittanunr.github.io/SmartMenu/ has cart + checkout; orders POST to Apps Script v2 (`config.json` order_endpoint) → sandbox sheet "Event" (id 1e8x…ISAg): Order / Order_Items / Event / Master. E2E tested. See ordering.md.
- AppSheet sandbox "SmartMenu Sandbox DIFOT": step buttons → evidence forms (Form_Pack / Form_Rider / Form_Deliver). See difot-step-flow.md.
- index.html loads app.js/styles.css with `?v=YYYY-MM-DD` — bump on every code change (GitHub Pages caches 10 min).

## In progress (2026-10-23 day)
- Sturdier ordering LIVE (retry + same client_order_id, cart kept, LINE fallback, rate limits). See ordering.md 2026-10-23 (day). Apps Script = Version 3 (same /exec URL, setup() ran → Order.Web_Client_ID exists); site pushed as commit 1b7a6ec, app.js?v=2026-10-23b. Checked: endpoint answers `too_big` (new code), live page loads new app.js. Not yet done: a real test order through the live site.
- Found while checking: right after a Pages deploy, config.json returned 503 once (page would silently drop to pilot mode: no order_endpoint, no LINE link). FIXED locally 2026-10-23: getJson retries after 0.8 s and 2 s (not on 404); app.js?v=2026-10-23c. Tested with a simulated 503. LIVE (commit 7aa5c45, CI + Pages OK, live page checked).
- Shop QR v1 LIVE: Apps Script Version 4 (setup ran, Master has Address/Contact_Name/LINE_Name/Shop_Code/Shop_Link; live lookup answers unknown_shop for a fake code), site commit b11facc (app.js?v=2026-10-23d), /tools/shop-qr.html live. makeShopCodes ran (6 customers got codes, sandbox). END-TO-END PASSED on the live site 2026-10-23 18:05: CUS-W002 "Test" link → greeting + masked card → order W261023-007 (฿87) → Order.Customer_ID = CUS-W002, Web_Client_ID filled, Order_Items 1 row, Event note "shop QR". Test row W261023-007 to delete. Before real use: remove/deactivate test customers (Test ×2, Ggg, Hshshsh) and fill Address for real shops. Skills installed in `Smart menu/.claude/skills` (test-driven-development, web-security-checklist) — see SOURCES.md there.
- 2026-10-23 18:20 — CI gate LIVE: commit 02d6bc7 pushed, Pages Source = GitHub Actions; run "validate and deploy" validate ✓ + deploy ✓; live site checked (menu, prices, order_endpoint OK). From now on a red ✗ on a commit = site NOT updated. Petch: don't click "Configure" on the Pages templates (would add a second workflow).
- 2026-10-23 evening — Reorder v1 ("สั่งเหมือนครั้งก่อน") built, local, NOT pushed (app.js/styles.css?v=2026-10-23e). THIS DEVICE ONLY: after an order goes through (Apps Script ok, pilot LINE sent, or "clear after LINE") its [sku, qty] are kept in localStorage `menu-last-order`; button in the green cover when the cart is empty → refills cart at this week's prices, skips products no longer sold (toast says how many). No backend change. Tested in the browser pane with a fake server: success saves + button returns; failed send does not overwrite; unsold SKU skipped; mobile + desktop layout OK; validate 0 errors. Limit: another staff phone of the same shop won't see it → server-side "last order by shop code" later if shops ask.
- (history) 2026-10-23 evening — CI blocks broken pushes: written locally, NOT pushed. Files: .github/workflows/validate.yml (validate → deploy job, main only), scripts/lib/checks.mjs (new checkSite: config.json, page file refs, app.js/Code.gs parse), scripts/validate.mjs comment, README. Go-live order: (1) Petch pushes, (2) Settings → Pages → Source = "GitHub Actions", (3) Actions tab → "validate and deploy" → Run workflow (or next push). Until step 2 the old branch deploy keeps working; the new deploy job will fail red — expected. Check after: green ✓ + live site loads. Verified with real Node 2026-10-23: repo passes (0 errors, 2 old data warnings); a broken copy (bad app.js, empty shop_id, missing CSS) fails with exit 1. Also fixed: readJson now ignores a UTF-8 BOM (would have blocked a good deploy).
- 2026-10-23 evening — Petch first said ordering may pause (no new prices, no customers yet), then chose to reuse this week's prices for 24–30 Oct (see Weekly price update below).
- 2026-10-23 evening — PDPA: checkout already says "used only to deliver and discuss orders" (app.js `privacy`). Full notice (who holds the data, how long kept, how to ask for deletion, contact) NOT written — needs Petch/Betagro to decide the wording.
- 2026-10-23 evening: Node.js 24.22.1 LTS installed (winget OpenJS.NodeJS.LTS) → `npm run validate` and `node scripts/publish-prices.mjs` run locally. Open a NEW terminal/session for PATH to pick it up. Still no Python: local preview uses `Smart menu/.claude/launch.json` "smartmenu-local" (PowerShell static server from a scratchpad; recreate if gone).

## Tomorrow's plan (Petch, 2026-10-23 01:29) — in Claude Code
1. Focus = SmartMenu only (DIFOT/AppSheet parked; it's the teammate's project, Petch only exploring). Design fixes to close the gaps in smartmenu-capacity-risks-login.md:
   - ordering under load (lock/timeout, retry), fallback to LINE when the endpoint fails (keep cart), spam protection, CI that blocks broken pushes, less dependence on one Google account.
   - customer identity (Petch likes it, 2026-10-23 01:35): private code per shop, hidden inside a per-shop QR/link (sticker or card left by salesperson, or sent in LINE) → scan = shop recognised + remembered; fallback phone number (masked address); typed code last resort. Then saved address, per-group menu/prices, reorder. LINE Login later on same shop record. PDPA notice.
   - optional: make SmartMenu installable (PWA) instead of a store app (Petch asked why store apps are harder: fees, review, 2 platforms, Mac for iOS, slow updates).
2. Later / optional: DIFOT web kanban demo (option 1 below).

## Parked decision (Petch, 2026-10-23 01:21)
Problem: เคาน์เตอร์ tab = slice Today_Orders `[Order_Date]=TODAY()` → orders never leave the counter. Tabs: จัดของ = `[Status]="Received"`, ส่งของ = `IN([Status],{"Packed","Out"})`, Delivered_7D = Delivered/Issue last 7 days.
Petch chose a counter confirm step (new Status "New" → counter presses ส่งไปจัดของ → "Received"). NOT built yet — paused because Petch asked about leaving AppSheet.
Options offered:
1. (recommended) Own web app: kanban board เคาน์เตอร์ → จัดของ → ส่งของ → เสร็จ, cards move with required evidence (photo/rider), opens from LINE, same Google Sheet via Apps Script (add doGet list + doPost step/photo upload to Drive). Build as demo on sandbox data first; teammate owns real DIFOT → agree before switching.
2. Glide on the same Sheet. 3. Lark Base kanban (data moves out).
If staying on AppSheet: build the confirm step (Status enum + initial "New", Today_Orders filter `[Status]="New"`, action ส่งไปจัดของ with confirm, Code.gs Status 'New' + redeploy same deployment).

## Weekly price update (any session)
If Petch attaches a new price sheet (PDF/image) and says "อัปราคา": follow README.md → "Update prices" + EXTRACTOR_CONTRACT.md: extract to JSON matching schema/prices.schema.json → `node scripts/publish-prices.mjs incoming.json` (dry-run first, show every WARN to Petch) → Petch pushes in GitHub Desktop. Never hand-edit data/prices/*.json. 2026-10-23 evening: no new sheet this week → Petch approved carrying the 17–23 Oct prices over to 24–30 Oct. Published via publish-prices (data/prices/2026-10-24.json, extracted_by "manual", source_file says carry-over; all 65 prices identical; validate 0 errors). NOT pushed yet. Next publish due Fri 30/10 (prices valid_to 2026-10-30 → ordering pauses from Sat 31/10 otherwise).

## Things to remember
- Never write to original DIFOT_Pilot_SU22 (id 1UEI…xvx8). Sandbox only.
- Ordering pauses after prices' `valid_to` — publish new prices every Friday.
- Test order rows still in sandbox: W261023-002, W261023-003 (Petch's), CUS-W002/003.
