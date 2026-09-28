/* ============================================================
 * services/stations-db.js — مسؤول عن حفظ نسخة المحطات بالجهاز في IndexedDB فقط.
 * النسخة سجل واحد كامل (المحطات + رقم الإصدار + وقت آخر مزامنة) يُكتب بعملية واحدة (transaction):
 * إما تُعتمد كاملة أو لا يتغيّر شيء — فلا توجد أبدًا نسخة نصفها قديم ونصفها جديد، حتى لو انقطع
 * الاتصال أو أُغلقت الصفحة أثناء الكتابة. البناء والتحقق يتمان قبل الكتابة بواسطة الصفحة.
 * لا يحذف ولا يعدّل نسخة localStorage القديمة — تبقى احتياطًا.
 *
 * Owns the on-device stations copy in IndexedDB only. The copy is ONE complete record
 * (stations + version + last sync time) written in a single transaction: it's either
 * committed whole or nothing changes — never a half-old/half-new copy, even if the
 * connection drops or the page closes mid-write. Building and verifying happen before
 * the write. Never deletes or edits the old localStorage copy — it stays as a fallback.
 * ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'sec-stations';
  const DB_VERSION = 1;
  const STORE = 'snapshots';
  const CURRENT = 'current';
  const SAMPLE_CHECKS = 25; // عينات مطابقة عند النقل إضافة للعدد / sample records compared on migration, besides the count

  let dbPromise = null;
  function open_() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!global.indexedDB) return reject(new Error('IndexedDB غير متاح'));
        let req;
        try { req = global.indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); } // وضع التصفح الخاص ببعض المتصفحات / private mode on some browsers
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
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

  /* يُرجع النسخة المعتمدة أو null — Returns the committed copy or null */
  function read() {
    return open_().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(CURRENT);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /* حجم تقريبي للعرض فقط — Approximate size, for display only */
  function sizeOf_(stations) {
    try { return new Blob([JSON.stringify(stations)]).size; } catch (e) { return 0; }
  }

  /**
   * يعتمد نسخة كاملة جديدة بعملية واحدة. أي خطأ ← تُلغى العملية كلها وتبقى السابقة كما هي.
   * Commits a complete new copy in one transaction. Any error ← the whole transaction aborts, the previous stays as is.
   */
  function commit(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.stations)) return Promise.reject(new Error('نسخة غير صالحة'));
    const record = {
      key: CURRENT, schema: 1,
      stations: snapshot.stations,
      version: snapshot.version == null ? null : String(snapshot.version),
      lastSync: snapshot.lastSync || null,
      count: snapshot.stations.length,
      sizeBytes: sizeOf_(snapshot.stations),
      savedAt: Date.now()
    };
    return open_().then(function (db) {
      return new Promise(function (resolve, reject) {
        let tx;
        try { tx = db.transaction(STORE, 'readwrite', { durability: 'strict' }); } // strict: لا تُعتبر مكتملة قبل الحفظ الفعلي / not "complete" before it's really on disk
        catch (e) { tx = db.transaction(STORE, 'readwrite'); } // متصفحات لا تدعم الخيار / browsers without the option
        tx.oncomplete = function () { resolve(record); };
        tx.onabort = function () { reject(tx.error || new Error('أُلغيت عملية الحفظ — النسخة السابقة سليمة')); };
        try { tx.objectStore(STORE).put(record); }
        catch (e) { try { tx.abort(); } catch (ignore) {} reject(e); }
      });
    });
  }

  /* مسح النسخة (زر "مسح البيانات المؤقتة" فقط) — Clears the copy (the "clear temporary data" button only) */
  function clear() {
    return open_().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(CURRENT);
        tx.oncomplete = function () { resolve(true); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function sameRecord_(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /**
   * النقل الآمن من localStorage: يكتب النسخة ثم يعيد قراءتها ويتحقق (العدد + الإصدار + عينات موزّعة).
   * إن لم تطابق تُزال النسخة الجديدة ويُرمى خطأ فتستمر الصفحة على localStorage كما كانت.
   * Safe migration from localStorage: writes the copy, reads it back and verifies (count + version + spread samples).
   * On mismatch the new copy is removed and an error thrown, so the page carries on with localStorage as before.
   */
  function migrate(snapshot) {
    const src = snapshot.stations;
    return commit(snapshot).then(read).then(function (rec) {
      let ok = !!rec && rec.count === src.length && rec.stations.length === src.length && rec.version === String(snapshot.version);
      if (ok && src.length) {
        const step = Math.max(1, Math.floor(src.length / SAMPLE_CHECKS));
        for (let i = 0; ok && i < src.length; i += step) ok = sameRecord_(rec.stations[i], src[i]);
        ok = ok && sameRecord_(rec.stations[src.length - 1], src[src.length - 1]);
      }
      if (!ok) {
        return clear().catch(function () {}).then(function () { throw new Error('فشل التحقق من نقل المحطات — الاستمرار على localStorage'); });
      }
      return rec;
    });
  }

  function keyOf_(st) { return String(st.id).toUpperCase() + '\u0001' + st.type; }

  /**
   * يبني نسخة جديدة كاملة من القديمة + التحديثات دون لمس القديمة (نفس منطق المطابقة الحالي: الرقم بلا حساسية حالة الأحرف + النوع).
   * Builds a complete new copy from the old one + updates without touching the old one (same matching as before: case-insensitive id + type).
   */
  function applyUpdates(base, updates) {
    const next = base.slice();
    const index = new Map();
    for (let i = 0; i < next.length; i++) { const k = keyOf_(next[i]); if (!index.has(k)) index.set(k, i); } // أول تطابق كما كانت findIndex / first match, as findIndex did
    let added = 0;
    (updates || []).forEach(function (st) {
      const k = keyOf_(st);
      if (index.has(k)) next[index.get(k)] = st;
      else { index.set(k, next.length); next.push(st); added++; }
    });
    return { stations: next, added: added };
  }

  global.SecStationsDB = { read: read, commit: commit, clear: clear, migrate: migrate, applyUpdates: applyUpdates };
})(window);
