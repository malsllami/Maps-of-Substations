/**
 * ===================================================
 * 10_Logs.gs — السجلات: الأخطاء (مع التصنيف)، الزوار، التعديلات
 * ===================================================
 * الكتابة في السجل لا تُفشل الطلب أبدًا.
 * أخطاء المتصفح (logClientError): دفعة حتى 20 خطأ بطلب واحد، ومنع التكرار بثلاث طبقات (انظر أدناه)،
 * وتحذير ResizeObserver لا يُسجَّل. السياق (requestId، الإجراء، حالة HTTP، نوع الخطأ، الجهاز، وقت الحدوث)
 * يكتبه المتصفح في «تفاصيل» بنفس عقد V1، فلا أعمدة جديدة.
 *
 * Logs: errors (with classification), visits, audit. Writing a log never fails the request.
 * Browser errors (logClientError): a batch of up to 20 per request, three de-duplication layers (below),
 * and the ResizeObserver warning is never logged. The context (requestId, action, HTTP status, error type,
 * device, occurrence time) is written by the browser into «تفاصيل» per the V1 contract, so no new columns.
 * ===================================================
 */

/* سطر في «سجل الأخطاء» مع تصنيفه — أخطاء الخادم نفسه (الجهاز «الخادم») — A row in the error log: the server's own errors */
function logError_(source, message, details) {
  try {
    appendFormattedRow_(sheet_(SHEETS.ERRORS), errorRow_(source, message, details || '', { deviceType: 'الخادم', action: String(source || '') }));
  } catch (err) {
    console.error('logError_: ' + err);
  }
}

// ===== صف «سجل الأخطاء» بأعمدته الثمانية عشر (16 أكتوبر) — An error-log row with its 18 columns =====

/* درجات الخطورة من الأدنى للأعلى (مواصفات محمد) — Severity levels, lowest first (Mohammed's spec) */
const SEVERITY = ['منخفض', 'مهم', 'مهم جدًا', 'حرج جدًا'];
/* الدرجة الابتدائية لكل تصنيف: فشل نهائي ← مهم جدًا، نجح في النهاية ← مهم، الخلفية/النوم ← منخفض
 * Each category's initial severity: a final failure ← very important, succeeded in the end ← important, background ← low */
const CATEGORY_SEVERITY = {
  // قواعد 21 أكتوبر: التأخير والتعطّل بدرجاتها — the 21 Oct rules: delays and outages by severity
  'تعطّل الموقع': 'حرج جدًا', 'تأخير اتصال طويل': 'مهم جدًا', 'تأخير اتصال': 'مهم',
  'خطأ برمجي': 'مهم جدًا', 'نتيجة كتابة غير مؤكدة': 'مهم جدًا', 'خروج قسري': 'مهم جدًا', 'صفحة 404 بدل الرد': 'مهم جدًا',
  'مشاكل اتصال': 'مهم جدًا', 'فشل تحديث بيانات': 'مهم جدًا',
  'تأخر وعالجه الاحتياطي': 'مهم', 'كتابة تأكدت بإعادة الإرسال': 'مهم', 'محاولة دخول خاطئة': 'مهم', 'رفض دخول لوحة المدير': 'مهم', 'تنبيهات': 'مهم',
  'فشل أثناء الخلفية أو النوم': 'منخفض', 'تحذير متصفح غير ضار': 'منخفض'
};
function severityOf_(category) { return CATEGORY_SEVERITY[category] || 'مهم'; }

/* رمز المشكلة: الإجراء + نوع الفشل + الصفحة — كل صفوف المشكلة نفسها تحمل الرمز نفسه (سهل التصفية بالشيت)
 * The problem code: action + failure kind + page — every row of the same problem carries the same code */
function problemCode_(action, failKind, page, fallback) {
  const parts = [action, failKind, page].map(function (x) { return String(x || '').trim(); });
  return parts[0] || parts[1] ? parts.join(' | ') : String(fallback || '').slice(0, 120);
}

/* قيمة نصية آمنة للخانة بحد طول — a safe, length-capped cell text */
function cellText_(v, max) { return sanitizeSheetText_(String(v == null ? '' : v).slice(0, max || 200)); }

/* يبني الصف: الأعمدة الخمسة الأصلية ثم الجديدة بترتيب HEADERS. meta من المتصفح (أو فارغ للخادم)، وما نقص يُستخرج من «تفاصيل»
 * (متصفح لم يتحدّث بعد). الاسم من جدول «الأعضاء» لحظة التسجيل.
 * Builds the row: the 5 original columns then the new ones in HEADERS order. meta from the browser (empty for the server);
 * anything missing is read from the details (a not-yet-updated browser). The name comes from the members sheet. */
