/* ============================================================
 * services/direction-tracker.js — مسؤول عن حكم "هل تتجه نحو المحطة؟" بدون إنترنت فقط (منطق خالص بلا خريطة ولا صفحة).
 * لا يحكم من قراءة واحدة أبدًا:
 * - اتجاه الحركة من الإزاحة الفعلية (15 م على الأقل خلال 20 ث)، لا من قراءة واحدة ولا من البوصلة.
 * - القراءات ضعيفة الدقة (أسوأ من 50 م) والقفزات المستحيلة تُتجاهل.
 * - الوقوف لا يُحكم عليه (لا اتجاه حركة أصلًا).
 * - تغيير الحالة يحتاج 3 قراءات متتالية متفقة، مع هامش 5° حول حدّي 30° و70° (منع التذبذب).
 * - «غير صحيح» لا يظهر إن كانت المسافة للمحطة تتناقص (طريق منحنٍ يقترب)، ولا قرب المحطة (أقل من 80 م).
 *
 * Owns the offline "are you heading to the station?" verdict only (pure logic, no map or page).
 * Never judges from a single reading:
 * - Course comes from real displacement (≥ 15 m within 20 s), not one reading or the compass.
 * - Weak fixes (worse than 50 m) and impossible jumps are ignored.
 * - Standing still is never judged (there's no course at all).
 * - A state change needs 3 consecutive agreeing readings, with a 5° margin around the 30°/70° limits (no flicker).
 * - «wrong» never shows while the distance to the station is shrinking (a curving road that approaches), nor near it (< 80 m).
 * ============================================================ */
