# Order contract (website → Apps Script → DIFOT sandbox) — v1, 2026-10-22

The site POSTs one order to `config.json` → `order_endpoint` (a Google Apps Script web app URL).
Request: `fetch(url, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(order)})`
(text/plain avoids a CORS preflight, which Apps Script cannot answer).

```json
{
  "contract": "order.v1",
  "shop_id": "SU22",
  "price_week": "2026-10-17",
  "customer": { "shop_name": "Café X", "contact_name": "Ken", "phone": "0812345678", "line_name": "ken_cafe" },
  "delivery": { "date": "2026-10-24", "address_note": "Soi 22, opposite 7-11" },
  "note": "free text, optional",
  "items": [
    { "sku": "PK-001", "name_th": "มันแข็งหมู", "name_en": "Pork back fat", "qty": 3, "qty_unit": "kg", "unit_price": 80, "line_total": 240 }
  ],
  "total": 240,
  "lang": "th",
  "client_ts": "2026-10-22T20:40:00+07:00",
  "hp": "",
  "client_order_id": "bef3e830-0628-4e33-bb42-24dde8719198"
}
```
Rules: phone = 9–10 digits starting 0; 1–40 items; qty > 0 and ≤ 500; unit_price = the tier price for that qty from latest.json; line_total = qty × unit_price and total = sum of line_total (±0.01); `hp` is a honeypot and must be empty; body ≤ 30,000 chars.

`client_order_id` (optional, added 2026-10-23): 8–64 chars `[A-Za-z0-9-]`, made once per distinct order in the buyer's browser (`localStorage` `menu-pending`) and sent unchanged on every retry. The server answers a repeated id with the first order's id (`"duplicate":true`) and writes nothing. Changing the cart or the form makes a new id.

`shop_code` (optional, added 2026-10-23): 10 chars `[A-HJKMNP-Z2-9]`, from the shop's own QR link `?shop=CODE`. When present, the server looks the shop up in Master (Type=Customer, Active, Shop_Code) and takes shop name, phone, contact and LINE name from there — the browser sends `customer.phone` empty. An empty `delivery.address_note` means "use the saved Address". Unknown or retired code → `unknown_shop` (final).

Shop lookup (same endpoint, same text/plain POST): `{"contract":"order.v1","action":"shop","shop_code":"ABCDEFGH23"}` →
`{"ok":true,"shop":{"name":"Café X","phone_masked":"xxx-xxx-5678","address_masked":"ซอยสุขุมวิท…"}}` or `{"ok":false,"error":"unknown_shop"|"rate"}` (≥60 wrong codes/hour site-wide pauses lookups). The full phone and address never leave the server.

`session` (optional, added 2026-10-24, Phase 3): the shop's login token, 64 hex chars, from member.html (kept in the browser as localStorage `menu-member`). When present the server checks it (Sessions.Token_Hash = SHA-256 of the token, not revoked, not past Expires_At, account still active) and takes the shop from Master exactly like `shop_code`; a login wins over a `shop_code` in the same order. Dead or malformed token → `session` (final: the site forgets the login and the form asks for the shop's details again). Auth = "member".

Shop login (same endpoint, same text/plain POST; Member.gs):
- `{"action":"login","phone":"0812345678","password":"…"}` → `{"ok":true,"token":"<64 hex>","shop":{…}}`, or with a temporary password `{"ok":true,"must_change":true,"change_token":"<64 hex>"}` (15 min, once). Errors: `bad_login` (wrong phone or password, closed account — always the same), `locked` (5 wrong tries on that phone → 15 min), `rate` (≥100 failed logins/hour site-wide), `temp_expired` (right temp password, past 7 days).
- `{"action":"set_password","change_token":"…","new_password":"…"}` → same as a login with `token`. Errors: `change_expired`, `password_short` (<8), `password_long` (>72 bytes), `password_phone`, `password_common`, `password_same`.
- `{"action":"me","token":"…","logo_id":"<id the phone has>"}` → `{"ok":true,"shop":{"name","phone_masked","address_masked","logo_id"[,"logo_data_url"]}}` (the logo only when the phone does not have this one) or `{"ok":false,"error":"session"}`.
- `{"action":"logout","token":"…"}` → `{"ok":true}` always.

Response JSON: `{"ok":true,"order_id":"W261022-001"}` or `{"ok":false,"error":"<code>"}`.
Error codes: `busy` (lock not free in 20 s) and `server` → the site retries. `rate` (≥5 orders/hour from one phone, or ≥40/hour from the whole site), `spam`, `too_big`, `bad_json`, and validation codes (`phone`, `items`, `total`, …) are final → the site shows the LINE fallback.

Site behaviour: up to 3 attempts (pauses 2 s, 5 s; 30 s timeout each; 75 s in all). If none succeeds the cart stays, and the done view offers "Send order to LINE" + "Try again"; after tapping LINE it also offers "Sent on LINE? Clear the cart".

Writes (sandbox sheet only): Order +1 row (Source="Web", Order_ID "W"+yymmdd+"-"+nnn, Slip_Photo empty, Web_Client_ID, Auth = "guest" or "shop_qr"; "member" from Phase 3), Order_Items +N rows (one write; Category = pork / chicken / egg / fish from the SKU prefix, else "other"), Event +1 row (Station="Web", Action="Ordered", Note ends ", shop QR" for QR orders), Master +1 row (Type="Customer", with Address / Contact_Name / LINE_Name) if the phone is new and no shop_code was sent.
`makeShopCodes()` (run by hand) is the only thing that edits existing rows: it fills empty Master.Shop_Code / Shop_Link for active customers.
