/**
 * ===================================================
 * 12_Reports.gs — التقرير اليومي بالبريد لإيميل المدير، ومشغّله الزمني (يُثبَّت يدويًا فقط)
 * ===================================================
 * - يعمل قرب منتصف الليل بتوقيت الرياض ويُحسب لليوم الكامل الذي انتهى للتو (الأمس) لا لدقائق اليوم الجديد.
 * - المحتوى كما في V1: طلبات السكربت ونسبتها من الحد، الأعضاء الجدد، المحطات المعدَّلة والمضافة (توزيع | تحويل)،
 *   الأخطاء الفعلية (برمجي، فشل تحديث، كتابة غير مؤكدة) مقابل المسجَّل للعلم، تفصيل التصنيفات، وحالة النظام.
 * - الأرقام تُحسب بنفس قواعد الإحصاءات ولوحة المدير (stationChanges_ و classifyError_).
 * - أي فشل يُسجَّل في «سجل الأخطاء» ولا يُسقط المشغّل.
 *
 * The daily email report to the admin's address, and its time trigger (installed manually only).
 * - Runs near Riyadh midnight and covers the whole day that just ended (yesterday), not the new day's minutes.
 * - Content as in V1: script requests and their share of the limit, new members, edited and added stations
 *   (distribution | substation), real errors vs logged-for-information, the category breakdown, and system status.
 * - Numbers use the same rules as the stats and the admin dashboard (stationChanges_ and classifyError_).
 * - Any failure is logged to the error log and never crashes the trigger.
 * ===================================================
 */

const REAL_ERROR_CATEGORIES = ['خطأ برمجي', 'فشل تحديث بيانات', 'نتيجة كتابة غير مؤكدة', 'تعطّل الموقع']; // + التعطّل (21 أكتوبر) / + outages
const REPORT_COLORS = {
  green: { bg: '#E8F8F0', text: '#1E8449', border: '#82E0AA' },
  yellow: { bg: '#FEF9E7', text: '#9A7D0A', border: '#F7DC6F' },
  orange: { bg: '#FDF2E9', text: '#B9770E', border: '#F5B041' },
  blue: { bg: '#EBF5FB', text: '#2874A6', border: '#85C1E9' },
  teal: { bg: '#E8F8F5', text: '#148F77', border: '#76D7C4' },
  red: { bg: '#FDEDEC', text: '#C0392B', border: '#F1948A' }
};

// ===== الأرقام — The numbers =====

/* عدد صفوف سجل زمني في [start, end) تحقق شرطًا اختياريًا — Rows of a chronological log within [start, end) matching an optional test */
function countLogRows_(sheetName, start, end, test) {
  return readLogRowsSince_(sheetName, new Date(start)).filter(function (row) {
    const t = logCellTime_(row[0]);
    return t && t.getTime() >= start && t.getTime() < end && (!test || test(row));
  }).length;
}

/* سجل الأخطاء في [start, end) بالتصنيف: الفعلية مقابل المسجَّل للعلم (التحذير غير الضار لا يُعدّ)
 * The error log within [start, end) by category: real vs for-information (the harmless warning isn't counted) */
function errorLogBetween_(start, end) {
  const byCategory = {};
  let real = 0, info = 0;
  readLogRowsSince_(SHEETS.ERRORS, new Date(start)).forEach(function (row) {
    const t = logCellTime_(row[0]);
    if (!t || t.getTime() < start || t.getTime() >= end) return;
    const category = classifyError_(row[1], row[2]);
    if (category === HARMLESS_CATEGORY) return;
    byCategory[category] = (byCategory[category] || 0) + 1;
    if (REAL_ERROR_CATEGORIES.indexOf(category) !== -1) real++; else info++;
  });
  return { byCategory: byCategory, real: real, info: info };
}

/* حالة النظام من الأخطاء الفعلية ونسبة الحصة — System status from real errors and the quota share */
function systemStatus_(realErrors, quotaPct) {
  if (realErrors === 0 && quotaPct < 60) return { label: 'ممتاز ✅', color: 'green' };
  if (realErrors <= 5 && quotaPct < 85) return { label: 'جيد ✅', color: 'green' };
  if (realErrors <= 20 && quotaPct < 90) return { label: 'تحذير ⚠️', color: 'yellow' };
  return { label: 'حرج 🔴', color: 'red' };
}

function quotaColor_(pct) {
  return pct < 60 ? 'green' : pct < 85 ? 'yellow' : 'red';
}