(function (global) {
  'use strict';

  const DEFAULTS = {
    weakAccuracyM: 50,     // قراءة أسوأ من هذا تُتجاهل / a fix worse than this is ignored
    maxSpeedMps: 70,       // ~250 كم/س: أسرع من هذا = قفزة خاطئة / faster than this = a bogus jump
    courseMinMoveM: 15,    // أقل إزاحة لحساب اتجاه الحركة / least displacement to derive a course
    windowMs: 20000,       // نافذة القراءات / readings window
    stopEdgeMs: 5000,      // الوقوف: متوسط أول/آخر 5 ث من النافذة / standing: mean of the window's first/last 5 s
    stopMoveM: 10,         // ...متقاربان أقل من هذا / ...closer than this
    stopSpreadM: 15,       // ...وكل القراءات حول المتوسط ضمن هذا (أو ضعف الدقة) / ...and every fix within this of the mean (or twice the accuracy)
    okDeg: 30, adjustDeg: 70, hysteresisDeg: 5,
    confirmReadings: 3,    // تأكيد تغيير الحالة / confirm a state change
    firstConfirmReadings: 2,
    approachM: 10,         // تناقص المسافة الذي يُعتبر اقترابًا / distance drop that counts as approaching
    approachWindowMs: 10000, // مدة قياس الاقتراب / how far back approaching is measured
    nearM: 80,             // قرب المحطة: لا «غير صحيح» / near the station: no «wrong»
    farM: 5000,            // ≤ هذا = قريب: شريط الانحراف و«عدّل قليلًا» / ≤ this = near: deviation bar and «adjust»
    farMarginM: 50         // البعيد فقط فوق 5050 م — لا تذبذب عند الحد مع تذبذب GPS / far only above 5050 m — no flicker at the limit with GPS jitter
  };

  const R = 6371000, rad = d => d * Math.PI / 180;
  function distM(a, b) {
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function bearingDeg(a, b) {
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function centroid_(list) {
    let la = 0, lo = 0;
    list.forEach(h => { la += h.p[0]; lo += h.p[1]; });
    return [la / list.length, lo / list.length];
  }
  /* الفرق بين اتجاهين من −180 إلى 180 (موجب = المحطة إلى اليمين) — Angle difference −180..180 (positive = station to the right) */
  function angleDiff(to, from) { return ((to - from + 540) % 360) - 180; }

  /**
   * يُنشئ متتبعًا لمحطة واحدة. push(fix) لكل قراءة GPS: { lat, lng, acc, t }.
   * يُرجع { state, deviation, course, approaching, reason }:
   * state: 'ok' | 'adjust' | 'wrong' (حالة مؤكدة) أو 'init' | 'stopped' | 'weak' (بلا حكم).
   * Creates a tracker for one station. push(fix) per GPS reading. Returns the confirmed state, or a no-verdict state.
   */
  function createDirectionTracker(target, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    let history = [];       // قراءات جيدة فقط / good fixes only
    let stable = null;      // الحالة المؤكدة / the confirmed state
    let pending = null;     // { cat, count }
    let near = null;        // قرب المحطة بهامش (5 كم) / near the station, with a margin (5 km)
    let last = { state: 'init', deviation: null, course: null, approaching: false, near: null };

    function categorize_(absDev) {
      // حد 30°: مغادرة «صحيح» تحتاج > 35°، والعودة إليه < 25° — 30° limit: leaving «ok» needs > 35°, returning < 25°
      const okLimit = stable === 'ok' ? o.okDeg + o.hysteresisDeg : stable ? o.okDeg - o.hysteresisDeg : o.okDeg;
      const wrongLimit = stable === 'wrong' ? o.adjustDeg - o.hysteresisDeg : stable ? o.adjustDeg + o.hysteresisDeg : o.adjustDeg;
      if (absDev <= okLimit) return 'ok';
      if (absDev <= wrongLimit) return 'adjust';
      return 'wrong';
    }

    function push(fix) {
      const p = [fix.lat, fix.lng], t = fix.t;
      if (!(fix.acc <= o.weakAccuracyM)) return (last = Object.assign({}, last, { state: stable ? last.state : 'weak', reason: 'weak' }));
      const prev = history[history.length - 1];
      if (prev && t > prev.t && distM(prev.p, p) / ((t - prev.t) / 1000) > o.maxSpeedMps) {
        return (last = Object.assign({}, last, { reason: 'jump' })); // قفزة مستحيلة — تُتجاهل / impossible jump — ignored
      }
      history.push({ p: p, t: t, acc: fix.acc });
      history = history.filter(h => t - h.t <= o.windowMs);
      const distNow = distM(p, target); // المسافة المباشرة الحالية — لا مسافة الطرق / the current direct distance — not the road distance
      const distRounded = Math.round(distNow); // لأقرب متر — 5 كم بالضبط تُعتبر 5 كم / to the nearest metre — exactly 5 km counts as 5 km
      if (near === null) near = distRounded <= o.farM;
      else if (near && distRounded > o.farM + o.farMarginM) near = false;
      else if (!near && distRounded <= o.farM) near = true;

      // الوقوف: متوسط موقع أول 5 ث من النافذة ومتوسط آخر 5 ث متقاربان (< 10 م) — المتوسط يلغي تذبذب GPS فلا يُقرأ المشي البطيء وقوفًا
      // Standing: the mean position of the window's first 5 s and of its last 5 s are close (< 10 m) — averaging cancels GPS jitter so slow walking isn't read as standing
      // + كل القراءات متجمعة (ضمن 15 م أو ضعف الدقة) — وإلا فالدوران للخلف والعودة لنفس المكان يبدو وقوفًا
      // + all fixes clustered (within 15 m or twice the accuracy) — otherwise a U-turn back over the same spot looks like standing
      let stopped = false;
      if (t - history[0].t >= o.windowMs * 0.8) {
        const early = history.filter(h => h.t - history[0].t <= o.stopEdgeMs), late = history.filter(h => t - h.t <= o.stopEdgeMs);
        const center = centroid_(history), spread = Math.max(o.stopSpreadM, 2 * fix.acc);
        stopped = distM(centroid_(early), centroid_(late)) < o.stopMoveM && history.every(h => distM(h.p, center) <= spread);
      }
      if (stopped) {
        stable = null; pending = null; // بعد الوقوف يُعاد التأكيد من جديد / after standing, confirm afresh
        return (last = { state: 'stopped', deviation: null, course: null, approaching: false, near: near, reason: 'stopped' });
      }

      // اتجاه الحركة: من أحدث قراءة تبعد 15 م على الأقل و1.5× دقة القراءتين (آخر مقطع حركة فعلي، فيلتقط الانعطاف بسرعة)
      // — تذبذب GPS لا يُحسب حركة. Course: from the newest fix at least 15 m away and 1.5× both fixes' accuracy (the latest
      // real movement segment, so turns are caught quickly) — GPS jitter never counts as movement.
      let from = null;
      for (let i = history.length - 2; i >= 0; i--) {
        const need = Math.max(o.courseMinMoveM, 1.5 * Math.max(history[i].acc, fix.acc));
        if (distM(history[i].p, p) >= need) { from = history[i]; break; }
      }
      if (!from) return (last = { state: stable || 'init', deviation: last.deviation, course: last.course, approaching: last.approaching, near: near, reason: 'moving-little' });

      const course = bearingDeg(from.p, p);
      const deviation = angleDiff(bearingDeg(p, target), course);
      // الاقتراب خلال آخر 10 ث — يحمي الطرق المنحنية من «غير صحيح» ويلتقط الدوران للخلف — Approaching over the last 10 s — shields curving roads from «wrong», still catches a U-turn
      const trendFrom = history.find(h => t - h.t <= o.approachWindowMs) || history[0];
      const approaching = distM(trendFrom.p, target) - distNow >= o.approachM;

      let cat = categorize_(Math.abs(deviation));
      if (cat === 'wrong' && (approaching || distNow < o.nearM)) cat = 'adjust';
      // بعيدًا عن المحطة لا يوجد مسار واضح، فالانحراف الدقيق مزعج: «صحيح» أو «غير صحيح» فقط
      // Far from the station there's no clear path, so fine deviation is noise: «right» or «wrong» only
      if (!near && cat === 'adjust') cat = 'ok';

      if (cat === stable) pending = null;
      else {
        pending = pending && pending.cat === cat ? { cat: cat, count: pending.count + 1 } : { cat: cat, count: 1 };
        if (pending.count >= (stable ? o.confirmReadings : o.firstConfirmReadings)) { stable = cat; pending = null; }
      }
      return (last = { state: stable || 'init', deviation: deviation, course: course, approaching: approaching, near: near, reason: 'ok' });
    }

    return { push: push, current: function () { return last; } };
  }

  global.SecDirectionTracker = { create: createDirectionTracker, angleDiff: angleDiff, DEFAULTS: DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
