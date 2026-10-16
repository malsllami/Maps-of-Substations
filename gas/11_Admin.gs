/**
 * ===================================================
 * 11_Admin.gs — لوحة المدير: العمليات، المتواجدون، سجل التغييرات، الرسوم، وجودة البيانات
 * ===================================================
 * كل إجراءات هذا الملف بتذكرة مدير (جوال المدير السري + دخول بالبصمة) — يُطبَّق في الموجّه (01_Api).
 * - لوحة العمليات: عدّاد طلبات اليوم وأكثر الإجراءات، عمليات الخصائص، الإحصاءات، جودة البيانات، المتواجدون
 *   اليوم والوردية، وملخص سجل الأخطاء بالتصنيفات، والمشاكل المحددة فيه (شريط 72 ساعة من أول ظهور + أحدث المشاكل
 *   لسجل النظام — 15 أكتوبر). محفوظة 55 ث (fresh يتجاوزها بزر «تحديث اللوحة»).
 * - السجلات الزمنية (الزوار، التعديلات) تُقرأ من ذيلها حتى بداية الفترة المطلوبة فقط.
 * - جودة البيانات: المحطات بلا إحداثيات صالحة، محفوظة 10 دقائق بمفتاح رقم الإصدار.
 * - كل الأوقات بتوقيت الرياض (+03:00 ثابت).
 *
 * Admin dashboard: operations, active users, change log, charts, and data quality.
 * Every action here needs an admin ticket (the secret admin phone + a fingerprint login) — applied in the router.
 * - Operations: today's request counter and top actions, property operations, stats, data quality, users active
 *   today and this shift, and the error-log summary by category. Cached 55 s (fresh bypasses it).
 * - Chronological logs (visits, audit) are read from their tail back to the period's start only.
 * - Data quality: stations without valid coordinates, cached 10 minutes under the data version.
 * - All times are Riyadh time (fixed +03:00).
 * ===================================================
 */

const DASHBOARD_CACHE_KEY = 'ops_dashboard';
const DASHBOARD_CACHE_SECONDS = 55;
const QUALITY_CACHE_SECONDS = 600;
const QUALITY_LIST_MAX = 50;
const CHANGES_DEFAULT_LIMIT = 100;
const CHANGES_MAX_LIMIT = 500;
const VISITORS_DAYS = 7;
const ACTIVITY_DAYS = 30;
const REGIONS_TOP = 10;
const NO_REGION = 'غير محدّدة';
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const ERROR_CATEGORIES = ['خطأ برمجي', 'فشل تحديث بيانات', 'محاولة دخول خاطئة', 'مشاكل اتصال', 'تنبيهات',
  'صفحة 404 بدل الرد', 'فشل أثناء الخلفية أو النوم', 'نتيجة كتابة غير مؤكدة', 'تأخر وعالجه الاحتياطي', 'كتابة تأكدت بإعادة الإرسال'];
const HARMLESS_CATEGORY = 'تحذير متصفح غير ضار';
// تصنيفات تُعدّ وتبقى في جدول السجل لكنها لا تظهر في شريط التنبيهات (نجحت في النهاية — 16 أكتوبر)
// Categories counted and kept in the log table but never shown in the alert strip (they succeeded in the end)
const NON_ALERT_CATEGORIES = ['كتابة تأكدت بإعادة الإرسال'];

// ===== الوقت — Time =====

/* «yyyy-MM-dd» ← بداية ذلك اليوم بالرياض (ميلي ثانية)، أو NaN — "yyyy-MM-dd" ← that day's Riyadh start (ms), or NaN */
function riyadhDateStrToMs_(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - RIYADH_OFFSET_MS : NaN;
}

/* يوم الأسبوع (0 = الأحد) والساعة بتوقيت الرياض — The Riyadh weekday (0 = Sunday) and hour */
function riyadhWeekdayHour_(date) {
  const z = new Date(date.getTime() + RIYADH_OFFSET_MS);
  return { weekday: z.getUTCDay(), hour: z.getUTCHours() };
}

/* الوردية الحالية: نهارية 7ص–7م، وليلية 7م–7ص — The current shift: day 7am–7pm, night 7pm–7am */
function shiftRange_(now) {
  const today = riyadhMidnightMs_(now), hour = riyadhWeekdayHour_(now).hour;
  const seven = today + 7 * 3600 * 1000, nineteen = today + 19 * 3600 * 1000;
  if (hour >= 7 && hour < 19) return { start: new Date(seven), end: new Date(nineteen), label: 'الوردية النهارية (٧ص–٧م)' };
  if (hour >= 19) return { start: new Date(nineteen), end: new Date(nineteen + 12 * 3600 * 1000), label: 'الوردية الليلية (٧م–٧ص)' };
  return { start: new Date(nineteen - DAY_MS), end: new Date(seven), label: 'الوردية الليلية (٧م–٧ص)' };
}

