# Usage statistics (track.js + Analytics.gs) — 2026-11-12

Goal (Petch): how many people visit (distinct), which pages / categories / products / prices they look at, and how far
they get toward an order. Kept in a Google Sheet that ONLY Petch's own Google account can open. PDPA: opt-in banner,
privacy.html, withdraw = delete, 13-month retention.

## How it works
- `track.js` (site): banner with equal "ยอมรับ / ไม่ยอมรับ" buttons, six languages. Nothing is sent and no id is stored
  before "ยอมรับ". After it: random visitor id (localStorage `sm-vid`) + session id (new after 30 min idle), events batched
  every 5 s and on leaving the page (sendBeacon). Footer button "ตั้งค่าการเก็บข้อมูล" reopens the banner.
  "ไม่ยอมรับ" after accepting → `{action:'forget'}` → that visitor's rows are deleted, ids removed from the phone.
- Events: page_view, category_view, product_open (sku, name, headline price, unit), product_close (seconds open),
  tiles_seen (products ≥1 s on screen), search (words, results), cart_add / cart_qty / cart_remove, cart_open,
  checkout_start, order_sent (lines, total), login_prompt, line_click, language, consent.
  Context: lang, member Y/N (never which shop), device (mobile-ios / mobile-android / tablet / desktop), source (direct = QR scan, line, shop_qr, …).
- NOT collected: name, phone, address, shop name/code, LINE name, IP.
- `backend/analytics/Analytics.gs`: a SEPARATE Apps Script, bound to Petch's sheet "SmartMenu Analytics". Writes only
  whitelisted events (others dropped), formula-safe, ≤50 events/request, ≤400 per visitor / 10 min, ≤20,000 / hour site-wide.
  No action reads data back. Tabs: Events, Consent, Dashboard (+2 charts), S_Daily, S_Products, S_Categories, S_Search, S_Sources.
  Triggers: buildSummary hourly, cleanup daily 03:00 (deletes rows > 395 days). Sheet menu "SmartMenu → อัปเดตสรุปตอนนี้".
- `config.json` → `analytics_endpoint`: empty = off (no banner). validate.mjs refuses a non-Apps-Script URL or the order URL.
- Tests: tests/analytics/analytics.test.mjs, tests/site/track.test.mjs. Policy version `2026-11-12` lives in track.js
  (POLICY), Analytics.gs (POLICY_VERSION) and privacy.html — change all three together; everyone is asked again.

## Setup (Petch, once) — use ONE Google account in the browser window
1. sheets.new (signed in to the account that should own the data) → name it **SmartMenu Analytics**. Do not share it.
2. Extensions → Apps Script → delete what is there → paste `backend/analytics/Analytics.gs` → Save.
3. Choose `setup` → Run → allow (tick every box). Tabs + Dashboard charts + 2 triggers appear.
4. Deploy → New deployment → Web app: Execute as **Me**, Who has access **Anyone** → Deploy → copy the `/exec` URL.
5. Give the URL to Claude (or paste into `config.json` → `"analytics_endpoint"`), bump `?v=` in index.html, push.
6. iPhone: open the menu → banner → ยอมรับ → open 2 products → wait 10 s → sheet Events has rows → menu SmartMenu → อัปเดตสรุปตอนนี้.

## Open
- Should the data sit under btgs.sukhumvit (the shop's Google account) instead of a personal Gmail? It is Betagro customer behaviour.
- Anyone can post fake events to the public /exec (limits above cap the damage). Bots are not filtered.
