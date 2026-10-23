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

Response JSON: `{"ok":true,"order_id":"W261022-001"}` or `{"ok":false,"error":"<code>"}`.
Error codes: `busy` (lock not free in 20 s) and `server` → the site retries. `rate` (≥5 orders/hour from one phone, or ≥40/hour from the whole site), `spam`, `too_big`, `bad_json`, and validation codes (`phone`, `items`, `total`, …) are final → the site shows the LINE fallback.

Site behaviour: up to 3 attempts (pauses 2 s, 5 s; 30 s timeout each; 75 s in all). If none succeeds the cart stays, and the done view offers "Send order to LINE" + "Try again"; after tapping LINE it also offers "Sent on LINE? Clear the cart".

Writes (sandbox sheet only): Order +1 row (Source="Web", Order_ID "W"+yymmdd+"-"+nnn, Slip_Photo empty, Web_Client_ID), Order_Items +N rows (one write), Event +1 row (Station="Web", Action="Ordered"), Master +1 row (Type="Customer") if the phone is new.
