/* ============================================================
 * services/navigation.js — محرك الملاحة «🧭 المسار من موقعي»: الحالة والقرارات فقط (بلا خريطة ولا واجهة)
 * ============================================================
 * - البدء: فحص الصلاحية ← انتظار أول موقع GPS دقيق (≤ 100 م فورًا، أو ≤ 500 م بعد 20 ث) ← ثم فقط الملاحة وطلب OSRM.
 * - مع الإنترنت: مسار طرق عبر OSRM من موقعي مرورًا بالنقاط الوسيطة بالترتيب إلى الوجهة، والمسافة المتبقية عبر الطرق.
 *   إعادة الحساب عند الخروج عن المسار 150 م (بقراءة دقتها ≤ 100 م) أو كل 60 ث، وبعد الفشل كل 15 ث، ولا أكثر من طلب
 *   كل 10 ث (خدمة عامة). الطلب الأحدث يلغي السابق، ورد طلب قديم يُتجاهل بالكامل (رقم تسلسلي) فلا يظهر مسار قديم.
 * - بدون إنترنت أو تعذّر OSRM بلا مسار صالح: توجيه مباشر (المسافة المباشرة + حكم الاتجاه) — لا ادعاء لمسار طرق أبدًا.
 *   عودة الاتصال ← محاولة مسار الطرق فورًا.
 * - الوصول: 40 م من الوجهة النهائية؛ والنقطة الوسيطة تُعتبر مُجتازة عند 40 م منها فتسقط من الطلبات التالية.
 * - الإيقاف ينظّف كل شيء: متابعة الموقع، المؤقتات، طلب OSRM الجاري، ومستمعي الاتصال — ومنها انتظار أول موقع.
 * - يُبلغ الواجهة بحالته (subscribe)، والواجهة (مكوّن منفصل) ترسم وتكتب النصوص.
 *
 * The navigation engine: state and decisions only (no map, no UI).
 * - Start: check permission ← wait for the first precise GPS fix ← only then navigate and call OSRM.
 * - Online: an OSRM road route from me through the waypoints in order to the destination, with the remaining road distance.
 *   Recompute when 150 m off the route (with a fix ≤ 100 m accurate) or every 60 s, every 15 s after a failure, and no more
 *   than one request per 10 s (a public service). A newer request cancels the previous one, and a stale reply is ignored
 *   entirely (a sequence number), so an old route never shows.
 * - Offline, or OSRM failing without a usable route: direct guidance (straight distance + the direction verdict) — never a
 *   road-route claim. Back online ← try the road route at once.
 * - Arrival: 40 m from the final destination; a waypoint counts as passed at 40 m and drops from later requests.
 * - Stopping cleans everything: the position watch, timers, the running OSRM request, connection listeners — including
 *   the wait for the first fix.
 * - Reports its state to the UI (subscribe); the UI (a separate component) draws and writes the texts.
 * ============================================================ */
