# SmartMenu — capacity, single points of failure, login ideas (2026-10-23 01:30)
Scope: SmartMenu website only (not AppSheet/DIFOT) — Petch, 2026-10-23.

## Capacity
- Menu browsing: static files on GitHub Pages CDN → hundreds+ of simultaneous viewers fine (soft limit ~100 GB/month bandwidth).
- Ordering: Apps Script doPost takes a script lock → orders written one at a time, ~2–4 s each (8–10 s cold start). waitLock(20000): >~5–8 orders inside 20 s → later ones time out. Fine for a few orders/hour.

## Single points of failure (SmartMenu only)
1. Google account btgs.sukhumvit — the web app runs as it; revoked auth / suspended → ordering stops (menu still loads).
2. Sandbox sheet tab/column names — code writes by header name; renaming Order/Order_Items/Master/Event or their columns breaks orders.
3. Weekly price publish — ordering pauses after latest.json valid_to.
4. Broken push (latest.json / app.js / config.json) → site breaks; CI validate warns but does not block Pages deploy.
5. Public order endpoint — honeypot only, no rate limit → spam orders possible. **2026-10-23: rate limits (5/h per phone, 40/h site), size + total checks added in Code.gs (not deployed yet).** A determined attacker can still rotate phone numbers; the 40/h cap limits the damage.
6. Knowledge sits with Petch (+ wiki).
- 2026-10-23: endpoint failure handled — site retries 3× with the same client_order_id (server de-duplicates), keeps the cart, offers LINE. Lock timeout now returns `busy` instead of an error page.

## Login ideas (customers stop re-typing address; per-group customization)
- A. Remember details on the device (localStorage) — quick win.
- B. LINE Login / LIFF (recommended next): open menu from LINE OA, LINE userId ↔ Master customer row; enables saved address, customer groups (bar/restaurant/school) with own prices/recommended items, "order same as last time", later LINE push status. Free; verify ID token in Apps Script.
- C. Phone + SMS OTP — costs per SMS.
- Storing address/phone → add PDPA consent notice.

## Idea: private shop code (Petch, 2026-10-23 01:34 — just an idea)
- Each shop gets its own code; at checkout enter the code → order links to that shop (saved name/address/phone/group).
- Claude's view: sound for B2B (several staff of one shop can share it; no LINE account needed). Design notes: random 6–8 chars (not sequential/guessable), enter once then remembered on the device, or give each shop a personal QR/link that fills the code; never show the full address/phone back (mask), rate-limit wrong codes, can reset a leaked code; LINE Login can later link to the same shop record.
- 2026-10-23 01:35 Petch: likes the code idea but customers may not be tech-savvy. Claude suggested hiding the code: each shop gets its own QR (sticker/card left by the salesperson, or sent in LINE) → scan once and the menu opens already linked + remembered; fallback = phone number (address shown masked; shop confirms by call anyway); typed code only as last resort.