// ===== النشاط من السجلات — Activity from the logs =====

/* أحداث الزوار والتعديلات منذ لحظة (محفوظة لعمر الطلب) — Visit and audit events since a moment (request-scoped) */
function activityEvents_(since) {
  const memo = requestMemo_.activity;
  if (memo && memo.since <= since.getTime()) return memo.events;
  const events = [];
  [SHEETS.VISITS, SHEETS.AUDIT].forEach(function (name) {
    const rows = perfMeasure_('ذيل ' + name, function () { return readLogRowsSince_(name, since); }, function (r) { return r.length + ' صف'; });
    rows.forEach(function (row) {
      const t = logCellTime_(row[0]);
      if (!t || t < since) return;
      events.push({ time: t, phone: String(row[1] || '').trim(), action: String(row[2] || ''), ref: name === SHEETS.AUDIT ? normalizeStationId_(row[3]) : '' });
    });
  });
  requestMemo_.activity = { since: since.getTime(), events: events };
  return events;
}

// ===== المتواجدون — Active users =====

/* period: «today» (افتراضي) أو «shift»، أو dateFrom/dateTo بصيغة yyyy-MM-dd؛ search بالاسم أو الجوال
 * period: "today" (default) or "shift", or dateFrom/dateTo as yyyy-MM-dd; search by name or phone */
function getActiveUsersDetail(data) {
  const now = new Date();
  let range;
  const from = riyadhDateStrToMs_(data.dateFrom), to = riyadhDateStrToMs_(data.dateTo);
  if (data.dateFrom || data.dateTo) {
    if (isNaN(from) || isNaN(to) || from > to) return { error: 'نطاق تاريخ غير صحيح' };
    range = { start: new Date(from), end: new Date(to + DAY_MS - 1), label: 'من ' + data.dateFrom + ' إلى ' + data.dateTo };
  } else if (data.period === 'shift') {
    range = shiftRange_(now);
  } else {
    range = { start: new Date(riyadhMidnightMs_(now)), end: now, label: 'اليوم الحالي' };
  }

  const last = {};
  activityEvents_(range.start).forEach(function (ev) {
    if (!ev.phone || ev.time < range.start || ev.time > range.end) return;
    if (!last[ev.phone] || ev.time > last[ev.phone].time) last[ev.phone] = ev;
  });
  const query = normalizeDigits_(String(data.search || '').trim().toLowerCase());
  const users = Object.keys(last).map(function (phone) {
    const member = findMember_(phone);
    return {
      phone: phone, name: member ? member.name : '(غير مسجّل)', shift: member ? member.shift : '',
      lastAction: last[phone].action, lastActivity: Utilities.formatDate(last[phone].time, TIMEZONE, 'yyyy-MM-dd HH:mm')
    };
  }).filter(function (u) {
    return !query || normalizeDigits_(u.phone).indexOf(query) !== -1 || String(u.name).toLowerCase().indexOf(query) !== -1;
  }).sort(function (a, b) { return b.lastActivity.localeCompare(a.lastActivity); });
  return { success: true, period: range.label, count: users.length, users: users };
}

// ===== سجل التغييرات — Change log =====

/* الأحدث أولًا؛ type (نوع العملية)، dateFrom/dateTo، search (رقم المحطة أو الاسم أو الجوال)، limit (100، حتى 500)
 * Newest first; type, dateFrom/dateTo, search (station number, name or phone), limit (100, up to 500) */
