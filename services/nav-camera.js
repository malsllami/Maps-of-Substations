/* ============================================================
 * services/nav-camera.js — كاميرا الملاحة: ماذا يجب أن يظهر أمامك (منطق خالص بلا رسم)
 * ============================================================
 * قرار محمد (9 أكتوبر 2026) — «الطريق القادم» بدل «موقعي والمحطة كلها»، في الوضعين (تدور معي / الشمال لأعلى):
 * - مسافة النظر حسب السرعة: أقل من 40 كم/س ← 400 م، حتى 80 كم/س ← 800 م، أسرع ← 1.5 كم (بلا سرعة معروفة ← 400 م).
 * - مع مسار الطرق: الجزء القادم من المسار من أقرب نقطة عليه إلى مسافة النظر.
 * - منعطف قادم (تغيّر اتجاه المسار أكثر من 35° بين ما قبل النقطة وما بعدها بـ25 م) ← الإطار حتى المنعطف + 80 م فقط،
 *   فيقترب التكبير لتظهر تفاصيله.
 * - المحطة أقرب من مسافة النظر ← الإطار ينتهي بالمحطة نفسها.
 * - بلا مسار (التوجيه المباشر بدون إنترنت): نفس مسافة النظر على الخط المباشر نحو المحطة.
 * القيم قيم بداية تُضبط ميدانيًا من هنا وحدها. الصفحة (navigation-view.js) تحوّل الإطار إلى تكبير وموضع.
 *
 * Navigation camera: what must show ahead of you (pure logic, no drawing). Mohammed's decision (9 Oct 2026): «the road
 * ahead» instead of «me and the whole station», in both modes. Look-ahead by speed; on a road route the coming part of the
 * route; an upcoming turn (> 35°) frames only up to the turn + 80 m (closer zoom); a station within the look-ahead ends
 * the frame; without a route, the same distance along the direct line. Starting values, tuned in the field here only.
 * ============================================================ */
