/* ============================================================
 * services/osrm.js — طلب مسار طرق من OSRM بين نقاط بالترتيب (مصدر واحد للملاحة وأداة المسار متعدد النقاط)
 * ============================================================
 * مُستخرج من services/navigation.js بلا تغيير سلوك (قرار محمد): نفس الخادم والرابط، ومهلة 15 ث بلا رد = فشل يُلغي
 * الطلب، والإلغاء من المستدعي (الطلب الأحدث يلغي السابق، والإيقاف يلغي الجاري)، ورد غير صالح = فشل.
 * - request(points, opts) ← { promise, abort() }. points: [[lat, lng], …] بالترتيب (نقطتان على الأقل).
 *   opts: { alternatives (بدائل الطرق — لأداة المسار)، fetch/setTimeout/clearTimeout (بيئة قابلة للحقن للاختبار) }.
 *   promise ← { routes: [{ pts: [[lat, lng], …], distance (م), duration (ث) }, …] } أو يُرفض (osrm-http-… /
 *   osrm-no-route / AbortError).
 * - shortest(routes): أقصر البدائل مسافة (V1: أداة المسار تعرض أقصرها).
 * - المؤقت يُزال عند الرد أو الفشل أو الإلغاء — لا مؤقت يبقى بعد انتهاء الطلب.
 *
 * A road route from OSRM between points in order — one source for navigation and the multi-point route tool. Extracted
 * from navigation.js with no behavior change: the same server and URL, a 15 s no-reply timeout = failure that aborts the
 * request, cancellation by the caller, an invalid reply = failure. The timer is cleared on reply, failure or abort.
 * ============================================================ */
(function (global) {
  'use strict';

  const URL = 'https://router.project-osrm.org/route/v1/driving/';
  const TIMEOUT_MS = 15000;

  /* رابط الطلب: الطول,العرض لكل نقطة بالترتيب — The request URL: lng,lat per point in order */
  function url(points, alternatives) {
    return URL + points.map(function (p) { return p[1] + ',' + p[0]; }).join(';') + '?overview=full&geometries=geojson' + (alternatives ? '&alternatives=true' : '');
  }

  /* رد OSRM ← مسارات بإحداثيات [lat, lng]، أو خطأ — An OSRM reply ← routes with [lat, lng] coordinates, or an error */
  function parse(data) {
    if (!data || data.code !== 'Ok' || !data.routes || !data.routes[0] || !data.routes[0].geometry) throw new Error('osrm-no-route');
    return {
      routes: data.routes.filter(function (r) { return r && r.geometry && Array.isArray(r.geometry.coordinates); }).map(function (r) {
        return { pts: r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }), distance: r.distance, duration: r.duration };
      })
    };
  }

  function shortest(routes) {
    return (routes || []).reduce(function (best, r) { return !best || r.distance < best.distance ? r : best; }, null);
  }

  /**
   * request(points, opts) ← { promise, abort() }
   */
  function request(points, opts) {
    const o = opts || {};
    const doFetch = o.fetch || function (u, x) { return global.fetch(u, x); };
    const setT = o.setTimeout || function (fn, ms) { return global.setTimeout(fn, ms); };
    const clearT = o.clearTimeout || function (id) { global.clearTimeout(id); };
    const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
    let timer = null, settled = false;
    const done = function () { settled = true; if (timer !== null) { clearT(timer); timer = null; } };
    timer = setT(function () { timer = null; if (controller) controller.abort(); }, o.timeoutMs || TIMEOUT_MS);
    const promise = doFetch(url(points, o.alternatives), controller ? { signal: controller.signal } : undefined)
      .then(function (res) { if (!res.ok) throw new Error('osrm-http-' + res.status); return res.json(); })
      .then(function (data) { done(); return parse(data); }, function (err) { done(); throw err; });
    return {
      promise: promise,
      abort: function () { if (settled) return; done(); if (controller) { try { controller.abort(); } catch (e) { /* أُلغي أصلًا / already aborted */ } } }
    };
  }

  global.SecOsrm = { request: request, url: url, parse: parse, shortest: shortest, TIMEOUT_MS: TIMEOUT_MS };
})(typeof window !== 'undefined' ? window : globalThis);
