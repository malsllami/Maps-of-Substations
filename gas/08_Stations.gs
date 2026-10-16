/**
 * ===================================================
 * 08_Stations.gs — المحطات: الفهرس المخزّن وإجراءات القراءة
 * ===================================================
 * الفهرس نسخة خفيفة من الجدولين (الرقم الموحّد، المغذي، المنطقة، الإحداثيات، وقت آخر تعديل) محفوظة
 * بالكاش 30 دقيقة بأجزاء، فلا يدفع أي مستخدم ثمن قراءة ~50 ألف صف في كل طلب.
 * - طلب واحد فقط يبني الفهرس في أي لحظة (علامة «بناء جارٍ»)، والبقية تنتظره حتى 25 ث بدل البناء معه.
 * - قراءة بدأت قبل كتابة لا تُحفظ فوقها (الجيل + قفل المستند عند الحفظ والتحديث).
 * - بعد أي إضافة/تعديل/حذف يُحدَّث عنصر واحد فقط داخل الفهرس المخزّن بدل حذفه كله.
 * - «آخر تعديل» يُحسب من عمودي التاريخ والوقت سواء خزّنهما الشيت تاريخًا أو نصًا (dd/MM/yyyy و HH:mm[:ss]).
 * - الإحداثية غير الصالحة تُحفظ null صراحة (لا NaN يتحول لـ null بالكاش فيُحسب كصفر).
 * إجراءات القراءة: التحميل الكامل بدفعات، المزامنة التزايدية، البحث، القريبة، المغذي، وتحديث الفهرس.
 *
 * Stations: the cached index and the read actions. The index is a light copy of both tables cached
 * 30 minutes in chunks, so no user pays for reading ~50k rows on every request.
 * - Only one request builds it at any moment (a "build in progress" marker); the rest wait up to 25 s.
 * - A read that started before a write is never saved over it (generation + document lock on save/patch).
 * - After any add/edit/delete only one entry inside the cached index is patched, instead of dropping it.
 * - "Last modified" comes from the date and time columns whether the sheet stores them as dates or text.
 * - An invalid coordinate is stored as an explicit null (not NaN that the cache turns into null = zero).
 * Read actions: full load in batches, incremental sync, search, nearby, feeder, and index refresh.
 * ===================================================
 */

const INDEX_CACHE_SECONDS = 1800;
const INDEX_BUILD_MARKER_SECONDS = 60;
const INDEX_BUILD_WAIT_MS = 25000;
const INDEX_LOCK_WAIT_MS = 3000;
const INDEX_MANUAL_REFRESH_GAP_MS = 60 * 1000;   // زر «تحديث البيانات»: لا إعادة بناء أكثر من مرة كل دقيقة / at most one rebuild a minute
const INDEX_KEYS = { 'توزيع': 'idx_stations', 'تحويل': 'idx_substations' };
const STATIONS_BATCH_SIZE = 5000;
const SYNC_LOOKBACK_MS = 20 * 60 * 1000;          // أكبر من دورة المشغّل (10 د) + زمن البناء / larger than the trigger cycle + build time
const NEARBY_DEFAULT_KM = 2;

const STATION_MSG = {
  BAD_COORDINATE: 'إحداثية غير صحيحة',
  FEEDER_REQUIRED: 'اسم المغذي مطلوب',
  REFRESHED: 'تم تحديث فهرس المحطات من الشيت'
};

// ===== أدوات عامة — General helpers =====

/* توحيد رقم المحطة للمطابقة: أرقام عربية ← إنجليزية، وأحرف كبيرة — Normalize a station id for matching */
function normalizeStationId_(id) {
  return normalizeDigits_(String(id == null ? '' : id).trim()).toUpperCase();
}

/* الإحداثية رقمًا (الفاصلة العشرية العربية/الإنجليزية) أو NaN — A coordinate as a number, or NaN */
function parseCoordinate_(value) {
  if (value === null || value === undefined || value === '') return NaN;
  return Number(normalizeDigits_(String(value).trim()).replace(',', '.').replace('٫', '.'));
}

