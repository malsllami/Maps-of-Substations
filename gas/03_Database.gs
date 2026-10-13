/**
 * ===================================================
 * 03_Database.gs — الوصول للشيت فقط (بلا منطق أعمال)
 * ===================================================
 * فتح الجداول، إعادة المحاولة عند أعطال جوجل العابرة، البحث داخل عمود بـTextFinder،
 * قراءة جدول صغير كاملًا، وتعقيم النص قبل كتابته (منع حقن الصيغ).
 *
 * Sheet access only (no business logic): opening tables, retrying on transient Google failures,
 * searching a column with TextFinder, reading a small table whole, and sanitizing text before
 * writing it (formula-injection guard).
 * ===================================================
 */

/* جدول بالاسم (أسماؤه في 00_Config) — A table by name (names in 00_Config) */
function sheet_(name) {
  return withSheetRetry_(function () { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); });
}

/* إعادة المحاولة 3 مرات عند أعطال خدمة الجداول العابرة فقط — Retry 3 times on transient Spreadsheet-service failures only */
function withSheetRetry_(fn, attempts) {
  const max = attempts || 3;
  let lastErr;
  for (let i = 1; i <= max; i++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err && err.message || err);
      const transient = /جداول البيانات|Spreadsheets|timed out|Service invoked too many times|Exception: Service/i.test(msg);
      if (!transient || i === max) throw err;
      Utilities.sleep(300 * i);
    }
  }
  throw lastErr;
}

/* كل صفوف جدول صغير (بالعناوين) — All rows of a small table (with headers) */
function readAllRows_(name) {
  const sheet = sheet_(name);
  if (!sheet || sheet.getLastRow() < 1) return [];
  return withSheetRetry_(function () { return sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues(); });
}

/* أرقام الصفوف التي تطابق نصها تمامًا في عمود (حساس لحالة الأحرف عند الطلب) — Row numbers whose cell exactly matches a text in a column */
function findRowsByText_(sheet, colIndex, text, matchCase) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || text === '' || text == null) return [];
  const finder = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).createTextFinder(String(text)).matchEntireCell(true).matchCase(!!matchCase);
  const rows = [];
  let cell;
  while ((cell = finder.findNext()) !== null) rows.push(cell.getRow());
  return rows;
}

/* صف واحد كاملًا — One whole row */
function readRow_(sheet, row) {
  return sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
}

/* نص يبدأ بـ = + - @ يُكتب نصًا لا صيغة — Text starting with = + - @ is written as text, not a formula */
function sanitizeSheetText_(value) {
  const s = String(value == null ? '' : value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/* وقت الرياض بصيغة الشيت — Riyadh time in the sheet's format */
function nowStamp_() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

/* إضافة صف بتنسيق الصفوف الجديدة — Append one row with the new-row format */
function appendFormattedRow_(sheet, values, alreadyLocked) {
  appendFormattedRows_(sheet, [values], alreadyLocked);
}

/* إضافة صفوف بتنسيق الصفوف الجديدة (NEW_ROW_FORMAT). كل صف بـappendRow (ذرّي، لا يكتب فوق صف أضافه طلب آخر)،
 * والقفل يضمن أن التنسيق يقع على هذه الصفوف نفسها؛ وإن تعذّر القفل تُضاف بلا تنسيق — البيانات لا تضيع أبدًا بسبب التنسيق.
 * قفل يملكه هذا التنفيذ مسبقًا (كتابة محطة، تهيئة المخطط، سجل أخطاء المتصفح) يُستخدم كما هو ولا يُحرَّر هنا.
 * Append rows with the new-row format. Each row via appendRow (atomic, never overwrites a row another request added),
 * and the lock makes the format land on these very rows; without the lock they are added unformatted — data is never
 * lost to formatting. A lock this execution already holds is used as is and never released here. */
function appendFormattedRows_(sheet, rows, alreadyLocked) {
  if (!rows.length) return;
  const lock = LockService.getScriptLock();
  const held = !!alreadyLocked || lock.hasLock();
  const locked = held || lock.tryLock(5000);
  try {
    rows.forEach(function (values) { withSheetRetry_(function () { sheet.appendRow(values); }); });
    if (locked) formatRows_(sheet, sheet.getLastRow() - rows.length + 1, rows.length, rows[0].length);
  } finally {
    if (locked && !held) lock.releaseLock();
  }
}

/* كتابة أعمدة محددة من صف واحد فقط (الأعمدة المتجاورة دفعة واحدة) — لا تمس أي خلية أخرى.
 * fields: { رقم العمود (من 0): القيمة }
 * Write only the given columns of one row (adjacent columns in one call) — no other cell is touched. */
function writeRowFields_(sheet, row, fields) {
  const cols = Object.keys(fields).map(Number).sort(function (x, y) { return x - y; });
  let start = 0;
  for (let i = 1; i <= cols.length; i++) {
    if (i === cols.length || cols[i] !== cols[i - 1] + 1) {
      const run = cols.slice(start, i);
      withSheetRetry_(function () { sheet.getRange(row, run[0] + 1, 1, run.length).setValues([run.map(function (c) { return fields[c]; })]); });
      start = i;
    }
  }
}

/* تطبيق تنسيق الصفوف الجديدة على صفوف متتالية — فشله لا يُفشل الحفظ
 * Apply the new-row format to consecutive rows — its failure never fails the save */
function formatRows_(sheet, firstRow, count, width) {
  try {
    const range = sheet.getRange(firstRow, 1, count, width)
      .setHorizontalAlignment(NEW_ROW_FORMAT.ALIGN).setVerticalAlignment('middle')
      .setFontSize(NEW_ROW_FORMAT.FONT_SIZE).setFontWeight(NEW_ROW_FORMAT.BOLD ? 'bold' : 'normal')
      .setBorder(true, true, true, true, true, true);
    if (NEW_ROW_FORMAT.WRAP) range.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  } catch (err) {
    console.error('formatRows_: ' + err);
  }
}