function errorRow_(source, message, details, meta) {
  const m = meta && typeof meta === 'object' ? meta : {}, d = String(details || '');
  const fromDetails = function (label) { const x = new RegExp(label + ': ([^|]+)').exec(d); return x ? x[1].trim() : ''; };
  const category = classifyError_(source, message);
  const phone = formatPhone(m.phone) || '';
  let name = '';
  if (phone) { try { const member = findMember_(phone); name = member ? member.name : '(غير مسجّل)'; } catch (err) { name = ''; } }
  const page = m.page || fromDetails('الصفحة'), deviceText = fromDetails('الجهاز');
  const old = legacyFields_(source, message, d); // متصفح لم يتحدّث (أو طابور قديم): من الرسالة والتفاصيل / an old browser or queue
  const action = m.action || old.action, failKind = m.failKind || old.failKind, outcome = m.outcome || old.outcome;
  const fromDevice = function (re) { const x = re.exec(deviceText); return x ? x[1].trim() : ''; };
  return [
    new Date(), cellText_(source, 200), cellText_(message, CLIENT_TEXT_MAX), cellText_(d, CLIENT_TEXT_MAX), category,
    cellText_(m.deviceType || deviceText.split(' ')[0]), cellText_(m.os || fromDevice(/((?:iOS|Android) [0-9.]+)/)), cellText_(m.browser || fromDevice(/— ([^(]+)/)),
    cellText_(m.openMode || fromDevice(/(تطبيق مثبّت|متصفح)/)), phone, cellText_(name),
    cellText_(page), cellText_(action), cellText_(m.file || old.file, 300), cellText_(failKind), cellText_(outcome),
    severityOf_(category), cellText_(problemCode_(action, failKind, page, source + ' — ' + message), 200)
  ];
}

/* الحقول من رسالة الخطأ وتفاصيله بالشكل القديم (قبل 16 أكتوبر): الإجراء، نوع الفشل، النتيجة، والملف للخطأ البرمجي
 * The fields from an old-format error's message and details: the action, failure kind, outcome, and the file for a JS error */
function legacyFields_(source, message, details) {
  const s = String(source || ''), msg = String(message || '');
  const act = /(?:فشل طلب|نتيجة كتابة غير مؤكدة:|كتابة تأكدت بإعادة الإرسال:|تأخر وعالجه الاحتياطي:)\s*([A-Za-z]\w*)/.exec(msg);
  const failKind = /HTTP (\d{3})/.test(msg) ? 'صفحة HTTP ' + /HTTP (\d{3})/.exec(msg)[1] : /انتهت المهلة/.test(msg) ? 'انتهاء المهلة'
    : /رد ليس من خادمنا/.test(msg) ? 'رد ليس من خادمنا' : /لم يرد خلال 8 ث/.test(msg) ? 'تأخر أكثر من 8 ث'
    : /انقطاع الاتصال/.test(msg) ? 'انقطاع' : s === 'client/js' ? 'خطأ برمجي' : '';
  const outcome = s === 'client/recovered' ? 'نجاح بعد الطلب الاحتياطي' : s === 'client/write-recovered' ? 'نجاح بعد إعادة الإرسال'
    : s === 'client/write-unconfirmed' ? 'غير مؤكدة' : s === 'client/background' ? 'فشل أثناء الخلفية' : s === 'client/connection' ? 'فشل نهائي' : '';
  const where = s === 'client/js' ? ((/المكان: ([^|]+)/.exec(String(details || '')) || [])[1] || '').trim() : '';
  return { action: act ? act[1] : where, failKind: failKind, outcome: outcome, file: where };
}

/* سطر في «سجل الزوار» — A row in the visits log */
function logVisit_(phone, action, result) {
  try {
    perfMeasure_('سجل الزوار', function () { appendFormattedRow_(sheet_(SHEETS.VISITS), [new Date(), phone, action, result]); });
  } catch (err) {
    console.error('logVisit_: ' + err);
  }
}

/* محاولة دخول فاشلة في «سجل الزوار»: النتيجة «فشل — السبب» (16 أكتوبر). الجوال موحّدًا إن صح، وإلا كما كُتب (مقصوصًا ومعقّمًا).
 * لا يُحسب في المتواجدين ولا الزوار ولا «آخر دخول» (كلها تقرأ «نجاح» فقط).
 * A failed login in the visits log: result «فشل — reason». The phone normalized if valid, else as typed (trimmed, sanitized).
 * Never counted as active, a visitor or a last login (they all read «نجاح» only). */
function logLoginFailure_(rawPhone, action, reason) {
  const phone = formatPhone(rawPhone) || sanitizeSheetText_(String(rawPhone == null ? '' : rawPhone).slice(0, 20));
  logVisit_(phone, action, 'فشل — ' + String(reason || 'غير معروف').slice(0, 120));
}

/* سطر في «سجل التعديلات» — A row in the audit log */
function logAudit_(phone, type, ref, details) {
  try {
    perfMeasure_('سجل التعديلات', function () { appendFormattedRow_(sheet_(SHEETS.AUDIT), [new Date(), phone, type, sanitizeSheetText_(ref), sanitizeSheetText_(details)]); });
  } catch (err) {
    console.error('logAudit_: ' + err);
  }
}

/* جدول المحطة داخل «التفاصيل» (15 أكتوبر — إضافة نص فقط بلا عمود جديد): حتى تُنسب المحطة لجدولها بعد حذفها.
 * الصفوف الأقدم بلا هذا الجزء ← «غير معروف».
 * The station's table inside «details» (15 Oct — text only, no new column), so a deleted station keeps its table.
 * Older rows lack it ← unknown. */
const AUDIT_TABLE_TAG = ' | الجدول: ';
function auditDetailsWithTable_(details, type) { return String(details) + AUDIT_TABLE_TAG + type; }
function auditTableOf_(details) {
  const m = /\| الجدول: (\S+)\s*$/.exec(String(details || ''));
  return m && (m[1] === STATION_TYPE.DISTRIBUTION || m[1] === STATION_TYPE.SUBSTATION) ? m[1] : '';
}

/* آخر زيارة ناجحة لجوال بأحد الإجراءات المعطاة — يُقرأ السجل من الأسفل بدفعات حتى أول تطابق
 * The phone's last successful visit with one of the given actions — the log is read from the bottom in blocks until the first match */
const LOG_TAIL_BLOCK = 500;
function findLastVisit_(phone, actions) {
  const sheet = sheet_(SHEETS.VISITS);
  let end = sheet.getLastRow();
  while (end >= 2) {
    const start = Math.max(2, end - LOG_TAIL_BLOCK + 1);
    const rows = sheet.getRange(start, 1, end - start + 1, 4).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (actions.indexOf(String(rows[i][2])) !== -1 && rows[i][3] === 'نجاح' && phonesMatch_(rows[i][1], phone)) return { time: rows[i][0], action: rows[i][2] };
    }
    end = start - 1;
  }
  return null;
}

