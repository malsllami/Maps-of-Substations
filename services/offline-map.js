/* ============================================================
 * services/offline-map.js — مسؤول عن خريطة جدة بدون إنترنت فقط (المحرك، بلا واجهة):
 * 1) معرفة الخريطة المتاحة من maps/jeddah.json (الإصدار، الحجم الحقيقي، البصمة).
 * 2) التنزيل بأجزاء (Range) إلى IndexedDB: الإيقاف اليدوي يُستكمل من حيث توقف؛ أي فشل يحذف الأجزاء المؤقتة ويبدأ من الصفر.
 * 3) التحقق قبل الاعتماد: الحجم + بصمة SHA-256 + رأس الملف — ملف ناقص أو تالف لا يُعتمد أبدًا.
 * 4) التحديث بأمان: الإصدار الجديد يُنزَّل بجانب القديم، والقديم يبقى صالحًا حتى يكتمل الجديد ويُتحقق منه.
 * 5) قراءة الخريطة من الجهاز لمكتبة pmtiles (مصدر بيانات محلي) ورسمها بـprotomaps-leaflet فوق Leaflet الحالي.
 *
 * Owns the offline Jeddah map only (the engine, no UI):
 * 1) Learns the available map from maps/jeddah.json (version, real size, fingerprint).
 * 2) Downloads in parts (Range) into IndexedDB: a manual pause resumes where it stopped; any failure deletes the temporary parts and starts from zero.
 * 3) Verifies before committing: size + SHA-256 + file header — an incomplete or corrupt file is never committed.
 * 4) Updates safely: the new version downloads beside the old one, which stays usable until the new one is complete and verified.
 * 5) Serves the map from the device to pmtiles (a local data source) and draws it with protomaps-leaflet over the existing Leaflet map.
 * ============================================================ */