/* إحداثية صالحة رقمًا أو null — A valid coordinate as a number, or null */
function coordinateOrNull_(value) {
  const n = parseCoordinate_(value);
  return isFinite(n) ? n : null;
}

/* للعنصر إحداثيات صالحة؟ — Does the entry have valid coordinates? */
function hasCoordinates_(e) {
  return typeof e.lat === 'number' && typeof e.lng === 'number' && isFinite(e.lat) && isFinite(e.lng);
}

/* المسافة بالكيلومتر (هافرساين) — Distance in km (haversine) */
function haversineKm_(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* اسم الجدول ونوع أعمدته حسب نوع المحطة — The sheet name and column map for a station type */
function stationSheetName_(type) {
  return type === STATION_TYPE.DISTRIBUTION ? SHEETS.STATIONS : SHEETS.SUBSTATIONS;
}
function stationCols_(type) {
  return type === STATION_TYPE.DISTRIBUTION ? COL.STATION : COL.SUBSTATION;
}

/* وقت آخر تعديل (ميلي ثانية) من التاريخ والوقت، أو null — Last-modified ms from date and time, or null */
function rowMoment_(dateValue, timeValue) {
  let d = null;
  if (dateValue instanceof Date) d = new Date(dateValue.getTime());
  else {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dateValue || '').trim());
    if (m) d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) - 3 * 3600 * 1000); // منتصف ليل الرياض / Riyadh midnight
  }
  if (!d || isNaN(d)) return null;
  if (timeValue instanceof Date) {
    if (dateValue instanceof Date) d.setHours(timeValue.getHours(), timeValue.getMinutes(), timeValue.getSeconds());
    else d = new Date(d.getTime() + (timeValue.getHours() * 3600 + timeValue.getMinutes() * 60 + timeValue.getSeconds()) * 1000);
  } else {
    const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeValue || '').trim());
    if (t) {
      const secs = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3] || 0);
      if (dateValue instanceof Date) d.setHours(Number(t[1]), Number(t[2]), Number(t[3] || 0));
      else d = new Date(d.getTime() + secs * 1000);
    }
  }
  return isNaN(d) ? null : d.getTime();
}

// ===== الفهرس: البناء والقراءة — The index: build and read =====

/* عنصر فهرس من صف — An index entry from a row */
function indexEntry_(type, row) {
  const c = stationCols_(type);
  const id = row[c.ID];
  if (id === '' || id === null || id === undefined) return null;
  const entry = { id: String(id), n: normalizeStationId_(id), lat: coordinateOrNull_(row[c.LAT]), lng: coordinateOrNull_(row[c.LNG]), t: rowMoment_(row[c.DATE], row[c.TIME]) };
  if (type === STATION_TYPE.DISTRIBUTION) { entry.feeder = String(row[c.FEEDER] == null ? '' : row[c.FEEDER]); entry.region = String(row[c.REGION] == null ? '' : row[c.REGION]); }
  return entry;
}

/* بناء الفهرس من الشيت — Build the index from the sheet */
function buildIndex_(type) {
  const rows = readAllRows_(stationSheetName_(type));
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const e = indexEntry_(type, rows[i]);
    if (e) out.push(e);
  }
  return out;
}

/* الفهرس: عمر الطلب ← الكاش ← (انتظار بناء جارٍ) ← بناء وحفظ — The index: memo ← cache ← (wait for a running build) ← build and save */
function stationIndex_(type) {
  const key = INDEX_KEYS[type];
  if (requestMemo_[key]) return requestMemo_[key];
  let index = perfMeasure_('فهرس ' + type + ' — الكاش', function () { return getChunked_(key); }, function (r) { return r ? r.length + ' (مصاب)' : 'مفقود'; });
  if (!index) index = waitForRunningBuild_(type) || buildAndSaveIndex_(type);
  requestMemo_[key] = index;
  return index;
}

