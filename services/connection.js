/* ============================================================
 * services/connection.js — مسؤول عن معرفة "هل الخادم متصل؟" بأقل عدد طلبات.
 * أي رد JSON سليم من الخادم (إحصاءات، بحث، حفظ...) يثبت الاتصال مثل طلب
 * فحص الاتصال (ping) تمامًا — فيُسجَّل وقته هنا، ويُتخطّى ping إن نجح أي طلب
 * خلال المدة المحددة. كان ping وحده حوالي 38٪ من طلبات اليوم دون أن يجلب أي بيانات.
 * الوقت محفوظ بـlocalStorage فيُشارَك بين الصفحات والتبويبات (الانتقال من الرئيسية
 * للوحة المدير لا يرسل ping جديدًا).
 *
 * Owns "is the server reachable?" with the fewest requests. Any valid JSON
 * reply from the server (stats, search, save...) proves connectivity exactly
 * like a ping — so its time is recorded here, and ping is skipped if any
 * request succeeded within the given window. Ping alone was ~38% of daily
 * requests while fetching no data. The time lives in localStorage so it's
 * shared across pages and tabs (going from home to the admin panel sends no new ping).
 * ============================================================ */
(function (global) {
  'use strict';

  const LAST_OK_KEY = 'sec-last-backend-ok';
  const API_MARKER = 'script.google.com/macros/';
  const originalFetch = global.fetch.bind(global);

  function recordOk_() {
    try { localStorage.setItem(LAST_OK_KEY, String(Date.now())); } catch (e) { /* تخزين محظور — يُرسل ping كالسابق / storage blocked — ping is sent as before */ }
  }

  /* يراقب ردود الخادم فقط دون تعديلها: رد JSON ناجح = الخادم متصل. صفحات خطأ جوجل (HTML) لا تُحسب.
   * Watches server replies only, never altering them: a successful JSON reply = server reachable. Google error pages (HTML) don't count. */
  global.fetch = function (input, init) {
    const request = originalFetch(input, init);
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(API_MARKER) === -1) return request;
    return request.then(function (res) {
      const contentType = (res.headers && res.headers.get('content-type')) || '';
      if (res.ok && contentType.indexOf('application/json') !== -1) recordOk_();
      return res;
    });
  };

  function lastOkAt() {
    try { return Number(localStorage.getItem(LAST_OK_KEY)) || 0; } catch (e) { return 0; }
  }

  /**
   * ينفّذ pingFn فقط إن لم ينجح أي طلب خلال maxAgeMs. عند التخطي يُرجع { success, skipped, at }
   * حيث at وقت آخر رد ناجح فعلي — ليبقى "آخر تحديث" بالواجهة صادقًا.
   * Runs pingFn only if no request succeeded within maxAgeMs. When skipped, returns { success, skipped, at }
   * where at is the real time of the last successful reply — so the UI's "last update" stays truthful.
   */
  function pingUnlessRecent(pingFn, maxAgeMs) {
    const at = lastOkAt();
    if (at && Date.now() - at < maxAgeMs) return Promise.resolve({ success: true, skipped: true, at: at });
    return pingFn();
  }

  global.SecConnection = { lastOkAt: lastOkAt, pingUnlessRecent: pingUnlessRecent };
})(window);