/* تصنيف الخطأ (القواعد بالترتيب) — Error classification (rules in order) */
function classifyError_(source, message) {
  const s = String(source || '').toLowerCase(), m = String(message || '').toLowerCase();
  const has = function (text, parts) { return parts.some(function (p) { return text.indexOf(p) !== -1; }); };
  if (has(m, ['resizeobserver loop'])) return 'تحذير متصفح غير ضار';
  // (21 أكتوبر) قبل غيرها: «slow-long» قبل «slow» — before the rest: «slow-long» before «slow»
  if (has(s, ['client/outage'])) return 'تعطّل الموقع';
  if (has(s, ['client/slow-long'])) return 'تأخير اتصال طويل';
  if (has(s, ['client/slow'])) return 'تأخير اتصال';
  if (has(s, ['client/recovered'])) return 'تأخر وعالجه الاحتياطي';
  if (has(s, ['client/write-recovered'])) return 'كتابة تأكدت بإعادة الإرسال'; // حُفظت مرة واحدة بنفس opKey — ليست خطأً / saved once — not an error
  if (has(s, ['client/session-expired'])) return 'خروج قسري'; // الخادم رفض التذكرة فخرج المستخدم — السبب في التفاصيل / the server refused the ticket
  if (has(s, ['client/write-unconfirmed'])) return 'نتيجة كتابة غير مؤكدة';
  if (has(s, ['client/background'])) return 'فشل أثناء الخلفية أو النوم';
  if (has(m, ['referenceerror', 'typeerror', 'syntaxerror', 'is not defined', 'is not a function', 'cannot read'])) return 'خطأ برمجي';
  if (has(s, ['credential', 'assertion', 'webauthn', 'admincode'])) return 'محاولة دخول خاطئة';
  if (has(s, ['client/connection'])) return has(m, ['http 404']) ? 'صفحة 404 بدل الرد' : 'مشاكل اتصال';
  if (has(s, ['client/js'])) return 'خطأ برمجي';
  if (has(s, ['getoperationsdashboard'])) return 'رفض دخول لوحة المدير';
  if (has(s, ['update', 'addnewstation', 'coordinates'])) return 'فشل تحديث بيانات';
  if (has(m, ['timeout', 'timed out', 'network', 'service invoked too many times'])) return 'مشاكل اتصال';
  return 'تنبيهات';
}