/* بناء جارٍ بطلب آخر ← انتظاره حتى 25 ث؛ يُرجع الفهرس أو null — A build running in another request ← wait up to 25 s */
function waitForRunningBuild_(type) {
  const key = INDEX_KEYS[type], cache = CacheService.getScriptCache();
  if (!cache.get(key + '_building')) return null;
  const deadline = Date.now() + INDEX_BUILD_WAIT_MS;
  while (Date.now() < deadline) {
    Utilities.sleep(1000);
    const ready = getChunked_(key);
    if (ready) { perfNote_('فهرس ' + type, 'بناه طلب آخر'); return ready; }
    if (!cache.get(key + '_building')) break;
  }
  return null;
}

/* بناء من الشيت تحت علامة «بناء جارٍ» ثم حفظ إن لم تقع كتابة أثناءه — Build under the marker, then save unless a write happened meanwhile */
function buildAndSaveIndex_(type) {
  const key = INDEX_KEYS[type], cache = CacheService.getScriptCache(), marker = key + '_building';
  cache.put(marker, '1', INDEX_BUILD_MARKER_SECONDS);
  try {
    const genBefore = cacheGen_(key);
    const index = perfMeasure_('فهرس ' + type + ' — بناء من الشيت', function () { return buildIndex_(type); }, function (r) { return r.length + ' محطة'; });
    saveIndexIfUnchanged_(key, index, genBefore);
    return index;
  } finally {
    cache.remove(marker);
  }
}

