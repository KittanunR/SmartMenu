# Switching SmartMenu from the sandbox to the real DIFOT app ("BiTFODG Pilot")
- 2026-11-03: Petch's teammate approved connecting SmartMenu to the real app (sheet DIFOT_Pilot_SU22, id 1UEI…xvx8).
- 2026-11-03 READ-ONLY look at the real sheet (Claude, gviz CSV in the browser as btgs.sukhumvit = authuser 1; nothing written). **The teammate rebuilt the app since the sandbox copy (2026-10-22)**:
  - **Order** (25 cols): Order_ID, Shop_ID, **Source** (values in Thai, e.g. "สร้างเอง"), **Channel** ("โทร"), **Created_By** (Staff ST-xx), Order_Date, T1_Ordered, **T2_Saved**, Customer_ID, **Req_Date**, **Req_Slot**, Promise_P, **Delivery_Mode** ("ไรเดอร์ร้าน"), **Note**, **T_Accept, Accepted_By, Reject_Reason**, T3_Packed, **Picked_By**, T4_Pickup, T5_Delivered, **Delivered_By**, Delivery_Photo, Customer_Issue, Status. Gone: Slip_Photo, T2_Slip_Saved, Pick_Result, Bag_Photo, Rider_Type. 2 real orders (261027-001 Issue, 261102-001 Packed).
  - **Master** (+ Unit, Price): SKU-001…008, Reason_Pick RP-01…06, **Reason_Delivery RD-01…06 (same as sandbox)**, Setting (slots 06:00–17:00, open 05:30–19:00, tolerances), **Staff ST-01…03**, **Reason_Reject RR-01…05**, 2 customers (CUS-001/002).
  - **Event** and **Exception**: same columns as the sandbox (both empty).
- So: **complaints fit as they are**. **Orders do NOT**: Code.gs writes Web_Delivery_Date / Web_Note / Status "Received" / Source "Web", the real app reads Req_Date / Note, starts with an accept step (T_Accept / Reject_Reason), and Source is a Thai-valued column (probably an Enum).

## Needed from the teammate before the switch
1. Status list and the **first status of a new order** (Received? New? — the app now has an accept/reject step).
2. Values to use for a web order in **Source** and **Channel** (and are they Enum columns that need a new value added?).
3. Leave Created_By empty for web orders? (Ref → Staff)
4. Web delivery date → **Req_Date**; slot: leave Req_Slot empty or add a slot picker to the site (Setting SET-SLOT-START/END exists)?
5. Is DIFOT_Pilot_SU22 inside the AppSheet app's own data folder? (logos / complaint photos are paths relative to the sheet's folder)
6. A quiet time to run setup() and regenerate Order / Master / Exception (+ add Order_Items) in the real app the same hour — the app refuses to open in between.

## Then (Claude's plan)
- Code.gs: write the real columns (Req_Date, Note, Source/Channel values, first Status), keep Web_* for what has no real column (shop name/phone for guests, total, client id, Auth). Tests against the real header set. History/status texts for the new statuses (e.g. Accepted / Rejected).
- SHEET_ID → real id; setup(); AppSheet regenerate; Order_Items table added (ref → Order); Member_Auth / Sessions / Admin_Log never added to AppSheet.
- Start member accounts fresh in the real sheet (only test shops exist in the sandbox); re-issue shop QR / logins for pilot shops.
- Rollback = SHEET_ID back to the sandbox + new deployment version.
