/* ============================================================
 * services/connection.js — مسؤول عن حالة الاتصال بالخادم:
 * 1) معرفة "هل الخادم متصل؟" بأقل عدد طلبات: أي رد JSON سليم (إحصاءات، بحث،
 *    حفظ...) يثبت الاتصال مثل ping تمامًا، فيُتخطّى ping إن نجح أي طلب خلال المدة
 *    المحددة. الوقت بـlocalStorage فيُشارَك بين الصفحات والتبويبات.
 * 2) تسجيل الأخطاء بـ"سجل الأخطاء" لكل المستخدمين: كل طلب فشل (صفحة خطأ من جوجل
 *    مثل 404، انقطاع اتصال، انتهاء مهلة) وكل خطأ برمجي بالصفحة. الخطأ يُحفظ أولًا
 *    بالجهاز ثم يُرسل بعد أول رد سليم من الخادم — لأن لحظة الفشل نفسها غالبًا لا
 *    يصل فيها أي طلب. بلا بيانات شخصية: نوع الجهاز والمتصفح فقط.
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
      details: ('وقت الحدوث: ' + clock_() + ' | الصفحة: ' + pageName_() + ' | ' + details + ' | الجهاز: ' + deviceSummary_()).slice(0, 500)
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

  /* يراقب طلبات الخادم فقط دون تعديل الطلب أو الرد: الرد السليم يثبت الاتصال ويرسل الأخطاء المنتظرة،
   * والفشل يُحفظ بالطابور. Watches server requests only, never altering request or reply: a healthy
   * reply proves connectivity and sends queued errors; a failure is queued. */
  global.fetch = function (input, init) {
    const request = originalFetch(input, init);
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf(API_MARKER) === -1) return request;
    const action = actionOf_(init);
    if (action === 'logClientError') return request; // لا يُسجَّل فشل التسجيل نفسه / never log the logger's own failures
    lastApiUrl = url;
    const startedAt = Date.now();
    const waited = function () { return ((Date.now() - startedAt) / 1000).toFixed(1) + ' ث'; };

    return request.then(function (res) {
      const contentType = (res.headers && res.headers.get('content-type')) || '';
      if (res.ok && contentType.indexOf('application/json') !== -1) {
        recordOk_();
        flushQueue_();
      } else if (!leavingPage) {
        // صفحة خطأ بدل الرد (مثل 404 من جوجل) — نقرأ عنوانها من نسخة منفصلة دون المساس بالرد الأصلي
        // An error page instead of the reply (e.g. Google 404) — read its title from a separate copy without touching the original
        res.clone().text().then(function (body) {
          queueError_('client/connection', 'فشل طلب ' + action + ': رد غير سليم HTTP ' + res.status,
            'الانتظار: ' + waited() + ' | نوع الرد: ' + (contentType || 'غير محدد') + ' | عنوان الرد: ' + titleOf_(body));
        }).catch(function () {});
      }
      return res;
    }, function (err) {
      // إلغاء الطلب الاحتياطي الأبطأ مقصود وليس عطلًا / cancelling the slower backup request is intentional, not a fault
      const hedgeLoser = init && init.signal && init.signal.__secHedgeLoser;
      // الجهاز بلا إنترنت فعليًا (وضع الطيران / لا شبكة): فشل متوقع وليس عطلًا بالموقع أو بجوجل — لا يُسجَّل
      // The device is truly offline (airplane mode / no network): an expected failure, not a site or Google fault — not logged
      const deviceOffline = navigator.onLine === false;
      if (!leavingPage && !hedgeLoser && !deviceOffline) {
        const kind = err && err.name === 'AbortError' ? 'انتهت المهلة' : 'انقطاع الاتصال';
        queueError_('client/connection', 'فشل طلب ' + action + ': ' + kind,
          'الانتظار: ' + waited() + ' | رسالة المتصفح: ' + String(err && err.message || err).slice(0, 80));
      }
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

  global.SecConnection = { lastOkAt: lastOkAt, pingUnlessRecent: pingUnlessRecent };
})(window);
