/* ============================================================
 * services/offline-map.js — إدارة بيانات خريطة جدة بدون إنترنت فقط (بلا رسم ولا خريطة مرئية)
 * ============================================================
 * 1) المعلومات: الخريطة المتاحة من maps/jeddah.json (الإصدار، الحجم الحقيقي، بصمة SHA-256) قبل أي تنزيل.
 * 2) التنزيل بموافقة المستخدم فقط، بأجزاء 1 ميجابايت (Range) إلى IndexedDB (sec2-offline-map)؛ كل جزء يُتحقق من طوله قبل
 *    حفظه. Wi‑Fi والبيانات الخلوية مسموحان (wifiOnly اختياري حسب اختيار المستخدم).
 * 3) الاستكمال: بعد إيقاف يدوي، أو انقطاع الشبكة، أو إغلاق الصفحة — يكمل من آخر جزء محفوظ ما دام الإصدار على الموقع نفسه
 *    (الحجم والبصمة). صدور إصدار أحدث ← تُحذف الأجزاء المؤقتة القديمة ويبدأ من الصفر.
 * 4) التحقق قبل الاعتماد: الحجم + رأس الملف (PMTiles v3) + SHA-256. فشل التحقق ← رفض النسخة الجديدة وحذف أجزائها المؤقتة،
 *    والتنزيل التالي من الصفر.
 * 5) التحديث بأمان: الإصدار الجديد يُنزَّل بجانب القديم؛ القديم يبقى صالحًا ومستخدمًا حتى يُعتمد الجديد بعد التحقق كاملًا،
 *    ثم يُبدَّل إليه (عملية واحدة)، ثم تُحذف أجزاء القديم. أي بقايا (انقطاع بين الخطوتين) تُنظَّف في التنزيل التالي.
 * 6) تنزيل واحد فقط في أي لحظة: داخل الصفحة، وبين التبويبات (Web Locks إن توفرت).
 * 7) القراءة: openSource() مصدر بيانات يقرأ أي نطاق من الملف المحفوظ لمكتبة pmtiles — الرسم نفسه في مكوّن العرض.
 *
 * Offline Jeddah map data management only (no drawing, no visible map):
 * 1) Info: the available map from maps/jeddah.json (version, real size, SHA-256) before any download.
 * 2) Download with user consent only, in 1 MB parts (Range) into IndexedDB; each part's length is checked before it's saved.
 * 3) Resume: after a manual pause, a network drop, or the page closing — continues from the last saved part as long as the
 *    site still offers the same version (size and fingerprint). A newer version ← old temporary parts deleted, start over.
 * 4) Verify before committing: size + file header + SHA-256. A failed check ← the new copy is rejected and its temporary
 *    parts deleted; the next download starts from zero.
 * 5) Safe update: the new version downloads beside the old one, which stays valid and in use until the new one is fully
 *    verified and committed, then switched to (one transaction), then the old parts are deleted. Leftovers are cleaned next time.
 * 6) One download at a time: within the page and across tabs (Web Locks when available).
 * 7) Reading: openSource() is a data source serving any range of the saved file to pmtiles — drawing lives in the view component.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('offline-map.js يحتاج config/الإعدادات.js قبله / needs config/الإعدادات.js loaded first');
  const META_URL = 'maps/jeddah.json';
  const DB_NAME = CONFIG.DB_NAMES.OFFLINE_MAP;
  const DB_VERSION = 1;
  const MAP_KEY = 'jeddah';
  const LOCK_NAME = CONFIG.STORAGE_PREFIX + 'offline-map-download';
  const CHUNK_BYTES = 1024 * 1024;   // جزء 1 ميجابايت / 1 MB parts
  const CHUNK_TIMEOUT_MS = 30000;    // جزء لم يكتمل خلال 30 ث = انقطاع / a part not done in 30 s = an interruption
  const LOG_MAX = 20;

  // ===== IndexedDB: meta (الحالة والسجلات) + chunks (أجزاء الملف بمفتاح «الإصدار:الرقم») =====
  let dbPromise = null;
  function db_() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!global.indexedDB) return reject(new Error('IndexedDB غير متاح'));
        let req;
        try { req = global.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); }
        req.onupgradeneeded = function () {
          const d = req.result;
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
          if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks');
        };
        req.onsuccess = function () { const d = req.result; d.onversionchange = function () { d.close(); dbPromise = null; }; resolve(d); };
        req.onerror = function () { reject(req.error); };
      });
      dbPromise.catch(function () { dbPromise = null; });
    }
    return dbPromise;
  }
  function tx_(stores, mode, fn) {
    return db_().then(function (d) {
      return new Promise(function (resolve, reject) {
        const t = d.transaction(stores, mode);
        let out;
        t.oncomplete = function () { resolve(out); };
        t.onabort = t.onerror = function () { reject(t.error || new Error('IndexedDB transaction failed')); };
        out = fn(t);
      });
    });
  }
  function value_(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; }); }
  function range_(version) { return global.IDBKeyRange.bound(version + ':', version + ':￿'); }

  function getRecord_() { return db_().then(function (d) { return value_(d.transaction('meta').objectStore('meta').get(MAP_KEY)); }).then(function (r) { return r || null; }); }
  function putRecord_(rec) { return tx_(['meta'], 'readwrite', function (t) { t.objectStore('meta').put(Object.assign({}, rec, { key: MAP_KEY })); }); }
  function chunkIndexes_(version) {
    return db_().then(function (d) { return value_(d.transaction('chunks').objectStore('chunks').getAllKeys(range_(version))); })
      .then(function (keys) { return keys.map(function (k) { return Number(String(k).split(':')[1]); }); });
  }
  function removeVersion_(version) { return tx_(['chunks'], 'readwrite', function (t) { t.objectStore('chunks').delete(range_(version)); }); }

  /* حذف أجزاء أي إصدار ليس المعتمد ولا الجاري — Delete parts of any version that is neither committed nor in progress */
  async function cleanOrphans_(keep) {
    const d = await db_();
    const keys = await value_(d.transaction('chunks').objectStore('chunks').getAllKeys());
    const stale = {};
    keys.forEach(function (k) { const v = String(k).split(':')[0]; if (keep.indexOf(v) === -1) stale[v] = true; });
    for (const v of Object.keys(stale)) await removeVersion_(v);
  }

  // ===== المعلومات والحالة — Info and state =====
  function fetchMeta() {
    return global.fetch(META_URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('تعذّر قراءة معلومات الخريطة (HTTP ' + r.status + ')');
      return r.json();
    }).then(function (m) {
      if (!m || !m.version || !m.file || !(m.bytes > 0) || !/^[0-9a-f]{64}$/.test(String(m.sha256))) throw new Error('معلومات الخريطة على الموقع غير صالحة');
      return m;
    });
  }

  /* نوع الاتصال إن عرفه المتصفح — The connection type if the browser knows it */
  function networkType() {
    const c = global.navigator && global.navigator.connection;
    if (!c || !c.type) return 'unknown';
    return c.type === 'wifi' || c.type === 'ethernet' ? 'wifi' : c.type === 'cellular' ? 'cellular' : 'unknown';
  }

  let active = null; // تنزيل جارٍ في هذه الصفحة / a download running in this page
  function chunkCount_(bytes) { return Math.ceil(bytes / CHUNK_BYTES); }
  function receivedBytes_(have, bytes) { const n = chunkCount_(bytes); return have >= n ? bytes : have * CHUNK_BYTES; }

  /* حالة التنزيل الهدف: downloading | paused (إيقاف يدوي) | interrupted (انقطع — يُستكمل) | rejected (فشل التحقق — يبدأ من الصفر)
   * The target's state: downloading | paused | interrupted (resumable) | rejected (verification failed — starts over) */
  async function targetStatus_(t) {
    const state = active && active.version === t.version ? 'downloading' : t.rejected ? 'rejected' : t.paused ? 'paused' : 'interrupted';
    const have = state === 'rejected' ? 0 : (await chunkIndexes_(t.version)).length;
    return { version: t.version, bytes: t.bytes, state: state, receivedBytes: receivedBytes_(have, t.bytes),
      reason: t.rejected ? t.rejected.reason : state === 'interrupted' ? (t.interrupted || 'توقف التنزيل قبل اكتماله') : null };
  }

  /**
   * { state: 'none' | 'complete' | 'downloading' | 'paused' | 'interrupted' | 'rejected', version, bytes, receivedBytes, completedAt, reason,
   *   pending (تحديث بجانب نسخة مكتملة): { version, bytes, state, receivedBytes, reason } }
   */
  async function status() {
    const rec = await getRecord_();
    if (!rec) return { state: 'none' };
    if (rec.complete) {
      const out = { state: 'complete', version: rec.version, bytes: rec.bytes, receivedBytes: rec.bytes, completedAt: rec.completedAt || null };
      if (rec.pending) out.pending = await targetStatus_(rec.pending);
      return out;
    }
    return await targetStatus_(rec);
  }

  // ===== السجلان: الإصدارات المكتملة وأحداث التنزيل — The two logs: completed versions and download events =====
  function readLog_(key) {
    return db_().then(function (d) { return value_(d.transaction('meta').objectStore('meta').get(key)); }).then(function (r) { return (r && r.entries) || []; });
  }
  async function appendLog_(key, entry) {
    try {
      const entries = await readLog_(key);
      entries.unshift(entry);
      await tx_(['meta'], 'readwrite', function (t) { t.objectStore('meta').put({ key: key, entries: entries.slice(0, LOG_MAX) }); });
    } catch (e) { /* السجل وصفي فقط / the log is descriptive only */ }
  }
  async function history() { return { versions: await readLog_('versions'), issues: await readLog_('issues') }; }

  // ===== التنزيل — Download =====
  function error_(name, message) { const e = new Error(message); e.name = name; return e; }

  /* جزء واحد بمهلة 30 ث؛ الإيقاف اليدوي يُميَّز عن الانقطاع — One part with a 30 s limit; a manual pause is told apart from a drop */
  async function fetchPart_(url, start, end, total, userSignal) {
    const ctl = new global.AbortController();
    let why = null;
    const onUser = function () { why = 'pause'; ctl.abort(); };
    if (userSignal) { if (userSignal.aborted) throw error_('AbortError', 'أُوقف التنزيل مؤقتًا'); userSignal.addEventListener('abort', onUser); }
    const timer = global.setTimeout(function () { why = 'timeout'; ctl.abort(); }, CHUNK_TIMEOUT_MS);
    try {
      const res = await global.fetch(url, { headers: { Range: 'bytes=' + start + '-' + end }, cache: 'no-store', signal: ctl.signal });
      let buf;
      if (res.status === 206) {
        const cr = res.headers.get('content-range') || '';
        if (cr && !cr.endsWith('/' + total)) throw error_('Interrupted', 'حجم الملف على الموقع لا يطابق معلوماته');
        buf = await res.arrayBuffer();
      } else if (res.status === 200) {
        const whole = await res.arrayBuffer(); // الخادم تجاهل الأجزاء / the server ignored Range
        if (whole.byteLength !== total) throw error_('Interrupted', 'حجم الملف على الموقع لا يطابق معلوماته');
        buf = whole.slice(start, end + 1);
      } else throw error_('Interrupted', 'فشل طلب جزء من الخريطة (HTTP ' + res.status + ')');
      if (buf.byteLength !== end - start + 1) throw error_('Interrupted', 'وصل جزء ناقص من الخريطة');
      return buf;
    } catch (e) {
      if (why === 'pause') throw error_('AbortError', 'أُوقف التنزيل مؤقتًا');
      if (why === 'timeout') throw error_('Interrupted', 'انتهت مهلة تنزيل جزء من الخريطة');
      if (e.name === 'Interrupted') throw e;
      throw error_('Interrupted', global.navigator && global.navigator.onLine === false ? 'انقطع الاتصال بالإنترنت أثناء التنزيل' : 'خطأ في الشبكة أثناء التنزيل');
    } finally {
      global.clearTimeout(timer);
      if (userSignal) userSignal.removeEventListener('abort', onUser);
    }
  }

  /* قفل بين التبويبات (Web Locks) إن توفّر؛ يُرجع دالة التحرير أو null إن كان مأخوذًا — A cross-tab lock if available; returns the release or null */
  function takeLock_() {
    const locks = global.navigator && global.navigator.locks;
    if (!locks || !locks.request) return Promise.resolve(function () {});
    return new Promise(function (resolve) {
      locks.request(LOCK_NAME, { ifAvailable: true }, function (lock) {
        if (!lock) { resolve(null); return; }
        return new Promise(function (release) { resolve(release); });
      }).catch(function () { resolve(function () {}); });
    });
  }

  /**
   * options: { consent: true (موافقة المستخدم — إلزامية)، wifiOnly، signal (إيقاف يدوي)، onProgress(got, total) }
   * أخطاء: ConsentRequired، CellularNotAllowed، AlreadyRunning، AbortError (إيقاف)، Interrupted (يُستكمل)، Rejected (فشل التحقق)
   */
  async function download(options) {
    const opts = options || {};
    if (opts.consent !== true) throw error_('ConsentRequired', 'التنزيل يحتاج موافقة المستخدم');
    if (opts.wifiOnly && networkType() === 'cellular') throw error_('CellularNotAllowed', 'اخترت التنزيل عبر Wi‑Fi فقط والجهاز على بيانات الجوال');
    if (active) throw error_('AlreadyRunning', 'يوجد تنزيل جارٍ بالفعل');
    active = { version: null };
    const release = await takeLock_();
    if (!release) { active = null; throw error_('AlreadyRunning', 'يوجد تنزيل جارٍ في تبويب آخر'); }
    try {
      return await download_(opts);
    } finally {
      active = null;
      release();
    }
  }

  async function download_(opts) {
    const meta = await fetchMeta();
    const url = new URL(meta.file, new URL(META_URL, global.location.href)).href;
    let rec = await getRecord_();
    const isUpdate = !!(rec && rec.complete);
    if (isUpdate && rec.version === meta.version) { // المعتمدة هي المتاحة — لا تنزيل / the committed one is the available one
      if (rec.pending) { await removeVersion_(rec.pending.version); delete rec.pending; await putRecord_(rec); }
      return status();
    }
    let target = isUpdate ? rec.pending : rec;
    // الاستكمال لنفس الإصدار بنفس الحجم والبصمة وما لم يُرفض؛ غير ذلك ← حذف أجزائه المؤقتة والبدء من الصفر
    // Resume the same version with the same size and fingerprint unless rejected; otherwise ← delete its parts and start over
    const resume = !!(target && target.version === meta.version && target.bytes === meta.bytes && target.sha256 === meta.sha256 && !target.rejected);
    if (target && !resume) await removeVersion_(target.version);
    target = { version: meta.version, bytes: meta.bytes, sha256: meta.sha256, url: url, paused: false, rejected: null, interrupted: null, startedAt: resume ? target.startedAt : Date.now() };
    if (isUpdate) rec.pending = target; else rec = Object.assign({ complete: false }, target);
    await putRecord_(rec);
    await cleanOrphans_(isUpdate ? [rec.version, meta.version] : [meta.version]);
    active = { version: meta.version };
    if (global.navigator && global.navigator.storage && global.navigator.storage.persist) global.navigator.storage.persist().catch(function () {});

    const total = meta.bytes, n = chunkCount_(total);
    const have = new Set(await chunkIndexes_(meta.version));
    const report = function () { if (opts.onProgress) { try { opts.onProgress(receivedBytes_(have.size, total), total); } catch (e) { /* الواجهة لا توقف التنزيل / the UI never stops it */ } } };
    const markTarget_ = async function (patch) {
      const r = await getRecord_();
      if (!r) return;
      if (r.complete && r.pending && r.pending.version === meta.version) Object.assign(r.pending, patch);
      else if (!r.complete && r.version === meta.version) Object.assign(r, patch);
      else return;
      await putRecord_(r);
    };
    try {
      report();
      for (let i = 0; i < n; i++) {
        if (have.has(i)) continue; // محفوظ من قبل — لا يُعاد / saved earlier — never re-downloaded
        const start = i * CHUNK_BYTES, end = Math.min(total, start + CHUNK_BYTES) - 1;
        const buf = await fetchPart_(url, start, end, total, opts.signal);
        try { await tx_(['chunks'], 'readwrite', function (t) { t.objectStore('chunks').put(buf, meta.version + ':' + i); }); }
        catch (e) { throw error_('Interrupted', 'تعذّر حفظ جزء من الخريطة في ذاكرة الجهاز'); }
        have.add(i);
        report();
      }
      await verifyAndSwitch_(meta, isUpdate);
      await appendLog_('versions', { at: Date.now(), version: meta.version, bytes: meta.bytes, kind: isUpdate ? 'update' : 'download' });
      return await status();
    } catch (e) {
      const got = receivedBytes_(have.size, total);
      if (e.name === 'AbortError') {
        await markTarget_({ paused: true, interrupted: null });
        await appendLog_('issues', { at: Date.now(), version: meta.version, bytes: total, receivedBytes: got, result: 'paused', reason: 'أوقفه المستخدم مؤقتًا' });
        throw e;
      }
      if (e.name === 'Rejected') {
        // فشل التحقق ← رفض وحذف الأجزاء المؤقتة (النسخة المعتمدة السابقة تبقى) / failed check ← reject and delete the temporary parts
        await removeVersion_(meta.version).catch(function () {});
        await markTarget_({ paused: false, rejected: { at: Date.now(), reason: e.message } }).catch(function () {});
        await appendLog_('issues', { at: Date.now(), version: meta.version, bytes: total, receivedBytes: got, result: 'rejected', reason: e.message });
        throw e;
      }
      // انقطاع ← الأجزاء المحفوظة تبقى للاستكمال / an interruption ← saved parts stay for resuming
      const reason = e.name === 'Interrupted' ? e.message : 'تعذّر إكمال التنزيل';
      await markTarget_({ paused: false, interrupted: reason }).catch(function () {});
      await appendLog_('issues', { at: Date.now(), version: meta.version, bytes: total, receivedBytes: got, result: 'interrupted', reason: reason });
      throw error_('Interrupted', reason);
    }
  }

  /* التحقق (الحجم، الرأس، SHA-256) ← التبديل للجديدة بعملية واحدة ← حذف أجزاء القديمة
   * Verify (size, header, SHA-256) ← switch to the new one in one transaction ← delete the old parts */
  async function verifyAndSwitch_(meta, isUpdate) {
    let bytes;
    try { bytes = await readAll_(meta.version, meta.bytes); } catch (e) { throw error_('Rejected', 'فشل التحقق: ' + e.message); }
    if (bytes.byteLength !== meta.bytes) throw error_('Rejected', 'فشل التحقق: حجم الملف لا يطابق');
    const head = new Uint8Array(bytes.slice(0, 8));
    if (String.fromCharCode.apply(null, Array.from(head.slice(0, 7))) !== 'PMTiles' || head[7] !== 3) throw error_('Rejected', 'فشل التحقق: رأس الملف ليس PMTiles v3');
    if (!global.crypto || !global.crypto.subtle) throw error_('Rejected', 'فشل التحقق: المتصفح لا يدعم SHA-256');
    const digest = await global.crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    if (hex !== meta.sha256) throw error_('Rejected', 'فشل التحقق: بصمة SHA-256 لا تطابق');
    const old = await getRecord_();
    await putRecord_({ version: meta.version, bytes: meta.bytes, sha256: meta.sha256, complete: true, completedAt: Date.now() });
    if (isUpdate && old && old.complete && old.version !== meta.version) await removeVersion_(old.version).catch(function () { /* تُنظَّف لاحقًا / cleaned later */ });
  }

  async function readAll_(version, total) {
    const n = chunkCount_(total), out = new Uint8Array(total);
    const d = await db_();
    for (let i = 0; i < n; i++) {
      const buf = await value_(d.transaction('chunks').objectStore('chunks').get(version + ':' + i));
      if (!buf) throw new Error('جزء مفقود');
      if (i * CHUNK_BYTES + buf.byteLength > total) throw new Error('جزء أطول من المتوقع');
      out.set(new Uint8Array(buf), i * CHUNK_BYTES);
    }
    return out.buffer;
  }

  /* حذف الخريطة من الجهاز بالكامل (بطلب المستخدم) — Remove the map from the device entirely (user request) */
  async function remove() {
    if (active) throw error_('AlreadyRunning', 'أوقف التنزيل الجاري أولًا');
    await tx_(['meta', 'chunks'], 'readwrite', function (t) { t.objectStore('meta').delete(MAP_KEY); t.objectStore('chunks').clear(); });
  }

  /* مصدر بيانات للملف المعتمد فقط (لمكتبة pmtiles): يقرأ أي نطاق من الأجزاء — null إن لا توجد نسخة معتمدة
   * A data source for the committed file only (for pmtiles): reads any range from the parts — null without a committed copy */
  async function openSource() {
    const rec = await getRecord_();
    if (!rec || !rec.complete) return null;
    const version = rec.version, total = rec.bytes, parts = new Map();
    return {
      version: version, bytes: total,
      getKey: function () { return 'idb://jeddah/' + version; },
      getBytes: async function (offset, length) {
        const end = Math.min(total, offset + length), out = new Uint8Array(Math.max(0, end - offset));
        let pos = offset;
        while (pos < end) {
          const i = Math.floor(pos / CHUNK_BYTES);
          let part = parts.get(i);
          if (!part) {
            const d = await db_();
            const buf = await value_(d.transaction('chunks').objectStore('chunks').get(version + ':' + i));
            if (!buf) throw new Error('جزء مفقود من الخريطة المحفوظة');
            part = new Uint8Array(buf); parts.set(i, part);
          }
          const from = pos - i * CHUNK_BYTES, take = Math.min(part.length - from, end - pos);
          out.set(part.subarray(from, from + take), pos - offset);
          pos += take;
        }
        return { data: out.buffer };
      }
    };
  }

  global.SecOfflineMap = {
    fetchMeta: fetchMeta, status: status, download: download, remove: remove, history: history,
    openSource: openSource, networkType: networkType, isDownloading: function () { return !!active; }, CHUNK_BYTES: CHUNK_BYTES
  };
})(typeof window !== 'undefined' ? window : globalThis);