function getChangesLog(data) {
  const asked = Math.floor(Number(data.limit));
  const limit = asked > 0 ? Math.min(asked, CHANGES_MAX_LIMIT) : CHANGES_DEFAULT_LIMIT;
  const from = data.dateFrom ? riyadhDateStrToMs_(data.dateFrom) : null, to = data.dateTo ? riyadhDateStrToMs_(data.dateTo) : null;
  if ((data.dateFrom && isNaN(from)) || (data.dateTo && isNaN(to))) return { error: 'نطاق تاريخ غير صحيح' };
  const query = normalizeDigits_(String(data.search || '').trim().toLowerCase());
  const rows = perfMeasure_('سجل التعديلات', function () { return readAllRows_(SHEETS.AUDIT); }, function (r) { return r.length + ' صف'; });
  const changes = [];
  for (let i = rows.length - 1; i >= 1 && changes.length < limit; i--) {
    const type = String(rows[i][2] || '');
    if (data.type && type !== data.type) continue;
    const t = logCellTime_(rows[i][0]);
    if (!t || (from !== null && t.getTime() < from) || (to !== null && t.getTime() > to + DAY_MS - 1)) continue;
    const phone = String(rows[i][1] || ''), stationId = String(rows[i][3] || ''), member = findMember_(phone);
    const name = member ? member.name : '(غير معروف)';
    if (query && normalizeDigits_(stationId + ' ' + name + ' ' + phone).toLowerCase().indexOf(query) === -1) continue;
    changes.push({
      stationId: stationId, memberName: name, phone: phone, shift: member ? member.shift : '', changeType: type,
      date: Utilities.formatDate(t, TIMEZONE, 'dd/MM/yyyy'), time: Utilities.formatDate(t, TIMEZONE, 'HH:mm:ss'), details: String(rows[i][4] || '')
    });
  }
  return { success: true, changes: changes };
}

// ===== الرسوم — Charts =====

/* الزوار لآخر 7 أيام كاملة (اليوم و6 قبله): كل صف في سجلي الزوار والتعديلات حدث
 * Visitors over the last 7 whole days (today and the 6 before): every row in the visits and audit logs is an event */
function getVisitorsChart() {
  const todayStart = riyadhMidnightMs_(new Date()), firstDay = todayStart - (VISITORS_DAYS - 1) * DAY_MS;
  const values = new Array(VISITORS_DAYS).fill(0);
  activityEvents_(new Date(firstDay)).forEach(function (ev) {
    const day = Math.floor((ev.time.getTime() - firstDay) / DAY_MS);
    if (day >= 0 && day < VISITORS_DAYS) values[day]++;
  });
  const labels = values.map(function (v, i) {
    const d = new Date(firstDay + i * DAY_MS);
    return WEEKDAYS[riyadhWeekdayHour_(d).weekday] + ' ' + Utilities.formatDate(d, TIMEZONE, 'dd/MM');
  });
  return { success: true, labels: labels, values: values };
}

/* أوقات الذروة لآخر 30 يومًا: مصفوفة 7 أيام × 24 ساعة وأعلى خانة — Peak hours over 30 days: a 7×24 matrix and the top cell */
function getPeakHoursHeatmap() {
  const matrix = WEEKDAYS.map(function () { return new Array(24).fill(0); });
  activityEvents_(new Date(Date.now() - ACTIVITY_DAYS * DAY_MS)).forEach(function (ev) {
    const w = riyadhWeekdayHour_(ev.time);
    matrix[w.weekday][w.hour]++;
  });
  let peak = null;
  matrix.forEach(function (row, d) {
    row.forEach(function (count, h) { if (count > 0 && (!peak || count > peak.count)) peak = { day: WEEKDAYS[d], hour: h, count: count }; });
  });
  return { success: true, matrix: matrix, weekdayLabels: WEEKDAYS, peak: peak };
}

/* نشاط المناطق لآخر 30 يومًا (تعديلات وإضافات المحطات)، أعلى 10 — Region activity over 30 days (station adds and edits), top 10 */
function getRegionActivity() {
  const regions = stationRegions_(), counts = {};
  activityEvents_(new Date(Date.now() - ACTIVITY_DAYS * DAY_MS)).forEach(function (ev) {
    if (!ev.ref) return;
    const region = regions[ev.ref] || NO_REGION;
    counts[region] = (counts[region] || 0) + 1;
  });
  const ranked = Object.keys(counts).map(function (r) { return { region: r, count: counts[r] }; })
    .sort(function (a, b) { return b.count - a.count; }).slice(0, REGIONS_TOP);
  return { success: true, regions: ranked, stations: regionStations_() };
}

/* قرار محمد (15 أكتوبر): توزيع محطات التوزيع على المناطق — المحطات التي لها تاريخ إضافة أو تعديل فقط (أُضيفت أو
 * عُدّلت في الموقع)، لا كل الجدول — الأكثر محطات أولًا، مع إضافات وتعديلات كل منطقة آخر 30 يومًا. (التحويل بلا منطقة.)
 * Mohammed's decision (15 Oct): distribution stations per region — only stations that carry an add/edit date (added or
 * edited on the site), not the whole sheet — most first, with each region's adds and edits over 30 days. */
