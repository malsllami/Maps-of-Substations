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
 * ============================================================ */
(function (global) {
  'use strict';

  const LAST_OK_KEY = 'sec-last-backend-ok';
  const PENDING_ERRORS_KEY = 'sec-pending-errors';
  const API_MARKER = 'script.google.com/macros/';
  const MAX_PENDING = 20;          // حد الأخطاء المنتظرة بالجهاز / max queued errors on the device
  const MAX_SEND_PER_FLUSH = 20;   // كلها في طلب واحد / all in a single request
  const originalFetch = global.fetch.bind(global);
  let lastApiUrl = '';
  let flushing = false;
  let leavingPage = false;
  // إلغاء المتصفح للطلبات عند مغادرة الصفحة ليس عطلًا فلا يُسجَّل / the browser cancelling requests on page leave isn't a fault — not logged
  global.addEventListener('beforeunload', function () { leavingPage = true; });
  global.addEventListener('pagehide', function () { leavingPage = true; });

  function recordOk_() {
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
  function queueError_(source, message, details) {
    const queue = readQueue_();
    queue.push({
      id: newErrorId_(),
      source: source,
      message: String(message).slice(0, 180),
      details: ('وقت الحدوث: ' + clock_() + ' | الصفحة: ' + pageName_() + ' | ' + details + ' | الجهاز: ' + deviceSummary_()).slice(0, 1500)
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
    if (flushing || !lastApiUrl) return;
    const queue = readQueue_();
    if (!queue.length) return;
    flushing = true;
    const batch = queue.slice(0, MAX_SEND_PER_FLUSH).map(function (item) {
      if (!item.id) item.id = newErrorId_(); // أخطاء محفوظة قبل هذا التحديث بلا رقم / errors queued before this update have no id
      return item;
    });
    writeQueue_(queue.slice(batch.length));
    originalFetch(lastApiUrl, {
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
  let hiddenTotalMs = 0;
  let hiddenSince = document.visibilityState === 'hidden' ? Date.now() : 0;
  let lastVisibleAt = Date.now();
  document.addEventListener('visibilitychange', function () {
    const now = Date.now();
    if (document.visibilityState === 'hidden') { if (!hiddenSince) hiddenSince = now; return; }
    if (hiddenSince) { hiddenTotalMs += now - hiddenSince; hiddenSince = 0; }
    lastVisibleAt = now;
  });
  global.addEventListener('pageshow', function (ev) { if (ev.persisted) lastVisibleAt = Date.now(); }); // رجوع من ذاكرة المتصفح / restored from the back-forward cache
  function hiddenClock_() { return hiddenTotalMs + (hiddenSince ? Date.now() - hiddenSince : 0); }

  /* ===== محاولة طلب: كل ما نعرفه عنها — A request attempt: everything we know about it ===== */
  function startAttempt_(action, requestId) {
    return { action: action, requestId: requestId, startedAt: Date.now(), hiddenAtStart: hiddenClock_(),
      hiddenAtStartNow: document.visibilityState === 'hidden', sinceVisibleSec: (Date.now() - lastVisibleAt) / 1000, kind: 'pending' };
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
      parts.push('الحالة: ' + a.status, 'عنوان الرد: ' + (a.responseUrl || '—'), 'تحويل: ' + (a.redirected ? 'نعم' : 'لا'), 'نوع الرد: ' + (a.contentType || 'غير محدد'));
      if (a.title) parts.push('عنوان الصفحة: ' + a.title);
    } else if (a.kind !== 'ok' && a.kind !== 'cancelled' && a.kind !== 'invalid-reply') {
      parts.push('رسالة المتصفح: ' + String(a.errMessage || '').slice(0, 80));
    }
    return parts.join(' | ');
  }

  /* ===== التصنيف — Classification =====
   * إجراءات تكتب بيانات: فشلها لا يعني أن الكتابة لم تتم (قد يكون الخادم نفّذها وضاع الرد) ← «نتيجة كتابة غير مؤكدة».
   * Data-writing actions: their failure doesn't mean the write didn't happen (the server may have done it and the reply got lost) */
  const WRITE_ACTIONS = { addNewStation: 1, updateCoordinates: 1, registerUser: 1, registerCredential: 1, updateMemberProfile: 1, clearSearchCache: 1 };
  function failureSource_(action, attempts) {
    if (WRITE_ACTIONS[action]) return 'client/write-unconfirmed';
    if (attempts.some(function (a) { return a.hiddenDuring; })) return 'client/background';
    return 'client/connection';
  }
  function failureMessage_(action, attempts) {
    const main = attempts.filter(function (a) { return a.kind === 'http'; })[0] || attempts[attempts.length - 1];
    return (WRITE_ACTIONS[action] ? 'نتيجة كتابة غير مؤكدة: ' : 'فشل طلب ') + action + ': ' + whatFailed_(main);
  }

  /* فشل حقيقي (طلب واحد، أو الأصلي والاحتياطي معًا) — a real failure (one request, or the original and backup together).
   * الجهاز بلا إنترنت فعليًا ← متوقع ولا يُسجَّل / device truly offline ← expected, not logged */
  function reportFailure(action, attempts, note) {
    if (leavingPage || !attempts.length || attempts.every(function (a) { return a.offline; })) return;
    const labels = attempts.length > 1 ? ['الطلب الأصلي', 'الطلب الاحتياطي'] : [''];
    const body = attempts.map(function (a, i) { return (labels[i] ? labels[i] + ': ' : '') + describeAttempt_(a); }).join(' || ');
    queueError_(failureSource_(action, attempts), failureMessage_(action, attempts) + (attempts.length > 1 ? ' (الأصلي والاحتياطي)' : ''),
      body + (note ? ' || ' + note : ''));
  }
  /* فشل الأصلي ونجح الاحتياطي: ليس خطأً ولا يُحذف — «تأخر وعالجه الاحتياطي»
   * The original failed and the backup succeeded: not an error, not dropped — "delayed, recovered by the backup" */
  function reportRecovered(action, original, backup) {
    queueError_('client/recovered', 'تأخر وعالجه الاحتياطي: ' + action + ' — ' + whatFailed_(original),
      'الطلب الأصلي: ' + describeAttempt_(original) + ' || الطلب الاحتياطي: requestId: ' + (backup.requestId || '—') +
      ' | الزمن: ' + sec_(backup.ms || 0) + ' | النتيجة النهائية: نجاح');
  }
  /* كتابة انتهت إحدى محاولاتها بلا رد سليم: النتيجة غير مؤكدة، ثم ما انتهت إليه إعادة الإرسال بنفس opKey
   * A write where an attempt ended without a valid reply: result unconfirmed, then what the same-opKey resend concluded */
  function reportWrite(action, attempts, outcome) {
    const failed = attempts.filter(function (a) { return a.kind !== 'ok'; });
    if (!failed.length) return;
    queueError_('client/write-unconfirmed', 'نتيجة كتابة غير مؤكدة: ' + action + ': ' + whatFailed_(failed[0]),
      attempts.map(function (a, i) { return 'المحاولة ' + (i + 1) + ': ' + (a.kind === 'ok' ? 'رد سليم | ' : '') + describeAttempt_(a); }).join(' || ') +
      ' || النتيجة النهائية: ' + outcome);
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
    if (url.indexOf(API_MARKER) === -1) return originalFetch(input, init);
    const action = actionOf_(init);
    if (action === 'logClientError') return originalFetch(input, init); // لا يُسجَّل فشل التسجيل نفسه / never log the logger's own failures
    let requestId = '';
    try {
      const payload = JSON.parse(init.body);
      requestId = payload.requestId || (Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6));
      if (!payload.requestId) { payload.requestId = requestId; init = Object.assign({}, init, { body: JSON.stringify(payload) }); }
    } catch (e) { /* جسم غير JSON — يُرسل كما هو / non-JSON body — sent as is */ }
    const request = originalFetch(input, init);
    lastApiUrl = url;
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
    // أخطاء ناتجة عن فشل اتصال مسجّل أصلًا أعلاه — لا تُكرر / side effects of a connection failure already logged above — not duplicated
    return /Load failed|Failed to fetch|NetworkError|did not match the expected pattern|Unexpected token|JSON/i.test(msg);
  }
  function queueJsError_(msg, where) {
    if (!msg || msg === 'Script error.' || isConnectionSideEffect_(msg)) return; // "Script error." = سكربت خارجي بلا تفاصيل / cross-origin script with no details
    if (/ResizeObserver loop/i.test(msg)) return; // تحذير متصفح معروف غير ضار، لا خلل ظاهر / a known harmless browser warning, no visible fault
    const key = msg + '|' + where;
    if (seenJsErrors[key]) return;
    seenJsErrors[key] = true;
    queueError_('client/js', 'خطأ برمجي: ' + msg, 'المكان: ' + where);
  }
  global.addEventListener('error', function (ev) {
    if (!ev || !ev.message) return; // فشل تحميل صورة/ملف وليس خطأ برمجيًا / a resource load failure, not a script error
    queueJsError_(ev.message, (ev.filename || '').split('/').pop() + ':' + ev.lineno);
  });
  global.addEventListener('unhandledrejection', function (ev) {
    const reason = ev && ev.reason;
    queueJsError_(reason && reason.message ? reason.message : String(reason || ''), 'وعد غير معالج (Promise)');
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

  global.SecConnection = { lastOkAt: lastOkAt, pingUnlessRecent: pingUnlessRecent,
    reportFailure: reportFailure, reportRecovered: reportRecovered, reportWrite: reportWrite };
})(window);
