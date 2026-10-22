# Hosting
- 2026-10-22: Petch chose GitHub Pages, code in repo SukhumvitShop (local path C:\Users\petch\Documents\GitHub\SukhumvitShop). Wiki lives at SukhumvitShop/wiki/.
- 2026-10-22: Repo not visible to Claude's GitHub access (list_repos query "sukhumvit" empty) — needs pushing or owner name.
- 2026-10-22 (superseded the repo line above): Petch created a new repo **KittanunR/SmartMenu** (private), local clone `C:\Users\petch\Documents\Smart menu\SmartMenu`. Code + wiki go there. Claude's GitHub credential has no access → delivery = copy files into the local clone; Petch commits/pushes with GitHub Desktop.
- 2026-10-22: GitHub Pages on a private repo needs a paid plan → asked Petch: make repo public or upgrade.
- 2026-10-22: Repo made public; GitHub Pages enabled from `main` / root. Live at https://kittanunr.github.io/SmartMenu/ — `data/prices/latest.json` served correctly (checked 2026-10-22 19:2x). QR: docs/qr/smartmenu-qr.png.
- 2026-10-22: Source of truth from now on = local clone `Documents\Smart menu\SmartMenu` (pushed `4a60a14`). Cloud copy /home/claude/price-menu is a scratch copy.
- 2026-10-23: Petch's refresh after push still showed the old site. Cause: GitHub Pages serves files with `Cache-Control: max-age=600` (browser may reuse app.js/styles.css up to 10 min) + deploy takes ~1–2 min after push. Data files are fetched with `cache:'no-cache'` so prices/config are always fresh. Fix: index.html loads `app.js?v=YYYY-MM-DD` / `styles.css?v=…` — bump the date on every code change.