function regionStations_() {
  const regions = stationRegions_(), byRegion = {}, seen = {};
  const row = function (name) { return byRegion[name] || (byRegion[name] = { region: name, stations: 0, additions: 0, edits: 0 }); };
  stationIndex_(STATION_TYPE.DISTRIBUTION).forEach(function (e) {
    if (!e.t || seen[e.n]) return; // بلا تاريخ إضافة/تعديل، أو رقم مكرر (أول صف يفوز) / no add/edit date, or a duplicate
    seen[e.n] = true;
    row(String(e.region || '').trim() || NO_REGION).stations++;
  });
  activityEvents_(new Date(Date.now() - ACTIVITY_DAYS * DAY_MS)).forEach(function (ev) {
    if (!ev.ref || (ev.action !== AUDIT_TYPE.ADD && ev.action !== AUDIT_TYPE.EDIT)) return;
    const r = row(String(regions[ev.ref] || '').trim() || NO_REGION);
    if (ev.action === AUDIT_TYPE.ADD) r.additions++; else r.edits++;
  });
  return Object.keys(byRegion).map(function (k) { return byRegion[k]; })
    .sort(function (a, b) { return b.stations - a.stations || (b.additions + b.edits) - (a.additions + a.edits); });
}

// ===== الأعضاء — Members =====

/* كل الأعضاء من جدول «الأعضاء» بترتيب عكسي (آخر من سجّل أولًا — قرار محمد، 15 أكتوبر)؛ للمدير فقط
 * Every member from the members sheet in reverse order (the latest registration first — Mohammed, 15 Oct); admin only */
function getMembersList() {
  const rows = cachedRows_(MEMBERS_CACHE_KEY, SHEETS.MEMBERS), c = COL.MEMBER, members = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const r = rows[i];
    if (!String(r[c.PHONE] || '').trim() && !String(r[c.NAME] || '').trim()) continue; // صف فارغ / an empty row
    const at = r[c.REGISTERED_AT];
    members.push({
      name: String(r[c.NAME] || ''), phone: formatPhone(r[c.PHONE]) || String(r[c.PHONE] || ''), memberType: String(r[c.MEMBER_TYPE] || ''),
      shift: String(r[c.SHIFT] || ''), department: String(r[c.DEPARTMENT] || ''), status: String(r[c.STATUS] || '').trim(),
      registeredAt: at instanceof Date && !isNaN(at) ? Utilities.formatDate(at, TIMEZONE, 'yyyy-MM-dd HH:mm') : String(at || '')
    });
  }
  return { success: true, count: members.length, members: members };
}

// ===== جودة البيانات — Data quality =====

/* المحطات بلا إحداثيات صالحة (من الفهرسين) — Stations without valid coordinates (from both indexes) */
function dataQualityReport_() {
  const key = 'quality_' + getDataVersion().version, cache = CacheService.getScriptCache();
  try { const hit = JSON.parse(cache.get(key) || 'null'); if (hit) return hit; } catch (err) { /* تالف ← يُحسب / broken ← recomputed */ }
  const all = stationIndex_(STATION_TYPE.DISTRIBUTION).concat(stationIndex_(STATION_TYPE.SUBSTATION));
  const review = all.filter(function (e) { return !hasCoordinates_(e); });
  const report = {
    qualityPct: all.length ? Math.round(((all.length - review.length) / all.length) * 100) : 100,
    total: all.length, needsReviewCount: review.length,
    needsReviewStations: review.slice(0, QUALITY_LIST_MAX).map(function (e) { return e.id; })
  };
  try { cache.put(key, JSON.stringify(report), QUALITY_CACHE_SECONDS); } catch (err) { /* لا يُفشل الطلب / never fails the request */ }
  return report;
}

// ===== لوحة العمليات — Operations dashboard =====

function getOperationsDashboard(data) {
  const cache = CacheService.getScriptCache();
  if (data.fresh === true) perfNote_('كاش اللوحة', 'متجاوز (تحديث يدوي)');
  else {
    try { const hit = JSON.parse(cache.get(DASHBOARD_CACHE_KEY) || 'null'); if (hit) return hit; } catch (err) { /* تالف ← يُبنى / broken ← rebuilt */ }
  }
  const result = perfMeasure_('بناء اللوحة', buildDashboard_);
  try { cache.put(DASHBOARD_CACHE_KEY, JSON.stringify(result), DASHBOARD_CACHE_SECONDS); } catch (err) { /* لا يُفشل الطلب / never fails the request */ }
  return result;
}

