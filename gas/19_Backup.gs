/**
 * ===================================================
 * 19_Backup.gs — النسخ الاحتياطي للبيانات واستعادتها (8 نوفمبر 2026)
 * ===================================================
 * - نسخة كاملة من ملف الشيت في مجلد Drive «نسخ احتياطية — خرائط المحطات»: قبل كل إطلاق (يدويًا من قائمة الشيت)، وكل ليلة
 *   (مشغّل زمني). اسم النسخة يحمل نوعها وتاريخها ورقم نسخة الخادم.
 * - الاحتفاظ: نسخ الإطلاق تبقى دائمًا. النسخ اليومية الأقدم من 30 يومًا تُنقل لسلة مهملات Drive (لا حذف نهائي).
 * - الاستعادة انتقائية دائمًا: جدول واحد من نسخة يُنسخ إلى ورقة جديدة «استعادة — …» في الشيت الحي مع مطابقة عدد الصفوف،
 *   ولا يُستبدل أي جدول حي ولا تُمس بياناته أبدًا — المدير يراجع وينقل ما يريد بنفسه.
 * - قائمة «النسخ الاحتياطية» في الشيت نفسه (عند فتحه): نسخة الآن، واستعادة جدول.
 *
 * Data backup and restore: a full copy of the spreadsheet in the Drive folder before every release (from the sheet menu) and
 * every night (time trigger), named with its kind, date and server version. Release copies are kept forever; daily copies
 * older than 30 days go to the Drive trash (never deleted outright). Restore is always selective: one table from a copy into a
 * new «restore — …» sheet in the live spreadsheet with a row-count check; no live table is ever replaced or touched.
 * ===================================================
 */

const BACKUP_FOLDER_NAME = 'نسخ احتياطية — خرائط المحطات';
const BACKUP_KIND = { RELEASE: 'نسخة إطلاق', DAILY: 'نسخة يومية' };
const BACKUP_DAILY_KEEP_DAYS = 30;
const BACKUP_LIST_MAX = 15; // ما يُعرض في نافذة الاستعادة / what the restore dialog lists

function backupFolder_() {
  const found = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  return found.hasNext() ? found.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

/* نسخة كاملة من ملف الشيت ← { id, name } — a full copy of the spreadsheet */
function makeBackup_(kind) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = kind + ' — ' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm') + ' — خادم ' + SERVER_BUILD;
  const copy = DriveApp.getFileById(ss.getId()).makeCopy(name, backupFolder_());
  return { id: copy.getId(), name: name };
}

/* النسخ اليومية الأقدم من 30 يومًا ← سلة مهملات Drive (نسخ الإطلاق لا تُلمس) ← عددها
 * Daily copies older than 30 days ← the Drive trash (release copies untouched) ← how many */
function trashOldDailyBackups_() {
  const limit = Date.now() - BACKUP_DAILY_KEEP_DAYS * 86400000, files = backupFolder_().getFiles();
  let n = 0;
  while (files.hasNext()) {
    const f = files.next();
    if (f.getName().indexOf(BACKUP_KIND.DAILY) === 0 && f.getDateCreated().getTime() < limit) { f.setTrashed(true); n++; }
  }
  return n;
}

/* المشغّل الليلي: نسخة يومية ثم تنظيف الأقدم — the nightly trigger: a daily copy, then clearing older ones */
function dailyBackup() {
  try {
    const b = makeBackup_(BACKUP_KIND.DAILY), trashed = trashOldDailyBackups_();
    console.log('نسخة يومية: ' + b.name + (trashed ? ' | نُقلت للسلة ' + trashed + ' نسخة أقدم من 30 يومًا' : ''));
  } catch (err) {
    logError_('dailyBackup', 'فشل النسخ الاحتياطي اليومي: ' + String(err), '');
  }
}

/* قبل كل إطلاق (من قائمة الشيت أو المحرر) — before every release (from the sheet menu or the editor) */
function نسخة_احتياطية_قبل_الإطلاق() {
  const b = makeBackup_(BACKUP_KIND.RELEASE);
  const msg = 'تمت النسخة الاحتياطية: ' + b.name + '\nفي مجلد Drive: ' + BACKUP_FOLDER_NAME;
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { /* تشغيل من المحرر بلا واجهة / run from the editor */ }
  return b;
}

