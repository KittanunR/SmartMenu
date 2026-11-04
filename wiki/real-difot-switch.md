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

## 2026-11-04 — Petch: connect now; web orders = Accepted; bring the member shops over
- Read (no changes) the real app's definition (AppSheet editor API, app DIFOT_Pilot_SU22-93916087, owner btgs.sukhumvit):
  - Order.Status Valid_If = New, Accepted, Rejected, Packed, Out, Delivered, Issue; initial = IF([Source]="LINE OA","New","Accepted").
  - Source Valid_If = "สร้างเอง","LINE OA" · Channel = "โทร","ข้อความ" (required) · Created_By Ref Staff (required) · Req_Date (required) ·
    Req_Slot Time list 06:00…17:00 (required) · Delivery_Mode = มารับเอง / ไรเดอร์ร้าน / Outsource (required) · Promise_P = Req_Date + Req_Slot.
  - Flow: Accepted → slice To_Pick (จัดของ) → each Order_Line ครบ/ขาด → Pack Done (Lines_Pending = 0) → Packed → Rider Pickup → Out → Deliver form (Delivered_By + photo) → Delivered. Customer Issue → Issue. Forms show only Picked_By / Delivered_By + Delivery_Photo, so web orders without staff don't block staff.
  - **Order_Line** (their lines table): Line_ID, Order_ID, SKU_Code (Ref Master, Valid_If Type SKU + Active), Unit (= [SKU_Code].[Unit]), Qty_Ordered, Qty_Picked, Line_Status (ครบ/ขาด), Reason_Code, Unit_Price.
  - Real sheet sits in **My Drive root**; app photos in My Drive/Order_Images → images resolve next to the sheet (our Master_Images / Exception_Images will be there too).
- Built + tested (106 tests): web order → Source "SmartMenu", Channel "เว็บ", Status **Accepted** + T_Accept, Req_Date (site's day, else today), Req_Slot = Master SET-SLOT-END (else 17:00), Delivery_Mode ไรเดอร์ร้าน, Note = address | note | ติดต่อ | โทร | LINE; lines also into **Order_Line**; our SKUs added to Master (Type SKU, Active Yes, Thai unit) on first order. History reads Req_Date. Status texts Accepted / Rejected on History (6 languages). Migrate.gs: backupRealSheet(), migrateMembers() (member shops CUS-W008 Hotpotman, W009 Kati doggy, W010 Ruksa Baby + Member_Auth + live Sessions + logos; re-run safe). Fixed on the way: shop codes now written as text (a code like 2E45678923 would have become a number).
- DONE 17:48: Apps Script project saved with the new Code / AdminServer / Member + new **Migrate.gs** (sha256 = repo). Deployments NOT changed yet (live = v14, still the sandbox). **backupRealSheet() ran → backup "DIFOT_Pilot_SU22 (backup before SmartMenu 2026-11-04 17:48)" id 14xJ3oDwiTfS7gQDqG4fpe9kWpr97WHCQ8oTMEdAQMmY in My Drive.**
- STOPPED: running setup() on the real sheet was blocked by the safety check (changes a live app other people use). Remaining, in order (same hour):
  1. Apps Script → Code.gs → setup() → Run.  2. Migrate.gs → migrateMembers() → Run (log shows {shops, logins, sessions, logos}).
  3. AppSheet BiTFODG Pilot → Data → Regenerate schema on **Order, Master, Exception** (app won't open until done) → Master.Logo_Image = Image; Exception Photo/Photo_2/Photo_3 = Image, Web_Item = Text; system cols (Web_*, Auth, Shop_Code, Shop_Link, Logo_File_ID, Member_Status, Complaint_ID, Source on Exception) Editable off; Order.Source Valid_If add "SmartMenu", Order.Channel Valid_If add "เว็บ". Do NOT add Order_Items / Member_Auth / Sessions / Admin_Log tabs to AppSheet. Save.
  4. Deploy → Manage deployments → order deployment (AKfycbyCWF…) → New version "v15 real DIFOT"; Admin deployment → New version too (else the admin page keeps editing the sandbox).
  5. GitHub Desktop push (History texts ?v=2026-11-04a).  6. Test order from the site → shows in จัดของ with its lines.
  Undo: deployments back to v14 (sandbox); the backup copy has the real sheet as it was.

## 2026-11-04 18:15 — SWITCHED to the real DIFOT app (LIVE)
- Petch ran setup() (17:53) and migrateMembers() (17:54) himself, and regenerated Order / Master / Exception in BiTFODG Pilot (saved 18:05).
  Checked in the sheet: 3 member shops CUS-W008 Hotpotman / W009 Kati doggy / W010 Ruksa Baby (Phone with leading 0, Shop_Code text, Member_Status active, logos copied to My Drive/Master_Images with new file ids), 3 Member_Auth rows, 5 live Sessions; new tabs Order_Items, Member_Auth, Sessions, Admin_Log (not in AppSheet).
- Claude finished AppSheet (saved, app valid, version 1.000102): Master Phone / Shop_Link / Logo_Image Required OFF (AppSheet had guessed Required — would have blocked editing every SKU / old customer row); Shop_Code, Shop_Link, Logo_File_ID, Member_Status, Logo_Image Editable off. Exception: Photo×3 = Image, Web_Item Url→Text, Source / Complaint_ID / Web_Item Editable off. Order: Web_Client_ID Url→Text, Web_Shop_Name / Web_Phone / Web_Total / Web_Client_ID / Auth Editable off; Source Valid_If = LIST("สร้างเอง","LINE OA","SmartMenu"), Channel = LIST("โทร","ข้อความ","เว็บ"). (Order.Source shows read-only in the app definition — not changed by Claude.)
- Deployments: order (AKfycbyCWF…) = **Version 15 "v15 real DIFOT (BiTFODG Pilot)"**; Admin (AKfycbwx_…) = **Version 15** "SmartMenu Admin v15 real DIFOT". Live check: shop lookup N8KU2TGQQZ → Hotpotman, M6C4H7F5UJ → Ruksa Baby (from the real sheet); sandbox-only test shop MPGVB9KMFS → unknown_shop.
- Not moved: guest/test customers and all sandbox orders (so members' History starts empty). Sandbox sheet + app left as they were.
- To do: Petch pushes the site (History texts Accepted/Rejected, ?v=2026-11-04a); first real test order from a phone → check จัดของ shows it with its lines, Master gets the PK-/CK-/EG- SKU rows.
- Undo: both deployments back to Version 14 (sandbox); backup copy of the real sheet: id 14xJ3oDwiTfS7gQDqG4fpe9kWpr97WHCQ8oTMEdAQMmY.
