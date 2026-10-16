/* ============================================================
 * services/stations-db.js — نسخة المحطات في الجهاز (IndexedDB) والمزامنة المحلية فقط
 * ============================================================
 * لا يطلب من الخادم ولا يبحث: يستقبل ردود الخادم من صاحبها (عميل الخادم/الصفحة) ويحوّلها لنسخة محفوظة.
 * - النسخة سجل واحد كامل { المحطات، الإصدار، وقت المزامنة، العدد } يُكتب بعملية واحدة: إما يُعتمد كاملًا أو لا يتغيّر
 *   شيء، فلا توجد أبدًا نسخة نصفها قديم ونصفها جديد. البناء والتحقق قبل الكتابة، وأي فشل يُبقي السابقة كما هي.
 * - الإصدار لا يرجع للخلف: اعتماد نسخة إصدارها أقدم من المحفوظة يُرفض داخل نفس العملية (رد متأخر لا يغطي الأحدث).
 * - التحميل الكامل يُجمَّع دفعة دفعة بالترتيب (كل دفعة تبدأ حيث انتهت السابقة): دفعة مكررة بإعادة المحاولة تُتجاهل،
 *   ودفعة ناقصة أو قافزة تُرفض، وتغيّر الإصدار في المنتصف يبدأ من الصفر. لا اعتماد قبل أن يطابق العدد totalCount.
 * - المزامنة التزايدية تضيف وتستبدل (الرقم بلا حساسية الأحرف + النوع). الحذف لا يصل في التحديثات، فإن لم يطابق
 *   العدد بعد الدمج totalCount ← لا تُعتمد وتطلب تحميلًا كاملًا. تكرار نفس التحديث آمن (استبدال).
 * - قاعدة sec2-stations مستقلة عن قاعدة V1 (sec-stations) ولا تمسّها.
 *
 * The on-device stations copy (IndexedDB) and local sync only — no server requests, no search: it takes the server
 * replies from their owner (the API client / page) and turns them into a stored copy.
 * - The copy is ONE complete record written in one transaction: all or nothing. Build and verify before writing;
 *   any failure keeps the previous copy as is.
 * - The version never goes back: committing a copy older than the stored one is refused inside the same transaction.
 * - The full load is assembled batch by batch in order: a batch repeated by a retry is ignored, a gap is refused,
 *   a version change midway starts over. Nothing is committed before the count matches totalCount.
 * - Incremental sync adds and replaces (case-insensitive id + type). Deletions don't arrive as updates, so a count
 *   mismatch with totalCount after merging ← not committed, and a full load is requested. Repeating an update is safe.
 * - The sec2-stations database is separate from V1's (sec-stations) and never touches it.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('stations-db.js يحتاج config/الإعدادات.js قبله / needs config/الإعدادات.js loaded first');
  const DB_NAME = CONFIG.DB_NAMES.STATIONS;
  const DB_VERSION = 1;
  const STORE = 'snapshots';
  const CURRENT = 'current';

  // ===== القاعدة — The database =====

  let dbPromise = null;
  function open_() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!global.indexedDB) return reject(new Error('IndexedDB غير متاح'));
        let req;
        try { req = global.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); } // التصفح الخاص ببعض المتصفحات / private mode on some browsers
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
        };
        req.onsuccess = function () {
          const db = req.result;
          db.onversionchange = function () { db.close(); dbPromise = null; };
          resolve(db);
        };
        req.onerror = function () { reject(req.error || new Error('تعذّر فتح IndexedDB')); };
        req.onblocked = function () { reject(new Error('IndexedDB محجوزة من تبويب آخر')); };
      });
      dbPromise.catch(function () { dbPromise = null; }); // يُعاد المحاولة بالطلب التالي / retried on the next call
    }
    return dbPromise;
  }

  /* الكتابات بالتتابع داخل الصفحة (المزامنة والتحميل الكامل والمسح لا تتداخل) — Writes run one at a time within the page */
  let writeQueue = Promise.resolve();
  function serial_(job) {
    const run = writeQueue.then(job, job);
    writeQueue = run.catch(function () {});
    return run;
  }

  /* النسخة المعتمدة أو null — The committed copy, or null */
  function read() {
    return open_().then(function (db) {
      return new Promise(function (resolve, reject) {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(CURRENT);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /* هل الإصدار a أقدم من b؟ (الإصدار وقت بالميلي ثانية من الخادم) — Is version a older than b? (a server ms timestamp) */
  function isOlder_(a, b) {
    return a != null && b != null && isFinite(Number(a)) && isFinite(Number(b)) && Number(a) < Number(b);
  }

  function sizeOf_(stations) {
    try { return new global.Blob([JSON.stringify(stations)]).size; } catch (e) { return 0; }
  }

  /**
   * يعتمد نسخة كاملة بعملية واحدة. يُرفض: نسخة غير صالحة، أو إصدار أقدم من المحفوظ (يُفحص داخل نفس العملية).
   * أي خطأ ← تُلغى العملية كلها وتبقى السابقة.
   * Commits a complete copy in one transaction. Refused: an invalid copy, or a version older than the stored one
   * (checked inside the same transaction). Any error ← the whole transaction aborts and the previous copy stays.
   */
  function commit(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.stations) || snapshot.version == null) return Promise.reject(new Error('نسخة غير صالحة'));
    const record = {
      key: CURRENT, schema: 1, stations: snapshot.stations, version: String(snapshot.version), lastSync: snapshot.lastSync || null,
      count: snapshot.stations.length, sizeBytes: sizeOf_(snapshot.stations), savedAt: Date.now()
    };
    return serial_(function () {
      return open_().then(function (db) {
        return new Promise(function (resolve, reject) {
          let tx;
          try { tx = db.transaction(STORE, 'readwrite', { durability: 'strict' }); } catch (e) { tx = db.transaction(STORE, 'readwrite'); }
          let refused = null;
          tx.oncomplete = function () { if (refused) reject(refused); else resolve(record); };
          tx.onabort = function () { reject(refused || tx.error || new Error('أُلغيت عملية الحفظ — النسخة السابقة سليمة')); };
          const store = tx.objectStore(STORE);
          const current = store.get(CURRENT);
          current.onsuccess = function () {
            if (current.result && isOlder_(record.version, current.result.version)) {
              refused = new Error('إصدار أقدم من النسخة المحفوظة — لم يُعتمد');
              return; // لا كتابة؛ تكتمل العملية بلا تغيير / no write; the transaction completes unchanged
            }
            try { store.put(record); } catch (e) { refused = e; try { tx.abort(); } catch (ignore) { /* أُلغيت أصلًا / already aborted */ } }
          };
        });
      });
    });
  }

  /* مسح النسخة (زر «مسح البيانات المؤقتة» فقط) — Clears the copy (the «clear temporary data» button only) */
  function clear() {
    return serial_(function () {
      return open_().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(CURRENT);
          tx.oncomplete = function () { resolve(true); };
          tx.onabort = function () { reject(tx.error); };
        });
      });
    });
  }

  // ===== شكل المحطة — The station shape =====

  /* محطة من رد الخادم (المضغوط [id, type, feeder, region, lat, lng] أو الكائن) — A station from a server reply */
  function toStation_(s) {
    return Array.isArray(s)
      ? { id: s[0], type: s[1], feeder: s[2], region: s[3], lat: s[4], lng: s[5] }
      : { id: s.id, type: s.type, feeder: s.feeder, region: s.region, lat: s.lat, lng: s.lng };
  }

  function keyOf_(st) { return String(st.id).toUpperCase() + '\u0001' + st.type; }

  // ===== التحميل الكامل — The full load =====

  /**
   * مجمّع دفعات التحميل الكامل (يُحفظ في الذاكرة فيُستكمل من مكانه بعد فشل دفعة). add(reply, offset) لكل دفعة بالترتيب،
   * ثم result() عند nextOffset = null. لا يُعتمد شيء هنا.
   * The full-load batch assembler (kept in memory so it resumes after a failed batch). add(reply, offset) per batch in
   * order, then result() when nextOffset is null. Nothing is committed here.
   */
  function createFullLoad() {
    let stations = [], version = null, total = null, done = false;
    return {
      /* الإزاحة التالية المطلوبة — The next offset to request */
      nextOffset: function () { return done ? null : stations.length; },
      /* يُرجع: 'added' | 'duplicate' (دفعة وصلت من قبل) | 'restart' (تغيّر الإصدار ← ابدأ من 0) | 'invalid' | 'gap'
       * Returns: 'added' | 'duplicate' | 'restart' (the version changed ← start from 0) | 'invalid' | 'gap' */
      add: function (reply, offset) {
        if (!reply || !reply.success || !Array.isArray(reply.stations) || reply.version == null || typeof reply.totalCount !== 'number') return 'invalid';
        if (version !== null && String(reply.version) !== version) {
          stations = []; version = null; total = null; done = false;
          return 'restart';
        }
        if (offset < stations.length) return 'duplicate';
        if (offset > stations.length) return 'gap';
        stations = stations.concat(reply.stations.map(toStation_));
        version = String(reply.version); total = reply.totalCount;
        if (reply.nextOffset === null || reply.nextOffset === undefined) done = true;
        return 'added';
      },
      progress: function () { return { loaded: stations.length, total: total }; },
      /* النتيجة بعد آخر دفعة: { ok, stations, version } أو { ok:false, reason } — The result after the last batch */
      result: function () {
        if (!done) return { ok: false, reason: 'التحميل لم يكتمل' };
        if (stations.length !== total) return { ok: false, reason: 'عدد المحطات المحمّلة (' + stations.length + ') لا يطابق العدد بالخادم (' + total + ')' };
        return { ok: true, stations: stations, version: version };
      }
    };
  }

  // ===== المزامنة التزايدية — Incremental sync =====

  /* دمج التحديثات في نسخة جديدة كاملة دون لمس القديمة — Merge updates into a complete new copy, the old one untouched */
  function applyUpdates(base, updates) {
    const next = base.slice(), index = new Map();
    for (let i = 0; i < next.length; i++) { const k = keyOf_(next[i]); if (!index.has(k)) index.set(k, i); } // أول تطابق / the first match
    let added = 0, replaced = 0, modified = 0;
    // «modified»: ما تغيّر فعلًا (لا ما أُعيد إرساله كما هو ضمن نافذة الرجوع) — what really changed, not what was resent unchanged
    const sig = function (s) { return [s.lat, s.lng, s.feeder || '', s.region || ''].join('|'); };
    (updates || []).forEach(function (raw) {
      const st = toStation_(raw), k = keyOf_(st);
      if (index.has(k)) { const i = index.get(k); if (sig(next[i]) !== sig(st)) modified++; next[i] = st; replaced++; }
      else { index.set(k, next.length); next.push(st); added++; }
    });
    return { stations: next, added: added, replaced: replaced, modified: modified };
  }

  /**
   * يبني نسخة المزامنة من النسخة المحفوظة ورد getUpdatedStationsSince. لا يعتمدها.
   * يُرجع { ok:true, stations, version, lastSync, changes } أو { ok:false, needsFullLoad, reason }.
   * Builds the sync copy from the stored copy and the getUpdatedStationsSince reply. Doesn't commit it.
   */
  function buildSync(stored, reply) {
    if (!stored || !Array.isArray(stored.stations)) return { ok: false, needsFullLoad: true, reason: 'لا توجد نسخة محفوظة' };
    if (!reply || !reply.success || !Array.isArray(reply.updated) || reply.version == null) return { ok: false, needsFullLoad: false, reason: 'رد غير صالح من الخادم' };
    if (isOlder_(reply.version, stored.version)) return { ok: false, needsFullLoad: false, reason: 'رد أقدم من النسخة المحفوظة' };
    const built = applyUpdates(stored.stations, reply.updated);
    if (built.stations.length !== stored.stations.length + built.added) return { ok: false, needsFullLoad: false, reason: 'عدد المحطات لم يطابق المتوقع' };
    if (typeof reply.totalCount === 'number' && built.stations.length !== reply.totalCount) {
      return { ok: false, needsFullLoad: true, reason: 'عدد النسخة (' + built.stations.length + ') لا يطابق الخادم (' + reply.totalCount + ') — محطة حُذفت أو تغيّر رقمها' };
    }
    return { ok: true, stations: built.stations, version: String(reply.version), lastSync: reply.serverTime || null, changes: reply.updated.length, added: built.added, modified: built.modified };
  }

  /* هل النسخة المحفوظة مطابقة لإصدار الخادم؟ — Does the stored copy match the server version? */
  function isCurrent(stored, serverVersion) {
    return !!stored && serverVersion != null && stored.version === String(serverVersion);
  }

  global.SecStationsDB = {
    read: read, commit: commit, clear: clear, createFullLoad: createFullLoad,
    applyUpdates: applyUpdates, buildSync: buildSync, isCurrent: isCurrent
  };
})(typeof window !== 'undefined' ? window : globalThis);
