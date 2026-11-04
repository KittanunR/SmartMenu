/**
 * One-off move from the old sandbox sheet to the REAL DIFOT sheet (2026-11-04). Run by hand in the Apps Script editor:
 *   1. backupRealSheet()  BEFORE setup(): a copy of the real sheet in My Drive, so every change can be undone.
 *   2. setup()            adds SmartMenu's columns and tabs to the real sheet.
 *   3. migrateMembers()   member shops (Master.Member_Status set) with their login, live sessions and logo. Safe to re-run:
 *                         a shop already in the real Master is skipped.
 * Guest test customers and all sandbox orders stay behind (test data). Codes stay the same (CUS-W008…), so shop QR codes,
 * logins and the CUS-W numbering carry on. Needs Code.gs and Admin.gs (table_, customerRow_, logoFolder_).
 */
// Read back from Sheets these come out as numbers or lose their leading 0 unless written as text.
const MIGRATE_TEXT_COLS = { Phone: true, Login_Phone: true, Shop_Code: true, Token_Hash: true };

function backupRealSheet() {
  const file = DriveApp.getFileById(SHEET_ID);
  const name = file.getName() + ' (backup before SmartMenu ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + ')';
  const copy = file.makeCopy(name, DriveApp.getRootFolder());
  const parents = file.getParents();
  console.log('Backup id ' + copy.getId() + ' in My Drive. The real sheet is in folder: ' +
    (parents.hasNext() ? parents.next().getName() : 'My Drive'));
  return copy.getId();
}

function migrateMembers() {
  const dst = SpreadsheetApp.openById(SHEET_ID);
  if (!dst.getSheetByName('Member_Auth') || !dst.getSheetByName('Sessions')) {
    throw new Error('Run setup() first: the real sheet has no Member_Auth / Sessions tab yet.');
  }
  const src = SpreadsheetApp.openById(SANDBOX_SHEET_ID);
  const out = { shops: 0, logins: 0, sessions: 0, logos: 0, skipped: 0 };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw new Error('Busy: try again in a minute.');
  try {
    const sm = table_(src.getSheetByName('Master'));
    const dm = table_(dst.getSheetByName('Master'));
    const moved = {};
    sm.rows.forEach((row, r) => {
      if (sm.str(r, 'Type') !== 'Customer' || !sm.str(r, 'Member_Status')) return;
      const id = sm.str(r, 'Code');
      moved[id] = true;
      if (customerRow_(dm, id) !== -1) { out.skipped++; return; }
      const rec = rowObject_(sm, r);
      const logoId = sm.str(r, 'Logo_File_ID');
      if (logoId) {
        try {
          const file = DriveApp.getFileById(logoId);
          rec.Logo_File_ID = file.makeCopy(file.getName(), logoFolder_()).getId();   // next to the real sheet
          rec.Logo_Image = LOGO_SUBFOLDER + '/' + file.getName();
          out.logos++;
        } catch (err) {
          console.error(id + ' logo not copied: ' + err);
          rec.Logo_File_ID = '';
          rec.Logo_Image = '';
        }
      }
      appendByHeader_(dm.sheet, rec);
      out.shops++;
    });

    const sa = table_(src.getSheetByName('Member_Auth'));
    const da = table_(dst.getSheetByName('Member_Auth'));
    sa.rows.forEach((row, r) => {
      const id = sa.str(r, 'Customer_ID');
      if (!moved[id] || da.find('Customer_ID', id) !== -1) return;
      appendByHeader_(da.sheet, rowObject_(sa, r));
      out.logins++;
    });

    // Live sessions only, so a shop that is logged in on its phone stays logged in.
    const ss = table_(src.getSheetByName('Sessions'));
    const ds = table_(dst.getSheetByName('Sessions'));
    ss.rows.forEach((row, r) => {
      const exp = ss.get(r, 'Expires_At');
      if (!moved[ss.str(r, 'Customer_ID')] || ss.get(r, 'Revoked_At') || !isDate_(exp) || exp.getTime() <= Date.now()) return;
      if (ds.find('Token_Hash', ss.str(r, 'Token_Hash')) !== -1) return;
      appendByHeader_(ds.sheet, rowObject_(ss, r));
      out.sessions++;
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  console.log(JSON.stringify(out));
  return out;
}

/** Row r as { header: value }, ready for appendByHeader_. */
function rowObject_(t, r) {
  const o = {};
  t.head.forEach(h => {
    if (!h) return;
    const v = t.get(r, h);
    o[h] = MIGRATE_TEXT_COLS[h] && v !== '' && v != null ? "'" + String(v) : v;
  });
  return o;
}