(function (global) {
  'use strict';

  const META_URL = 'maps/jeddah.json';
  const DB_NAME = 'sec-offline-map';
  const DB_VERSION = 1;
  const CHUNK_BYTES = 1024 * 1024;   // جزء 1 ميجابايت: استكمال دقيق دون طلبات كثيرة / 1 MB parts: fine-grained resume without many requests
  const MAP_KEY = 'jeddah';
  // مكتبات الرسم بإصدارات ثابتة — تُحمَّل فقط عند الحاجة ويحفظها sw.js للعمل بدون إنترنت
  // Rendering libraries at pinned versions — loaded only when needed, stored by sw.js for offline use
  const LIBS = [
    'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/dist/pmtiles.js',
    'https://cdn.jsdelivr.net/npm/protomaps-leaflet@5.1.0/dist/protomaps-leaflet.js'
  ];

  // ===== IndexedDB: meta (حالة الخريطة) + chunks (أجزاء الملف) — meta (map state) + chunks (file parts) =====
  let dbPromise = null;
  function db_() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!global.indexedDB) return reject(new Error('IndexedDB غير متاح'));
        const req = global.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          const d = req.result;
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
          if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks'); // المفتاح: "الإصدار:الرقم" / key: "version:index"
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
  function reqValue_(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; }); }

  function getRecord_() {
    return db_().then(function (d) { return reqValue_(d.transaction('meta').objectStore('meta').get(MAP_KEY)); }).then(function (r) { return r || null; });
  }
  function putRecord_(rec) { return tx_(['meta'], 'readwrite', function (t) { t.objectStore('meta').put(Object.assign({ key: MAP_KEY }, rec)); }); }
  function chunkKeys_(version) {
    return db_().then(function (d) {
      const range = IDBKeyRange.bound(version + ':', version + ':￿');
      return reqValue_(d.transaction('chunks').objectStore('chunks').getAllKeys(range));
    });
  }

  // ===== المعلومات والحالة — Info and state =====
  /* الخريطة المتاحة على الموقع (الإصدار والحجم الحقيقي قبل التنزيل) — The map available on the site (version and real size before download) */
  function fetchMeta() {
    return fetch(META_URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('تعذّر قراءة معلومات الخريطة (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  /* ===== قاعدة التنزيل (قرار مقفل) — The download rule (locked decision) =====
   * - إيقاف يدوي ← الأجزاء موثوقة حتى آخر جزء مكتمل ← «استكمال التنزيل» من نفس الموضع.
   * - أي فشل (انقطاع، خطأ شبكة، انتهاء مهلة، فشل الأجزاء، جزء ناقص، فشل الحفظ، فشل التحقق) ← حذف الأجزاء المؤقتة
   *   لهذا التنزيل ← «إعادة التحميل» من الصفر. لا استكمال بعد فشل.
   * - تنزيل انقطع دون إيقاف يدوي (أُغلقت الصفحة أثناءه) ← يُعامل كفشل.
   * - لا شيء يبدأ تلقائيًا عند عودة الإنترنت — المستخدم يقرر.
   * - «🟢 جاهزة» فقط بعد اكتمال الملف + نجاح التحقق. النسخة المكتملة الموجودة لا تتأثر بفشل تحديث.
   * - Manual pause ← parts trusted up to the last complete part ← "resume" from the same point.
   * - Any failure (drop, network error, timeout, range failure, short part, save failure, verification failure) ← this
   *   download's temporary parts are deleted ← "download again" from zero. No resume after a failure.
   * - A download cut without a manual pause (page closed during it) ← treated as a failure.
   * - Nothing starts automatically when the internet returns — the user decides.
   * - "Ready" only after the full file + a passed verification. An existing complete copy is untouched by a failed update. */
  const CHUNK_TIMEOUT_MS = 30000;  // جزء لم يكتمل خلال 30 ث = فشل (انتهاء المهلة) / a part not done within 30 s = failure (timeout)
  let active = null;               // تنزيل جارٍ في هذه الصفحة: { version } / a download running in this page

  /* حالة التنزيل الهدف (الأول أو التحديث) — the target download's state (first or update) */
  function targetState_(t) {
    if (active && active.version === t.version) return 'downloading';
    if (t.failed) return 'failed';
    if (t.paused) return 'paused';
    return 'failed'; // انقطع دون إيقاف يدوي — لا يُعتمد عليه / cut without a manual pause — not trusted
  }

  /**
   * حالة الخريطة: { state: 'none'|'downloading'|'paused'|'failed'|'complete', version, bytes, receivedBytes, completedAt, failedReason, pending }
   * pending (تحديث بجانب نسخة مكتملة): { version, bytes, receivedBytes, state: 'downloading'|'paused'|'failed', failedReason }
   * Map state; pending = an update beside a complete copy.
   */
  async function status() {
    const rec = await getRecord_();
    if (!rec) return { state: 'none' };
    if (rec.complete) {
      const out = { state: 'complete', version: rec.version, bytes: rec.bytes, receivedBytes: rec.bytes, completedAt: rec.completedAt || null };
      if (rec.pending) {
        const ps = targetState_(rec.pending);
        out.pending = { version: rec.pending.version, bytes: rec.pending.bytes, state: ps, failedReason: failedReason_(rec.pending),
          receivedBytes: ps === 'failed' ? 0 : receivedBytes_((await chunkKeys_(rec.pending.version)).length, rec.pending.bytes) };
      }
      return out;
    }
    const st = targetState_(rec);
    return { state: st, version: rec.version, bytes: rec.bytes, failedReason: failedReason_(rec),
      receivedBytes: st === 'failed' ? 0 : receivedBytes_((await chunkKeys_(rec.version)).length, rec.bytes) };
  }
  function failedReason_(t) { return t.failed ? t.failed.reason : (!t.paused && !(active && active.version === t.version) ? 'انقطع التنزيل قبل اكتماله (دون إيقاف يدوي)' : null); }
  function chunkCount_(bytes) { return Math.ceil(bytes / CHUNK_BYTES); }
  function receivedBytes_(have, bytes) { const n = chunkCount_(bytes); return have >= n ? bytes : have * CHUNK_BYTES; }

  /* ===== سجلان منفصلان: الإصدارات المكتملة (versions) وأحداث التنزيل (issues: paused/failed) — لا خلط بينهما =====
   * Two separate logs: completed versions and download events (issues: paused/failed) — never mixed */
  const LOG_MAX = 20;
  function readLog_(key) {
    return db_().then(function (d) { return reqValue_(d.transaction('meta').objectStore('meta').get(key)); }).then(function (r) { return (r && r.entries) || []; });
  }
  async function appendLog_(key, entry) {
    try {
      const entries = await readLog_(key);
      entries.unshift(entry);
      await tx_(['meta'], 'readwrite', function (t) { t.objectStore('meta').put({ key: key, entries: entries.slice(0, LOG_MAX) }); });
    } catch (e) { /* السجل وصفي فقط — لا يوقف التنزيل / the log is descriptive only — never blocks the download */ }
  }
  /* الإصدارات المكتملة + أحداث التنزيل، الأحدث أولًا — completed versions + download events, newest first */
  async function history() {
    return { versions: await readLog_('versions'), issues: await readLog_('issues') };
  }

  // ===== التنزيل — Download =====
  function abortError_() { const e = new Error('أُوقف التنزيل مؤقتًا'); e.name = 'AbortError'; return e; }
  function failure_(reason) { const e = new Error(reason); e.name = 'DownloadFailed'; return e; }

  /* جلب جزء بمهلة 30 ث؛ الإيقاف اليدوي يُميَّز عن انتهاء المهلة — fetch one part with a 30 s limit; a manual pause is told apart from a timeout */
  async function fetchPart_(url, start, end, total, userSignal) {
    const ctl = new AbortController();
    let why = null;
    const onUser = function () { why = 'pause'; ctl.abort(); };
    if (userSignal) { if (userSignal.aborted) throw abortError_(); userSignal.addEventListener('abort', onUser); }
    const timer = setTimeout(function () { why = 'timeout'; ctl.abort(); }, CHUNK_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=' + start + '-' + end }, cache: 'no-store', signal: ctl.signal });
      let buf;
      if (res.status === 206) {
        const cr = res.headers.get('content-range') || '';
        if (cr && !cr.endsWith('/' + total)) throw failure_('حجم الملف على الموقع لا يطابق معلوماته');
        buf = await res.arrayBuffer();
      } else if (res.status === 200) {
        // الخادم تجاهل الأجزاء: يُقتطع الجزء المطلوب من الملف كاملًا — the server ignored Range: slice the part from the whole file
        const whole = await res.arrayBuffer();
        if (whole.byteLength !== total) throw failure_('حجم الملف على الموقع لا يطابق معلوماته');
        buf = whole.slice(start, end + 1);
      } else throw failure_('فشل طلب جزء من الخريطة (HTTP ' + res.status + ')');
      if (buf.byteLength !== end - start + 1) throw failure_('وصل جزء ناقص من الخريطة');
      return buf;
    } catch (e) {
      if (why === 'pause') throw abortError_();
      if (why === 'timeout') throw failure_('انتهت مهلة تنزيل جزء من الخريطة');
      if (e.name === 'DownloadFailed') throw e;
      throw failure_(navigator.onLine === false ? 'انقطع الاتصال بالإنترنت أثناء التنزيل' : 'خطأ في الشبكة أثناء التنزيل');
    } finally {
      clearTimeout(timer);
      if (userSignal) userSignal.removeEventListener('abort', onUser);
    }
  }

  /**
   * ينزّل الإصدار المتاح: يستكمل بعد إيقاف يدوي، ويبدأ من الصفر بعد أي فشل. options: { onProgress(got, total), signal (إيقاف يدوي) }.
   * Downloads the available version: resumes after a manual pause, starts from zero after any failure.
   */
  async function download(options) {
    if (active) throw failure_('يوجد تنزيل جارٍ بالفعل');
    const opts = options || {};
    const meta = await fetchMeta();
    const url = new URL(meta.file, new URL(META_URL, location.href)).href;
    let rec = await getRecord_();
    if (rec && rec.complete && rec.version === meta.version && !rec.pending) return status(); // مكتملة ومحدّثة / complete and current
    const isUpdate = !!(rec && rec.complete);
    let target = isUpdate ? rec.pending : rec;
    // لا استكمال إلا بعد إيقاف يدوي لنفس الإصدار؛ غير ذلك ← حذف الأجزاء المؤقتة والبدء من الصفر
    // Resume only after a manual pause of the same version; otherwise ← delete the temporary parts and start from zero
    const canResume = !!(target && target.version === meta.version && target.paused && !target.failed);
    if (target && !canResume) await removeVersion_(target.version);
    target = { version: meta.version, bytes: meta.bytes, sha256: meta.sha256, url: url, paused: false, failed: null, startedAt: canResume ? target.startedAt : Date.now() };
    if (isUpdate) { rec.pending = target; } else { rec = Object.assign({ complete: false }, target); }
    await putRecord_(rec);
    active = { version: meta.version };
    loadLibs().catch(function () {}); // مكتبتا الرسم تُحفظان الآن (مع الإنترنت) لتعملا لاحقًا بدونه / the two libraries get stored now (online) for offline use
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); // يقلل حذف المتصفح للخريطة / reduces browser eviction

    const total = meta.bytes, n = chunkCount_(total);
    const have = new Set((await chunkKeys_(meta.version)).map(function (k) { return Number(String(k).split(':')[1]); }));
    const report = function () { if (opts.onProgress) opts.onProgress(receivedBytes_(have.size, total), total); };
    const markTarget_ = async function (patch) {
      const r = await getRecord_();
      if (!r) return;
      if (r.complete && r.pending) Object.assign(r.pending, patch); else if (!r.complete) Object.assign(r, patch);
      await putRecord_(r);
    };
    try {
      report();
      for (let i = 0; i < n; i++) {
        if (have.has(i)) continue; // محفوظ من قبل الإيقاف اليدوي — لا يُعاد / saved before the manual pause — never re-downloaded
        const start = i * CHUNK_BYTES, end = Math.min(total, start + CHUNK_BYTES) - 1;
        const buf = await fetchPart_(url, start, end, total, opts.signal);
        try { await tx_(['chunks'], 'readwrite', function (t) { t.objectStore('chunks').put(buf, meta.version + ':' + i); }); }
        catch (e) { throw failure_('تعذّر حفظ جزء من الخريطة في ذاكرة الجهاز'); }
        have.add(i);
        report();
      }
      await verifyAndCommit_(meta);
      await appendLog_('versions', { at: Date.now(), version: meta.version, bytes: meta.bytes, kind: isUpdate ? 'update' : 'download' });
      return await status();
    } catch (e) {
      const got = receivedBytes_(have.size, total);
      if (e.name === 'AbortError') { // إيقاف يدوي ← الأجزاء تبقى للاستكمال / manual pause ← parts kept to resume
        await markTarget_({ paused: true, failed: null });
        await appendLog_('issues', { at: Date.now(), version: meta.version, bytes: total, receivedBytes: got, result: 'paused', reason: 'أوقفه المستخدم مؤقتًا' });
        throw e;
      }
      // فشل ← حذف الأجزاء المؤقتة لهذا التنزيل فقط (النسخة المكتملة السابقة تبقى) — failure ← delete this download's temporary parts only (a previous complete copy stays)
      const reason = e.name === 'DownloadFailed' ? e.message : 'تعذّر إكمال التنزيل';
      await removeVersion_(meta.version).catch(function () {});
      await markTarget_({ paused: false, failed: { at: Date.now(), reason: reason } }).catch(function () {});
      await appendLog_('issues', { at: Date.now(), version: meta.version, bytes: total, receivedBytes: got, result: 'failed', reason: reason });
      throw failure_(reason);
    } finally {
      active = null;
    }
  }

  /* التحقق ثم الاعتماد بعملية واحدة؛ فشل التحقق يُعامل كأي فشل (حذف الأجزاء + البدء من الصفر)
   * Verify then commit in one transaction; a failed verification is treated like any failure (delete the parts + start from zero) */
  async function verifyAndCommit_(meta) {
    const bytes = await readAll_(meta.version, meta.bytes);
    const head = new Uint8Array(bytes.slice(0, 8));
    const magicOk = String.fromCharCode.apply(null, Array.from(head.slice(0, 7))) === 'PMTiles' && head[7] === 3;
    let shaOk = true;
    if (meta.sha256 && global.crypto && global.crypto.subtle) {
      const digest = await global.crypto.subtle.digest('SHA-256', bytes);
      shaOk = Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('') === meta.sha256;
    }
    if (bytes.byteLength !== meta.bytes || !magicOk || !shaOk) throw failure_('فشل التحقق من سلامة الملف بعد التنزيل');
    const old = await getRecord_();
    await putRecord_({ version: meta.version, bytes: meta.bytes, sha256: meta.sha256, url: (old && old.pending ? old.pending.url : old && old.url), complete: true, completedAt: Date.now() });
    if (old && old.complete && old.version !== meta.version) await removeVersion_(old.version); // القديمة تُحذف فقط بعد اعتماد الجديدة / the old one goes only after the new one is committed
    cache = null;
  }

  async function readAll_(version, total) {
    const n = chunkCount_(total), out = new Uint8Array(total);
    const d = await db_();
    for (let i = 0; i < n; i++) {
      const buf = await reqValue_(d.transaction('chunks').objectStore('chunks').get(version + ':' + i));
      if (!buf) throw new Error('جزء مفقود من الخريطة');
      out.set(new Uint8Array(buf), i * CHUNK_BYTES);
    }
    return out.buffer;
  }
  function removeVersion_(version) {
    return tx_(['chunks'], 'readwrite', function (t) { t.objectStore('chunks').delete(IDBKeyRange.bound(version + ':', version + ':￿')); });
  }

  /* حذف الخريطة من الجهاز بالكامل (بطلب المستخدم) — Remove the map from the device entirely (user request) */
  async function remove() {
    await tx_(['meta', 'chunks'], 'readwrite', function (t) { t.objectStore('meta').delete(MAP_KEY); t.objectStore('chunks').clear(); });
    cache = null;
  }

  // ===== القراءة من الجهاز لمكتبة pmtiles — Reading from the device for pmtiles =====
  let cache = null; // الأجزاء المقروءة بالذاكرة (الملف كله ~9 ميجابايت) / parts read into memory (the whole file is ~9 MB)
  /* مصدر بيانات pmtiles يقرأ النطاق المطلوب من أجزاء IndexedDB — A pmtiles data source reading the requested range from IndexedDB parts */
  function localSource_(rec) {
    const parts = new Map();
    cache = parts;
    return {
      getKey: function () { return 'idb://jeddah/' + rec.version; },
      getBytes: async function (offset, length) {
        const out = new Uint8Array(length);
        let pos = offset;
        while (pos < offset + length) {
          const i = Math.floor(pos / CHUNK_BYTES);
          let part = parts.get(i);
          if (!part) {
            const d = await db_();
            const buf = await reqValue_(d.transaction('chunks').objectStore('chunks').get(rec.version + ':' + i));
            if (!buf) throw new Error('جزء مفقود من الخريطة المحفوظة');
            part = new Uint8Array(buf); parts.set(i, part);
          }
          const from = pos - i * CHUNK_BYTES, take = Math.min(part.length - from, offset + length - pos);
          out.set(part.subarray(from, from + take), pos - offset);
          pos += take;
        }
        return { data: out.buffer };
      }
    };
  }

  let libsPromise = null;
  /* تحميل مكتبتي الرسم عند الحاجة فقط. الجلب بطلب CORS يجعل sw.js يحفظهما (الوسم <script> العادي يعطي ردًا معتمًا لا يُحفظ)،
   * فتعملان بعدها بدون إنترنت. Load the two rendering libraries only when needed. Fetching with CORS lets sw.js store them
   * (a plain <script> tag gets an opaque reply that isn't stored), so they then work offline. */
  function loadLibs() {
    if (global.pmtiles && global.protomapsL) return Promise.resolve();
    if (!libsPromise) {
      libsPromise = LIBS.reduce(function (p, src) {
        return p.then(function () {
          return fetch(src, { mode: 'cors' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          }).then(function (code) {
            return new Promise(function (resolve, reject) {
              const s = document.createElement('script');
              const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
              s.src = blobUrl;
              s.onload = function () { URL.revokeObjectURL(blobUrl); resolve(); };
              s.onerror = function () { reject(new Error('تعذّر تشغيل مكتبة الخريطة المحفوظة')); };
              document.head.appendChild(s);
            });
          });
        });
      }, Promise.resolve()).catch(function (e) { libsPromise = null; throw new Error('تعذّر تحميل مكتبة الخريطة المحفوظة: ' + e.message); });
    }
    return libsPromise;
  }

  /**
   * طبقة Leaflet تعرض الخريطة المحفوظة (null إن لم تكتمل). flavor: 'light' | 'dark' — نفس الملف للوضعين.
   * A Leaflet layer showing the saved map (null if not complete). flavor: 'light' | 'dark' — the same file for both.
   */
  async function createLayer(flavor) {
    const rec = await getRecord_();
    if (!rec || !rec.complete) return null;
    await loadLibs();
    const archive = new global.pmtiles.PMTiles(localSource_(rec));
    return global.protomapsL.leafletLayer({ url: archive, flavor: flavor === 'dark' ? 'dark' : 'light', lang: 'ar', attribution: '© OpenStreetMap' });
  }

  global.SecOfflineMap = { fetchMeta: fetchMeta, status: status, download: download, remove: remove, history: history, createLayer: createLayer, loadLibs: loadLibs, CHUNK_BYTES: CHUNK_BYTES };
})(window);
