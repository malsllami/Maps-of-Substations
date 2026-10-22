/**
 * ===================================================
 * 16_UsageLog.gs — سجل الاستخدام اليومي: صف واحد لكل عضو في كل يوم بعدّادات الاستخدام (محمد 22 أكتوبر)
 * ===================================================
 * - الموقع يجمع العدّادات في الجهاز ويرسلها بطلب واحد عند إغلاقه أو تصغيره (services/usage-log.js)، فيضيفها الخادم إلى صف
 *   العضو لليوم أو ينشئه. أعداد فقط: لا إحداثيات ولا أرقام محطات.
 * - كل إرسال برقم فريد (opKey) يُحفظ 6 ساعات داخل القفل، فإعادة الإرسال بعد ضياع الرد لا تُضاعف العدّ.
 * - الجدول يُنشأ تلقائيًا مع المخطط (إضافة فقط)، وإنشاء_سجل_الاستخدام_اليومي() للتشغيل اليدوي من المحرر.
 *
 * The daily usage log: one row per member per day with usage counters (Mohammed, 22 Oct). The site gathers the counters on
 * the device and sends them in one request when it's closed or minimized; the server adds them to the member's row for
 * the day or creates it. Counts only: no coordinates, no station numbers. Every send carries a unique key (opKey) kept
 * 6 hours inside the lock, so a resend after a lost reply never doubles a count. The table is created with the schema
 * (additive only); the function below runs it manually from the editor.
 * ===================================================
 */

const USAGE_OP_SECONDS = 21600;  // 6 ساعات: أطول بكثير من أي إعادة إرسال / 6 hours: far longer than any resend
const USAGE_MAX_COUNT = 100000;  // حد أعلى لكل عدّاد في إرسال واحد (حماية الشيت) / a cap per counter per send (sheet safety)
const USAGE_MAX_PAST_DAYS = 7;   // يوم سابق يُقبل حتى أسبوع (جهاز لم يتصل) / a past day is accepted up to a week back

/* العدّادات: مفتاح الموقع ← عمود الجدول — the counters: the site's key ← the table column */
const USAGE_COUNTERS = {
  opens: 'مرات الفتح', minutes: 'دقائق الاستخدام', offline: 'استخدام بدون إنترنت', search: 'عمليات البحث',
  foundLocal: 'وجدت من الجهاز', foundServer: 'وجدت من الخادم', notFound: 'غير موجودة', outage: 'بحث الأعطال',
  nav: 'الملاحة', navMinutes: 'دقائق الملاحة', google: 'قوقل ماب', share: 'مشاركة', viewData: 'البيانات',
  viewStations: 'المحطات', viewMore: 'المزيد', details: 'التفاصيل', nearby: 'قريب', feeder: 'مغذي', ruler: 'القياس'
};
/* نصوص آخر قيمة (الجهاز والمتصفح وطريقة الفتح) — the last-value texts */
const USAGE_TEXTS = { device: 'الجهاز', browser: 'المتصفح', standalone: 'تطبيق مثبت' };

/* اليوم المرسل إن كان صالحًا وحديثًا، وإلا اليوم — the sent day if valid and recent, else today */
function usageDay_(day) {
  const today = riyadhDay_(new Date());
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) return today;
  const oldest = riyadhDay_(new Date(Date.now() - USAGE_MAX_PAST_DAYS * 86400000));
  return day < oldest ? today : day;
}

/* عدد صحيح موجب بحد أعلى — a capped non-negative integer */
function usageCount_(v) {
  const n = Math.floor(Number(v));
  return isFinite(n) && n > 0 ? Math.min(n, USAGE_MAX_COUNT) : 0;
}

/**
 * الإجراء logUsage — { day, counts: { opens, minutes, … }, meta: { device, browser, standalone }, opKey }
 * يضيف العدّادات إلى صف العضو لليوم (أو ينشئه) ويُرجع { success: true }. auth.phone من التحقق (عضو موجود).
 * Adds the counters to the member's row for the day (or creates it). auth.phone comes from the access check.
 */
function logUsage(data, auth) {
  const phone = formatPhone(auth && auth.phone);
  if (!phone) return { error: MSG.LOGIN_REQUIRED };
  const counts = data && typeof data.counts === 'object' && !Array.isArray(data.counts) ? data.counts : {};
  const meta = data && typeof data.meta === 'object' && !Array.isArray(data.meta) ? data.meta : {};
  const opKey = typeof data.opKey === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(data.opKey) ? data.opKey : '';
  const day = usageDay_(data.day), key = day + ' ' + phone;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { error: 'الخادم مشغول، حاول لاحقًا' };
  try {
    const cache = CacheService.getScriptCache(), opCacheKey = opKey ? 'usage_op_' + opKey : '';
    if (opCacheKey && cache.get(opCacheKey)) return { success: true, duplicate: true }; // أُضيف من قبل / already added
    const sheet = sheet_(SHEETS.USAGE), headers = HEADERS[SHEETS.USAGE], col = function (title) { return headers.indexOf(title); };
    const found = withSheetRetry_(function () {
      return sheet.getRange(2, col('مفتاح اليوم') + 1, Math.max(sheet.getLastRow() - 1, 1), 1).createTextFinder(key).matchEntireCell(true).findNext();
    });
    const row = found ? found.getRow() : 0;
    const values = row ? withSheetRetry_(function () { return sheet.getRange(row, 1, 1, headers.length).getValues()[0]; }) : headers.map(function () { return ''; });
    Object.keys(USAGE_COUNTERS).forEach(function (k) {
      const i = col(USAGE_COUNTERS[k]);
      values[i] = (Number(values[i]) || 0) + usageCount_(counts[k]);
    });
    Object.keys(USAGE_TEXTS).forEach(function (k) {
      if (meta[k] != null && String(meta[k]).trim()) values[col(USAGE_TEXTS[k])] = sanitizeSheetText_(String(meta[k]).slice(0, 60));
    });
    values[col('آخر تحديث')] = new Date();
    if (row) {
      withSheetRetry_(function () { sheet.getRange(row, 1, 1, headers.length).setValues([values]); });
    } else {
      const member = findMember_(phone);
      values[col('التاريخ')] = day; values[col('الجوال')] = phone; values[col('اسم العضو')] = member ? member.name : '';
      values[col('مفتاح اليوم')] = key;
      appendFormattedRow_(sheet, values, true);
    }
    if (opCacheKey) { try { cache.put(opCacheKey, '1', USAGE_OP_SECONDS); } catch (err) { /* لا يُفشل الطلب / never fails the request */ } }
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/* تشغيل يدوي من المحرر: إنشاء الجدول وأعمدته إن لم توجد (إضافة فقط، لا يمس أي بيانات) — آمن للتكرار
 * Manual run from the editor: create the table and its columns if missing (additive only, never touching data) — safe to repeat */
function إنشاء_سجل_الاستخدام_اليومي() {
  const report = applySchema_().filter(function (line) { return line.indexOf(SHEETS.USAGE) !== -1; });
  scriptProps_().setProperty(SCHEMA_FLAG_KEY, SCHEMA_VERSION);
  CacheService.getScriptCache().put(SCHEMA_FLAG_KEY, SCHEMA_VERSION, SCHEMA_CACHE_SECONDS);
  console.log(report.length ? report.join('\n') : 'سجل الاستخدام اليومي موجود ومطابق — لا تغيير');
}
