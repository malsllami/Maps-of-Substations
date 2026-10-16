/* ============================================================
 * services/fresh-start.js — «البداية النظيفة» يوم الانتقال من V1 إلى V2 (خطة محمد — 16 أكتوبر)
 * ============================================================
 * مرة واحدة لكل جهاز، وفقط حين CONFIG.FRESH_START.ENABLED (يُفعَّل يوم الانتقال):
 * 1. ينقل جوال V1 المحفوظ (sec-phone أو جوال جلسة V1) إلى حقل الدخول في V2 — نفس فكرة «تذكرني» — إن لم يكن لـ V2 جوال.
 * 2. يمسح بيانات V1 من هذا الجهاز: مفاتيح localStorage التي تبدأ بـ «sec-»، وذاكرات الملفات «sec-…»، وقاعدتي V1 بالاسم.
 *    لا يمس «sec2-» ولا أي مشروع آخر على نفس النطاق (malsllami.github.io مشترك بين المستودعات).
 * 3. يمسح جلسة V2 ونسخة محطاتها، فيسجّل الجميع الدخول من جديد ويحمّلون البيانات الحديثة.
 *    التفضيلات (الثيم، نمط الخريطة، «تذكرني») وخريطة جدة المحمّلة في V2 تبقى.
 * 4. بعد تحميل الصفحة: بطاقة «نسخة جديدة محسّنة» ← الجولة ← صفحة الدخول.
 * الجزء المتزامن (localStorage) يتم لحظة تحميل الملف في <head> قبل أي سكربت يقرأ الجلسة، وحذف القواعد يُطلب قبل أن
 * تفتحها الصفحة (IndexedDB تنتظر الحذف قبل أي فتح لاحق).
 *
 * Migration-day «fresh start» (Mohammed's plan): once per device, only when enabled. Moves V1's saved phone into V2's login
 * field, wipes V1's own data on this device (sec- keys, sec- caches, V1's two databases by name — never sec2- nor other
 * projects on the shared origin), clears V2's session and station copy so everyone logs in again, then card ← tour ← login.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('fresh-start.js يحتاج config/الإعدادات.js قبله / needs the config first');
  const FS = CONFIG.FRESH_START, K = CONFIG.STORAGE_KEYS;
  const V2_PREFIX = CONFIG.STORAGE_PREFIX;
  // ما يُمسح من V2 (الجلسة والبيانات) — ما سواه من تفضيلات يبقى — what is cleared from V2 (session and data); preferences stay
  const V2_CLEAR = [K.SESSION, K.STATIONS_META, K.STATIONS_LOAD_LOG, K.STATIONS_ISSUES_LOG, K.RECENT_STATIONS, K.LAST_BACKEND_OK, K.PENDING_ERRORS, K.SETTINGS_LISTS];
  let ran = false, pending = Promise.resolve();

  function ls_() { try { return global.localStorage; } catch (e) { return null; } }
  function isV1Key_(k) { return typeof k === 'string' && k.indexOf(FS.V1_PREFIX) === 0 && k.indexOf(V2_PREFIX) !== 0; }

  /* جوال V1: المفتاح المباشر ثم جوال الجلسة — V1's phone: the direct key, then the session's phone */
  function v1Phone_(store) {
    const direct = store.getItem(FS.V1_PHONE_KEY);
    if (direct) return direct;
    try { const s = JSON.parse(store.getItem(FS.V1_SESSION_KEY) || 'null'); return (s && s.phone) || ''; } catch (e) { return ''; }
  }

  /* الجزء المتزامن: الجوال ثم مسح المفاتيح — the synchronous part: the phone, then clearing the keys */
  function runSync_(store) {
    const phone = v1Phone_(store);
    if (phone && !store.getItem(K.PHONE) && store.getItem(K.REMEMBER_PHONE) !== '0') store.setItem(K.PHONE, String(phone));
    const v1Keys = [];
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (isV1Key_(k)) v1Keys.push(k); }
    v1Keys.forEach(function (k) { store.removeItem(k); });
    V2_CLEAR.forEach(function (k) { store.removeItem(k); });
    store.setItem(K.FRESH_START, FS.ID);
    return v1Keys.length;
  }

  /* الجزء غير المتزامن: الذاكرات والقواعد — فشل أي منها لا يوقف الموقع — the async part: caches and databases; a failure never stops the site */
  function dropDb_(name) {
    return new Promise(function (resolve) {
      try { const r = global.indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = function () { resolve(); }; } catch (e) { resolve(); }
    });
  }
  function runAsync_() {
    const jobs = FS.V1_DATABASES.concat([CONFIG.DB_NAMES.STATIONS]).map(dropDb_);
    if (global.caches && global.caches.keys) {
      jobs.push(global.caches.keys().then(function (names) {
        return Promise.all(names.filter(isV1Key_).map(function (n) { return global.caches.delete(n); }));
      }).catch(function () { /* لا شيء / nothing */ }));
    }
    return Promise.all(jobs).then(function () { return true; });
  }

  /**
   * run() — يُستدعى تلقائيًا عند تحميل الملف. يُرجع { ran, v1Keys } — Called automatically on load.
   */
  function run() {
    const store = ls_();
    if (!FS || !FS.ENABLED || !store) return { ran: false };
    try { if (store.getItem(K.FRESH_START) === FS.ID) return { ran: false }; } catch (e) { return { ran: false }; }
    let v1Keys = 0;
    try { v1Keys = runSync_(store); } catch (e) { return { ran: false }; } // تخزين محظور ← الموقع يعمل كالمعتاد / storage blocked ← site as usual
    ran = true;
    pending = runAsync_();
    return { ran: true, v1Keys: v1Keys };
  }

  /* بعد تحميل الصفحة: البطاقة ثم الجولة ثم صفحة الدخول — after load: the card, the tour, then login */
  function showWelcome_() {
    const done = function () { if (global.location.pathname.indexOf('auth.html') === -1) global.location.href = 'auth.html'; };
    if (global.SecFeatureTour) global.SecFeatureTour.showCard({ onDone: done }); else done();
  }

  run();
  if (ran) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', showWelcome_);
    else showWelcome_();
  }

  global.SecFreshStart = { run: run, justRan: function () { return ran; }, whenDone: function () { return pending; } };
})(typeof window !== 'undefined' ? window : globalThis);
