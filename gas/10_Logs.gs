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

/* سطر في «سجل الأخطاء» مع تصنيفه — A row in the error log with its category */
function logError_(source, message, details) {
  try {
    appendFormattedRow_(sheet_(SHEETS.ERRORS), [new Date(), sanitizeSheetText_(source), sanitizeSheetText_(message), sanitizeSheetText_(details || ''), classifyError_(source, message)]);
  } catch (err) {
    console.error('logError_: ' + err);
  }
}

/* سطر في «سجل الزوار» — A row in the visits log */
function logVisit_(phone, action, result) {
  try {
    perfMeasure_('سجل الزوار', function () { appendFormattedRow_(sheet_(SHEETS.VISITS), [new Date(), phone, action, result]); });
  } catch (err) {
    console.error('logVisit_: ' + err);
  }
}

/* سطر في «سجل التعديلات» — A row in the audit log */
function logAudit_(phone, type, ref, details) {
  try {
    perfMeasure_('سجل التعديلات', function () { appendFormattedRow_(sheet_(SHEETS.AUDIT), [new Date(), phone, type, sanitizeSheetText_(ref), sanitizeSheetText_(details)]); });
  } catch (err) {
    console.error('logAudit_: ' + err);
  }
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
  if (has(s, ['client/recovered'])) return 'تأخر وعالجه الاحتياطي';
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
 * 3) window: المصدر + الرسالة + عائلة الجهاز بلا أرقام الإصدار، 5 دقائق ← نفس العطل يتكرر بسرعة / the same fault repeating fast
 *    («تأخر وعالجه الاحتياطي» خارج الطبقة 3: كل حالة منه طلب مستقل نحتاج عدّه / outside layer 3: each case is a request we count) */
function clientErrorKeys_(e) {
  const details = String(e.details || '');
  const hash = function (text) {
    return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8));
  };
  const at = (/وقت الحدوث: ([0-9:]+)/.exec(details) || [])[1] || '';
  const device = ((/الجهاز: ([^|]+)/.exec(details) || [])[1] || '').trim();
  const family = device.replace(/[0-9.]+/g, '').replace(/\s+/g, ' ').trim();
  const base = String(e.source || '') + '|' + String(e.message || '');
  return {
    id: e.id ? 'clienterr_id_' + String(e.id).slice(0, 40) : null,
    exact: 'clienterr_x_' + hash(base + '|' + at + '|' + device),
    window: String(e.source || '') === 'client/recovered' ? null : 'clienterr_w_' + hash(base + '|' + family)
  };
}

/* الإجراء: يسجّل الجديد فقط من الدفعة ويُرجع عدد ما سُجّل. فحص التكرار والكتابة وحفظ المفاتيح داخل قفل واحد،
 * فلا تُسجَّل دفعتان متطابقتان وصلتا معًا مرتين؛ وإن تعذّر القفل يُسجَّل على أي حال (الخطأ لا يضيع).
 * The action: logs only the batch's new errors and returns how many. Duplicate check, write and saving the keys
 * run inside one lock, so two identical batches arriving together aren't logged twice; without the lock it still logs. */
function logClientError(data) {
  if (!Array.isArray(data.errors)) return { error: 'صيغة السجل غير صحيحة' };
  const errors = data.errors.slice(0, CLIENT_ERROR_BATCH_MAX).filter(function (e) {
    return e && typeof e === 'object' && !Array.isArray(e) && !/ResizeObserver loop/i.test(String(e.message || ''));
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
    rows.push([new Date(), sanitizeSheetText_(source), sanitizeSheetText_(message), sanitizeSheetText_(String(e.details || '').slice(0, CLIENT_TEXT_MAX)), classifyError_(source, message)]);
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
