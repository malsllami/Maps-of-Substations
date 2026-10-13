/* ============================================================
 * services/timing.js — قياس زمن طلبات خادم V2 في المتصفح (تشخيص فقط)
 * ============================================================
 * يغلّف fetch بشفافية لطلبات خادم V2 فقط: يضيف requestId للطلب (أو يستخدم الموجود)، ويقيس الزمن الكلي الذي انتظره
 * المتصفح، ويقارنه بزمن الخادم (_timing.serverMs) ليُظهر الزمن خارج الخادم (الشبكة وجوجل).
 * - لا يغيّر الطلب (سوى requestId) ولا الرد، وأي خطأ داخل القياس لا يمس نجاح الطلب.
 * - لكل طلب قياسه المستقل (لا حالة مشتركة بين الطلبات سوى عدد الطلبات المتزامنة).
 * - لا يحفظ أي بيانات حساسة: لا جسم الطلب (التذكرة والجوال) ولا الرد؛ فقط الإجراء والأزمنة والحالة ومراحل الخادم،
 *   وبداية الرد فقط إن لم يكن JSON (صفحة خطأ من جوجل) لمعرفة مصدره.
 * - النتائج في هذا الجهاز فقط (آخر 300) في sec2-perf-log، ويعرضها جدول القياس (مكوّن منفصل).
 *
 * Browser-side timing of V2 server requests (diagnostics only). Transparently wraps fetch for V2 server requests only:
 * adds a requestId (or keeps the existing one), measures the total time the browser waited, and compares it with the
 * server time to show the time spent outside the server (network and Google).
 * - Never alters the request (except requestId) or the reply; any error inside the measurement never affects the request.
 * - Each request has its own measurement (no state shared between requests except the concurrency count).
 * - Stores no sensitive data: neither the request body (ticket, phone) nor the reply; only the action, times, status and
 *   server stages, plus the start of the reply only when it isn't JSON (a Google error page) to learn its source.
 * - Results stay on this device only (last 300) in sec2-perf-log; the timing table (a separate component) shows them.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('timing.js يحتاج config/الإعدادات.js قبله / needs config/الإعدادات.js loaded first');
  const LOG_KEY = CONFIG.STORAGE_KEYS.PERF_LOG;
  const TAB_KEY = CONFIG.STORAGE_KEYS.PERF_TAB;
  const API_URL = CONFIG.API_BASE_URL;
  const MAX_ENTRIES = 300;
  const BODY_SNIPPET_CHARS = 150;
  const originalFetch = global.fetch.bind(global);
  let inFlight = 0;
  let leavingPage = false;
  let backgroundCount = 0; // مرات ذهاب الصفحة للخلفية: تغيّره أثناء الطلب = جمّد الجوال الصفحة / page-hidden count: a change mid-request = the phone froze the page

  // beforeunload يسبق إلغاء المتصفح للطلبات عند المغادرة، فتُسمّى «أُلغي» لا «فشل شبكة» / fires before the browser cancels requests on leave
  global.addEventListener('beforeunload', function () { leavingPage = true; });
  global.addEventListener('pagehide', function () { leavingPage = true; });
  global.document.addEventListener('visibilitychange', function () { if (global.document.visibilityState === 'hidden') backgroundCount++; });

  function pageName_() { return global.location.pathname.split('/').pop() || 'index.html'; }
  function clock_() { return new Date().toLocaleTimeString('en-GB', { hour12: false }); }
  function now_() { return global.performance && global.performance.now ? global.performance.now() : Date.now(); }
  function newRequestId_() { return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6); }

  /* معرّف قصير لكل تبويب (يكشف الطلبات المتكررة من تبويبين) — A short per-tab id (exposes duplicates from two tabs) */
  function tabId_() {
    try {
      let id = global.sessionStorage.getItem(TAB_KEY);
      if (!id) { id = Math.random().toString(36).slice(2, 5); global.sessionStorage.setItem(TAB_KEY, id); }
      return id;
    } catch (e) { return '—'; }
  }

  function readLog() {
    try { const log = JSON.parse(global.localStorage.getItem(LOG_KEY) || '[]'); return Array.isArray(log) ? log : []; } catch (e) { return []; }
  }
  function append_(entry) {
    try {
      const log = readLog();
      log.push(entry);
      global.localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_ENTRIES)));
    } catch (e) { /* تخزين ممتلئ أو محظور — القياس في الـConsole فقط / storage full/blocked — console only */ }
  }
  function clearLog() {
    try { global.localStorage.removeItem(LOG_KEY); } catch (e) { /* تخزين محظور / storage blocked */ }
  }

  /* سطر «فتح الصفحة» بنوع الفتح وحالة الدخول (بلا هوية) — A "page open" row with the open type and login state (no identity) */
  function recordPageOpen() {
    let navType = 'غير معروف';
    try { const nav = global.performance.getEntriesByType('navigation')[0]; if (nav) navType = nav.type; } catch (e) { /* غير مدعوم / unsupported */ }
    let state = 'زائر (غير مسجّل)';
    try { if (global.localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION)) state = 'مسجّل دخول'; } catch (e) { /* تخزين محظور / storage blocked */ }
    append_({ at: clock_(), page: pageName_(), tab: tabId_(), kind: 'open', action: 'فتح الصفحة (' + navType + ') — ' + state });
  }

  function isApiPost_(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    return url.split('?')[0] === API_URL && init && String(init.method || '').toUpperCase() === 'POST' && typeof init.body === 'string';
  }

  /* حالة الرد ومراحل الخادم من نصه — بلا أي قيمة من بيانات الرد — The reply status and server stages from its text — no reply data values */
  function describeReply_(text, httpStatus) {
    let json;
    try { json = JSON.parse(text); } catch (e) {
      return { serverMs: null, status: 'رد غير JSON (HTTP ' + httpStatus + ')', stages: ['بداية الرد: ' + String(text).slice(0, BODY_SNIPPET_CHARS)] };
    }
    const t = json && json._timing;
    let status = t ? 'نجاح' : 'بلا _timing';
    if (json && json.error) status = 'رد بخطأ: ' + String(json.error).slice(0, 45);
    else if (json && json.success === false) status = 'رد بفشل';
    return { serverMs: t && typeof t.serverMs === 'number' ? t.serverMs : null, status: status, stages: t && Array.isArray(t.stages) ? t.stages.slice(0, 60) : null };
  }

  global.fetch = function (input, init) {
    if (!isApiPost_(input, init)) return originalFetch(input, init);
    let payload;
    try { payload = JSON.parse(init.body); } catch (e) { return originalFetch(input, init); }
    if (!payload || typeof payload !== 'object') return originalFetch(input, init);

    // نفس الرقم الذي وضعه مراقب الاتصال إن وُجد — فيتطابق جدول القياس وسجل الأخطاء وسجل الخادم
    // The same id the connection watcher set, if any — so the timing table, the error log and the server log match
    const requestId = payload.requestId || newRequestId_();
    payload.requestId = requestId;
    const action = typeof payload.action === 'string' ? payload.action : 'غير معروف';
    const sent = Object.assign({}, init, { body: JSON.stringify(payload) });

    // قياس هذا الطلب وحده — this request's own measurement
    const m = { start: now_(), at: clock_(), concurrent: ++inFlight, background: backgroundCount, done: false };
    function finish(serverMs, status, stages) {
      if (m.done) return;
      m.done = true;
      inFlight = Math.max(0, inFlight - 1);
      try {
        const totalMs = Math.round(now_() - m.start);
        if (backgroundCount !== m.background) status += ' — الصفحة ذهبت للخلفية أثناء الطلب';
        append_({ at: m.at, endAt: clock_(), page: pageName_(), tab: tabId_(), action: action, rid: requestId, serverMs: serverMs, totalMs: totalMs,
          outsideMs: serverMs == null ? null : totalMs - serverMs, concurrent: m.concurrent, status: status, stages: stages || null });
      } catch (e) { /* القياس لا يُفشل الطلب / the measurement never fails the request */ }
    }

    return originalFetch(input, sent).then(function (res) {
      try {
        res.clone().text().then(function (text) {
          const d = describeReply_(text, res.status);
          finish(d.serverMs, d.status, d.stages);
        }).catch(function () { finish(null, 'تعذّر قراءة الرد'); });
      } catch (e) { finish(null, 'تعذّر قراءة الرد'); }
      return res;
    }, function (err) {
      let status = err && err.name === 'AbortError' ? 'أُلغي (انتهت المهلة)' : 'فشل شبكة';
      if (init.signal && init.signal.__secHedgeLoser) status = 'أُلغي (وصل رد الطلب الاحتياطي أولًا)';
      if (leavingPage) status = 'أُلغي (مغادرة/إعادة تحميل الصفحة)';
      finish(null, status);
      throw err;
    });
  };

  global.SecTiming = { readLog: readLog, clearLog: clearLog, recordPageOpen: recordPageOpen, logKey: LOG_KEY };
})(typeof window !== 'undefined' ? window : globalThis);