// ===== أخطاء المتصفح — Browser errors =====

const CLIENT_ERROR_BATCH_MAX = 20;
const CLIENT_ERROR_ID_SECONDS = 21600;   // 6 ساعات: أطول بكثير من أي إعادة إرسال / 6 hours: far longer than any resend
const CLIENT_ERROR_WINDOW_SECONDS = 300; // 5 دقائق لنفس الخطأ من نفس نوع الجهاز / 5 minutes for the same error from the same device kind
const CLIENT_TEXT_MAX = 5000;            // حد طول الخلية حماية للشيت / a cell length cap protecting the sheet

/* مفاتيح منع التكرار لخطأ واحد — The de-duplication keys of one error:
 * 1) id: رقم فريد يولّده المتصفح ← إعادة إرسال نفس الدفعة (ضاع الرد) لا تكرر الصف / a resent batch never duplicates the row
 * 2) exact: المصدر + الرسالة + وقت الحدوث + الجهاز ← نفس الحدث أُرسل برقم آخر / the same event sent under another id
 * 3) window: المصدر + الرسالة + **الشخص** (الجوال، أو معرّف الجهاز لمن لم يسجّل دخوله، أو عائلة الجهاز لمتصفح قديم)، 5 دقائق
 *    ← نفس العطل يتكرر بسرعة عند نفس الشخص؛ وأشخاص مختلفون يُسجَّلون كلهم فيُعدّ «الأعضاء المتأثرون» (مواصفات محمد 16 أكتوبر)
 *    («تأخر وعالجه الاحتياطي» خارج الطبقة 3: كل حالة منه طلب مستقل نحتاج عدّه / outside layer 3: each case is a request we count)
 * Layer 3 is per PERSON (phone, else device id, else device family for an old browser), so different members are all
 * logged and «affected members» can be counted. */
function clientErrorKeys_(e) {
  const details = String(e.details || ''), meta = e.meta && typeof e.meta === 'object' ? e.meta : {};
  const hash = function (text) {
    return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8));
  };
  const at = (/وقت الحدوث: ([0-9:]+)/.exec(details) || [])[1] || '';
  const device = ((/الجهاز: ([^|]+)/.exec(details) || [])[1] || '').trim();
  const family = device.replace(/[0-9.]+/g, '').replace(/\s+/g, ' ').trim();
  const person = formatPhone(meta.phone) || String(meta.deviceId || '').slice(0, 40) || family;
  const base = String(e.source || '') + '|' + String(e.message || '');
  return {
    id: e.id ? 'clienterr_id_' + String(e.id).slice(0, 40) : null,
    exact: 'clienterr_x_' + hash(base + '|' + at + '|' + device + '|' + person),
    window: String(e.source || '') === 'client/recovered' ? null : 'clienterr_w_' + hash(base + '|' + person)
  };
}

/* (21 أكتوبر) ما عولج تلقائيًا أو فشل والصفحة في الخلفية لا يُسجَّل؛ الأجهزة التي لم تتحدّث بعد ما زالت ترسله بأسمائه
   القديمة فيُتجاهَل هنا — auto-handled or background failures aren't logged; not-yet-updated devices still send them under the
   old names, so they're dropped here */
const CLIENT_NOT_LOGGED = ['client/recovered', 'client/write-recovered', 'client/background'];

/* الإجراء: يسجّل الجديد فقط من الدفعة ويُرجع عدد ما سُجّل. فحص التكرار والكتابة وحفظ المفاتيح داخل قفل واحد،
 * فلا تُسجَّل دفعتان متطابقتان وصلتا معًا مرتين؛ وإن تعذّر القفل يُسجَّل على أي حال (الخطأ لا يضيع).
 * The action: logs only the batch's new errors and returns how many. Duplicate check, write and saving the keys
 * run inside one lock, so two identical batches arriving together aren't logged twice; without the lock it still logs. */