/* النسخ الموجودة، الأحدث أولًا — the existing copies, newest first */
function listBackups_() {
  const out = [], files = backupFolder_().getFiles();
  while (files.hasNext()) { const f = files.next(); out.push({ id: f.getId(), name: f.getName(), at: f.getDateCreated().getTime() }); }
  return out.sort(function (a, b) { return b.at - a.at; });
}

/**
 * استعادة جدول واحد من نسخة إلى ورقة جديدة في الشيت الحي (لا يمس أي جدول حي) ← { sheetName, rows, sourceRows, match }
 * Restore one table from a copy into a new sheet in the live spreadsheet (no live table touched)
 */
function restoreTableFromBackup_(backupId, tableName) {
  const source = SpreadsheetApp.openById(backupId).getSheetByName(tableName);
  if (!source) throw new Error('الجدول «' + tableName + '» غير موجود في هذه النسخة');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const target = 'استعادة — ' + tableName + ' — ' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH-mm');
  const copied = source.copyTo(ss).setName(target);
  const rows = copied.getLastRow(), sourceRows = source.getLastRow();
  return { sheetName: target, rows: rows, sourceRows: sourceRows, match: rows === sourceRows };
}

/* من قائمة الشيت: اختيار النسخة والجدول ثم الاستعادة إلى ورقة منفصلة — from the sheet menu: choose the copy and table, then restore */
function استعادة_جدول_من_نسخة() {
  const ui = SpreadsheetApp.getUi(), list = listBackups_().slice(0, BACKUP_LIST_MAX);
  if (!list.length) { ui.alert('لا توجد نسخ احتياطية بعد في مجلد «' + BACKUP_FOLDER_NAME + '»'); return; }
  const pick = ui.prompt('استعادة جدول — اختر رقم النسخة', list.map(function (b, i) { return (i + 1) + ') ' + b.name; }).join('\n'), ui.ButtonSet.OK_CANCEL);
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  const backup = list[Number(String(pick.getResponseText()).trim()) - 1];
  if (!backup) { ui.alert('رقم غير صحيح'); return; }
  const names = Object.keys(HEADERS);
  const table = ui.prompt('اكتب اسم الجدول كما هو', names.join('\n'), ui.ButtonSet.OK_CANCEL);
  if (table.getSelectedButton() !== ui.Button.OK) return;
  try {
    const r = restoreTableFromBackup_(backup.id, String(table.getResponseText()).trim());
    ui.alert('تمت الاستعادة إلى ورقة جديدة: «' + r.sheetName + '»\nعدد الصفوف: ' + r.rows + ' من ' + r.sourceRows + (r.match ? ' ✓ مطابق' : ' ✗ غير مطابق') +
      '\n\nلم يُلمس أي جدول حي. راجع الورقة وانقل ما تحتاجه بنفسك.');
  } catch (err) {
    ui.alert('تعذّرت الاستعادة: ' + String(err && err.message || err));
  }
}

/* قائمة «النسخ الاحتياطية» عند فتح الشيت — the «backups» menu when the spreadsheet opens */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('النسخ الاحتياطية')
    .addItem('نسخة احتياطية الآن (قبل الإطلاق)', 'نسخة_احتياطية_قبل_الإطلاق')
    .addItem('استعادة جدول من نسخة', 'استعادة_جدول_من_نسخة')
    .addToUi();
}

/* تثبيت المشغّل الليلي يدويًا من المحرر (مرة واحدة)، ويحذف أي نسخة سابقة منه
 * Install the nightly trigger manually from the editor (once); removes any previous copy */
function تثبيت_مشغل_النسخ_اليومية() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyBackup').timeBased().atHour(2).everyDays(1).inTimezone(TIMEZONE).create();
  console.log('ثُبّت مشغّل النسخ الاحتياطية اليومية (2 فجرًا بتوقيت الرياض) في مجلد: ' + backupFolder_().getName());
}
