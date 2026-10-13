/**
 * ===================================================
 * 00_فحص_الشيت.gs — المرحلة 2 من V2: فحص الشيت الجديد (قراءة فقط)
 * ===================================================
 * مسؤوليته الوحيدة: التأكد قبل بناء الخادم أن الشيت الجديد جاهز —
 * الجداول الخمسة منسوخة كاملة، والسجلات الأربعة فارغة.
 * لا يكتب ولا يعدّل ولا يحذف أي شيء. يُشغَّل يدويًا من المحرر: اختر «فحص_الشيت_الجديد» ثم «تشغيل»،
 * والنتيجة في «سجل التنفيذ».
 *
 * Its only responsibility: before building the server, confirm the new sheet is ready — the five
 * tables fully copied and the four logs empty.
 * Writes, changes and deletes nothing. Run manually from the editor; the result is in the execution log.
 * ===================================================
 */

// معرّف الشيت الجديد المعتمد لـ V2 — the approved V2 sheet id
const V2_SHEET_ID_FOR_CHECK = '1Ko9_omiJ7fyyT9pdvq22KDhQ9uuRWY7FJWMv6dVmJHM';

// الجداول المتوقعة: الخمسة بالبيانات، والأربعة فارغة — the expected tables: five with data, four empty
const V2_DATA_SHEETS_FOR_CHECK = ['الأعضاء', 'بصمات الأجهزة', 'الإعدادات', 'احداثيات محطات التوزيع', 'محطات التحويل'];
const V2_LOG_SHEETS_FOR_CHECK = ['سجل الأخطاء', 'سجل الزوار', 'سجل التعديلات', 'عمليات الحفظ'];

/* فحص الشيت الجديد — يطبع لكل جدول: موجود؟ عدد صفوف البيانات، عدد الأعمدة، والعناوين
 * Checks the new sheet — prints for each table: exists? data rows, columns and headers */
function فحص_الشيت_الجديد() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(V2_SHEET_ID_FOR_CHECK);
  const lines = [];
  let problems = 0;

  lines.push('الشيت: ' + ss.getName() + ' | المعرّف: ' + ss.getId());
  if (ss.getId() !== V2_SHEET_ID_FOR_CHECK) {
    lines.push('⚠️ السكربت مرتبط بشيت غير الشيت المعتمد لـ V2');
    problems++;
  }

  // يقرأ عنوان الجدول وعدد صفوفه فقط — reads the table's header and row count only
  const describe = function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return null;
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    return { dataRows: Math.max(0, lastRow - 1), cols: lastCol, headers: headers };
  };

  lines.push('');
  lines.push('— الجداول الخمسة (يجب أن تحتوي بيانات) —');
  V2_DATA_SHEETS_FOR_CHECK.forEach(function (name) {
    const d = describe(name);
    if (!d) { lines.push('❌ ' + name + ': غير موجود'); problems++; return; }
    const ok = d.dataRows > 0;
    if (!ok) problems++;
    lines.push((ok ? '✅ ' : '❌ ') + name + ': ' + d.dataRows + ' صف بيانات، ' + d.cols + ' عمود');
    lines.push('    العناوين: ' + d.headers.join(' | '));
  });

  lines.push('');
  lines.push('— السجلات الأربعة (يجب أن تكون فارغة) —');
  V2_LOG_SHEETS_FOR_CHECK.forEach(function (name) {
    const d = describe(name);
    if (!d) { lines.push('ℹ️ ' + name + ': غير موجود (سينشئه الخادم تلقائيًا)'); return; }
    const ok = d.dataRows === 0;
    if (!ok) problems++;
    lines.push((ok ? '✅ ' : '⚠️ ') + name + ': ' + d.dataRows + ' صف بيانات، ' + d.cols + ' عمود');
    lines.push('    العناوين: ' + d.headers.join(' | '));
  });

  // أي جدول آخر غير متوقع — any other unexpected table
  const known = V2_DATA_SHEETS_FOR_CHECK.concat(V2_LOG_SHEETS_FOR_CHECK);
  const extra = ss.getSheets().map(function (s) { return s.getName(); }).filter(function (n) { return known.indexOf(n) === -1; });
  lines.push('');
  lines.push(extra.length ? 'ℹ️ جداول أخرى موجودة: ' + extra.join('، ') : 'لا جداول أخرى.');

  // V2 بناء جديد بمفتاح جلسات خاص به يُنشئه الخادم تلقائيًا (لا نقل من V1) — معلومة فقط
  // V2 is a fresh build with its own session secret created by the server automatically (not moved from V1) — info only
  const secret = PropertiesService.getScriptProperties().getProperty('IDENTITY_SECRET');
  lines.push('');
  lines.push(secret ? 'ℹ️ يوجد مفتاح جلسات في خصائص السكربت' : 'ℹ️ لا يوجد مفتاح جلسات بعد — سيُنشئه الخادم الجديد تلقائيًا');

  lines.push('');
  lines.push(problems ? '⚠️ عدد الملاحظات: ' + problems : '✅ الشيت جاهز لبناء الخادم');
  console.log(lines.join('\n'));
}