/* أرقام اليوم الذي انتهى قبل «now» — The numbers of the day that ended before "now" */
function dailyReportData_(now) {
  const end = riyadhMidnightMs_(now), start = end - DAY_MS;
  const requests = requestsOnDay_(riyadhDay_(new Date(start)));
  const quotaPct = Math.round((requests / DAILY_REQUEST_LIMIT) * 100);
  const errors = errorLogBetween_(start, end);
  return {
    dateLabel: Utilities.formatDate(new Date(start), TIMEZONE, 'dd/MM/yyyy'),
    requests: requests, quotaPct: quotaPct,
    newMembers: countLogRows_(SHEETS.VISITS, start, end, function (row) { return row[2] === 'تسجيل_عضو' && row[3] === 'نجاح'; }),
    changes: stationChanges_([[]].concat(readLogRowsSince_(SHEETS.AUDIT, new Date(start))), start, end, stationIdSets_()),
    errors: errors,
    categories: Object.keys(errors.byCategory).sort(function (a, b) { return errors.byCategory[b] - errors.byCategory[a]; })
      .map(function (c) { return { label: c, count: errors.byCategory[c], real: REAL_ERROR_CATEGORIES.indexOf(c) !== -1 }; }),
    status: systemStatus_(errors.real, quotaPct)
  };
}

// ===== الرسالة — The message =====

function reportBadge_(text, colorKey) {
  const c = REPORT_COLORS[colorKey] || REPORT_COLORS.teal;
  return '<span style="display:inline-block;padding:5px 14px;border-radius:20px;background:' + c.bg + ';color:' + c.text +
    ';border:1px solid ' + c.border + ';font-weight:700;font-size:13px;white-space:nowrap;">' + text + '</span>';
}

function reportRow_(label, valueHtml) {
  return '<tr><td style="padding:12px 10px;border-bottom:1px solid #EEE;font-size:13.5px;color:#333;text-align:right;">' + label + '</td>' +
    '<td style="padding:12px 10px;border-bottom:1px solid #EEE;text-align:left;">' + valueHtml + '</td></tr>';
}

/* الموضوع والنص العادي ونسخة HTML — The subject, plain text, and HTML version */
function dailyReportMessage_(d) {
  const ch = d.changes;
  const lines = [
    ['أ) عدد طلبات السكربت', d.requests + ' / ' + DAILY_REQUEST_LIMIT + ' (' + d.quotaPct + '%)', quotaColor_(d.quotaPct)],
    ['ب) الأعضاء الجدد المسجلين', String(d.newMembers), 'teal'],
    ['ج) محطات مُعدَّلة (توزيع | تحويل)', ch.editsDistribution + ' | ' + ch.editsSubstations, 'orange'],
    ['د) محطات مُضافة (توزيع | تحويل)', ch.additionsDistribution + ' | ' + ch.additionsSubstations, 'blue'],
    ['س) الأخطاء الفعلية (برمجي | فشل تحديث | كتابة غير مؤكدة)', String(d.errors.real), d.errors.real > 0 ? 'red' : 'green'],
    ['ص) مسجَّل للعلم (اتصال | 404 | خلفية | عالجه الاحتياطي…)', String(d.errors.info), 'teal']
  ];
  const categoryHtml = d.categories.length
    ? d.categories.map(function (l) { return '<div style="font-size:12.5px;color:' + (l.real ? '#C0392B' : '#555') + ';margin:3px 0;">' + (l.real ? '● ' : '○ ') + l.label + ': <b>' + l.count + '</b></div>'; }).join('')
    : '<span style="font-size:12.5px;color:#1E8449;">لا شيء</span>';
  const rows = lines.map(function (l) { return reportRow_(l[0], reportBadge_(l[1], l[2])); }).join('') +
    reportRow_('ش) تفصيل سجل الأخطاء حسب التصنيف', categoryHtml) +
    reportRow_('ر) حالة النظام (من الأخطاء الفعلية والحصة)', reportBadge_(d.status.label, d.status.color));
  const html = '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;padding:20px;">' +
    '<h2 style="text-align:center;color:#1B4D8C;margin:0 0 4px;">التقرير اليومي</h2>' +
    '<div style="text-align:center;color:#888;font-size:12.5px;margin-bottom:18px;">نظام محطات التوزيع — ' + d.dateLabel + '</div>' +
    '<table style="width:100%;border-collapse:collapse;">' + rows + '</table>' +
    '<div style="text-align:center;color:#AAA;font-size:11px;margin-top:18px;">تقرير آلي، لا حاجة للرد عليه</div></div>';
  const plain = 'التقرير اليومي لنظام محطات التوزيع — ' + d.dateLabel + '\n\n' +
    lines.map(function (l) { return l[0] + ': ' + l[1]; }).join('\n') + '\n' +
    'ش) تفصيل سجل الأخطاء حسب التصنيف:\n' +
    (d.categories.length ? d.categories.map(function (l) { return '   ' + (l.real ? '● ' : '○ ') + l.label + ': ' + l.count; }).join('\n') : '   لا شيء') + '\n' +
    'ر) حالة النظام (من الأخطاء الفعلية والحصة): ' + d.status.label + '\n\n— تقرير آلي، لا حاجة للرد عليه.';
  return { subject: 'التقرير اليومي — نظام محطات التوزيع (' + d.dateLabel + ')', plain: plain, html: html };
}