(function (global) {
  'use strict';

  const OFF_ROUTE_M = 150;                // الخروج عن المسار الذي يستدعي إعادة الحساب / off-route distance that triggers a recompute
  const REROUTE_EVERY_MS = 60000;          // إعادة حساب دورية / periodic recompute
  const MIN_REROUTE_GAP_MS = 10000;        // أقل فاصل بين طلبين لـOSRM / min gap between OSRM calls
  const RETRY_AFTER_FAIL_MS = 15000;       // إعادة المحاولة بعد فشل OSRM / retry after an OSRM failure
  // طلب OSRM نفسه (الرابط والمهلة 15 ث والإلغاء وقراءة الرد) في services/osrm.js المشترك مع أداة المسار
  // The OSRM request itself (URL, 15 s timeout, abort, reply parsing) lives in services/osrm.js, shared with the route tool
  const MAX_ACCURACY_FOR_REROUTE_M = 100;  // قراءة أضعف لا تُعتبر خروجًا عن المسار / a weaker fix never counts as leaving the route
  const ARRIVED_M = 40;                    // الوصول / arrival radius
  const FIRST_FIX_GOOD_M = 100;            // دقة كافية للبدء فورًا / accurate enough to start at once
  const FIRST_FIX_OK_M = 500;              // مقبولة بعد انتهاء المهلة / acceptable once the wait runs out
  const FIRST_FIX_WAIT_MS = 20000;
  const IGNORE_FIX_M = 500;                // أثناء الملاحة: قراءة أسوأ لا تحرّك موقعي / while navigating: a worse fix never moves me
  const DENIED_QUICK_MS = 700;             // رفض أسرع = مرفوض مسبقًا بلا نافذة / a faster refusal = denied earlier, no prompt
  const TICK_MS = 5000;
  const NO_PRIORITY = { first: 1, target: 1, online: 1 }; // أسباب لا تنتظر فاصل الـ10 ث / reasons that skip the 10 s gap

  const R = 6371000, rad = function (d) { return d * Math.PI / 180; };

  /* أقرب نقطة على المسار: البعد عنه + المتبقي عبر الطرق من تلك النقطة للنهاية (إسقاط محلي بالأمتار) — من V1 حرفيًا
   * Nearest point on the route: distance off it + remaining road distance from there (local metric projection) — V1 verbatim */
  function locateOnRoute(me, pts, cum) {
    const kx = Math.cos(rad(me[0])) * R * Math.PI / 180, ky = R * Math.PI / 180;
    let best = { off: Infinity, remaining: 0 };
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = (pts[i][1] - me[1]) * kx, ay = (pts[i][0] - me[0]) * ky;
      const bx = (pts[i + 1][1] - me[1]) * kx, by = (pts[i + 1][0] - me[0]) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const px = ax + t * dx, py = ay + t * dy, off = Math.sqrt(px * px + py * py);
      if (off < best.off) best = { off: off, remaining: cum[cum.length - 1] - (cum[i] + t * Math.sqrt(len2)) };
    }
    return best;
  }

  /* نقطة صالحة { lat, lng } ← [lat, lng] أو null — A valid point ← [lat, lng], or null */
  function point_(p) {
    if (!p) return null;
    const empty = function (v) { return v === null || v === undefined || (typeof v === 'string' && !v.trim()); }; // Number(null) = 0 — الفارغ ليس صفرًا / empty isn't zero
    if (empty(p.lat) || empty(p.lng)) return null;
    const lat = Number(p.lat), lng = Number(p.lng);
    return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? [lat, lng] : null;
  }

  /**
   * ينشئ محركًا. env اختياري (للاختبار): fetch، geolocation، permissions، isOnline، now، المؤقتات، والمستمعين.
   * Creates an engine. env is optional (for tests): fetch, geolocation, permissions, isOnline, now, timers, listeners.
   */
  function createNavigator(env) {
    const T = global.SecDirectionTracker, O = global.SecOsrm;
    if (!T) throw new Error('navigation.js يحتاج services/direction-tracker.js قبله / needs services/direction-tracker.js loaded first');
    if (!O) throw new Error('navigation.js يحتاج services/osrm.js قبله / needs services/osrm.js loaded first');
    const e = Object.assign({
      fetch: function (u, o) { return global.fetch(u, o); },
      geolocation: global.navigator && global.navigator.geolocation,
      permissions: global.navigator && global.navigator.permissions,
      isOnline: function () { return !(global.navigator && global.navigator.onLine === false); },
      now: function () { return Date.now(); },
      setTimeout: function (f, ms) { return global.setTimeout(f, ms); }, clearTimeout: function (id) { global.clearTimeout(id); },
      setInterval: function (f, ms) { return global.setInterval(f, ms); }, clearInterval: function (id) { global.clearInterval(id); },
      on: function (t, f) { global.addEventListener(t, f); }, off: function (t, f) { global.removeEventListener(t, f); }
    }, env || {});

    let nav = null;        // الملاحة الجارية / the running navigation
    let pending = null;    // انتظار أول موقع / waiting for the first fix
    let startToken = 0;
    let lastError = null;
    const listeners = [];

    // ===== الإبلاغ — Reporting =====
    function status_() {
      if (!nav) return pending ? 'locating' : 'stopped';
      if (!nav.me) return 'locating';
      if (nav.arrived) return 'arrived';
      if (nav.mode === 'smart') return 'smart';
      if (nav.offRoute) return 'off-route';
      if (nav.route) return nav.acc > MAX_ACCURACY_FOR_REROUTE_M ? 'road-weak' : 'road';
      return 'routing';
    }
    function state() {
      if (!nav) return { active: false, status: status_(), error: lastError };
      return {
        active: true, status: status_(), mode: nav.mode, online: e.isOnline(), error: lastError,
        me: nav.me, acc: nav.acc, destination: nav.dest, waypoints: nav.waypoints.slice(),
        route: nav.route ? { pts: nav.route.pts, distance: nav.route.distance, duration: nav.route.duration } : null,
        remaining: nav.remaining, straight: nav.me ? T.distM(nav.me, nav.dest) : null,
        arrived: nav.arrived, offRoute: nav.offRoute, routeFailed: nav.routeFailed, routing: nav.routing,
        dir: nav.dir, motion: nav.motionNow
      };
    }
    function emit_() {
      const s = state();
      listeners.slice().forEach(function (fn) { try { fn(s); } catch (err) { /* خطأ الواجهة لا يوقف المحرك / a UI error never stops the engine */ } });
    }
    function subscribe(fn) {
      listeners.push(fn);
      return function () { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
    }

    // ===== الصلاحية وأول موقع — Permission and first fix =====
    async function permissionState_() {
      try { if (e.permissions && e.permissions.query) return (await e.permissions.query({ name: 'geolocation' })).state; } catch (err) { /* غير مدعوم / unsupported */ }
      return 'unknown';
    }
    function acquireFirstFix_() {
      return new Promise(function (resolve, reject) {
        const startedAt = e.now();
        let best = null;
        const p = { done: false, watchId: null, timer: null };
        p.finish = function (fn, arg) {
          if (p.done) return;
          p.done = true;
          e.clearTimeout(p.timer);
          if (p.watchId != null) e.geolocation.clearWatch(p.watchId);
          if (pending === p) pending = null;
          fn(arg);
        };
        p.cancel = function () { p.finish(reject, { kind: 'cancelled' }); };
        pending = p;
        p.timer = e.setTimeout(function () {
          if (best && best.coords.accuracy <= FIRST_FIX_OK_M) p.finish(resolve, best);
          else if (best) p.finish(reject, { kind: 'inaccurate', accuracy: best.coords.accuracy });
          else p.finish(reject, { kind: 'noFix' });
        }, FIRST_FIX_WAIT_MS);
        p.watchId = e.geolocation.watchPosition(function (pos) {
          if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
          if (pos.coords.accuracy <= FIRST_FIX_GOOD_M) p.finish(resolve, pos);
        }, function (err) {
          if (err && err.code === 1) p.finish(reject, { kind: 'denied', quick: e.now() - startedAt < DENIED_QUICK_MS });
          // غير ذلك: الانتظار مستمر حتى المهلة / otherwise: keep waiting until the deadline
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: FIRST_FIX_WAIT_MS });
      });
    }

    // ===== البدء والإيقاف — Start and stop =====

    /**
     * start({ destination: {lat,lng}, waypoints: [{lat,lng}, …] }) ← { ok } أو { ok:false, error }
     * الأخطاء: no-destination، invalid-coordinates، unsupported، settings (مرفوضة مسبقًا)، refused، inaccurate (+accuracy)، noFix، cancelled
     */
    async function start(options) {
      const o = options || {};
      if (!o.destination) return fail_({ code: 'no-destination' });
      const dest = point_(o.destination);
      const wps = (o.waypoints || []).map(point_);
      if (!dest || wps.some(function (w) { return !w; })) return fail_({ code: 'invalid-coordinates' });
      if (!e.geolocation) return fail_({ code: 'unsupported' });
      stop();
      lastError = null;
      const token = ++startToken;
      const perm = await permissionState_();
      if (token !== startToken) return { ok: false, error: { code: 'cancelled' } };
      if (perm === 'denied') return fail_({ code: 'settings' }); // لا نافذة ستظهر — لا حلقة طلبات / no prompt will show — no request loop
      emit_();
      let first;
      try { first = await acquireFirstFix_(); } catch (err) {
        if (err.kind === 'cancelled' || token !== startToken) return { ok: false, error: { code: 'cancelled' } };
        if (err.kind === 'denied') return fail_({ code: perm === 'prompt' || (perm === 'unknown' && !err.quick) ? 'refused' : 'settings' });
        if (err.kind === 'inaccurate') return fail_({ code: 'inaccurate', accuracy: err.accuracy });
        return fail_({ code: 'noFix' });
      }
      if (token !== startToken) return { ok: false, error: { code: 'cancelled' } };
      begin_(dest, wps, first);
      return { ok: true };
    }
    function fail_(error) { lastError = error; emit_(); return { ok: false, error: error }; }

    function begin_(dest, wps, first) {
      nav = {
        dest: dest, waypoints: wps, me: null, acc: null, route: null, remaining: null, arrived: false, offRoute: false,
        routeFailed: false, routing: false, lastRouteAt: 0, seq: 0, req: null,
        mode: e.isOnline() ? 'road' : 'smart', tracker: T.create(dest), motion: T.createMotion(), dir: null, motionNow: null
      };
      const n = nav;
      n.onOffline = function () { if (nav === n) { enterSmart_(); emit_(); } };
      n.onOnline = function () { if (nav === n) { n.lastRouteAt = 0; requestRoute_('online'); emit_(); } };
      e.on('offline', n.onOffline);
      e.on('online', n.onOnline);
      onFix_(first);
      n.watchId = e.geolocation.watchPosition(onFix_, onGeoError_, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
      n.timer = e.setInterval(tick_, TICK_MS);
    }

    function stop() {
      startToken++;
      if (pending) pending.cancel();
      if (!nav) return;
      const n = nav;
      nav = null;
      if (n.watchId != null) e.geolocation.clearWatch(n.watchId);
      e.clearInterval(n.timer);
      if (n.req) n.req.abort(); // يلغي الطلب الجاري ومؤقته / aborts the running request and its timer
      e.off('offline', n.onOffline);
      e.off('online', n.onOnline);
      emit_();
    }

    /* تغيير الوجهة أثناء الملاحة (تغيّرت إحداثيات المحطة بعد التحقق من الخادم) — Change the destination mid-navigation */
    function updateTarget(destination) {
      const dest = point_(destination);
      if (!nav || !dest) return false;
      nav.dest = dest;
      nav.tracker = T.create(dest); nav.dir = null;
      nav.arrived = false; nav.route = null; nav.offRoute = false; nav.remaining = null;
      if (nav.me) {
        if (e.isOnline()) requestRoute_('target'); else enterSmart_();
        evaluate_();
      }
      emit_();
      return true;
    }

    // ===== GPS =====
    function onFix_(pos) {
      if (!nav || !pos || !pos.coords) return;
      if (!(pos.coords.accuracy <= IGNORE_FIX_M)) return; // موقع تقريبي بعيد لا يحرّك موقعي / a rough far fix never moves me
      const me = point_({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      if (!me) return;
      const first = !nav.me, t = pos.timestamp || e.now();
      nav.me = me; nav.acc = pos.coords.accuracy;
      nav.dir = nav.tracker.push({ lat: me[0], lng: me[1], acc: nav.acc, t: t });
      nav.motionNow = nav.motion.push({ lat: me[0], lng: me[1], acc: nav.acc, t: t, heading: pos.coords.heading, speed: pos.coords.speed });
      // نقطة وسيطة اجتزتها (40 م) تسقط من الطلبات التالية / a passed waypoint (40 m) drops from later requests
      while (nav.waypoints.length && T.distM(me, nav.waypoints[0]) <= ARRIVED_M) nav.waypoints.shift();
      if (first) requestRoute_('first');
      evaluate_();
      emit_();
    }
    function onGeoError_(err) {
      if (!nav) return;
      if (err && err.code === 1) { stop(); fail_({ code: 'settings' }); } // سُحبت الصلاحية أثناء الملاحة / permission revoked mid-navigation
    }

    // ===== OSRM (services/osrm.js) =====
    function requestRoute_(reason) {
      const n = nav;
      if (!n || !n.me) return;
      if (!e.isOnline()) { enterSmart_(); return; } // بدون إنترنت: لا طلب محكوم بالفشل / offline: no doomed request
      if (!NO_PRIORITY[reason] && (n.routing || e.now() - n.lastRouteAt < MIN_REROUTE_GAP_MS)) return;
      if (n.req) n.req.abort(); // الطلب الأحدث يلغي السابق — the newer request cancels the previous one
      const seq = ++n.seq;
      n.routing = true; n.lastRouteAt = e.now();
      const req = O.request([n.me].concat(n.waypoints, [n.dest]), { fetch: e.fetch, setTimeout: e.setTimeout, clearTimeout: e.clearTimeout });
      n.req = req;
      const current = function () { return nav === n && n.seq === seq; };
      req.promise
        .then(function (result) {
          if (!current()) return; // رد طلب قديم أو ملاحة منتهية — يُتجاهل بالكامل / a stale reply or ended navigation — ignored entirely
          if (!e.isOnline()) return; // انقطع الإنترنت أثناء الطلب — يبقى التوجيه المباشر / internet dropped mid-request — direct guidance stays
          const r = result.routes[0];
          const pts = r.pts;
          const cum = [0];
          for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + T.distM(pts[i - 1], pts[i]));
          n.route = { pts: pts, cum: cum, distance: r.distance, duration: r.duration };
          n.routeFailed = false; n.offRoute = false; n.mode = 'road';
          evaluate_();
        })
        .catch(function () {
          if (!current()) return;
          n.routeFailed = true;
          // لا مسار صالح ← توجيه مباشر مؤقتًا مع إعادة المحاولة؛ مسار صالح قائم ← يبقى / no usable route ← direct for now; a usable route ← kept
          if (!n.route || n.offRoute) enterSmart_();
        })
        .then(function () {
          if (!current()) return;
          n.routing = false; n.req = null;
          emit_();
        });
    }

    function enterSmart_() {
      if (!nav) return;
      nav.mode = 'smart'; nav.route = null; nav.offRoute = false; nav.remaining = null;
      evaluate_();
    }

    /* كل 5 ث: الخروج عن المسار، إعادة المحاولة بعد فشل (15 ث)، أو الدورية (60 ث) — Every 5 s: off-route, retry after failure, or periodic */
    function tick_() {
      if (!nav || !nav.me || !e.isOnline()) return;
      const since = e.now() - nav.lastRouteAt;
      if (nav.offRoute) requestRoute_('off');
      else if (nav.routeFailed && since >= RETRY_AFTER_FAIL_MS) requestRoute_('retry');
      else if (since >= REROUTE_EVERY_MS) requestRoute_('periodic');
    }

    /* تقييم: الوصول، المتبقي عبر الطرق، الخروج عن المسار — Evaluate: arrival, remaining road distance, off-route */
    function evaluate_() {
      if (!nav || !nav.me) return;
      nav.arrived = T.distM(nav.me, nav.dest) <= ARRIVED_M && nav.waypoints.length === 0;
      if (nav.mode === 'smart' || !nav.route) { nav.remaining = null; return; }
      const loc = locateOnRoute(nav.me, nav.route.pts, nav.route.cum);
      nav.remaining = Math.max(0, loc.remaining + (loc.off > 30 ? loc.off : 0));
      nav.offRoute = !nav.arrived && loc.off > OFF_ROUTE_M && nav.acc <= MAX_ACCURACY_FOR_REROUTE_M;
      if (nav.offRoute) requestRoute_('off');
    }

    return {
      start: start, stop: stop, updateTarget: updateTarget, subscribe: subscribe, state: state,
      isActive: function () { return !!nav; }, isLocating: function () { return !!pending; }
    };
  }

  global.SecNavigation = {
    create: createNavigator, locateOnRoute: locateOnRoute,
    LIMITS: { OFF_ROUTE_M: OFF_ROUTE_M, REROUTE_EVERY_MS: REROUTE_EVERY_MS, MIN_REROUTE_GAP_MS: MIN_REROUTE_GAP_MS, RETRY_AFTER_FAIL_MS: RETRY_AFTER_FAIL_MS,
      get OSRM_TIMEOUT_MS() { return global.SecOsrm ? global.SecOsrm.TIMEOUT_MS : undefined; }, ARRIVED_M: ARRIVED_M, FIRST_FIX_GOOD_M: FIRST_FIX_GOOD_M, FIRST_FIX_OK_M: FIRST_FIX_OK_M, FIRST_FIX_WAIT_MS: FIRST_FIX_WAIT_MS }
  };
})(typeof window !== 'undefined' ? window : globalThis);