(function (global) {
  'use strict';

  const SPEED_TIERS = [[40, 400], [80, 800]];   // [حتى كم/س، مسافة النظر م] / [up to km/h, look-ahead m]
  const FAST_LOOKAHEAD_M = 1500;
  const TURN_DEG = 35, TURN_SPAN_M = 25, TURN_AFTER_M = 80, TURN_IGNORE_M = 15;
  const R = 6371000, rad = function (d) { return d * Math.PI / 180; }, deg = function (r) { return r * 180 / Math.PI; };

  /* مسافة النظر بالأمتار من السرعة (م/ث أو null) — the look-ahead in metres from the speed (m/s or null) */
  function lookAheadM(speedMps) {
    const kmh = typeof speedMps === 'number' && isFinite(speedMps) && speedMps > 0 ? speedMps * 3.6 : 0;
    for (let i = 0; i < SPEED_TIERS.length; i++) if (kmh < SPEED_TIERS[i][0]) return SPEED_TIERS[i][1];
    return FAST_LOOKAHEAD_M;
  }

  // ===== هندسة محلية بالأمتار — local metric geometry =====
  function distM(a, b) {
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0])), x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  function lerp_(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  function dest_(p, brg, m) {
    const d = m / R, b = rad(brg), la = rad(p[0]), lo = rad(p[1]);
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return [deg(la2), deg(lo2)];
  }
  function angleDiff_(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  /* أقرب نقطة على المسار: رقم القطعة ونسبتها (إسقاط محلي) — the nearest point on the route: segment index and fraction */
  function nearest_(me, pts) {
    const kx = Math.cos(rad(me[0])) * R * Math.PI / 180, ky = R * Math.PI / 180;
    let best = { i: 0, t: 0, off: Infinity };
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = (pts[i][1] - me[1]) * kx, ay = (pts[i][0] - me[0]) * ky, bx = (pts[i + 1][1] - me[1]) * kx, by = (pts[i + 1][0] - me[0]) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const px = ax + t * dx, py = ay + t * dy, off = Math.sqrt(px * px + py * py);
      if (off < best.off) best = { i: i, t: t, off: off };
    }
    return best;
  }

  /* المسار من أقرب نقطة للأمام حتى maxM: [{ p, d }] بالمسافة التراكمية — the route ahead up to maxM, with cumulative distance */
  function walk_(me, pts, maxM) {
    const n = nearest_(me, pts);
    const out = [{ p: lerp_(pts[n.i], pts[n.i + 1], n.t), d: 0 }];
    let d = 0;
    for (let i = n.i + 1; i < pts.length; i++) {
      const prev = out[out.length - 1].p, seg = distM(prev, pts[i]);
      if (d + seg >= maxM) { out.push({ p: seg ? lerp_(prev, pts[i], (maxM - d) / seg) : pts[i], d: maxM, cut: true }); return out; }
      d += seg;
      out.push({ p: pts[i], d: d });
    }
    return out; // المسار انتهى قبل maxM (المحطة) / the route ended before maxM (the station)
  }
  function pointAt_(path, d) {
    if (d <= 0) return path[0].p;
    for (let i = 1; i < path.length; i++) {
      if (path[i].d >= d) { const a = path[i - 1], b = path[i], span = b.d - a.d; return span ? lerp_(a.p, b.p, (d - a.d) / span) : b.p; }
    }
    return path[path.length - 1].p;
  }

  /* أول منعطف على المسار القادم (بالأمتار) أو null — the first turn on the path ahead (metres), or null */
  function firstTurn_(path) {
    const end = path[path.length - 1].d;
    for (let i = 1; i < path.length - 1; i++) {
      const v = path[i];
      if (v.d < TURN_IGNORE_M || v.d + TURN_SPAN_M > end) continue;
      const a = pointAt_(path, v.d - TURN_SPAN_M), b = pointAt_(path, v.d + TURN_SPAN_M);
      if (distM(a, v.p) < 1 || distM(v.p, b) < 1) continue;
      if (angleDiff_(bearing(a, v.p), bearing(v.p, b)) > TURN_DEG) return { d: v.d, p: v.p };
    }
    return null;
  }

  /**
   * frame(s) — s: حالة المحرك (me، destination، mode، route.pts، motion.speed)
   * ← { points: نقاط يجب أن تظهر (أولها موقعي)، critical: النقطة التي لا يجوز أن تخرج من الشاشة، reason: 'turn'|'dest'|'ahead', lookAhead }
   * ← the points that must show (me first), the one point that must never leave the screen, and why
   */
  function frame(s) {
    const me = s.me, dest = s.destination;
    const L = lookAheadM(s.motion ? s.motion.speed : null);
    const pts = s.mode === 'road' && s.route && Array.isArray(s.route.pts) && s.route.pts.length > 1 ? s.route.pts : null;
    if (pts) {
      const path = walk_(me, pts, L + TURN_SPAN_M); // يُمد 25 م للحكم على منعطف عند آخر الإطار / extended to judge a turn at the frame's end
      const turn = firstTurn_(path);
      if (turn && turn.d <= L) {
        const upto = Math.min(L, turn.d + TURN_AFTER_M);
        return { points: [me].concat(path.filter(function (q) { return q.d <= upto; }).map(function (q) { return q.p; }), [pointAt_(path, upto)]), critical: turn.p, reason: 'turn', lookAhead: L };
      }
      const last = path[path.length - 1];
      if (!last.cut && last.d <= L) return { points: [me].concat(path.map(function (q) { return q.p; }), [dest]), critical: dest, reason: 'dest', lookAhead: L };
      const ahead = path.filter(function (q) { return q.d <= L; }).map(function (q) { return q.p; }).concat([pointAt_(path, L)]);
      return { points: [me].concat(ahead), critical: ahead[ahead.length - 1], reason: 'ahead', lookAhead: L };
    }
    const straight = distM(me, dest);
    if (straight <= L) return { points: [me, dest], critical: dest, reason: 'dest', lookAhead: L };
    const p = dest_(me, bearing(me, dest), L);
    return { points: [me, p], critical: p, reason: 'ahead', lookAhead: L };
  }

  global.SecNavCamera = { lookAheadM: lookAheadM, frame: frame, distM: distM, bearing: bearing,
    TUNING: { SPEED_TIERS: SPEED_TIERS, FAST_LOOKAHEAD_M: FAST_LOOKAHEAD_M, TURN_DEG: TURN_DEG, TURN_SPAN_M: TURN_SPAN_M, TURN_AFTER_M: TURN_AFTER_M } };
})(typeof window !== 'undefined' ? window : globalThis);
