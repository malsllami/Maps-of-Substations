/**
 * ===================================================
 * 04_Schema.gs — مخطط الشيت: إنشاء الناقص وتصحيح العناوين (إضافة فقط)
 * ===================================================
 * - ينشئ أي جدول ناقص بعناوينه، ويضيف أي عمود ناقص في آخر الجدول.
 * - يصحح نص العنوان المخالف لقاعدة التسمية (عربي فقط، مسافة واحدة) في الصف الأول فقط —
 *   لا يمس أي بيانات أسفله، ولا يحذف جدولًا أو عمودًا أبدًا.
 * - يضيف مفاتيح القوائم الناقصة في «الإعدادات» بقيمها الابتدائية (لا يغيّر مفتاحًا موجودًا).
 * يعمل تلقائيًا مع أول طلب ثم لا يتكرر (علم في خصائص السكربت + كاش 6 ساعات يغني عن قراءته في كل طلب).
 *
 * Sheet schema: create what's missing and fix headers (additive only).
 * - Creates any missing table with its headers, and appends any missing column at the end.
 * - Fixes header text that breaks the naming rule (Arabic only, one space) in row 1 only — never
 *   touches data below it, never deletes a table or column.
 * - Adds missing list keys to «الإعدادات» with their initial values (never changes an existing key).
 * Runs automatically with the first request, then never again (a Script Properties flag + a 6-hour
 * cache that saves reading it on every request).
 * ===================================================
 */

const SCHEMA_VERSION = 'v2-1';
const SCHEMA_FLAG_KEY = 'schema_version';
const SCHEMA_CACHE_SECONDS = 21600;

/* يُستدعى مع كل طلب: كاش ← خاصية ← تهيئة (مرة واحدة فقط) — Called on every request: cache ← property ← setup (once only) */
function ensureSchema_() {
  const cache = CacheService.getScriptCache();
  if (cache.get(SCHEMA_FLAG_KEY) === SCHEMA_VERSION) return 'جاهز (كاش)';
  const props = scriptProps_();
  if (props.getProperty(SCHEMA_FLAG_KEY) !== SCHEMA_VERSION) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return 'تأجيل: تهيئة جارية بطلب آخر';
    try {
      if (props.getProperty(SCHEMA_FLAG_KEY) !== SCHEMA_VERSION) {
        applySchema_();
        props.setProperty(SCHEMA_FLAG_KEY, SCHEMA_VERSION);
      }
    } finally {
      lock.releaseLock();
    }
  }
  cache.put(SCHEMA_FLAG_KEY, SCHEMA_VERSION, SCHEMA_CACHE_SECONDS);
  return 'جاهز';
}

/* تشغيل يدوي من المحرر لإعادة التحقق من المخطط في أي وقت (آمن للتكرار) — Manual run from the editor to re-check the schema any time (safe to repeat) */
function تهيئة_المخطط() {
  const report = applySchema_();
  scriptProps_().setProperty(SCHEMA_FLAG_KEY, SCHEMA_VERSION);
  CacheService.getScriptCache().put(SCHEMA_FLAG_KEY, SCHEMA_VERSION, SCHEMA_CACHE_SECONDS);
  console.log(report.length ? report.join('\n') : 'المخطط مطابق — لا تغيير');
}

/* التهيئة الفعلية — يُرجع قائمة بما تغيّر — The actual setup — returns a list of what changed */
function applySchema_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const changes = [];
  Object.keys(HEADERS).forEach(function (name) {
    const wanted = HEADERS[name];
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, wanted.length).setValues([wanted]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      changes.push('أُنشئ الجدول: ' + name);
      return;
    }
    const width = Math.max(sheet.getLastColumn(), 1);
    const current = sheet.getRange(1, 1, 1, width).getValues()[0];
    wanted.forEach(function (title, i) {
      if (i >= current.length || current[i] === '') {
        sheet.getRange(1, i + 1).setValue(title).setFontWeight('bold');
        changes.push(name + ': أُضيف العمود «' + title + '»');
      } else if (String(current[i]) !== title && normalizeHeader_(current[i]) === normalizeHeader_(title)) {
        sheet.getRange(1, i + 1).setValue(title);
        changes.push(name + ': صُحّح العنوان «' + String(current[i]).replace(/\s+/g, ' ') + '» ← «' + title + '»');
      } else if (String(current[i]) !== title && isLegacyMapHeader_(current[i]) && title === 'رابط قوقل ماب') {
        sheet.getRange(1, i + 1).setValue(title);
        changes.push(name + ': صُحّح العنوان «' + current[i] + '» ← «' + title + '»');
      }
    });
  });
  changes.push.apply(changes, ensureSettingDefaults_(ss.getSheetByName(SHEETS.SETTINGS)));
  return changes;
}

/* مقارنة العناوين بعد توحيد المسافات والأسطر — Compare headers after normalizing spaces and line breaks */
function normalizeHeader_(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

/* العنوان الإنجليزي القديم لعمود رابط الخريطة — The old English header of the map-link column */
function isLegacyMapHeader_(value) {
  return normalizeHeader_(value).toLowerCase() === 'google map';
}

/* إضافة مفاتيح القوائم الناقصة فقط — Add only the missing list keys */
function ensureSettingDefaults_(sheet) {
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues() : [];
  const existing = rows.map(function (r) { return String(r[COL.SETTING.KEY]).trim(); });
  const added = [];
  Object.keys(SETTING_DEFAULTS).forEach(function (key) {
    if (existing.indexOf(key) !== -1) return;
    appendFormattedRow_(sheet, [key, SETTING_DEFAULTS[key]], true); // تهيئة المخطط تملك القفل / schema setup holds the lock
    added.push('الإعدادات: أُضيف المفتاح «' + key + '»');
  });
  return added;
}
