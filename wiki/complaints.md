# Complaints from the website (แจ้งปัญหาสินค้า)
- 2026-11-03: Petch asked for customers to complain from SmartMenu, **photo required**; his teammate (owner of the real DIFOT app "BiTFODG Pilot") approved connecting SmartMenu to it.

## Decisions (2026-11-03, Claude; Petch asked for photo = required)
- **Logged-in shops only**, from History ("แจ้งปัญหาสินค้า" under a delivered order). Guests and shop-QR users can't: anyone could complain about another shop's order. They keep using LINE.
- Only orders that are the shop's own History orders (Auth member / shop_qr), Status **Delivered** (or already Issue), up to **7 days** after T5_Delivered (Order_Date if T5 is empty). Max **3 complaints per order**, **10 per shop per day**.
- Form: reason (required) · products (optional; none = the whole order, e.g. late) · 1–3 photos (required) · note (required only for "อื่นๆ", ≤ 400 chars).
- Reasons = DIFOT's own Master rows Type `Reason_Delivery` (RD-01 ของขาด, RD-02 ได้ของผิด, RD-03 ของเสียหาย, RD-04 ไม่เย็น, RD-05 ส่งช้า, RD-06 อื่นๆ). The server checks the code is an active Reason_Delivery row; the site has the 6 labels in 6 languages. Same codes in the sandbox AND the real sheet (checked 2026-11-03).
- Photos are shrunk in the browser (≤ 1600 px JPEG, ≤ ~585 KB; a 4000×3000 3.2 MB test photo became 317 KB) and saved by Apps Script in `<sheet folder>/Exception_Images/<CW id>-<n>.jpg` — private, AppSheet shows them from a path relative to the sheet's folder (same trick as Master_Images logos).

## What gets written (Member.gs `complain_`)
- **Exception**: one row per product picked (one row with empty SKU_Code for the whole order): Exception_ID `XW…`, Order_ID, Shop_ID, Stage `After_Delivery`, SKU_Code = **our SKU** (PK-001…; DIFOT's Master has SKU-001… so the Ref won't resolve), Reason_Code, Other_Note = note, Logged_At, Logged_By `web:<Customer_ID>`, + new cols **Source** `Web`, **Complaint_ID** `CW…` (the number the shop sees), **Web_Item** (Thai product name, because SKU_Code won't resolve), **Photo / Photo_2 / Photo_3**.
- **Order**: Status → `Issue`, Customer_Issue → TRUE (first time doPost edits an existing order row; header comment in Code.gs updated).
- **Event**: Station Web, Action `Customer_Issue`, Photo = first photo, Note "reason, n items, n photo(s), CW…".
- Same client_id → same Complaint_ID (hash of shop + client_id), found in the sheet even if the cache is gone → a retry never writes twice.
- History answer gains `complain_until` (ISO, '' = no button) and `complaints` (count).

## Built + checked 2026-11-03 (local, NOT deployed / pushed)
- Files: backend Code.gs (Exception cols in setup(), body limit 2.7 M chars for `complain` only), Member.gs (complain_, history fields), Admin.gs (imageFolder_), history.html/js (bottom sheet), i18n.js (ja/zh/ko/hi), styles.css, tests (complaint.test.mjs 10 tests; 97 total pass), ?v=2026-11-03a.
- Deliberate breaks caught by tests: other shop's order, 7-day limit, image check, 3-per-order limit.
- Browser check (Playwright, iPhone 13 size, real backend code on a fake sheet): button + "แจ้งได้ถึง" date only on the delivered order ≤ 7 days; missing reason / photo messages; 2 photos → done screen with CW number; card turns "มีปัญหา" + "แจ้งปัญหาแล้ว 1 เรื่อง" + "แจ้งปัญหาเพิ่ม"; Japanese sheet; no console errors.
- Translations ja/zh/ko/hi are Claude's (unreviewed), like the rest of the site.

## Rollout (sandbox first) — Apps Script BEFORE the site push is not required: old backend sends no complain_until, so the button simply doesn't show
1. Apps Script project: replace **Code.gs**, **AdminServer.gs** (= repo Admin.gs), **Member.gs**. Run `setup()` → Exception gets Source, Complaint_ID, Web_Item, Photo, Photo_2, Photo_3. No new permissions (Drive is already allowed).
2. **Same day** (rule from difot-step-flow.md): AppSheet sandbox → Data → Exception → Regenerate structure → Photo/Photo_2/Photo_3 = Image; Source/Complaint_ID/Web_Item Editable off → Save.
3. Deploy → Manage deployments → order deployment (AKfycbyCWF…) → ✏️ → New version "v14 complaints" → Deploy. Admin deployment: no change needed.
4. GitHub Desktop: commit "Complaints with photos from History" + push → Actions ✓.
5. iPhone: log in as a test shop → a Delivered order (mark one delivered in the sandbox app first) → แจ้งปัญหาสินค้า → take a photo with the camera → send → check AppSheet Exception / แจ้งปัญหา view shows the photo.

## 2026-11-03 19:50 — steps 1–3 DONE by Claude in the built-in browser (Petch asked; he pushes GitHub himself)
- Apps Script: live files were exactly the last commit (sha256), so only the changes were applied in the editor; Code.gs / AdminServer.gs / Member.gs now sha256-match the repo (checked again after a reload). Admin.html and Bcrypt.gs unchanged.
- `setup()` ran (Execution completed) → sandbox Exception has the 6 new columns.
- Order deployment (AKfycbyCWF…) = **Version 14 "v14 complaints with photos"**, same /exec. Live check: complain / history with a fake token → `session`; a 40 K-char order → `too_big`. Admin deployment unchanged (v13).
- AppSheet sandbox: Exception regenerated (16 cols incl. _RowNumber); Photo/Photo_2/Photo_3 = Image (AppSheet's guess); Web_Item guessed Url → set to Text; Source / Complaint_ID / Web_Item Editable off; nothing Required. Saved, no issues.
- Left: step 4 (Petch pushes in GitHub Desktop, site ?v=2026-11-03a) and step 5 (iPhone test on a Delivered order).