function logClientError(data) {
  if (!Array.isArray(data.errors)) return { error: 'صيغة السجل غير صحيحة' };
  const errors = data.errors.slice(0, CLIENT_ERROR_BATCH_MAX).filter(function (e) {
    return e && typeof e === 'object' && !Array.isArray(e) && !/ResizeObserver loop/i.test(String(e.message || '')) &&
      CLIENT_NOT_LOGGED.indexOf(String(e.source || '')) === -1;
  });
  if (!errors.length) return { success: true, logged: 0 };
  const lock = LockService.getScriptLock(), locked = lock.tryLock(5000);
  try {
    return { success: true, logged: logNewClientErrors_(errors) };
  } finally {
    if (locked) lock.releaseLock();
  }
}

/* كتابة غير المكرر دفعة واحدة ثم حفظ مفاتيحه — Write the non-duplicates in one go, then save their keys */
function logNewClientErrors_(errors) {
  const cache = CacheService.getScriptCache(), keys = errors.map(clientErrorKeys_), lookup = [];
  keys.forEach(function (k) { [k.id, k.exact, k.window].forEach(function (x) { if (x) lookup.push(x); }); });
  let seen = {};
  try { seen = cache.getAll(lookup); } catch (err) { seen = {}; }
  const fresh = {}, freshWindow = {}, rows = [];
  const isSeen = function (k) { return !!(k && (seen[k] || fresh[k] || freshWindow[k])); };
  errors.forEach(function (e, i) {
    const k = keys[i];
    if (isSeen(k.id) || isSeen(k.exact) || isSeen(k.window)) return; // مكرر / duplicate
    const source = String(e.source || 'client').slice(0, 200), message = String(e.message || '').slice(0, CLIENT_TEXT_MAX);
    const meta = e.meta && typeof e.meta === 'object' && !Array.isArray(e.meta) ? e.meta : {};
    rows.push(errorRow_(source, message, String(e.details || '').slice(0, CLIENT_TEXT_MAX), meta));
    if (k.id) fresh[k.id] = '1';
    fresh[k.exact] = '1';
    if (k.window) freshWindow[k.window] = '1';
  });
  try {
    appendFormattedRows_(sheet_(SHEETS.ERRORS), rows);
  } catch (err) {
    console.error('logClientError: ' + err);
    return 0; // لم يُكتب ← لا تُحفظ المفاتيح، فإعادة الإرسال تسجّله / not written ← keys not saved, so a resend logs it
  }
  try {
    if (Object.keys(fresh).length) cache.putAll(fresh, CLIENT_ERROR_ID_SECONDS);
    if (Object.keys(freshWindow).length) cache.putAll(freshWindow, CLIENT_ERROR_WINDOW_SECONDS);
  } catch (err) { /* فشل الكاش لا يُفشل التسجيل / a cache failure never fails logging */ }
  return rows.length;
}

// ===== قراءة ذيل سجل زمني — Reading the tail of a chronological log =====

const LOG_READ_BLOCK_ROWS = 300;
const LOG_ORDER_MARGIN_MS = 10 * 60 * 1000;

/* وقت خلية السجل أو null — A log cell's time, or null */
function logCellTime_(value) {
  const t = value instanceof Date ? value : new Date(value);
  return isNaN(t) ? null : t;
}

/* صفوف السجل منذ لحظة معيّنة: السجلات تُكتب بترتيب زمني، فتُقرأ من الأسفل بدفعات حتى صف أقدم من الفترة
 * (بهامش 10 دقائق لاختلاف ترتيب كتابتين متزامنتين) بدل قراءة السجل كاملًا. بلا صف العناوين؛ والفرز بالوقت على المستدعي.
 * A log's rows since a moment: logs are written in time order, so they're read from the bottom in blocks until a row
 * older than the period (with a 10-minute margin for concurrent writes) instead of the whole log. No header row;
 * the caller filters by time. */
function readLogRowsSince_(sheetName, since) {
  const sheet = sheet_(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const width = sheet.getLastColumn(), stopBefore = since.getTime() - LOG_ORDER_MARGIN_MS, blocks = [];
  let end = sheet.getLastRow();
  while (end >= 2) {
    const start = Math.max(2, end - LOG_READ_BLOCK_ROWS + 1);
    const values = withSheetRetry_(function () { return sheet.getRange(start, 1, end - start + 1, width).getValues(); });
    blocks.unshift(values);
    const first = logCellTime_(values[0][0]);
    if (first && first.getTime() < stopBefore) break;
    end = start - 1;
  }
  return [].concat.apply([], blocks);
}
