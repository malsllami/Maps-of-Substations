/**
 * ===================================================
 * 01_Api.gs — نقطة الاتصال الوحيدة: استقبال الطلب، التحقق، التوجيه، وتغليف الرد
 * ===================================================
 * - جدول توجيه واحد (ROUTES): لكل إجراء معالجه ومستوى التحقق المطلوب له. التحقق يُطبَّق هنا مرة واحدة
 *   حسب الجدول (لا داخل كل دالة)، فيُعرف بنظرة واحدة ماذا يحتاج كل إجراء.
 * - opResult: كتابة تُعاد بنفس مفتاح العملية ترجع نتيجة تنفيذها الأول (لا تكرار عند ضياع الرد).
 * - شكل الرد ثابت (عقد مع الواجهة): كائن JSON فيه success/error/found، ويُلحق به `_timing` للقياس.
 * - أي خطأ غير متوقع لا يُسقط الطلب: يُسجَّل ويُرجع رد خطأ موحّد.
 * الإجراءات تُضاف للجدول خطوة بخطوة حسب ترتيب البناء المعتمد.
 *
 * The single connection point: receive, check, route, wrap the reply.
 * - One routing table (ROUTES): each action's handler and required check level, applied here once.
 * - opResult: a write resent with the same operation key returns its first run's result (no repeat when a reply is lost).
 * - Fixed reply shape (a contract with the front end): success/error/found, plus `_timing`.
 * - An unexpected error never drops the request: it is logged and a uniform error reply is returned.
 * Actions are added to the table step by step in the approved build order.
 * ===================================================
 */

/* مستويات التحقق (تطبيقها في 02_Auth) — Check levels (applied in 02_Auth)
 * PUBLIC بلا تحقق · MEMBER جوال عضو موجود (قاعدة V1) · TOKEN تذكرة صالحة · ADMIN تذكرة بصمة لجوال المدير السري */
const ACCESS = { PUBLIC: 'public', MEMBER: 'member', TOKEN: 'token', ADMIN: 'admin' };

/* جدول التوجيه: الإجراء ← { المعالج، مستوى التحقق، opResult }. المعالجات تُستدعى بالاسم وقت الطلب لأن ملفات
 * Apps Script تُحمَّل بالترتيب، ودوال الملفات اللاحقة غير معرّفة بعد عند تحميل هذا الملف.
 * Routing table. Handlers are called by name at request time because Apps Script loads files in order and
 * later files' functions are not defined yet when this file loads. */
const ROUTES = {
  ping: { handler: function () { return { success: true, t: Date.now() }; }, access: ACCESS.PUBLIC },
  getDataVersion: { handler: function () { return getDataVersion(); }, access: ACCESS.PUBLIC },
  getAdminContactInfo: { handler: function () { return getAdminContactInfo(); }, access: ACCESS.PUBLIC },
  // المصادقة — authentication
  loginByPhone: { handler: function (d) { return loginByPhone(d); }, access: ACCESS.PUBLIC },
  refreshIdentityToken: { handler: function (d) { return refreshIdentityToken(d); }, access: ACCESS.PUBLIC }, // تتحقق بنفسها: تقبل المنتهية ضمن 180 يومًا / checks itself: accepts expired within 180 days
  generateRegisterChallenge: { handler: function (d) { return generateRegisterChallenge(d); }, access: ACCESS.PUBLIC },
  registerCredential: { handler: function (d) { return registerCredential(d); }, access: ACCESS.PUBLIC, opResult: true },
  generateLoginChallenge: { handler: function (d) { return generateLoginChallenge(d); }, access: ACCESS.PUBLIC },
  verifyAssertion: { handler: function (d) { return verifyAssertion(d); }, access: ACCESS.PUBLIC },
  // الأعضاء — members
  getSettingsLists: { handler: function () { return getSettingsLists(); }, access: ACCESS.PUBLIC },
  registerUser: { handler: function (d) { return registerUser(d); }, access: ACCESS.PUBLIC, opResult: true },
  getMemberProfileLite: { handler: function (d, a) { return getMemberProfileLite(d, a); }, access: ACCESS.TOKEN },
  getMemberProfile: { handler: function (d, a) { return getMemberProfile(d, a); }, access: ACCESS.TOKEN },
  updateMemberProfile: { handler: function (d, a) { return updateMemberProfile(d, a); }, access: ACCESS.TOKEN },
  // المحطات: القراءة — stations: reads
  getAllStations: { handler: function (d) { return getAllStations(d); }, access: ACCESS.MEMBER },
  getUpdatedStationsSince: { handler: function (d) { return getUpdatedStationsSince(d); }, access: ACCESS.PUBLIC },
  searchStation: { handler: function (d) { return searchStation(d); }, access: ACCESS.MEMBER },
  getNearbyStations: { handler: function (d) { return getNearbyStations(d); }, access: ACCESS.MEMBER },
  getFeederStations: { handler: function (d) { return getFeederStations(d); }, access: ACCESS.PUBLIC },
  clearSearchCache: { handler: function () { return clearSearchCache(); }, access: ACCESS.MEMBER, deniedMessage: 'يجب تسجيل الدخول لاستخدام هذا الإجراء' },
  // المحطات: الكتابة (مفتاح العملية يُحفظ في «عمليات الحفظ») — stations: writes (operation key kept in «عمليات الحفظ»)
  addNewStation: { handler: function (d, a) { return addNewStation(d, a); }, access: ACCESS.MEMBER, deniedMessage: 'الرجاء تسجيل الدخول أولًا' },
  updateCoordinates: { handler: function (d, a) { return updateCoordinates(d, a); }, access: ACCESS.MEMBER, deniedMessage: 'الرجاء تسجيل الدخول أولًا' },
  deleteStation: { handler: function (d) { return deleteStation(d); }, access: ACCESS.ADMIN, deniedMessage: 'حذف المحطات متاح للمدير فقط' },
  // الإحصاءات — stats
  getStats: { handler: function () { return getStats(); }, access: ACCESS.MEMBER },
  // السجلات (عام كما في V1: يصل الخطأ حتى قبل الدخول) — logs (public as in V1: errors arrive even before login)
  logClientError: { handler: function (d) { return logClientError(d); }, access: ACCESS.PUBLIC },
  // لوحة المدير (بتذكرة مدير بالبصمة فقط) — admin dashboard (fingerprint admin ticket only)
  getOperationsDashboard: { handler: function (d) { return getOperationsDashboard(d); }, access: ACCESS.ADMIN, logDenied: true },
  getActiveUsersDetail: { handler: function (d) { return getActiveUsersDetail(d); }, access: ACCESS.ADMIN },
  getChangesLog: { handler: function (d) { return getChangesLog(d); }, access: ACCESS.ADMIN },
  getVisitorsChart: { handler: function () { return getVisitorsChart(); }, access: ACCESS.ADMIN },
  getPeakHoursHeatmap: { handler: function () { return getPeakHoursHeatmap(); }, access: ACCESS.ADMIN },
  getRegionActivity: { handler: function () { return getRegionActivity(); }, access: ACCESS.ADMIN },
  getMembersList: { handler: function () { return getMembersList(); }, access: ACCESS.ADMIN }, // كل الأعضاء للمدير (15 أكتوبر) / all members for the admin
  getDailyReport: { handler: function () { return getDailyReport(); }, access: ACCESS.ADMIN } // تقرير الأمس للعرض فقط (V2) / yesterday's report, view only (V2)
};

