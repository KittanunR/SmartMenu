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
  "hp": ""
}
```
Rules: phone = 9–10 digits starting 0; 1–40 items; qty > 0 and ≤ 500; unit_price = the tier price for that qty from latest.json; `hp` is a honeypot and must be empty.

Response JSON: `{"ok":true,"order_id":"W261022-001"}` or `{"ok":false,"error":"<code>"}`.

Writes (sandbox sheet only): Order +1 row (Source="Web", Order_ID "W"+yymmdd+"-"+nnn, Slip_Photo empty), Order_Items +N rows, Event +1 row (Station="Web", Action="Ordered"), Master +1 row (Type="Customer") if the phone is new.