/* الحفظ تحت قفل المستند: لا يقع بين كتابة وتحديثها للفهرس — Save under the document lock: never between a write and its index patch */
function saveIndexIfUnchanged_(key, index, genBefore) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(INDEX_LOCK_WAIT_MS)) return false;
  try {
    if (cacheGen_(key) !== genBefore) return false;
    putChunked_(key, index, INDEX_CACHE_SECONDS);
    CacheService.getScriptCache().put(key + '_built', String(Date.now()), INDEX_CACHE_SECONDS);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/* منطقة كل محطة توزيع (للملف الشخصي ونشاط المناطق): أول صف يفوز — Each distribution station's region: the first row wins */
function stationRegions_() {
  const map = {};
  stationIndex_(STATION_TYPE.DISTRIBUTION).forEach(function (e) { if (!(e.n in map)) map[e.n] = e.region || ''; });
  return map;
}

// ===== تحديث عنصر واحد بعد كتابة — Patch one entry after a write =====

/* op: 'add' | 'replace' | 'remove'. يعدّل جزءًا واحدًا من الفهرس المخزّن؛ أي شك ← حذف الفهرس فيُبنى من الشيت.
 * الجيل يُرفع أولًا فلا يحفظ بناءٌ بدأ قبل الكتابة نسخته القديمة.
 * Edits one chunk of the cached index; any doubt ← drop the index so it is rebuilt from the sheet.
 * The generation is bumped first so a build that started before the write never saves its stale copy. */
function patchIndex_(type, op, entry, n) {
  const key = INDEX_KEYS[type];
  return perfMeasure_('فهرس ' + type + ' — تحديث العنصر', function () {
    const lock = LockService.getDocumentLock();
    const locked = lock.tryLock(INDEX_LOCK_WAIT_MS);
    try {
      bumpGen_(key);
      delete requestMemo_[key];
      if (!locked) { dropIndex_(key); return 'حذف (تعذّر القفل)'; }
      const outcome = patchChunks_(key, op, entry, n);
      if (outcome !== 'تم' && outcome !== 'لا يوجد كاش') { dropIndex_(key); return 'حذف (' + outcome + ')'; }
      return outcome;
    } catch (err) {
      dropIndex_(key);
      return 'حذف (خطأ: ' + err + ')';
    } finally {
      if (locked) lock.releaseLock();
    }
  }, function (o) { return o; });
}

function bumpGen_(key) {
  CacheService.getScriptCache().put(key + '_gen', String(Date.now()) + Math.random().toString(36).slice(2, 6), 21600);
}

function dropIndex_(key) {
  bumpGen_(key);
  delete requestMemo_[key];
  CacheService.getScriptCache().remove(key + '_meta');
}

/* التعديل الفعلي على الأجزاء — The actual chunk edit */
function patchChunks_(key, op, entry, n) {
  const cache = CacheService.getScriptCache();
  const meta = JSON.parse(cache.get(key + '_meta') || 'null');
  if (!meta) return 'لا يوجد كاش';
  const keys = [];
  for (let i = 0; i < meta.chunks; i++) keys.push(key + '_c' + i);
  const parts = cache.getAll(keys);
  for (let i = 0; i < keys.length; i++) if (!parts[keys[i]]) return 'جزء مفقود';
  const payload = {};

  if (op === 'add') {
    const last = keys[keys.length - 1], entryJson = JSON.stringify(entry);
    if (parts[last].length + entryJson.length + 1 <= CACHE_CHUNK_CHARS) {
      const chunk = JSON.parse(parts[last]); chunk.push(entry); payload[last] = JSON.stringify(chunk);
      payload[key + '_meta'] = JSON.stringify({ chunks: meta.chunks, total: meta.total + 1 });
    } else {
      payload[key + '_c' + meta.chunks] = JSON.stringify([entry]);
      payload[key + '_meta'] = JSON.stringify({ chunks: meta.chunks + 1, total: meta.total + 1 });
    }
    cache.putAll(payload, INDEX_CACHE_SECONDS);
    return 'تم';
  }

  // التعديل والحذف يصيبان أول صف بالرقم = أول عنصر به (الفهرس بترتيب الصفوف)
  // Edit and delete hit the first row with the id = its first entry (the index follows row order)
  const needle = '"n":' + JSON.stringify(n) + ',';
  for (let i = 0; i < keys.length; i++) {
    if (parts[keys[i]].indexOf(needle) === -1) continue;
    const chunk = JSON.parse(parts[keys[i]]);
    for (let j = 0; j < chunk.length; j++) {
      if (chunk[j].n !== n) continue;
      if (op === 'replace') chunk[j] = entry; else chunk.splice(j, 1);
      const raw = JSON.stringify(chunk);
      if (raw.length > CACHE_CHUNK_CHARS) return 'جزء أكبر من الحد الآمن';
      payload[keys[i]] = raw;
      if (op === 'remove') payload[key + '_meta'] = JSON.stringify({ chunks: meta.chunks, total: meta.total - 1 });
      cache.putAll(payload, INDEX_CACHE_SECONDS);
      return 'تم';
    }
  }
  return 'العنصر غير موجود';
}

// ===== إجراءات القراءة — Read actions =====

/* محطة بشكل الرد الموحّد — A station in the uniform reply shape */
function stationReply_(type, e) {
  const dist = type === STATION_TYPE.DISTRIBUTION;
  return {
    id: e.id, type: type, name: (dist ? 'محطة توزيع ' : 'محطة تحويل ') + e.id + (dist && e.region ? ' — ' + e.region : ''),
    lat: e.lat, lng: e.lng, region: dist ? e.region : '', feeder: dist ? e.feeder : ''
  };
}

/* كل المحطات (التوزيع ثم التحويل) بالشكل الخفيف — All stations (distribution then substations), light shape */
function allStationsLight_() {
  const out = [];
  stationIndex_(STATION_TYPE.DISTRIBUTION).forEach(function (e) { out.push([e.id, STATION_TYPE.DISTRIBUTION, e.feeder, e.region, e.lat, e.lng]); });
  stationIndex_(STATION_TYPE.SUBSTATION).forEach(function (e) { out.push([e.id, STATION_TYPE.SUBSTATION, '', '', e.lat, e.lng]); });
  return out;
}

/* التحميل الكامل بدفعات 5000 — compact: كل محطة [id, type, feeder, region, lat, lng] بدل كائن يكرر أسماء المفاتيح
 * Full load in batches of 5000 — compact: each station [id, type, feeder, region, lat, lng] instead of an object */
function getAllStations(data) {
  const offset = Math.max(0, Math.floor(Number(data.offset) || 0)), compact = data.compact === true;
  const all = allStationsLight_();
  let batch = all.slice(offset, offset + STATIONS_BATCH_SIZE);
  if (!compact) batch = batch.map(function (s) { return { id: s[0], type: s[1], feeder: s[2], region: s[3], lat: s[4], lng: s[5] }; });
  return {
    success: true, compact: compact, stations: batch, totalCount: all.length,
    nextOffset: offset + STATIONS_BATCH_SIZE < all.length ? offset + STATIONS_BATCH_SIZE : null,
    version: getDataVersion().version
  };
}

/* المزامنة التزايدية: ما تغيّر منذ آخر مزامنة (مع نافذة رجوع 20 دقيقة) + العدد الكلي للمقارنة
 * Incremental sync: what changed since the last sync (with a 20-minute lookback) + the total count to compare */
function getUpdatedStationsSince(data) {
  const sinceMs = data.since ? new Date(data.since).getTime() - SYNC_LOOKBACK_MS : NaN;
  const manual = readManualChanges_(); // تعديلات يدوية في الشيت اكتشفها المشغّل (بلا تاريخ تعديل) / manual sheet edits found by the trigger
  const changed = function (type, e) {
    if (e.t !== null && e.t !== undefined && (isNaN(sinceMs) || e.t > sinceMs)) return true;
    const at = manual[type + '|' + e.n];
    return !!at && (isNaN(sinceMs) || at > sinceMs);
  };
  const dist = stationIndex_(STATION_TYPE.DISTRIBUTION), sub = stationIndex_(STATION_TYPE.SUBSTATION);
  const updated = [];
  dist.forEach(function (e) { if (changed(STATION_TYPE.DISTRIBUTION, e)) updated.push({ id: e.id, type: STATION_TYPE.DISTRIBUTION, feeder: e.feeder, region: e.region, lat: e.lat, lng: e.lng }); });
  sub.forEach(function (e) { if (changed(STATION_TYPE.SUBSTATION, e)) updated.push({ id: e.id, type: STATION_TYPE.SUBSTATION, feeder: '', region: '', lat: e.lat, lng: e.lng }); });
  perfNote_('المتغيّرة', updated.length);
  return { success: true, updated: updated, serverTime: new Date().toISOString(), version: getDataVersion().version, totalCount: dist.length + sub.length };
}

/* البحث برقم المحطة (أرقام عربية/إنجليزية، أحرف كبيرة/صغيرة): التوزيع أولًا ثم التحويل
 * Search by station number: distribution first, then substations */
function searchStation(data) {
  const q = normalizeStationId_(data.query);
  if (!q) return { found: false };
  const types = [STATION_TYPE.DISTRIBUTION, STATION_TYPE.SUBSTATION];
  for (let t = 0; t < types.length; t++) {
    const index = stationIndex_(types[t]);
    for (let i = 0; i < index.length; i++) {
      if (index[i].n === q) return Object.assign({ found: true }, stationReply_(types[t], index[i]));
    }
  }
  // بمفتاح المطابقة (نفس utils/text-input.js stationKey): «mdn 2» ← MDN2، «ANS1» ← «ANS 1»، «2283» ← «2283-»
  // By the match key (same as the browser's stationKey)
  const key = stationKey_(q);
  if (key) {
    for (let t = 0; t < types.length; t++) {
      const index = stationIndex_(types[t]);
      for (let i = 0; i < index.length; i++) {
        if (stationKey_(index[i].n) === key) return Object.assign({ found: true }, stationReply_(types[t], index[i]));
      }
    }
  }
  return { found: false };
}

/* مفتاح مطابقة رقم المحطة: بلا مسافات ولا شرطة في الطرفين — The station id match key: no spaces, no edge dashes */
function stationKey_(id) {
  return normalizeStationId_(id).replace(/[‐-―−]/g, '-').replace(/\s+/g, '').replace(/^-+|-+$/g, '');
}

/* المحطات القريبة (افتراضيًا 2 كم) الأقرب أولًا — Nearby stations (2 km by default), nearest first */
function getNearbyStations(data) {
  const lat = parseCoordinate_(data.lat), lng = parseCoordinate_(data.lng);
  if (!isFinite(lat) || !isFinite(lng)) return { error: STATION_MSG.BAD_COORDINATE };
  const asked = Number(data.radiusKm), radius = isFinite(asked) && asked > 0 ? asked : NEARBY_DEFAULT_KM;
  const results = [];
  [STATION_TYPE.DISTRIBUTION, STATION_TYPE.SUBSTATION].forEach(function (type) {
    stationIndex_(type).forEach(function (e) {
      if (!hasCoordinates_(e)) return;
      const d = haversineKm_(lat, lng, e.lat, e.lng);
      if (d <= radius) results.push(Object.assign(stationReply_(type, e), { distanceKm: Math.round(d * 100) / 100 }));
    });
  });
  results.sort(function (a, b) { return a.distanceKm - b.distanceKm; });
  return { success: true, stations: results };
}

/* محطات مغذٍّ (تطابق تام بعد إزالة المسافات الطرفية) — A feeder's stations (exact match after trimming) */
function getFeederStations(data) {
  const feeder = String(data.feeder == null ? '' : data.feeder).trim();
  if (!feeder) return { error: STATION_MSG.FEEDER_REQUIRED };
  const results = [];
  stationIndex_(STATION_TYPE.DISTRIBUTION).forEach(function (e) {
    if (String(e.feeder || '').trim() === feeder && hasCoordinates_(e)) results.push(stationReply_(STATION_TYPE.DISTRIBUTION, e));
  });
  return { success: true, stations: results };
}

/* زر «تحديث البيانات»: إعادة بناء الفهرس فوق النسخة الحالية (القرّاء يستمرون عليها حتى تُستبدل)؛
 * فهرس بُني خلال آخر دقيقة لا يُعاد، وبناء جارٍ يُنتظر ولا يُكرر.
 * The «refresh data» button: rebuild over the current copy (readers keep using it until replaced);
 * an index built within the last minute isn't rebuilt, and a running build is awaited, not repeated. */
function clearSearchCache() {
  [STATION_TYPE.DISTRIBUTION, STATION_TYPE.SUBSTATION].forEach(refreshIndexInPlace_);
  return { success: true, message: STATION_MSG.REFRESHED };
}

function refreshIndexInPlace_(type) {
  const key = INDEX_KEYS[type], cache = CacheService.getScriptCache();
  const builtAt = Number(cache.get(key + '_built') || 0);
  if (builtAt && Date.now() - builtAt < INDEX_MANUAL_REFRESH_GAP_MS) { perfNote_('فهرس ' + type, 'تخطٍّ: بُني قبل ' + Math.round((Date.now() - builtAt) / 1000) + ' ث'); return; }
  if (cache.get(key + '_building')) { waitForRunningBuild_(type); return; }
  requestMemo_[key] = buildAndSaveIndex_(type);
}

// ===== المشغّل الزمني — Time trigger =====

/* يعيد بناء الفهرسين كل 10 دقائق بتنفيذ منفصل (لا ينتظره أي مستخدم)؛ يظهر التعديل اليدوي بالشيت خلال 10 دقائق.
 * بناء جارٍ بطلب آخر ← يُتخطى هذا الفهرس.
 * Rebuilds both indexes every 10 minutes in a separate execution (no user waits); manual sheet edits show within 10 minutes.
 * A build already running elsewhere ← this index is skipped. */
function refreshStationIndexesInBackground() {
  const manualKeys = [];
  [STATION_TYPE.DISTRIBUTION, STATION_TYPE.SUBSTATION].forEach(function (type) {
    const start = Date.now();
    try {
      if (CacheService.getScriptCache().get(INDEX_KEYS[type] + '_building')) { console.log('فهرس ' + type + ': تخطٍّ (بناء جارٍ)'); return; }
      const before = getChunked_(INDEX_KEYS[type]); // الفهرس الحالي (يشمل كتابات الموقع) قبل إعادة البناء / the current index, before the rebuild
      const index = buildAndSaveIndex_(type);
      const diff = before ? indexDiff_(before, index) : [];
      diff.forEach(function (n) { manualKeys.push(type + '|' + n); });
      console.log('فهرس ' + type + ' بالخلفية: ' + index.length + ' محطة | ' + (Date.now() - start) + ' ms' + (diff.length ? ' | تعديل يدوي: ' + diff.length : ''));
    } catch (err) {
      logError_('refreshStationIndexesInBackground', String(err), type);
    }
  });
  // تعديل يدوي في الشيت ← يُسجَّل ويُرفع الإصدار فتجلبه الأجهزة (اعتماد محمد 16 أكتوبر) — manual edit ← recorded and the version bumped
  if (manualKeys.length) { recordManualChanges_(manualKeys); bumpDataVersion_(); }
  countTriggerPropOps_(); // عمليات الخصائص لهذا التشغيل ضمن عدّاد اليوم / this run's property operations into today's counter
}

// ===== التعديل اليدوي في الشيت — Manual sheet edits =====
/* لا يغيّر أي خلية في الشيت: يحفظ أرقام المحطات المعدّلة يدويًا ووقت اكتشافها في خاصية للسكربت، فتدخل «المتغيّر» في المزامنة
 * Never changes a sheet cell: keeps the manually edited station numbers and when they were found in a script property */
const MANUAL_CHANGES_KEY = 'manual_station_changes';
const MANUAL_CHANGES_MAX = 300;                       // حد حماية لحجم الخاصية / a cap protecting the property size
const MANUAL_CHANGES_KEEP_MS = 2 * 24 * 3600 * 1000;  // يومان: جهاز غاب أكثر يحمّل كاملًا عند اختلاف العدد أو يتلقاها من الإصدار / two days

/* المحطات الجديدة أو التي تغيّرت إحداثياتها/مغذيها/منطقتها بين فهرسين — stations new or changed between two indexes */
function indexDiff_(before, after) {
  const sig = function (e) { return [e.lat, e.lng, e.feeder || '', e.region || ''].join('|'); };
  const old = {};
  before.forEach(function (e) { old[e.n] = sig(e); });
  const out = [];
  after.forEach(function (e) { if (old[e.n] !== sig(e)) out.push(e.n); });
  return out;
}
function readManualChanges_() {
  try { return JSON.parse(scriptProps_().getProperty(MANUAL_CHANGES_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function recordManualChanges_(keys) {
  const map = readManualChanges_(), now = Date.now();
  keys.forEach(function (k) { map[k] = now; });
  const kept = Object.keys(map).filter(function (k) { return now - map[k] < MANUAL_CHANGES_KEEP_MS; })
    .sort(function (a, b) { return map[b] - map[a]; }).slice(0, MANUAL_CHANGES_MAX);
  const out = {};
  kept.forEach(function (k) { out[k] = map[k]; });
  scriptProps_().setProperty(MANUAL_CHANGES_KEY, JSON.stringify(out));
}

/* تثبيت المشغّل يدويًا من المحرر (مرة واحدة): يحذف أي نسخة سابقة فلا يتكرر، ثم يبني الفهرس فورًا
 * Install the trigger manually from the editor (once): removes any previous copy so it never duplicates, then builds right away */
function تثبيت_مشغل_الفهرس() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshStationIndexesInBackground') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshStationIndexesInBackground').timeBased().everyMinutes(10).create();
  refreshStationIndexesInBackground();
  console.log('تم تثبيت مشغّل الفهرس كل 10 دقائق');
}
