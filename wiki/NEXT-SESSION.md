# Next session — pick up here (written 2026-10-23 01:38)

Say: "อ่าน SmartMenu/wiki/NEXT-SESSION.md แล้วทำต่อ". Open in Claude Code inside `Documents\Smart menu\SmartMenu` if building the DIFOT board (option 1 below).

## Done (2026-10-22/23)
- Live site https://kittanunr.github.io/SmartMenu/ has cart + checkout; orders POST to Apps Script v2 (`config.json` order_endpoint) → sandbox sheet "Event" (id 1e8x…ISAg): Order / Order_Items / Event / Master. E2E tested. See ordering.md.
- AppSheet sandbox "SmartMenu Sandbox DIFOT": step buttons → evidence forms (Form_Pack / Form_Rider / Form_Deliver). See difot-step-flow.md.
- index.html loads app.js/styles.css with `?v=YYYY-MM-DD` — bump on every code change (GitHub Pages caches 10 min).

## In progress (2026-10-23 day)
- Sturdier ordering DONE locally (retry + same client_order_id, cart kept, LINE fallback, rate limits). See ordering.md 2026-10-23 (day). **Deploy order matters: Apps Script first (paste Code.gs → run setup() → new version of the same deployment), then push the site** — otherwise the new site's retries could hit the old server, which has no duplicate guard.
- This PC has no Node.js/Python: local preview uses `.claude/launch.json` "smartmenu-local" (PowerShell static server from the session scratchpad; recreate if gone). `npm run validate` can't run locally → CI on push checks it.

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
If Petch attaches a new price sheet (PDF/image) and says "อัปราคา": follow README.md → "Update prices" + EXTRACTOR_CONTRACT.md: extract to JSON matching schema/prices.schema.json → `node scripts/publish-prices.mjs incoming.json` (dry-run first, show every WARN to Petch) → Petch pushes in GitHub Desktop. Never hand-edit data/prices/*.json. Current prices valid_to 2026-10-23 → ordering pauses from Sat 24/10 until the new week is published.

## Things to remember
- Never write to original DIFOT_Pilot_SU22 (id 1UEI…xvx8). Sandbox only.
- Ordering pauses after prices' `valid_to` — publish new prices every Friday.
- Test order rows still in sandbox: W261023-002, W261023-003 (Petch's), CUS-W002/003.
