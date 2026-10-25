/* ============================================================
 * services/connection.js — مسؤول عن حالة الاتصال بالخادم:
 * 1) معرفة "هل الخادم متصل؟" بأقل عدد طلبات: أي رد JSON سليم (إحصاءات، بحث،
 *    حفظ...) يثبت الاتصال مثل ping تمامًا، فيُتخطّى ping إن نجح أي طلب خلال المدة
 *    المحددة. الوقت بـlocalStorage فيُشارَك بين الصفحات والتبويبات.
 * 2) تسجيل الأخطاء بـ"سجل الأخطاء" لكل المستخدمين: كل طلب فشل (صفحة خطأ من جوجل
 *    مثل 404، انقطاع اتصال، انتهاء مهلة) وكل خطأ برمجي بالصفحة. الخطأ يُحفظ أولًا
 *    بالجهاز ثم يُرسل بعد أول رد سليم من الخادم — لأن لحظة الفشل نفسها غالبًا لا
 *    يصل فيها أي طلب. بلا بيانات شخصية: نوع الجهاز والمتصفح فقط.
 * 3) التصنيف: فشل حقيقي · تأخر وعالجه الاحتياطي · فشل أثناء الخلفية/النوم · نتيجة كتابة غير مؤكدة
 *    (الـ404 يُميَّز بالخادم من رسالته)، مع requestId وعنوان الرد والتحويل وحالة الخلفية لكل محاولة.
 *
 * Owns the server-connection state:
 * 1) "Is the server reachable?" with the fewest requests: any valid JSON reply
 *    proves connectivity exactly like a ping, so ping is skipped if any request
 *    succeeded within the window. Stored in localStorage, shared across pages/tabs.
 * 2) Error logging to the error-log sheet for all users: every failed request
 *    (Google error page such as 404, dropped connection, timeout) and every page
 *    JavaScript error. Errors are queued on the device first and sent after the
 *    next valid server reply — the failure moment itself usually lets nothing
 *    through. No personal data: device and browser type only.
 * 3) Classification: real failure · delayed and recovered by the backup · failed during background/sleep ·
 *    write result unconfirmed (404 is told apart on the server from its message), with the requestId, reply URL,
 *    redirect and background state of every attempt.
 *
 * V2: نفس السلوك المعتمد في V1، مع ربطه بهيكل V2 فقط: المفاتيح وعنوان الخادم من config/الإعدادات.js (بادئة sec2-)،
 * ويُعرف طلب الخادم بمطابقة عنوان V2 تمامًا (لا أي رابط Apps Script)، و«حذف محطة» ضمن إجراءات الكتابة.
 * V2: the same approved V1 behavior, only rewired to the V2 structure: keys and the server address come from
 * config/الإعدادات.js (sec2- prefix), a server request is recognized by the exact V2 address (not any Apps Script
 * link), and deleteStation is among the write actions.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('connection.js يحتاج config/الإعدادات.js قبله / needs config/الإعدادات.js loaded first');
  const LAST_OK_KEY = CONFIG.STORAGE_KEYS.LAST_BACKEND_OK;
  const PENDING_ERRORS_KEY = CONFIG.STORAGE_KEYS.PENDING_ERRORS;
  const API_URL = CONFIG.API_BASE_URL;
  const MAX_PENDING = 20;          // حد الأخطاء المنتظرة بالجهاز / max queued errors on the device
  const MAX_SEND_PER_FLUSH = 20;   // كلها في طلب واحد / all in a single request
  const originalFetch = global.fetch.bind(global);
  let flushing = false;
  let leavingPage = false;
  // إلغاء المتصفح للطلبات عند مغادرة الصفحة ليس عطلًا فلا يُسجَّل / the browser cancelling requests on page leave isn't a fault — not logged
  global.addEventListener('beforeunload', function () { leavingPage = true; });
  global.addEventListener('pagehide', function () { leavingPage = true; });

  function recordOk_() {
    noteOk_();
    try { localStorage.setItem(LAST_OK_KEY, String(Date.now())); } catch (e) { /* تخزين محظور — يُرسل ping كالسابق / storage blocked — ping is sent as before */ }
  }

  /* ===== وصف الجهاز بلا بيانات شخصية — Device description without personal data ===== */
  function deviceSummary_() {
    const ua = navigator.userAgent || '';
    let device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : 'غير معروف';
    const ios = ua.match(/OS (\d+)_(\d+)/);
    if (ios && (device === 'iPhone' || device === 'iPad')) device += ' iOS ' + ios[1] + '.' + ios[2];
    const browser = /EdgA?\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
      : /SamsungBrowser/.test(ua) ? 'Samsung' : /Safari\//.test(ua) ? 'Safari' : 'غير معروف';
    let installed = false;
    try { installed = navigator.standalone === true || global.matchMedia('(display-mode: standalone)').matches; } catch (e) {}
    const net = navigator.connection && navigator.connection.effectiveType ? ' | الشبكة: ' + navigator.connection.effectiveType : '';
    return device + ' — ' + browser + (installed ? ' (تطبيق مثبّت)' : ' (متصفح)') + net;
  }

  /* بيانات الجهاز منفصلة لأعمدة «سجل الأخطاء» الجديدة (16 أكتوبر) — device data split for the new error-log columns */
  function deviceMeta_() {
    const ua = navigator.userAgent || '';
    const type = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : 'غير معروف';
    const ios = ua.match(/OS (\d+)_(\d+)/), android = ua.match(/Android (\d+(?:\.\d+)?)/), mac = ua.match(/Mac OS X (\d+)[_.](\d+)/), win = ua.match(/Windows NT (\d+\.\d+)/);
    const os = (type === 'iPhone' || type === 'iPad') && ios ? 'iOS ' + ios[1] + '.' + ios[2] : android ? 'Android ' + android[1]
      : mac ? 'macOS ' + mac[1] + '.' + mac[2] : win ? 'Windows ' + win[1] : type;
    const v = function (re) { const m = ua.match(re); return m ? ' ' + m[1] : ''; };
    const browser = /EdgA?\//.test(ua) ? 'Edge' + v(/EdgA?\/(\d+)/) : /CriOS|Chrome\//.test(ua) ? 'Chrome' + v(/(?:CriOS|Chrome)\/(\d+)/)
      : /FxiOS|Firefox\//.test(ua) ? 'Firefox' + v(/(?:FxiOS|Firefox)\/(\d+)/) : /SamsungBrowser/.test(ua) ? 'Samsung' + v(/SamsungBrowser\/(\d+)/)
      : /Safari\//.test(ua) ? 'Safari' + v(/Version\/(\d+(?:\.\d+)?)/) : 'غير معروف';
    let installed = false;
    try { installed = navigator.standalone === true || global.matchMedia('(display-mode: standalone)').matches; } catch (e) {}
    const net = navigator.connection && navigator.connection.effectiveType ? ' · ' + navigator.connection.effectiveType : '';
    return { deviceType: type, os: os, browser: browser, openMode: (installed ? 'تطبيق مثبّت' : 'متصفح') + net };
  }
  /* جوال العضو من الجلسة (بلا اعتماد على session.js)، ومعرّف جهاز ثابت لمن لم يسجّل دخوله — لعدّ «الأعضاء المتأثرين»
     The member's phone from the session (no dependency on session.js), and a stable device id for the logged-out */
  function personMeta_() {
    let phone = '', deviceId = '';
    try { phone = (JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION) || 'null') || {}).phone || ''; } catch (e) { phone = ''; }
    try {
      deviceId = localStorage.getItem(CONFIG.STORAGE_KEYS.DEVICE_ID) || '';
      if (!deviceId) { deviceId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem(CONFIG.STORAGE_KEYS.DEVICE_ID, deviceId); }
    } catch (e) { deviceId = ''; }
    return { phone: phone, deviceId: deviceId };
  }

  function pageName_() {
    return location.pathname.split('/').pop() || 'index.html';
  }
  function clock_() {
    return new Date().toLocaleTimeString('en-GB', { hour12: false });
  }

  /* ===== طابور الأخطاء بالجهاز ثم إرسالها — On-device error queue, then sending ===== */
  function readQueue_() {
    try { return JSON.parse(localStorage.getItem(PENDING_ERRORS_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeQueue_(queue) {
    try { localStorage.setItem(PENDING_ERRORS_KEY, JSON.stringify(queue.slice(-MAX_PENDING))); } catch (e) {}
  }
  /* meta (اختياري): { action, failKind, outcome, file } — تُكمَّل ببيانات الجهاز والصفحة والعضو لأعمدة السجل المنفصلة
     meta (optional): completed with device, page and member data for the separate log columns */
  function queueError_(source, message, details, meta) {
    const queue = readQueue_(), person = personMeta_();
    queue.push({
      id: newErrorId_(),
      source: source,
      message: String(message).slice(0, 180),
      details: ('وقت الحدوث: ' + clock_() + ' | الصفحة: ' + pageName_() + ' | ' + details + ' | الجهاز: ' + deviceSummary_() +
        (person.deviceId ? ' | معرّف الجهاز: ' + person.deviceId : '')).slice(0, 1500),
      meta: Object.assign(deviceMeta_(), { page: pageName_(), phone: person.phone, deviceId: person.deviceId }, meta || {})
    });
    writeQueue_(queue);
  }

  /* رقم فريد لكل خطأ: الخادم يتجاهل أي خطأ سجّله من قبل. إعادة الإرسال بعد 404 من جوجل (حيث يكون الخطأ قد
   * سُجّل فعلًا) لا تكرر الصف. A unique id per error: the server ignores any error it already logged. Resending
   * after a Google 404 (when the error was in fact logged) never duplicates the row. */
  function newErrorId_() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* يرسل كل الأخطاء المنتظرة في طلب واحد بعد رد سليم من الخادم؛ إن فشل الإرسال تعود للطابور للمرة القادمة
   * Sends all queued errors in ONE request after a healthy reply; if sending fails they go back for next time */
  function flushQueue_() {
    if (flushing) return;
    const queue = readQueue_();
    if (!queue.length) return;
    flushing = true;
    const batch = queue.slice(0, MAX_SEND_PER_FLUSH).map(function (item) {
      if (!item.id) item.id = newErrorId_(); // أخطاء محفوظة قبل هذا التحديث بلا رقم / errors queued before this update have no id
      return item;
    });
    writeQueue_(queue.slice(batch.length));
    originalFetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'logClientError', errors: batch })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
    }).catch(function () {
      writeQueue_(batch.concat(readQueue_())); // فشل الإرسال — تعود للطابور بنفس أرقامها / send failed — back to the queue with the same ids
    }).finally(function () { flushing = false; });
  }

  function actionOf_(init) {
    try { return JSON.parse(init && init.body || '{}').action || 'غير معروف'; } catch (e) { return 'غير معروف'; }
  }
  function titleOf_(html) {
    const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html || '');
    return m ? m[1].trim().slice(0, 80) : String(html || '').replace(/\s+/g, ' ').slice(0, 80);
  }

  /* ===== تتبّع الخلفية والنوم — Background / sleep tracking =====
   * طلب مرّ بالخلفية (أو نام الجوال أثناءه) زمنه ليس زمن شبكة، ويُصنَّف منفصلًا. يُقاس بساعة الجهاز لأن النوم يوقف المؤقتات.
   * A request that went through background (or the phone slept) isn't network time, and is classified separately.
   * Measured with the wall clock because sleep stops timers. */
  const doc = global.document || { visibilityState: 'visible', addEventListener: function () {} }; // خارج المتصفح (اختبارات) / outside a browser (tests)
  let hiddenTotalMs = 0;
  let hiddenSince = doc.visibilityState === 'hidden' ? Date.now() : 0;
  let lastVisibleAt = Date.now();
  doc.addEventListener('visibilitychange', function () {
    const now = Date.now();
    if (doc.visibilityState === 'hidden') { if (!hiddenSince) hiddenSince = now; return; }
    if (hiddenSince) { hiddenTotalMs += now - hiddenSince; hiddenSince = 0; }
    lastVisibleAt = now;
  });
  global.addEventListener('pageshow', function (ev) { if (ev.persisted) lastVisibleAt = Date.now(); }); // رجوع من ذاكرة المتصفح / restored from the back-forward cache
  function hiddenClock_() { return hiddenTotalMs + (hiddenSince ? Date.now() - hiddenSince : 0); }

  /* ===== محاولة طلب: كل ما نعرفه عنها — A request attempt: everything we know about it ===== */
  function startAttempt_(action, requestId) {
    return { action: action, requestId: requestId, startedAt: Date.now(), hiddenAtStart: hiddenClock_(),
      hiddenAtStartNow: doc.visibilityState === 'hidden', sinceVisibleSec: (Date.now() - lastVisibleAt) / 1000, kind: 'pending' };
  }
  function endAttempt_(a, fields) {
    a.ms = Date.now() - a.startedAt;
    a.hiddenMs = hiddenClock_() - a.hiddenAtStart;
    a.hiddenDuring = a.hiddenMs > 0 || a.hiddenAtStartNow;
    a.offline = navigator.onLine === false;
    Object.keys(fields).forEach(function (k) { a[k] = fields[k]; });
    return a;
  }
  /* عنوان الرد بلا معاملات (مفتاح الرد لمرة واحدة لا يُحفظ) — the reply URL without parameters (the one-time reply key is never stored) */
  function bareUrl_(u) {
    try { const x = new URL(u); return x.host + x.pathname; } catch (e) { return String(u || '').split('?')[0].slice(0, 120); }
  }
  function sec_(ms) { return (ms / 1000).toFixed(1) + ' ث'; }
  /* نوع الفشل مختصرًا لعمود «نوع الفشل» ولرمز المشكلة — the failure kind, short, for the column and the problem code */
  function failKind_(a) {
    return !a ? '' : a.kind === 'http' ? 'صفحة HTTP ' + a.status : a.kind === 'timeout' ? 'انتهاء المهلة'
      : a.kind === 'invalid-reply' ? 'رد ليس من خادمنا' : a.kind === 'cancelled' ? 'تأخر أكثر من 8 ث' : 'انقطاع';
  }
  function whatFailed_(a) {
    return a.kind === 'http' ? 'رد غير سليم HTTP ' + a.status
      : a.kind === 'timeout' ? 'انتهت المهلة'
      : a.kind === 'invalid-reply' ? 'رد ليس من خادمنا'
      : a.kind === 'cancelled' ? 'لم يرد خلال 8 ث — أُلغي بعد نجاح الطلب الاحتياطي'
      : 'انقطاع الاتصال';
  }
  /* وصف محاولة واحدة بالتفاصيل — one attempt described for the details column */
  function describeAttempt_(a) {
    const parts = ['requestId: ' + (a.requestId || '—'), 'الانتظار: ' + sec_(a.ms || 0),
      'الصفحة بالخلفية أثناء الطلب: ' + (a.hiddenDuring ? 'نعم (مدة الخلفية: ' + sec_(a.hiddenMs) + ')' : 'لا'),
      'منذ ظهور الصفحة عند بدء الطلب: ' + a.sinceVisibleSec.toFixed(1) + ' ث'];
    if (a.kind === 'http') {
      parts.push('الحالة: ' + a.status, 'رابط الرد: ' + (a.responseUrl || '—'), 'تحويل: ' + (a.redirected ? 'نعم' : 'لا'), 'نوع الرد: ' + (a.contentType || 'غير محدد'));
      if (a.title) parts.push('عنوان الرد: ' + a.title); // نفس معنى «عنوان الرد» بالسجل القديم / same meaning as «عنوان الرد» in the old log
    } else if (a.kind !== 'ok' && a.kind !== 'cancelled' && a.kind !== 'invalid-reply') {
      parts.push('رسالة المتصفح: ' + String(a.errMessage || '').slice(0, 80));
    }
    return parts.join(' | ');
  }

  /* ===== التصنيف — Classification =====
   * إجراءات تكتب بيانات: فشلها لا يعني أن الكتابة لم تتم (قد يكون الخادم نفّذها وضاع الرد) ← «نتيجة كتابة غير مؤكدة».
   * Data-writing actions: their failure doesn't mean the write didn't happen (the server may have done it and the reply got lost) */
  // (25 أكتوبر) clearSearchCache ليس منها: يعيد بناء فهرس البحث فقط وتكراره آمن، ففشله المنفرد عابر لا يُسجَّل
  // clearSearchCache isn't one: it only rebuilds the search index and is safe to repeat, so a single failure is transient
  const WRITE_ACTIONS = { addNewStation: 1, updateCoordinates: 1, deleteStation: 1, registerUser: 1, registerCredential: 1, updateMemberProfile: 1 };
  // طلبات لا يُسجَّل فشلها أبدًا: سجل الأخطاء نفسه وعدّادات الاستخدام (تُعاد تلقائيًا) — never logged: the logger and the usage counters
  const QUIET_ACTIONS = { logClientError: 1, logUsage: 1 };

  /* ===== قواعد السجل (محمد 22 أكتوبر): المشاكل الحقيقية فقط — The logging rules: real problems only =====
   * يُسجَّل: نتيجة كتابة غير مؤكدة؛ تأخير طلب دقيقتين فأكثر ثم نجح («تأخير اتصال طويل»)؛ والخادم لا يرد دقيقتين فأكثر والجهاز
   * متصل والصفحة ظاهرة («تعطّل الموقع» — مرة واحدة حتى يعود رد سليم). كل ما سواها عابر لا يُسجَّل: فشل طلب واحد، أو ما
   * عالجه الاحتياطي أو إعادة الإرسال في أقل من دقيقتين، أو والصفحة في الخلفية، أو والجهاز بلا إنترنت. زمن الخلفية لا يُحتسب.
   * Logged: an unconfirmed write; a request delayed two minutes or more then succeeded; the server not answering for two
   * minutes or more while online and visible (once until a healthy reply). Everything else is transient and not logged. */
  const LOG = { DELAY: CONFIG.TIMING.LOG_DELAY_MS, DOWN: CONFIG.TIMING.LOG_DOWN_MS };
  function incidentMs_(attempts) {
    const start = Math.min.apply(null, attempts.map(function (a) { return a.startedAt; }));
    const end = Math.max.apply(null, attempts.map(function (a) { return a.startedAt + (a.ms || 0); }));
    const hidden = Math.max.apply(null, attempts.map(function (a) { return a.hiddenMs || 0; }));
    return Math.max(0, end - start - hidden);
  }
  function failureMessage_(action, attempts) {
    const main = attempts.filter(function (a) { return a.kind === 'http'; })[0] || attempts[attempts.length - 1];
    return 'نتيجة كتابة غير مؤكدة: ' + action + ': ' + whatFailed_(main);
  }
  function details_(attempts) {
    const labels = attempts.length > 1 ? ['الطلب الأصلي', 'الطلب الاحتياطي'] : [''];
    return attempts.map(function (a, i) { return (labels[i] ? labels[i] + ': ' : '') + describeAttempt_(a); }).join(' || ');
  }

  // ===== تعطّل الموقع: الخادم لا يرد دقيقتين فأكثر — the outage: the server not answering two minutes or more =====
  let downSince = null, downReported = false; // null = لا حادثة جارية / no outage in progress
  function noteOk_() { downSince = null; downReported = false; } // رد سليم ← انتهى التعطّل / a healthy reply ← the outage is over
  function noteDown_(action, attempts) {
    const start = Math.min.apply(null, attempts.map(function (a) { return a.startedAt; }));
    const end = Math.max.apply(null, attempts.map(function (a) { return a.startedAt + (a.ms || 0); }));
    if (downSince === null) downSince = start;
    const span = end - downSince;
    if (span < LOG.DOWN || downReported) return;
    downReported = true;
    const main = attempts[attempts.length - 1];
    queueError_('client/server-down', 'تعطّل الموقع: الخادم لا يرد منذ ' + sec_(span) + ' (آخر طلب: ' + action + ')',
      details_(attempts), { action: action, failKind: failKind_(main), outcome: 'الخادم لا يرد ' + sec_(span) });
  }

  /* فشل نهائي (طلب واحد، أو الأصلي والاحتياطي معًا) — a final failure (one request, or the original and backup together) */
  function reportFailure(action, attempts, note) {
    if (leavingPage || !attempts.length || QUIET_ACTIONS[action] || attempts.every(function (a) { return a.offline; })) return;
    if (attempts.some(function (a) { return a.hiddenDuring; })) return; // الصفحة في الخلفية ← لا يُسجَّل / in the background ← not logged
    if (WRITE_ACTIONS[action]) { // كتابة لم تتأكد — قد لا تكون البيانات حُفظت / an unconfirmed write — the data may not be saved
      const main = attempts.filter(function (a) { return a.kind === 'http'; })[0] || attempts[attempts.length - 1];
      queueError_('client/write-unconfirmed', failureMessage_(action, attempts) + (attempts.length > 1 ? ' (الأصلي والاحتياطي)' : ''),
        details_(attempts) + (note ? ' || ' + note : ''), { action: action, failKind: failKind_(main), outcome: 'غير مؤكدة' });
      return;
    }
    noteDown_(action, attempts); // غير ذلك: يُعدّ نحو «تعطّل الموقع» فقط / otherwise: it only counts toward an outage
  }
  /* تأخير عولج تلقائيًا: يُسجَّل فقط إن بلغ دقيقتين — an auto-handled delay: logged only at two minutes or more */
  function reportDelay_(action, attempts, how, detailsText, failed) {
    const ms = incidentMs_(attempts);
    if (QUIET_ACTIONS[action] || ms < LOG.DELAY) return;
    queueError_('client/long-delay', 'تأخير اتصال طويل: ' + action + ' — ' + sec_(ms) + ' (' + how + ')', detailsText,
      { action: action, failKind: failKind_(failed), outcome: 'نجاح بعد ' + sec_(ms) });
  }
  function reportRecovered(action, original, backup) {
    reportDelay_(action, [original, backup], 'عالجه الطلب الاحتياطي بعد: ' + whatFailed_(original),
      'الطلب الأصلي: ' + describeAttempt_(original) + ' || الطلب الاحتياطي: requestId: ' + (backup.requestId || '—') + ' | الزمن: ' + sec_(backup.ms || 0) + ' | النتيجة النهائية: نجاح', original);
  }
  /* كتابة: تأكدت بالإعادة ← بقاعدة التأخير (دقيقتان)؛ لم تتأكد ← «نتيجة كتابة غير مؤكدة» — a write: confirmed ← the delay rule; not ← unconfirmed */
  function reportWrite(action, attempts, outcome, confirmed) {
    const failed = attempts.filter(function (a) { return a.kind !== 'ok'; });
    if (!failed.length) return;
    const text = attempts.map(function (a, i) { return 'المحاولة ' + (i + 1) + ': ' + (a.kind === 'ok' ? 'رد سليم | ' : '') + describeAttempt_(a); }).join(' || ') + ' || النتيجة النهائية: ' + outcome;
    if (confirmed) { reportDelay_(action, attempts, 'حُفظت بإعادة الإرسال بعد: ' + whatFailed_(failed[0]), text, failed[0]); return; }
    queueError_('client/write-unconfirmed', 'نتيجة كتابة غير مؤكدة: ' + action + ': ' + whatFailed_(failed[0]), text,
      { action: action, failKind: failKind_(failed[0]), outcome: 'غير مؤكدة' });
  }

  /* يراقب طلبات الخادم فقط دون تعديل الطلب أو الرد (سوى إضافة requestId الذي يضيفه قياس الأزمنة أصلًا): الرد السليم يثبت
   * الاتصال ويرسل الأخطاء المنتظرة، والفشل يُحفظ بالطابور. الطلبات «المُدارة» (الاحتياطي وإعادة الحفظ) لا تُسجَّل هنا —
   * صاحبها يعرف النتيجة النهائية فيسجّلها بتصنيفها الصحيح، ويقرأ تفاصيل كل محاولة من signal.__secAttempt.
   * Watches server requests only, never altering request or reply (except adding the requestId that timing adds anyway): a
   * healthy reply proves connectivity and sends queued errors; a failure is queued. "Managed" requests (backup reads and save
   * retries) aren't logged here — their owner knows the final outcome and logs it with the right classification, reading
   * each attempt's details from signal.__secAttempt. */
  global.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.split('?')[0] !== API_URL) return originalFetch(input, init); // طلبات غير خادم V2 تمر كما هي / non-V2-server requests pass through
    const action = actionOf_(init);
    if (QUIET_ACTIONS[action]) return originalFetch(input, init); // سجل الأخطاء وعدّادات الاستخدام لا يُسجَّل فشلهما / never logged
    let requestId = '';
    try {
      const payload = JSON.parse(init.body);
      requestId = payload.requestId || (Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6));
      if (!payload.requestId) { payload.requestId = requestId; init = Object.assign({}, init, { body: JSON.stringify(payload) }); }
    } catch (e) { /* جسم غير JSON — يُرسل كما هو / non-JSON body — sent as is */ }
    const request = originalFetch(input, init);
    const signal = init && init.signal;
    const managed = !!(signal && signal.__secManaged);
    const attempt = startAttempt_(action, requestId);
    if (managed) signal.__secAttempt = attempt;

    return request.then(function (res) {
      const contentType = (res.headers && res.headers.get('content-type')) || '';
      if (res.ok && contentType.indexOf('application/json') !== -1) {
        endAttempt_(attempt, { kind: 'ok' });
        recordOk_();
        flushQueue_();
      } else {
        endAttempt_(attempt, { kind: 'http', status: res.status, responseUrl: bareUrl_(res.url), redirected: !!res.redirected, contentType: contentType });
        // صفحة خطأ بدل الرد (مثل 404) — عنوانها من نسخة منفصلة دون المساس بالرد الأصلي
        // An error page instead of the reply (e.g. 404) — its title from a separate copy without touching the original
        res.clone().text().then(function (body) {
          attempt.title = titleOf_(body);
          if (!managed && !leavingPage) reportFailure(action, [attempt]);
        }).catch(function () { if (!managed && !leavingPage) reportFailure(action, [attempt]); });
      }
      return res;
    }, function (err) {
      // إلغاء الطلب الاحتياطي الأبطأ مقصود وليس عطلًا / cancelling the slower backup request is intentional, not a fault
      const hedgeLoser = signal && signal.__secHedgeLoser;
      endAttempt_(attempt, { kind: hedgeLoser ? 'cancelled' : err && err.name === 'AbortError' ? 'timeout' : 'network', errMessage: String(err && err.message || err) });
      if (!managed && !leavingPage && !hedgeLoser) reportFailure(action, [attempt]);
      throw err;
    });
  };

  /* ===== الأخطاء البرمجية بالصفحة — Page JavaScript errors ===== */
  const seenJsErrors = {}; // نفس الخطأ مرة واحدة لكل فتح صفحة / the same error once per page open
  function isConnectionSideEffect_(msg) {
    // أخطاء ناتجة عن فشل اتصال مسجّل أصلًا أعلاه — لا تُكرر (ومنها «invalid-reply» الذي يسجّله الطلب الاحتياطي بنتيجته)
    // side effects of a connection failure already logged above — not duplicated (including «invalid-reply», logged by the backup request with its outcome)
    return /Load failed|Failed to fetch|NetworkError|did not match the expected pattern|Unexpected token|JSON|invalid-reply/i.test(msg);
  }
  /* where: الملف:السطر:العمود؛ stack: أول أسطر تسلسل الاستدعاءات (إن توفر) — where: file:line:column; stack: the first call-stack lines */
  function queueJsError_(msg, where, stack) {
    if (!msg || msg === 'Script error.' || isConnectionSideEffect_(msg)) return; // "Script error." = سكربت خارجي بلا تفاصيل / cross-origin script with no details
    if (/ResizeObserver loop/i.test(msg)) return; // تحذير متصفح معروف غير ضار، لا خلل ظاهر / a known harmless browser warning, no visible fault
    const key = msg + '|' + where;
    if (seenJsErrors[key]) return;
    seenJsErrors[key] = true;
    // أول سطرين، ثم أول سطرين من كودنا (خارج libs/): خطأ داخل مكتبة يُظهر من استدعاها (25 أكتوبر — كانت أسطر Leaflet وحدها)
    // the first two lines, then our first two frames (outside libs/): an error inside a library shows who called it
    const lines = String(stack || '').split('\n').map(function (l) { return l.trim().replace(/https?:\/\/[^/]+\/[^/]*\//g, ''); }).filter(Boolean);
    const ours = lines.slice(3).filter(function (l) { return /\.js:\d/.test(l) && !/libs\//.test(l); }).slice(0, 2);
    const trace = lines.slice(0, 3).concat(ours).join(' ← ');
    queueError_('client/js', 'خطأ برمجي: ' + msg, 'المكان: ' + where + (trace ? ' | تسلسل الاستدعاءات: ' + trace.slice(0, 600) : ''),
      { action: where, failKind: 'خطأ برمجي', file: where, outcome: '—' }); // الملف والسطر في رمز المشكلة: كل خطأ مشكلة مستقلة / file:line in the code
  }
  global.addEventListener('error', function (ev) {
    if (!ev || !ev.message) return; // فشل تحميل صورة/ملف وليس خطأ برمجيًا / a resource load failure, not a script error
    queueJsError_(ev.message, (ev.filename || '').split('/').pop() + ':' + ev.lineno + (ev.colno ? ':' + ev.colno : ''), ev.error && ev.error.stack);
  });
  global.addEventListener('unhandledrejection', function (ev) {
    const reason = ev && ev.reason;
    queueJsError_(reason && reason.message ? reason.message : String(reason || ''), 'وعد غير معالج (Promise)', reason && reason.stack);
  });

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
    // نجاح قديم لا يثبت الاتصال إن كان الجهاز بلا إنترنت الآن — A recent success proves nothing if the device is offline now
    if (at && Date.now() - at < maxAgeMs && navigator.onLine !== false) return Promise.resolve({ success: true, skipped: true, at: at });
    return pingFn();
  }

  /* حدث تشخيصي تعرفه الصفحة وحدها (مثل نوع خطأ البصمة) — بنفس الطابور والتفاصيل الموحدة
   * A diagnostic event only the page knows about (e.g. the fingerprint error type) — through the same queue and standard details */
  function reportEvent(source, message, details, meta) {
    if (leavingPage) return;
    queueError_(String(source), String(message), String(details || ''), meta);
  }

  global.SecConnection = { lastOkAt: lastOkAt, pingUnlessRecent: pingUnlessRecent,
    reportFailure: reportFailure, reportRecovered: reportRecovered, reportWrite: reportWrite, reportEvent: reportEvent };
})(window);
