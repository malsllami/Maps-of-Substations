/**
 * ===================================================
 * 05_Cache.gs — الكاش ورقم إصدار البيانات
 * ===================================================
 * - كاش مجزّأ: البيانات الكبيرة تُقسَّم لأجزاء آمنة الحجم (حد جوجل 100 كيلوبايت للمفتاح).
 * - كاش عمر الطلب: لا تُقرأ نفس البيانات من CacheService مرتين في طلب واحد.
 * - جيل لكل كاش: قراءة بدأت قبل كتابة لا تُحفظ فوقها (لا تعود بيانات قديمة بعد تعديل).
 * - الإبطال فور أي كتابة. الكاش وسيلة تسريع فقط، والشيت هو المصدر دائمًا.
 * - رقم الإصدار يتغير مع كل تغيير في المحطات، فيعرف المتصفح بطلب صغير هل نسخته مطابقة.
 *
 * Cache and data version:
 * - Chunked cache: large data is split into safe-size chunks (Google's limit is 100 KB per key).
 * - Request-scoped cache: the same data is never read from CacheService twice in one request.
 * - A generation per cache: a read that started before a write is never saved over it.
 * - Invalidated on every write. The cache only speeds things up; the sheet is always the source.
 * - The version changes with every station change, so one small request tells the browser if its copy matches.
 * ===================================================
 */

const CACHE_CHUNK_CHARS = 40000;   // هامش واسع تحت 100 كيلوبايت مع تمدد العربية في UTF-8 / wide margin under 100 KB with Arabic UTF-8 growth
const ROWS_CACHE_SECONDS = 300;    // الجداول الصغيرة (الأعضاء، الإعدادات، البصمات) 5 دقائق / small tables 5 minutes
const DATA_VERSION_KEY = 'data_version';

let requestMemo_ = {}; // كاش عمر الطلب / request-scoped cache

/* حفظ مصفوفة بأجزاء — Save an array in chunks */
function putChunked_(key, arr, ttlSeconds) {
  const payload = {};
  let chunk = [], size = 2, count = 0;
  const flush = function () { payload[key + '_c' + count] = JSON.stringify(chunk); count++; chunk = []; size = 2; };
  arr.forEach(function (item) {
    const itemSize = JSON.stringify(item).length + 1;
    if (chunk.length && size + itemSize > CACHE_CHUNK_CHARS) flush();
    chunk.push(item); size += itemSize;
  });
  if (chunk.length || !count) flush();
  payload[key + '_meta'] = JSON.stringify({ chunks: count, total: arr.length });
  try { CacheService.getScriptCache().putAll(payload, ttlSeconds); } catch (err) { /* فشل الحفظ لا يُفشل الطلب / a save failure never fails the request */ }
}

/* قراءة مصفوفة مجزّأة أو null إن نقص أي جزء — Read a chunked array, or null if any chunk is missing */
function getChunked_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const meta = JSON.parse(cache.get(key + '_meta') || 'null');
    if (!meta) return null;
    const keys = [];
    for (let i = 0; i < meta.chunks; i++) keys.push(key + '_c' + i);
    const parts = cache.getAll(keys);
    const out = [];
    for (let i = 0; i < meta.chunks; i++) {
      if (!parts[keys[i]]) return null;
      Array.prototype.push.apply(out, JSON.parse(parts[keys[i]]));
    }
    return out.length === meta.total ? out : null;
  } catch (err) {
    return null; // كاش تالف ← يُقرأ من الشيت / a broken cache ← read from the sheet
  }
}

function cacheGen_(key) {
  return CacheService.getScriptCache().get(key + '_gen') || '0';
}

/* صفوف جدول صغير: عمر الطلب ← الكاش ← الشيت (ثم تُحفظ إن لم يتغير الجيل أثناء القراءة)
 * A small table's rows: request memo ← cache ← sheet (then saved if the generation didn't change during the read) */
function cachedRows_(cacheKey, sheetName) {
  if (requestMemo_[cacheKey]) return requestMemo_[cacheKey];
  let rows = perfMeasure_('كاش ' + sheetName, function () { return getChunked_(cacheKey); }, function (r) { return r ? 'مصاب' : 'مفقود'; });
  if (!rows) {
    const genBefore = cacheGen_(cacheKey);
    rows = perfMeasure_('قراءة شيت ' + sheetName, function () { return JSON.parse(JSON.stringify(readAllRows_(sheetName))); }, function (r) { return r.length + ' صف'; });
    if (cacheGen_(cacheKey) === genBefore) putChunked_(cacheKey, rows, ROWS_CACHE_SECONDS);
  }
  requestMemo_[cacheKey] = rows;
  return rows;
}

/* إبطال كاش بعد كتابة — Invalidate a cache after a write */
function invalidateCache_(cacheKey) {
  delete requestMemo_[cacheKey];
  const cache = CacheService.getScriptCache();
  cache.put(cacheKey + '_gen', String(Date.now()) + Math.random().toString(36).slice(2, 6), 21600);
  cache.remove(cacheKey + '_meta');
}

/* بداية كل طلب: كاش عمر الطلب فارغ — Start of every request: the request memo is empty */
function resetRequestMemo_() {
  requestMemo_ = {};
}

/* الإصدار الحالي (يُنشأ أول مرة) — The current version (created the first time) */
function getDataVersion() {
  const props = scriptProps_();
  let version = props.getProperty(DATA_VERSION_KEY);
  if (!version) {
    version = String(Date.now());
    props.setProperty(DATA_VERSION_KEY, version);
  }
  return { success: true, version: version };
}

/* رفع الإصدار بعد أي تغيير في المحطات — Bump the version after any station change */
function bumpDataVersion_() {
  scriptProps_().setProperty(DATA_VERSION_KEY, String(Date.now()));
}