const UNEXPECTED_ERROR_MSG = 'حدث خطأ غير متوقع، حاول مرة أخرى';
const OP_RESULT_SECONDS = 600; // نتيجة الكتابة محفوظة 10 دقائق لإعادة الإرسال / a write's result kept 10 minutes for resends

/* طلب GET (فتح الرابط من المتصفح مباشرة) — للتأكد أن النشر يعمل فقط
 * A GET request (opening the link directly in a browser) — only to confirm the deployment works */
function doGet() {
  return jsonOutput_({ status: 'ok' });
}

/* كل طلبات الموقع تصل هنا — Every site request arrives here */
function doPost(e) {
  let data = null;
  try { data = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { data = null; }
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) data = null;
  const action = data && typeof data.action === 'string' ? data.action : '';
  resetRequestMemo_();
  perfStart_(data && data.requestId, action || 'غير معروف');

  let result;
  try {
    if (!data) result = { error: 'صيغة الطلب غير صحيحة' };
    else {
      perfMeasure_('تهيئة المخطط', ensureSchema_);
      result = perfMeasure_('الإجراء ' + action, function () { return dispatch_(action, data); });
    }
  } catch (err) {
    reportServerError_('doPost/' + action, err);
    result = { error: UNEXPECTED_ERROR_MSG };
  }
  perfMeasure_('عدّ الطلب', function () { countRequest_(action); }); // في النهاية: يشمل كل عمليات الخصائص / at the end: includes all property operations
  return jsonOutput_(result, perfEnd_());
}

/* التحقق ثم التوجيه — Check, then route */
function dispatch_(action, data) {
  const route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : null;
  if (!route) return { error: 'إجراء غير معروف: ' + action };
  const access = perfMeasure_('التحقق (' + route.access + ')', function () { return checkAccess_(route, data); });
  if (access.deny) return access.deny;
  const run = function () { return route.handler(data, access.auth); };
  return route.opResult ? withOpResult_(data, run) : run();
}

/* مفتاح عملية صالح ← نتيجة التنفيذ الأول محفوظة 10 دقائق ومربوطة بالجوال؛ بلا مفتاح ← تنفيذ عادي
 * A valid operation key ← the first run's result kept 10 minutes, bound to the phone; no key ← a normal run */
function withOpResult_(data, run) {
  const opKey = typeof data.opKey === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(data.opKey) ? data.opKey : '';
  if (!opKey) return run();
  const cache = CacheService.getScriptCache(), key = 'opres_' + opKey, phone = formatPhone(data.phone);
  try {
    const saved = JSON.parse(cache.get(key) || 'null');
    if (saved && saved.phone === phone) return saved.result;
  } catch (err) { /* كاش غير متاح ← تنفيذ عادي / cache unavailable ← a normal run */ }
  const result = run();
  if (result && result.success) {
    try { cache.put(key, JSON.stringify({ phone: phone, result: result }), OP_RESULT_SECONDS); } catch (err) { /* لا يُفشل الطلب / never fails the request */ }
  }
  return result;
}

/* رد JSON مع ملخص القياس — A JSON reply with the timing summary */
function jsonOutput_(result, timing) {
  const body = result && typeof result === 'object' && !Array.isArray(result) && timing
    ? Object.assign({}, result, { _timing: timing })
    : result;
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/* خطأ غير متوقع بالخادم: سجل التنفيذ + سجل الأخطاء — An unexpected server error: execution log + error log */
function reportServerError_(source, err) {
  console.error(source + ': ' + (err && err.stack ? err.stack : err));
  logError_(source, String(err && err.message || err), '');
}
