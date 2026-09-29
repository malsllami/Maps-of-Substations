/* ============================================================
 * services/offline-map.js — مسؤول عن خريطة جدة بدون إنترنت فقط (المحرك، بلا واجهة):
 * 1) معرفة الخريطة المتاحة من maps/jeddah.json (الإصدار، الحجم الحقيقي، البصمة).
 * 2) التنزيل بأجزاء (Range) إلى IndexedDB: إيقاف واستكمال من حيث توقف، ولا يُعاد تنزيل جزء محفوظ.
 * 3) التحقق قبل الاعتماد: الحجم + بصمة SHA-256 + رأس الملف — ملف ناقص أو تالف لا يُعتمد أبدًا.
 * 4) التحديث بأمان: الإصدار الجديد يُنزَّل بجانب القديم، والقديم يبقى صالحًا حتى يكتمل الجديد ويُتحقق منه.
 * 5) قراءة الخريطة من الجهاز لمكتبة pmtiles (مصدر بيانات محلي) ورسمها بـprotomaps-leaflet فوق Leaflet الحالي.
 *
 * Owns the offline Jeddah map only (the engine, no UI):
 * 1) Learns the available map from maps/jeddah.json (version, real size, fingerprint).
 * 2) Downloads in parts (Range) into IndexedDB: pause and resume where it stopped; a saved part is never re-downloaded.
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

  /**
   * حالة الخريطة على الجهاز: { state: 'none'|'partial'|'complete', version, bytes, receivedBytes, completedAt, pending }
   * pending = تنزيل تحديث غير مكتمل بجانب نسخة مكتملة. — pending = an incomplete update download beside a complete copy.
   */
  async function status() {
    const rec = await getRecord_();
    if (!rec) return { state: 'none' };
    const out = { state: rec.complete ? 'complete' : 'partial', version: rec.version, bytes: rec.bytes, completedAt: rec.completedAt || null };
    const target = rec.pending || (rec.complete ? null : rec);
    if (target) {
      const keys = await chunkKeys_(target.version);
      out.receivedBytes = receivedBytes_(keys.length, target.bytes);
      if (rec.pending) out.pending = { version: rec.pending.version, bytes: rec.pending.bytes, receivedBytes: out.receivedBytes };
    } else out.receivedBytes = rec.bytes;
    return out;
  }
  function chunkCount_(bytes) { return Math.ceil(bytes / CHUNK_BYTES); }
  function receivedBytes_(have, bytes) { const n = chunkCount_(bytes); return have >= n ? bytes : have * CHUNK_BYTES; }

  // ===== التنزيل بأجزاء مع الاستكمال — Chunked download with resume =====
  /**
   * ينزّل الإصدار المتاح (أو يستكمله). options: { onProgress(received, total), signal (للإيقاف المؤقت) }.
   * يُرجع حالة الخريطة بعد الاعتماد. الإيقاف (signal) يترك الأجزاء المحفوظة لاستكمالها لاحقًا.
   * Downloads (or resumes) the available version. Returns the map state after commit. Aborting keeps saved parts for later.
   */
  /* ===== سجلان منفصلان: الإصدارات المكتملة (versions) ومشكلات التنزيل (issues) — لا خلط بينهما =====
   * issues: 🟠 incomplete = توقف/انقطع ويمكن استكماله (الأجزاء محفوظة) · 🔴 failed = لم ينتج نسخة صالحة (تحقق/خادم)
   * Two separate logs: completed versions and download issues — never mixed.
   * incomplete = paused/dropped and resumable (parts kept) · failed = produced no valid copy (verification/server) */
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
  /* الإصدارات المكتملة + مشكلات التنزيل، الأحدث أولًا — completed versions + download issues, newest first */
  async function history() {
    return { versions: await readLog_('versions'), issues: await readLog_('issues') };
  }

  /**
   * ينزّل الإصدار المتاح (أو يستكمله) ويسجّل النتيجة: اكتمال ← الإصدارات؛ إيقاف/انقطاع ← 🟠؛ فشل ← 🔴.
   * Downloads (or resumes) the available version and logs the outcome: complete ← versions; pause/drop ← incomplete; failure ← failed.
   */
  async function download(options) {
    const before = await getRecord_();
    const wasComplete = !!(before && before.complete);
    try {
      const st = await downloadInner_(options);
      const after = await getRecord_();
      if (after && after.complete && (!before || !before.complete || before.version !== after.version)) {
        await appendLog_('versions', { at: Date.now(), version: after.version, bytes: after.bytes, kind: wasComplete ? 'update' : 'download' });
      }
      return st;
    } catch (e) {
      const st = await status().catch(function () { return {}; });
      const target = st.pending || st;
      // 🟠 غير مكتمل: بقيت أجزاء محفوظة يمكن استكمالها (إيقاف، انقطاع، خطأ خادم بمنتصف التنزيل)؛ 🔴 فشل: لا شيء يُستكمل (تحقق فاشل حذف الأجزاء، أو فشل من أول جزء)
      // incomplete: saved parts remain to resume (pause, drop, server error mid-way); failed: nothing to resume (failed verification removed the parts, or failure at the first part)
      const partsKept = (st.state === 'partial' || !!st.pending) && (target.receivedBytes || 0) > 0;
      const resumable = e.name === 'AbortError' || partsKept || ((e instanceof TypeError || navigator.onLine === false) && st.state !== 'none');
      let ver = target.version, bytes = target.bytes;
      if (!ver) { try { const m = await fetchMeta(); ver = m.version; bytes = m.bytes; } catch (ignore) {} } // فشل التحقق يحذف السجل — نأخذ الإصدار من معلومات الموقع / a failed verification removes the record — take the version from the site info
      await appendLog_('issues', {
        at: Date.now(), version: ver || null, bytes: bytes || null, receivedBytes: resumable ? (target.receivedBytes || 0) : 0,
        result: resumable ? 'incomplete' : 'failed',
        reason: e.name === 'AbortError' ? 'أوقفه المستخدم مؤقتًا' : (e instanceof TypeError || navigator.onLine === false) ? 'انقطع الاتصال أثناء التنزيل' : String(e.message || e).slice(0, 120)
      });
      throw e;
    }
  }

  async function downloadInner_(options) {
    const opts = options || {};
    const meta = await fetchMeta();
    const url = new URL(meta.file, new URL(META_URL, location.href)).href;
    let rec = await getRecord_();
    const isUpdate = !!(rec && rec.complete && rec.version !== meta.version);
    if (rec && rec.complete && rec.version === meta.version) return status(); // مكتملة ومحدّثة — لا شيء / complete and current — nothing to do
    // مكان التنزيل: تحديث ← بجانب القديمة (pending)، وإلا ← السجل نفسه — where to download: update ← beside the old (pending), else ← the record itself
    const target = { version: meta.version, bytes: meta.bytes, sha256: meta.sha256, url: url };
    // أجزاء إصدار أقدم لم يكتمل تُحذف (لا تشغل مساحة بلا فائدة) — parts of an older incomplete version are removed (no wasted space)
    if (isUpdate) {
      if (rec.pending && rec.pending.version !== meta.version) await removeVersion_(rec.pending.version);
      rec.pending = target; await putRecord_(rec);
    } else if (!rec || rec.version !== meta.version) {
      if (rec && !rec.complete) await removeVersion_(rec.version);
      rec = Object.assign({ complete: false, startedAt: Date.now() }, target); await putRecord_(rec);
    }
    loadLibs().catch(function () {}); // مكتبتا الرسم تُحفظان الآن (مع الإنترنت) لتعملا لاحقًا بدونه / the two libraries get stored now (online) to work offline later
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); // يقلل حذف المتصفح للخريطة عند امتلاء التخزين / reduces browser eviction under storage pressure

    const total = meta.bytes, n = chunkCount_(total);
    const have = new Set((await chunkKeys_(meta.version)).map(function (k) { return Number(String(k).split(':')[1]); }));
    const report = function () { if (opts.onProgress) opts.onProgress(receivedBytes_(have.size, total), total); };
    report();
    for (let i = 0; i < n; i++) {
      if (have.has(i)) continue; // محفوظ سابقًا — لا يُعاد / saved before — never re-downloaded
      if (opts.signal && opts.signal.aborted) throw abortError_();
      const start = i * CHUNK_BYTES, end = Math.min(total, start + CHUNK_BYTES) - 1;
      const res = await fetch(url, { headers: { Range: 'bytes=' + start + '-' + end }, cache: 'no-store', signal: opts.signal });
      let buf;
      if (res.status === 206) {
        const cr = res.headers.get('content-range') || '';
        if (cr && !cr.endsWith('/' + total)) throw new Error('حجم الملف على الموقع لا يطابق معلوماته — أعد المحاولة لاحقًا');
        buf = await res.arrayBuffer();
      } else if (res.status === 200) {
        // الخادم تجاهل الأجزاء: يُقتطع الجزء المطلوب من الملف كاملًا — the server ignored Range: slice the part from the whole file
        const whole = await res.arrayBuffer();
        if (whole.byteLength !== total) throw new Error('حجم الملف على الموقع لا يطابق معلوماته — أعد المحاولة لاحقًا');
        buf = whole.slice(start, end + 1);
      } else throw new Error('تعذّر تنزيل جزء من الخريطة (HTTP ' + res.status + ')');
      if (buf.byteLength !== end - start + 1) throw new Error('جزء ناقص من الخريطة — سيُعاد تنزيله');
      await tx_(['chunks'], 'readwrite', function (t) { t.objectStore('chunks').put(buf, meta.version + ':' + i); });
      have.add(i);
      report();
    }
    await verifyAndCommit_(meta, isUpdate);
    return status();
  }
  function abortError_() { const e = new Error('أُوقف التنزيل مؤقتًا'); e.name = 'AbortError'; return e; }

  /* التحقق ثم الاعتماد بعملية واحدة؛ الفشل يحذف أجزاء الإصدار الجديد فقط — Verify then commit in one transaction; failure removes the new version's parts only */
  async function verifyAndCommit_(meta, isUpdate) {
    const bytes = await readAll_(meta.version, meta.bytes);
    const head = new Uint8Array(bytes.slice(0, 8));
    const magicOk = String.fromCharCode.apply(null, Array.from(head.slice(0, 7))) === 'PMTiles' && head[7] === 3;
    let shaOk = true;
    if (meta.sha256 && global.crypto && global.crypto.subtle) {
      const digest = await global.crypto.subtle.digest('SHA-256', bytes);
      shaOk = Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('') === meta.sha256;
    }
    if (bytes.byteLength !== meta.bytes || !magicOk || !shaOk) {
      await removeVersion_(meta.version);
      const rec = await getRecord_();
      if (rec && isUpdate) { delete rec.pending; await putRecord_(rec); }
      else await tx_(['meta'], 'readwrite', function (t) { t.objectStore('meta').delete(MAP_KEY); });
      throw new Error('فشل التحقق من الخريطة بعد التنزيل — لم تُعتمد، أعد التنزيل');
    }
    const old = await getRecord_();
    await putRecord_({ version: meta.version, bytes: meta.bytes, sha256: meta.sha256, url: (old && old.pending ? old.pending.url : old && old.url), complete: true, completedAt: Date.now() });
    if (isUpdate && old && old.version !== meta.version) await removeVersion_(old.version); // القديمة تُحذف فقط بعد اعتماد الجديدة / the old one goes only after the new one is committed
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