function buildDashboard_() {
  const stats = getStats(), quality = dataQualityReport_(), usage = usageToday_();
  const today = getActiveUsersDetail({ period: 'today' }), shift = getActiveUsersDetail({ period: 'shift' });
  const result = {
    success: true,
    dailyRequests: usage.requests, dailyRequestBreakdown: usage.topActions, dailyRequestLimit: DAILY_REQUEST_LIMIT,
    dailyRequestBreakdownAll: usage.allActions, // كل أنواع الطلبات (15 أكتوبر) / every request type (15 Oct)
    propOpsToday: usage.propOps, propOpsLimit: SCRIPT_PROPS_DAILY_LIMIT,
    totalStations: stats.totalStations, totalStationsDistribution: stats.distribution, totalStationsSubstations: stats.substations,
    additionsToday: stats.additions, editsToday: stats.edits,
    dataQualityPct: quality.qualityPct, stationsNeedingReview: quality.needsReviewCount,
    activeUsersToday: today.count, activeUsersShift: shift.count, currentShiftLabel: shiftRange_(new Date()).label
  };
  const rows = perfMeasure_('سجل الأخطاء', function () { return readAllRows_(SHEETS.ERRORS); }, function (r) { return r.length + ' صف'; });
  result.alertsSummary = errorCategoryCounts_(rows);
  // قرار محمد (15 أكتوبر): شريط الأخطاء = المشاكل التي أول ظهور لها خلال 72 ساعة؛ وكل المشاكل تبقى في «سجل النظام»
  // Mohammed's decision (15 Oct): the alert strip = problems first seen within 72 hours; all problems stay in «system log»
  const problems = recentProblems_(rows, Date.now());
  result.alertsRecent = problems.recent;
  result.problems = problems.latest;
  return result;
}

/* عدد صفوف سجل الأخطاء لكل تصنيف (بالقواعد الحالية؛ التحذير غير الضار لا يُعدّ) — Error-log rows per category (current rules; the harmless warning isn't counted) */
function errorCategoryCounts_(rows) {
  const counts = {};
  ERROR_CATEGORIES.forEach(function (c) { counts[c] = 0; });
  for (let i = 1; i < rows.length; i++) {
    const category = classifyError_(rows[i][1], rows[i][2]);
    if (category !== HARMLESS_CATEGORY) counts[category] = (counts[category] || 0) + 1;
  }
  return counts;
}

/* المشاكل المحددة في سجل الأخطاء: المشكلة الواحدة = نفس المصدر + نفس الرسالة (بلا التحذير غير الضار).
 * recent: أول ظهور لها خلال آخر 72 ساعة (للشريط)، الأحدث ظهورًا أولًا؛ latest: أحدث المشاكل بآخر ظهور (لسجل النظام).
 * Distinct problems in the error log: one problem = same source + same message (harmless warning excluded).
 * recent: first seen within the last 72 hours (the strip), newest first; latest: the most recently seen (system log). */
const ALERT_WINDOW_HOURS = 72;
const PROBLEMS_LIST_MAX = 20;
const PROBLEM_MESSAGE_MAX = 160;
function recentProblems_(rows, nowMs) {
  const byKey = {};
  for (let i = 1; i < rows.length; i++) {
    const t = logCellTime_(rows[i][0]);
    if (!t) continue;
    const source = String(rows[i][1] || '').trim(), message = String(rows[i][2] || '').trim();
    const category = classifyError_(source, message);
    if (category === HARMLESS_CATEGORY) continue;
    const key = source + '\u0000' + message, ms = t.getTime();
    const p = byKey[key] || (byKey[key] = { category: category, source: source, message: message.slice(0, PROBLEM_MESSAGE_MAX), count: 0, first: ms, last: ms });
    p.count++;
    if (ms < p.first) p.first = ms;
    if (ms > p.last) p.last = ms;
  }
  const all = Object.keys(byKey).map(function (k) { return byKey[k]; });
  const out = function (p) { return { category: p.category, source: p.source, message: p.message, count: p.count, firstSeen: new Date(p.first).toISOString(), lastSeen: new Date(p.last).toISOString() }; };
  const since = nowMs - ALERT_WINDOW_HOURS * 3600 * 1000;
  return {
    recent: all.filter(function (p) { return p.first >= since && NON_ALERT_CATEGORIES.indexOf(p.category) === -1; }).sort(function (a, b) { return b.first - a.first; }).slice(0, PROBLEMS_LIST_MAX).map(out),
    latest: all.slice().sort(function (a, b) { return b.last - a.last; }).slice(0, PROBLEMS_LIST_MAX).map(out)
  };
}
