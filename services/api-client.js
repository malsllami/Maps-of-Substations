/* ============================================================
 * services/api-client.js — الطريق الوحيد من الصفحات والخدمات إلى خادم V2 (Apps Script /exec)
 * ============================================================
 * يجمع ما كان مكررًا بأشكال مختلفة في صفحات V1 الخمس، دون إعادة منطق موجود في غيره:
 * - تسجيل الأخطاء يتولاه connection.js، والقياس timing.js (كلاهما يراقب fetch)، والتذكرة والجوال من session.js.
 * - القراءة: طلب احتياطي — بلا رد خلال 8 ث يُرسل نفس الطلب بالتوازي، وبعد فشل صريح يُرسل بعد 1.5 ث؛ أول رد سليم يفوز
 *   ويُلغى الآخر. القراءة لا تغيّر بيانات فتكرارها آمن. فشل الاثنين ← خطأ.
 * - الكتابة بمفتاح عملية (opKey): بلا رد سليم ← إعادة الإرسال بنفس المفتاح بعد 5 ث ثم 8 ث — الخادم يرجع نتيجة التنفيذ
 *   الأول بلا تكرار. رد الخادم بخطأ صريح نهائي ولا يُعاد. والجهاز بلا إنترنت فعلًا ← لا تُرسل أصلًا.
 * - غير ذلك (verifyAssertion برمز لمرة واحدة، الحذف، لوحة المدير…): طلب واحد.
 * - «رد سليم» = JSON من خادمنا يحمل success أو error أو found؛ غيره (صفحة 404، {"status":"ok"}…) ليس ردًا.
 * - رد الخادم بخطأ يُعاد للمستدعي كما هو (لا يُبتلع)، وفشل الشبكة يُرمى خطأً (ApiError) — ولا يُخرج المستخدم أبدًا.
 * - لا يحفظ ولا يسجّل أي جسم طلب أو رد.
 *
 * The only road from pages and services to the V2 server. Gathers what V1 duplicated across five pages without
 * re-implementing other services: error logging is connection.js's, timing is timing.js's (both watch fetch), the
 * ticket and phone come from session.js.
 * - Reads: a backup request — no reply in 8 s ← the same request in parallel; an explicit failure ← after 1.5 s; the
 *   first valid reply wins, the other is cancelled. Both failing ← an error.
 * - Writes with an operation key: no valid reply ← resend with the SAME key after 5 s then 8 s — the server returns the
 *   first run's result without repeating it. An explicit server error is final. A truly offline device ← not sent at all.
 * - Anything else (single-use challenges, delete, admin…): one request.
 * - A "valid reply" = JSON from our server carrying success, error or found.
 * - A server error reply is returned to the caller as is (never swallowed); a network failure is thrown (ApiError) — and
 *   never logs the user out.
 * - Stores and logs no request or reply body.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('api-client.js يحتاج config/الإعدادات.js قبله / needs config/الإعدادات.js loaded first');
  const API_URL = CONFIG.API_BASE_URL;
  const T = CONFIG.TIMING;
  const REQUEST_TIMEOUT_MS = 75000; // قيس في V1: بعض ردود جوجل تصل حتى 65 ث (تشغيل بارد) / measured in V1: some Google replies take up to 65 s (cold start)

  // القراءات التي يُرسل لها طلب احتياطي (تكرارها آمن) — reads that get a backup request (safe to repeat)
  const HEDGED = new Set(['ping', 'getDataVersion', 'getSettingsLists', 'getAdminContactInfo', 'getStats', 'getMemberProfileLite',
    'getAllStations', 'getUpdatedStationsSince', 'searchStation', 'getNearbyStations', 'getFeederStations',
    'loginByPhone', 'generateLoginChallenge', 'generateRegisterChallenge']);
  // الكتابات بمفتاح عملية — تُعاد بنفس المفتاح (والحذف منها: إعادته لا تحذف الصف المكرر التالي بنفس الرقم)
  // writes with an operation key — resent with the same key (delete too: a resend never deletes the next duplicate row)
  const OP_KEY_WRITES = new Set(['addNewStation', 'updateCoordinates', 'deleteStation', 'registerUser', 'registerCredential']);
  // كتابات لا تُرسل والجهاز بلا إنترنت فعلًا — writes never sent while truly offline
  const WRITES = new Set(['addNewStation', 'updateCoordinates', 'deleteStation', 'registerUser', 'registerCredential', 'updateMemberProfile', 'clearSearchCache']);

  const MSG = {
    offline: 'هذه العملية تحتاج إلى اتصال بالإنترنت',
    connection: 'تعذّر الاتصال بالخادم مؤقتًا، حاول مرة أخرى بعد قليل',
    unconfirmed: 'تعذّر التأكد من الحفظ بسبب خلل مؤقت في الاتصال بخادم جوجل. تحقّق من النتيجة قبل إعادة المحاولة.'
  };

  /* خطأ اتصال (لا رد سليم) — kind: network | timeout | http | invalid-reply | offline | unconfirmed
   * A connection error (no valid reply) */
  function apiError_(kind, message, extra) {
    const e = new Error(message || MSG.connection);
    e.name = 'ApiError'; e.kind = kind;
    Object.assign(e, extra || {});
    return e;
  }

  function isApiReply(json) {
    return !!json && typeof json === 'object' && !Array.isArray(json) && ('success' in json || 'error' in json || 'found' in json);
  }

  function newOpKey(prefix) {
    const bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    return (prefix || 'op') + '_' + Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function newRequestId_() { return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6); }
  function offline_() { return !!(global.navigator && global.navigator.onLine === false); }
  function delay_(ms) { return new Promise(function (r) { global.setTimeout(r, ms); }); }

  /* محاولة واحدة: يُرجع الرد السليم أو يرمي ApiError — One attempt: returns the valid reply or throws ApiError */
  async function once_(body, controller) {
    const timer = global.setTimeout(function () { controller.timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      let res;
      try {
        // بلا ترويسات: طلب «بسيط» لا يحتاج فحصًا مسبقًا (CORS) — no headers: a "simple" request without a CORS preflight
        res = await global.fetch(API_URL, { method: 'POST', body: JSON.stringify(Object.assign({}, body, { requestId: newRequestId_() })), signal: controller.signal });
      } catch (err) {
        if (err && err.name === 'AbortError') throw apiError_(controller.timedOut ? 'timeout' : 'aborted', MSG.connection);
        throw apiError_(offline_() ? 'offline' : 'network', MSG.connection);
      }
      const text = await res.text().catch(function () { return ''; });
      let json;
      try { json = JSON.parse(text); } catch (e) { throw apiError_('http', MSG.connection, { status: res.status }); }
      if (!isApiReply(json)) throw apiError_('invalid-reply', MSG.connection, { status: res.status });
      return json;
    } finally {
      global.clearTimeout(timer);
    }
  }

  /* القراءة بطلب احتياطي؛ connection.js يسجّل النتيجة النهائية فقط — A read with a backup; connection.js logs only the final outcome */
  function hedged_(action, body) {
    return new Promise(function (resolve, reject) {
      const tries = [];
      let launched = 0, failures = 0, settled = false, timer = null;
      const conn = function () { return global.SecConnection || null; };
      const attempt = function (t) { const a = t.controller.signal.__secAttempt || null; if (a && t.invalid) a.kind = 'invalid-reply'; return a; };
      const launch = function () {
        if (settled || launched >= 2) return;
        launched++;
        const controller = new global.AbortController();
        controller.signal.__secManaged = true; // النتيجة تُسجَّل هنا لا بمراقب الاتصال / the outcome is logged here
        const t = { controller: controller, invalid: false };
        tries.push(t);
        once_(body, controller).then(function (json) {
          if (settled) return;
          settled = true;
          global.clearTimeout(timer);
          tries.forEach(function (o) { if (o !== t) { o.controller.signal.__secHedgeLoser = true; o.controller.abort(); } });
          resolve(json);
          if (t !== tries[0]) global.setTimeout(function () {
            const c = conn(), a0 = attempt(tries[0]), a1 = attempt(t);
            if (c && c.reportRecovered && a0 && a1) c.reportRecovered(action, a0, a1);
          }, 0);
        }, function (err) {
          if (err && err.kind === 'invalid-reply') t.invalid = true;
          if (settled) return;
          failures++;
          if (launched < 2) { global.clearTimeout(timer); timer = global.setTimeout(launch, T.HEDGE_RETRY_AFTER_FAIL_MS); }
          else if (failures >= launched) {
            settled = true;
            reject(err);
            const c = conn(), attempts = tries.map(attempt).filter(Boolean);
            if (c && c.reportFailure && attempts.length) global.setTimeout(function () { c.reportFailure(action, attempts); }, 50);
          }
        });
      };
      launch();
      timer = global.setTimeout(launch, T.HEDGE_AFTER_MS);
    });
  }

  /* الكتابة بنفس مفتاح العملية: إعادة فقط عند غياب رد سليم — A write with the same operation key: resent only without a valid reply */
  async function write_(action, body, onRetry) {
    const attempts = [];
    const record = function (outcome) { const c = global.SecConnection; if (c && c.reportWrite) c.reportWrite(action, attempts, outcome); };
    const delays = T.SAVE_RETRY_DELAYS_MS;
    for (let i = 0; ; i++) {
      const controller = new global.AbortController();
      controller.signal.__secManaged = true;
      try {
        const json = await once_(body, controller);
        if (controller.signal.__secAttempt) attempts.push(controller.signal.__secAttempt);
        if (i > 0) record(json.success ? 'تأكد الحفظ بإعادة الإرسال بنفس opKey (بلا تكرار)' : 'رد الخادم بعد إعادة الإرسال: ' + String(json.error || 'فشل').slice(0, 80));
        return json;
      } catch (err) {
        if (controller.signal.__secAttempt) attempts.push(controller.signal.__secAttempt);
        if (i >= delays.length) {
          record('لم تتأكد بعد ' + attempts.length + ' محاولات بنفس opKey — طُلب من المستخدم التحقق');
          throw apiError_('unconfirmed', MSG.unconfirmed, { cause: err.kind });
        }
        if (onRetry) { try { onRetry(i + 1); } catch (e) { /* الواجهة لا توقف الحفظ / the UI never stops the save */ } }
        await delay_(delays[i]);
      }
    }
  }

  /**
   * call(action, payload, options) ← رد الخادم (JSON) كما هو، أو يرمي ApiError عند غياب رد سليم.
   * options: { token: true (تذكرة الجلسة)، phone: true (جوال الجلسة)، onRetry(n) للكتابات }
   * Returns the server reply (JSON) as is, or throws ApiError when no valid reply arrived.
   */
  async function call(action, payload, options) {
    const o = options || {};
    const body = Object.assign({ action: action }, payload || {});
    const S = global.SecSession;
    if (o.token && body.identityToken === undefined && S) body.identityToken = S.getToken();
    if (o.phone && body.phone === undefined && S) body.phone = S.getPhone();
    if (WRITES.has(action) && offline_()) throw apiError_('offline', MSG.offline);
    if (OP_KEY_WRITES.has(action) && !body.opKey) body.opKey = newOpKey(action);

    let json;
    if (HEDGED.has(action)) json = await hedged_(action, body);
    else if (OP_KEY_WRITES.has(action)) json = await write_(action, body, o.onRetry);
    else {
      const controller = new global.AbortController();
      json = await once_(body, controller);
    }
    if (S && S.touch) S.touch(); // كل نشاط فعلي يجدد وقت آخر نشاط / every real activity renews the last-activity time
    return json;
  }

  /* فحص النشر بطلب GET (لا يمر بالإجراءات) — بإعادة واحدة بعد 1.5 ث: جوجل يرجع أحيانًا 404 لطلب سليم (قيس على V2)
   * Deployment check by GET (no action runs) — one retry after 1.5 s: Google sometimes returns 404 to a valid request (measured on V2) */
  async function checkDeployment() {
    let last = null;
    for (let i = 0; i < 2; i++) {
      if (i) await delay_(T.HEDGE_RETRY_AFTER_FAIL_MS);
      try {
        const res = await global.fetch(API_URL, { method: 'GET' });
        const json = await res.json().catch(function () { return null; });
        if (json && json.status === 'ok') return json;
        last = apiError_('http', MSG.connection, { status: res.status });
      } catch (err) { last = apiError_(offline_() ? 'offline' : 'network', MSG.connection); }
    }
    throw last;
  }

  global.SecApi = {
    call: call, checkDeployment: checkDeployment, isApiReply: isApiReply, newOpKey: newOpKey,
    isRead: function (a) { return HEDGED.has(a); }, isWrite: function (a) { return WRITES.has(a); }, MSG: MSG
  };
})(typeof window !== 'undefined' ? window : globalThis);