// ===== العرض في لوحة المدير (قرار محمد — 8 أكتوبر) — Shown in the admin dashboard =====

const DAILY_REPORT_CACHE_SECONDS = 600;

/* أرقام تقرير الأمس نفسها التي يحملها البريد — قراءة فقط، بلا إرسال. محفوظة 10 دقائق بمفتاح اليوم.
 * Yesterday's report numbers, the same the email carries — read only, nothing sent. Cached 10 minutes under the day. */
function getDailyReport() {
  const d = dailyReportData_(new Date());
  const key = 'daily_report_' + d.dateLabel, cache = CacheService.getScriptCache();
  try { const hit = JSON.parse(cache.get(key) || 'null'); if (hit) return hit; } catch (err) { /* تالف ← يُحسب / broken ← recomputed */ }
  const ch = d.changes;
  const result = {
    success: true, dateLabel: d.dateLabel, requests: d.requests, requestLimit: DAILY_REQUEST_LIMIT, quotaPct: d.quotaPct,
    quotaColor: quotaColor_(d.quotaPct), newMembers: d.newMembers,
    editsDistribution: ch.editsDistribution, editsSubstations: ch.editsSubstations,
    additionsDistribution: ch.additionsDistribution, additionsSubstations: ch.additionsSubstations,
    realErrors: d.errors.real, infoErrors: d.errors.info, categories: d.categories, status: d.status
  };
  try { cache.put(key, JSON.stringify(result), DAILY_REPORT_CACHE_SECONDS); } catch (err) { /* لا يُفشل الطلب / never fails the request */ }
  return result;
}

// ===== الإرسال والمشغّل — Sending and the trigger =====

/* معالج المشغّل الزمني (ويمكن تشغيله يدويًا من المحرر لإرسال تقرير الأمس الآن)
 * The time-trigger handler (can also be run manually from the editor to send yesterday's report now) */
function sendDailyOperationsReport() {
  try {
    const to = getSetting_(SETTING_KEYS.ADMIN_EMAIL);
    if (!to) {
      logError_('sendDailyOperationsReport', 'لا يوجد إيميل مدير مسجّل بشيت الإعدادات، تعذّر إرسال التقرير اليومي', '');
    } else {
      const message = dailyReportMessage_(dailyReportData_(new Date()));
      MailApp.sendEmail({ to: to, subject: message.subject, body: message.plain, htmlBody: message.html });
      console.log('أُرسل التقرير اليومي إلى ' + to + ': ' + message.subject);
    }
  } catch (err) {
    logError_('sendDailyOperationsReport exception', String(err), '');
  }
  countTriggerPropOps_(); // عمليات الخصائص لهذا التشغيل ضمن عدّاد اليوم / this run's property operations into today's counter
}

/* تثبيت المشغّل يدويًا من المحرر (مرة واحدة): كل يوم قرب منتصف الليل بتوقيت الرياض. يحذف أي نسخة سابقة فلا يتكرر.
 * Install the trigger manually from the editor (once): every day near Riyadh midnight. Removes any previous copy so it never duplicates. */
function تثبيت_مشغل_التقرير_اليومي() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyOperationsReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyOperationsReport').timeBased().atHour(0).everyDays(1).inTimezone(TIMEZONE).create();
  console.log('تم تثبيت مشغّل التقرير اليومي (قرب منتصف الليل بتوقيت الرياض)');
}
