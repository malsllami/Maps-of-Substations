/* ============================================================
 * components/navigation-view.js — عرض الملاحة «🧭 المسار من موقعي» والتحكم بواجهتها فقط
 * ============================================================
 * تصميم V1 المعتمد والمجرّب ميدانيًا كما هو (الشاشة الكاملة، ✕ العائم، شارة «بدون اتصال»، اللوحة السفلية وتفاصيلها
 * ومظهرها، «⌖ متابعة»، الكاميرا، ودوران الخريطة مع البوصلة) — لكن القرارات كلها من الخدمات المختبرة:
 * - services/navigation.js: الموقع الأول، OSRM، إعادة الحساب، الوصول، التوجيه المباشر، والتنظيف.
 * - services/direction-tracker.js: حكم الاتجاه، والحركة، وقواعد الدوران (10 كم/س، 8°).
 * - services/nav-camera.js: ماذا يظهر أمامك (الطريق القادم حسب السرعة والمنعطفات — قرار 9 أكتوبر 2026). هنا يُحوَّل إلى
 *   تكبير وموضع: موقعي ثابت عند نقطة واحدة في الوضعين، والتكبير والتصغير درجة واحدة كل تحديث (بلا قفزات).
 * هذا الملف يرسم حالة المحرك على Leaflet ويكتب نصوصها، ويحفظ اختيارَي المستخدم (الدوران ومظهر اللوحة) فقط.
 * الصفحة تمرّر ما يلزم عبر init(deps): getMap، stage، topArea، relayout، hint، hideHint، googleMapsUrl، fractionalZoom.
 *
 * The navigation view and its UI control only. V1's approved, field-tested design as is — but every decision comes from
 * the tested services (navigation.js: first fix, OSRM, recompute, arrival, direct guidance, cleanup; direction-tracker.js:
 * the verdict, motion, rotation rules). This file draws the engine's state on Leaflet, writes its texts, and saves the
 * user's two choices (rotation and sheet look) only. The page passes what's needed through init(deps).
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, NAV = global.SecNavigation, T = global.SecDirectionTracker, CAM = global.SecNavCamera;
  if (!CONFIG || !NAV || !T || !CAM) throw new Error('navigation-view.js يحتاج الإعدادات وnavigation.js وdirection-tracker.js وnav-camera.js قبله / needs config, navigation.js, direction-tracker.js and nav-camera.js first');
  const ROTATE_KEY = CONFIG.STORAGE_KEYS.NAV_ROTATE, GLASS_KEY = CONFIG.STORAGE_KEYS.NAV_GLASS;

  // ===== ثوابت العرض (من V1) — Display constants (from V1) =====
  const CAMERA_EVERY_MS = 2500;      // الكاميرا تتحرك بهدوء لا مع كل قراءة / the camera moves calmly, not on every fix
  const MAX_FOLLOW_ZOOM = 17;
  const USER_ZOOM_WINDOW_MS = 1500;  // تكبير خلال هذه المدة بعد لمس حقيقي = من المستخدم / a zoom within this after a real touch = the user's
  const ME_COLOR = '#2E7DD1';
  const FIT_PAD_SIDE = 36, FIT_PAD_BOTTOM = 40, FRAME_SETTLE_MS = 900, MIN_ZOOM = 3;
  const ROT_PIVOT = 0.68, ROT_TOP = 70;
  const DIRECT_LINE_FAR_M = 5000, DIRECT_LINE_MARGIN_M = 50, DIRECT_LINE_W = 6, DIRECT_LINE_FAR_W = 4;
  const GLASS_MODES = [['clear', 'واضحة'], ['bal', 'متوازنة'], ['solid', 'معتمة']];
  const DIR_NAMES = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
  const TONE_COLOR = { ok: '#18A957', warn: '#E8A317', bad: '#E5484D' };

  const MSG = {
    locating: '📍 جارٍ تحديد موقعك…',
    refused: 'يلزم السماح بتحديد موقعك لبدء الملاحة.',
    settings: 'صلاحية تحديد الموقع غير مفعلة. فعّلها من إعدادات المتصفح أو الجهاز للمتابعة.',
    inaccurate: function (acc) { return 'دقة موقعك غير كافية للملاحة (الدقة الحالية ' + fmtAcc_(acc) + '). تأكد من تفعيل خدمات الموقع و«الموقع الدقيق»، ثم حاول مرة أخرى.'; },
    noFix: 'تعذّر الحصول على موقعك. تأكد من تفعيل خدمات الموقع، ثم حاول مرة أخرى.',
    unsupported: 'المتصفح لا يدعم تحديد الموقع',
    badStation: 'إحداثيات المحطة غير صالحة للملاحة'
  };
  // حالة المحرك ← النص واللون — the engine status ← text and tone
  const STATUS = {
    locating: ['جارٍ تحديد موقعك…', 'wait'], routing: ['جارٍ حساب المسار…', 'wait'], road: ['المسار محسوب بالشوارع', 'ok'],
    'road-weak': ['دقة الموقع ضعيفة — المسار محسوب بالشوارع', 'warn'], 'off-route': ['خرجت عن المسار — إعادة حساب المسار…', 'warn'],
    arrived: ['وصلت إلى المحطة ✓', 'ok']
  };
  const SMART_STATUS = {
    ok: ['🟢 الاتجاه صحيح', 'ok'], adjust: ['🟡 عدّل الاتجاه قليلًا', 'warn'], wrong: ['🔴 الاتجاه غير صحيح', 'bad'],
    init: ['جارٍ تحديد اتجاه حركتك…', 'wait'], stopped: ['متوقف — تحرّك ليُحدَّد اتجاهك', 'wait'], weak: ['دقة الموقع ضعيفة — بانتظار قراءة أدق', 'wait']
  };

  let deps = null, engine = null, ui = null, starting = false;

  function fmtAcc_(m) { return m >= 1000 ? '±' + (m / 1000).toFixed(1) + ' كم' : '±' + Math.round(m) + ' م'; }
  function fmtDist_(m) { return m >= 1000 ? { v: (m / 1000).toFixed(1), u: 'كم' } : { v: String(Math.max(0, Math.round(m / 10) * 10)), u: 'م' }; }
  function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dirName_(deg) { return DIR_NAMES[Math.round(deg / 45) % 8]; }
  function read_(key, allowed, fallback) { try { const v = global.localStorage.getItem(key); return allowed.indexOf(v) !== -1 ? v : fallback; } catch (e) { return fallback; } }
  function save_(key, v) { try { global.localStorage.setItem(key, v); } catch (e) { /* للجلسة فقط / this session only */ } }

  function init(pageDeps) {
    deps = pageDeps;
    if (!engine) { engine = NAV.create(); engine.subscribe(onState_); }
  }

  // ===== إبقاء الشاشة مضاءة أثناء الملاحة (طلب محمد 16 أكتوبر) — Keep the screen on during navigation =====
  /* Screen Wake Lock: يُطلب عند بدء الملاحة، والمتصفح يحرّره تلقائيًا إذا ذهبت الصفحة للخلفية فيُطلب من جديد عند العودة،
   * ويُحرَّر عند الإيقاف. غير مدعوم أو مرفوض ← لا شيء يتغير (بلا حيل).
   * Requested when navigation starts; the browser drops it when the page goes to the background, so it is requested again on
   * return; released on stop. Unsupported or refused ← nothing changes (no tricks). */
  let wakeLock = null;
  async function keepAwake_() {
    if (!ui || wakeLock || !global.navigator.wakeLock || global.document.visibilityState !== 'visible') return;
    try {
      const lock = await global.navigator.wakeLock.request('screen');
      if (!ui) { lock.release().catch(function () { /* لا شيء / nothing */ }); return; } // انتهت الملاحة أثناء الطلب / nav ended meanwhile
      wakeLock = lock;
      lock.addEventListener('release', function () { if (wakeLock === lock) wakeLock = null; });
    } catch (e) { /* رفض المتصفح (بطارية منخفضة/سياسة) — الملاحة تعمل كالمعتاد / refused — navigation works as usual */ }
  }
  function releaseAwake_() {
    const lock = wakeLock;
    wakeLock = null;
    if (lock) lock.release().catch(function () { /* لا شيء / nothing */ });
  }
  function onVisibility_() { if (global.document.visibilityState === 'visible') keepAwake_(); }
  function isActive() { return !!ui; }

  // ===== البدء والإيقاف — Start and stop =====
  /* الترتيب كما في V1: الصلاحية ← أول موقع دقيق ← ثم فقط شاشة الملاحة. الرفض أو عدم الدقة ← رسالة واضحة وبطاقة المحطة كما هي.
   * As in V1: permission ← first precise fix ← only then the navigation screen. Refusal or imprecision ← a clear message, card untouched. */
  async function start(station) {
    if (!deps || !station || starting) return false;
    if (ui) stop();
    starting = true;
    deps.hint(MSG.locating, true);
    const r = await engine.start({ destination: { lat: station.lat, lng: station.lng } });
    starting = false;
    if (!r.ok) {
      const c = r.error.code;
      if (c === 'cancelled') return false;
      deps.hint(c === 'inaccurate' ? MSG.inaccurate(r.error.accuracy) : c === 'invalid-coordinates' || c === 'no-destination' ? MSG.badStation : MSG[c] || MSG.noFix);
      return false;
    }
    deps.hideHint();
    build_(station);
    if (global.SecUsageLog) global.SecUsageLog.navStart(); // سجل الاستخدام (22 أكتوبر): بدء الملاحة / the usage log: navigation start
    onState_(engine.state());
    return true;
  }

  function stop() {
    if (starting) { starting = false; deps.hideHint(); }
    const had = !!ui;
    teardown_();
    if (engine) engine.stop();
    return had;
  }

  /* تغيّرت إحداثيات المحطة أثناء الملاحة (تحقق الخادم) — The station's coordinates changed mid-navigation (server check) */
  function updateTarget(station) {
    if (!ui || !station || !engine.updateTarget({ lat: station.lat, lng: station.lng })) return false;
    ui.station = station;
    const gm = ui.sheet.querySelector('.nav-gm');
    if (gm) gm.href = deps.googleMapsUrl(station);
    moveCamera_(true);
    return true;
  }

  // ===== حالة المحرك ← الشاشة — The engine state ← the screen =====
  function onState_(s) {
    if (!ui) return;
    if (!s.active) { // أنهى المحرك الملاحة بنفسه (سُحبت الصلاحية) / the engine ended navigation itself (permission revoked)
      teardown_();
      if (s.error && s.error.code === 'settings') deps.hint(MSG.settings);
      return;
    }
    const first = !ui.s;
    ui.s = s;
    if (ui.rotation.update(s.motion, s.dir ? s.dir.state : null, ui.follow).changed) applyBearing_();
    drawMe_();
    drawLines_();
    render_();
    moveCamera_(first);
  }

  // ===== البناء والتفكيك — Building and teardown =====
  function build_(station) {
    const map = deps.getMap();
    ui = {
      station: station, map: map, s: null, follow: true, framed: false, lastCameraAt: 0, cameraMovedAt: 0, lastUserInputAt: 0,
      meDot: null, accCircle: null, routeLine: null, routePts: null, directLine: null, lineFar: false, expanded: false,
      rotation: T.createRotation(read_(ROTATE_KEY, ['course', 'north'], 'course')), pivot: null, rotD: null, sheetTop: null,
      prevZoomSnap: map.options.zoomSnap,
      prevOpts: { touchZoom: map.options.touchZoom, scrollWheelZoom: map.options.scrollWheelZoom, doubleClickZoom: map.options.doubleClickZoom }
    };
    deps.topArea.classList.add('nav-collapsed');
    deps.stage.classList.add('nav-active');
    global.document.body.classList.add('nav-full');
    deps.relayout();
    applyZoomSnap_();
    buildSheet_();
    bindInput_();
    bindRotDrag_();
    setRotateMode_(ui.rotation.mode());
    global.document.addEventListener('visibilitychange', onVisibility_);
    keepAwake_();
  }

  function teardown_() {
    if (ui && global.SecUsageLog) global.SecUsageLog.navEnd(); // دقائق الملاحة بأي طريقة انتهت / navigation minutes however it ended
    if (!ui) return;
    const u = ui;
    ui = null;
    global.document.removeEventListener('visibilitychange', onVisibility_);
    releaseAwake_();
    const map = u.map, mc = map.getContainer();
    map.off('dragstart', u.onDrag); map.off('zoomstart', u.onZoom);
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (t) { deps.stage.removeEventListener(t, u.onUserInput, { capture: true }); });
    mc.removeEventListener('pointerdown', u.onRotDown);
    global.removeEventListener('pointermove', u.onRotMove);
    global.removeEventListener('pointerup', u.onRotUp);
    global.removeEventListener('pointercancel', u.onRotUp);
    [u.meDot, u.accCircle, u.routeLine, u.directLine].forEach(function (l) { if (l) map.removeLayer(l); });
    map.options.zoomSnap = u.prevZoomSnap;
    mc.classList.remove('nav-rot'); deps.stage.classList.remove('nav-rot-on');
    ['--rot-d', '--rot-left', '--rot-top', '--rot-a'].forEach(function (p) { mc.style.removeProperty(p); });
    map.dragging.enable();
    Object.keys(u.prevOpts).forEach(function (k) { map.options[k] = u.prevOpts[k]; });
    [u.sheet, u.followBtn, u.xBtn, u.chip].forEach(function (el) { if (el) el.remove(); });
    global.document.body.classList.remove('nav-full');
    deps.topArea.classList.remove('nav-collapsed');
    deps.stage.classList.remove('nav-active');
    deps.stage.style.removeProperty('--nav-sheet-h');
    deps.relayout();
  }

  /* تحريك المستخدم للخريطة يوقف الكاميرا فقط (V1): السحب منه دائمًا، والتكبير منه فقط إن سبقه لمس حقيقي خلال 1.5 ث
   * The user moving the map stops the camera only (V1): a drag is always theirs, a zoom only after a real touch within 1.5 s */
  function bindInput_() {
    ui.onUserInput = function (e) {
      if (!ui || ui.sheet.contains(e.target) || ui.followBtn.contains(e.target)) return;
      ui.lastUserInputAt = Date.now();
    };
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (t) { deps.stage.addEventListener(t, ui.onUserInput, { capture: true, passive: true }); });
    ui.onDrag = function () { pauseFollow_(); };
    ui.onZoom = function () { if (ui && ui.lastUserInputAt > ui.cameraMovedAt && Date.now() - ui.lastUserInputAt < USER_ZOOM_WINDOW_MS) pauseFollow_(); };
    ui.map.on('dragstart', ui.onDrag);
    ui.map.on('zoomstart', ui.onZoom);
  }

  // ===== الرسم — Drawing =====
  /* موقعي: سهم يدور مع اتجاه الحركة، ونقطة عند الوقوف أو قبل معرفة الاتجاه — Me: an arrow turning with the course, a dot when standing */
  function drawMe_() {
    const s = ui.s;
    if (!s.me) return;
    if (!ui.meDot) {
      ui.accCircle = global.L.circle(s.me, { radius: s.acc, color: ME_COLOR, weight: 1, fillColor: ME_COLOR, fillOpacity: 0.15, interactive: false }).addTo(ui.map);
      ui.meDot = global.L.marker(s.me, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: global.L.divIcon({
        className: 'nav-me', iconSize: [34, 34], iconAnchor: [17, 17],
        html: '<span class="nav-me-dot"></span><svg class="nav-me-arrow" width="34" height="34" viewBox="0 0 24 24"><path d="M12 2.5l7 18-7-4.2-7 4.2z" fill="' + ME_COLOR + '" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>'
      }) }).addTo(ui.map);
    } else {
      ui.accCircle.setLatLng(s.me).setRadius(s.acc);
      ui.meDot.setLatLng(s.me);
    }
    const course = s.motion ? s.motion.course : null, verdict = s.dir ? s.dir.state : null;
    const moving = course != null && verdict !== 'stopped' && verdict !== 'weak';
    const el = ui.meDot.getElement();
    if (el) {
      el.classList.toggle('moving', moving);
      if (moving) el.querySelector('.nav-me-arrow').style.transform = 'rotate(' + Math.round(course) + 'deg)';
    }
  }

  /* مسار الطرق (OSRM)، أو خط مباشر بلا ادعاء مسار — أرفع بعد 5 كم (هامش 50 م) — The road route, or a direct line (thinner beyond 5 km) */
  function drawLines_() {
    const s = ui.s, map = ui.map;
    if (s.mode === 'road' && s.route) {
      if (ui.directLine) { map.removeLayer(ui.directLine); ui.directLine = null; }
      if (ui.routePts !== s.route.pts) {
        ui.routePts = s.route.pts;
        if (ui.routeLine) ui.routeLine.setLatLngs(s.route.pts);
        else ui.routeLine = global.L.polyline(s.route.pts, { color: ME_COLOR, weight: 6, opacity: 0.9, interactive: false }).addTo(map);
      }
      return;
    }
    if (ui.routeLine) { map.removeLayer(ui.routeLine); ui.routeLine = null; ui.routePts = null; }
    if (s.mode !== 'smart' || !s.me) return;
    const d = Math.round(s.straight);
    ui.lineFar = ui.lineFar ? d > DIRECT_LINE_FAR_M : d > DIRECT_LINE_FAR_M + DIRECT_LINE_MARGIN_M;
    const weight = ui.lineFar ? DIRECT_LINE_FAR_W : DIRECT_LINE_W;
    if (ui.directLine) { ui.directLine.setLatLngs([s.me, s.destination]); if (ui.directLine.options.weight !== weight) ui.directLine.setStyle({ weight: weight }); }
    else ui.directLine = global.L.polyline([s.me, s.destination], { color: ME_COLOR, weight: weight, opacity: 0.9, interactive: false, className: 'nav-direct-line' }).addTo(map);
  }

  // ===== الكاميرا (من V1) — The camera (from V1) =====
  /* تكبير كسري (0.25) مع خريطة جدة المحلية فقط؛ مع المربعات بدرجات صحيحة (لا فواصل بين المربعات)
   * Fractional zoom (0.25) only with the local Jeddah map; whole levels with image tiles (no seams) */
  function applyZoomSnap_() {
    if (!ui) return;
    const fractional = !!(deps.fractionalZoom && deps.fractionalZoom());
    ui.map.options.zoomSnap = fractional ? 0.25 : 1;
    const z = ui.map.getZoom();
    if (!fractional && z % 1) { ui.cameraMovedAt = Date.now(); ui.map.setZoom(Math.floor(z), { animate: false }); }
  }

  /* الكاميرا (الوضعان): الإطار من nav-camera.js، وموقعي ثابت عند نقطة الدوران، وأقرب تكبير يُظهر الإطار كله فوق اللوحة
   * The camera (both modes): the frame from nav-camera.js, me fixed at the pivot, the closest zoom showing the whole frame */
  function moveCamera_(force) {
    if (!ui || !ui.s || !ui.s.me || !ui.follow) return;
    if (!force && Date.now() - ui.lastCameraAt < CAMERA_EVERY_MS) return;
    ui.lastCameraAt = Date.now();
    applyZoomSnap_();
    const map = ui.map, rot = rotating_();
    if (rot) rotLayout_(); else { map.invalidateSize({ pan: false }); northPivot_(); }
    const f = CAM.frame(ui.s), b = rot ? ui.rotation.bearing() : 0;
    const target = targetZoom_(f.points, b), cur = map.getZoom(), first = !ui.framed;
    // درجة واحدة كل تحديث في الاتجاهين بلا قفزات؛ أول تأطير وحده مباشر / one level per update both ways; only the first framing is direct
    const zoom = force || first ? target : Math.max(cur - 1, Math.min(cur + 1, target));
    ui.framed = true; ui.cameraMovedAt = Date.now(); ui.frame = f;
    map.setView(centerFor_(zoom), zoom, { animate: true, duration: 0.8 });
    if (first) global.setTimeout(function () { if (ui && ui.follow) moveCamera_(true); }, FRAME_SETTLE_MS);
  }
  /* نقطة الدوران في وضع الشمال لأعلى: نفس موضعها في الوضع المُدار — the north-up pivot: the same spot as in rotated mode */
  function northPivot_() {
    const stage = deps.stage, sr = stage.getBoundingClientRect();
    const sheetTop = ui.sheet.getBoundingClientRect().top - sr.top;
    ui.pivot = global.L.point(stage.clientWidth / 2, Math.round(ROT_TOP + (sheetTop - ROT_TOP) * ROT_PIVOT)); ui.sheetTop = sheetTop;
  }
  /* هل تقع النقاط داخل المساحة الظاهرة وموقعي عند نقطة الدوران بتكبير z؟ — do the points fit the visible area with me at the pivot at zoom z? */
  function fits_(points, b, z) {
    const map = ui.map, W = deps.stage.clientWidth, meP = map.project(ui.s.me, z);
    return points.every(function (p) {
      const v = toScreen_(map.project(p, z).subtract(meP), b), x = ui.pivot.x + v.x, y = ui.pivot.y + v.y;
      return x >= FIT_PAD_SIDE && x <= W - FIT_PAD_SIDE && y >= ROT_TOP && y <= ui.sheetTop - FIT_PAD_BOTTOM;
    });
  }
  function targetZoom_(points, b) {
    const step = ui.map.options.zoomSnap || 1;
    for (let z = MAX_FOLLOW_ZOOM; z >= MIN_ZOOM; z -= step) if (fits_(points, b, z)) return z;
    return MIN_ZOOM;
  }
  /* مركز الخريطة الذي يضع موقعي عند نقطة الدوران — the map centre that puts me at the pivot.
     المُدار: الحاوية متمركزة على نقطة الدوران فالمركز موقعي؛ الشمال لأعلى: إزاحة من منتصف الحاوية / rotated: the container is centred on the pivot */
  function centerFor_(zoom) {
    if (rotating_()) return ui.s.me;
    const map = ui.map, size = map.getSize();
    return map.unproject(map.project(ui.s.me, zoom).add(global.L.point(size.x / 2 - ui.pivot.x, size.y / 2 - ui.pivot.y)), zoom);
  }

  // ===== دوران الخريطة (العرض فقط — القواعد في direction-tracker.js) — Map rotation (display only) =====
  function rotating_() { return !!ui && ui.rotation.mode() === 'course'; }
  function toScreen_(v, bearing) { const a = -bearing * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return global.L.point(v.x * c - v.y * s, v.x * s + v.y * c); }

  function rotLayout_() {
    if (!ui) return;
    const c = ui.map.getContainer(), stage = deps.stage;
    if (!rotating_()) {
      c.classList.remove('nav-rot'); stage.classList.remove('nav-rot-on');
      ['--rot-d', '--rot-left', '--rot-top', '--rot-a'].forEach(function (p) { c.style.removeProperty(p); });
      return;
    }
    const W = stage.clientWidth, H = stage.clientHeight, sr = stage.getBoundingClientRect();
    const sheetTop = ui.sheet.getBoundingClientRect().top - sr.top;
    const py = Math.round(ROT_TOP + (sheetTop - ROT_TOP) * ROT_PIVOT);
    const D = Math.ceil(2 * Math.hypot(W / 2, Math.max(py, H - py))) + 2; // قطر يغطي الشاشة بأي دوران / a diameter covering the screen at any angle
    const changed = !ui.pivot || ui.pivot.y !== py || ui.pivot.x !== W / 2 || ui.rotD !== D;
    ui.pivot = global.L.point(W / 2, py); ui.rotD = D; ui.sheetTop = sheetTop;
    c.style.setProperty('--rot-d', D + 'px');
    c.style.setProperty('--rot-left', Math.round(W / 2 - D / 2) + 'px');
    c.style.setProperty('--rot-top', Math.round(py - D / 2) + 'px');
    c.classList.add('nav-rot'); stage.classList.add('nav-rot-on');
    applyBearing_();
    if (changed) { ui.map.invalidateSize({ pan: false }); if (ui.follow && ui.s && ui.s.me) ui.map.setView(ui.s.me, ui.map.getZoom(), { animate: false }); }
  }

  function applyBearing_() {
    if (!ui) return;
    const b = rotating_() ? ui.rotation.bearing() : 0;
    ui.map.getContainer().style.setProperty('--rot-a', (-b).toFixed(1) + 'deg');
    if (ui.dial) ui.dial.style.transform = b ? 'rotate(' + (-b).toFixed(1) + 'deg)' : '';
  }

  /* السحب في الوضع المُدار: حركة الإصبع على الشاشة ← نفس الاتجاه على الخريطة — drag in rotated mode: finger on screen ← the same direction on the map */
  function bindRotDrag_() {
    const c = ui.map.getContainer();
    let last = null, moved = 0;
    ui.onRotDown = function (e) { if (!rotating_() || !e.isPrimary) return; last = { x: e.clientX, y: e.clientY }; moved = 0; };
    ui.onRotMove = function (e) {
      if (!last || !rotating_() || !e.isPrimary) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < 6) return; // لمسة لا سحب / a tap, not a drag
      pauseFollow_();
      const a = ui.rotation.bearing() * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
      ui.map.panBy(global.L.point(-(dx * cs - dy * sn), -(dx * sn + dy * cs)), { animate: false });
    };
    ui.onRotUp = function () { last = null; };
    c.addEventListener('pointerdown', ui.onRotDown);
    global.addEventListener('pointermove', ui.onRotMove);
    global.addEventListener('pointerup', ui.onRotUp);
    global.addEventListener('pointercancel', ui.onRotUp);
  }

  function setRotateMode_(mode) {
    if (!ui) return;
    const m = ui.rotation.setMode(mode);
    save_(ROTATE_KEY, m);
    const map = ui.map, on = m === 'course';
    if (on) map.dragging.disable(); else map.dragging.enable(); // المُدار: السحب بمعالجنا والتكبير حول موقعي / rotated: our drag, zoom around me
    ['touchZoom', 'scrollWheelZoom', 'doubleClickZoom'].forEach(function (k) { map.options[k] = on ? 'center' : ui.prevOpts[k]; });
    rotLayout_();
    if (!on) map.invalidateSize({ pan: false });
    applyBearing_();
    if (ui.dial) {
      ui.dial.classList.toggle('north', !on);
      ui.dial.title = on ? 'الخريطة تدور معك — اضغط لتثبيت الشمال لأعلى' : 'الشمال لأعلى — اضغط لتدور الخريطة معك';
      ui.dial.setAttribute('aria-label', ui.dial.title);
    }
    moveCamera_(true);
  }

  function pauseFollow_() {
    if (!ui || !ui.follow) return;
    ui.follow = false; ui.followBtn.hidden = false;
    placeFollowBtn_();
  }
  function resumeFollow_() {
    if (!ui) return;
    ui.follow = true; ui.followBtn.hidden = true;
    moveCamera_(true);
  }

  // ===== اللوحة (التصميم الهجين المعتمد في V1) — The sheet (V1's approved hybrid design) =====
  function setGlass_(g) {
    if (!ui) return;
    save_(GLASS_KEY, g);
    GLASS_MODES.forEach(function (m) { ui.sheet.classList.toggle('glass-' + m[0], m[0] === g); });
    ui.sheet.querySelectorAll('.nav-glass button').forEach(function (b) { b.classList.toggle('on', b.dataset.glass === g); });
  }

  function buildSheet_() {
    const s = ui.station, L = global.L, doc = global.document;
    const sheet = doc.createElement('div');
    sheet.className = 'nav-sheet';
    sheet.innerHTML =
      '<div class="nav-grab"></div>' +
      '<div class="nav-head"><div class="nav-big"><div class="nav-d"><span class="nav-dv">—</span><small class="nav-du"></small></div></div>' +
      '<div class="nav-dirbox"><div class="nav-dir"></div><div class="nav-dial"><b>N</b><svg class="nav-arrow" width="26" height="26" viewBox="0 0 24 24"><path d="M12 2l6.5 18L12 16l-6.5 4z" fill="' + ME_COLOR + '"/></svg></div></div></div>' +
      '<div class="nav-line2"><div class="nav-stt"></div><div class="nav-kind"></div></div>' +
      '<div class="nav-note" hidden>🟠 اتجاه مباشر، وليس مسار طرق</div>' +
      '<div class="nav-band-wrap" hidden><div class="nav-band"><i hidden></i></div>' +
      '<div class="nav-lbl"><span class="bad">يمين كثيرًا</span><span class="warn">يمين</span><span class="ok">في الاتجاه الصحيح</span><span class="warn">يسار</span><span class="bad">يسار كثيرًا</span></div></div>' +
      '<div class="nav-details" hidden><div class="nav-rows">' +
      '<div class="nav-row"><span class="k">حالة الاتصال</span><span class="v nav-conn">—</span></div>' +
      '<div class="nav-row"><span class="k">نوع الملاحة</span><span class="v nav-type">—</span></div>' +
      '<div class="nav-row"><span class="k">رقم المحطة</span><span class="v num">' + esc_(s.id) + '</span></div>' +
      '<div class="nav-row"><span class="k">' + (s.region ? 'المنطقة' : 'النوع') + '</span><span class="v">' + esc_(s.region || s.type) + '</span></div>' +
      '<div class="nav-row"><span class="k">دقة الموقع</span><span class="v num nav-acc">—</span></div></div>' +
      '<div class="nav-lbl2">🌓 مظهر اللوحة</div>' +
      '<div class="nav-glass">' + GLASS_MODES.map(function (m) { return '<button type="button" data-glass="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>' +
      '<a class="nav-gm" href="' + esc_(deps.googleMapsUrl(s)) + '" target="_blank" rel="noopener">🧭 فتح المحطة في قوقل ماب</a>' +
      '<button type="button" class="nav-end">🔴 إنهاء الملاحة</button></div>' +
      '<button type="button" class="nav-more">⌃ التفاصيل</button>';
    deps.stage.appendChild(sheet);
    ui.sheet = sheet;
    setGlass_(read_(GLASS_KEY, GLASS_MODES.map(function (m) { return m[0]; }), 'bal'));
    sheet.querySelector('.nav-end').addEventListener('click', stop);
    sheet.querySelector('.nav-more').addEventListener('click', function () { setExpanded_(!ui.expanded); });
    sheet.querySelectorAll('.nav-glass button').forEach(function (b) { b.addEventListener('click', function () { setGlass_(b.dataset.glass); }); });
    // مؤشر الاتجاه هو البوصلة: الضغط يبدّل «تدور معي» / «الشمال لأعلى» — the indicator is the compass: a tap switches modes
    ui.dial = sheet.querySelector('.nav-dial');
    ui.dial.setAttribute('role', 'button'); ui.dial.tabIndex = 0;
    ui.dial.addEventListener('click', function () { setRotateMode_(rotating_() ? 'north' : 'course'); });
    let y0 = null;
    sheet.addEventListener('touchstart', function (e) { y0 = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    sheet.addEventListener('touchend', function (e) {
      if (y0 == null || !ui) return;
      const dy = e.changedTouches[0].clientY - y0; y0 = null;
      if (dy < -30) setExpanded_(true); else if (dy > 30) setExpanded_(false);
    });
    L.DomEvent.disableClickPropagation(sheet); L.DomEvent.disableScrollPropagation(sheet);

    const x = doc.createElement('button');
    x.type = 'button'; x.className = 'nav-x'; x.textContent = '✕';
    x.setAttribute('aria-label', 'إنهاء الملاحة'); x.title = 'إنهاء الملاحة';
    x.addEventListener('click', stop);
    L.DomEvent.disableClickPropagation(x);
    deps.stage.appendChild(x);
    ui.xBtn = x;

    const chip = doc.createElement('div');
    chip.className = 'nav-chip'; chip.textContent = '🟠 بدون اتصال · اتجاه مباشر'; chip.hidden = true;
    deps.stage.appendChild(chip);
    ui.chip = chip;

    const btn = doc.createElement('button');
    btn.type = 'button'; btn.className = 'nav-follow'; btn.textContent = '⌖ متابعة'; btn.hidden = true;
    btn.addEventListener('click', resumeFollow_);
    L.DomEvent.disableClickPropagation(btn);
    deps.stage.appendChild(btn);
    ui.followBtn = btn;
  }

  function setExpanded_(on) {
    if (!ui) return;
    ui.expanded = on;
    ui.sheet.querySelector('.nav-details').hidden = !on;
    ui.sheet.querySelector('.nav-more').textContent = on ? '⌄ إخفاء التفاصيل' : '⌃ التفاصيل';
    placeFollowBtn_();
    moveCamera_(true);
  }

  /* زر المتابعة (يسارًا) وأزرار +/− (يمينًا عبر --nav-sheet-h) فوق اللوحة دائمًا — the follow button and +/− always above the sheet */
  function placeFollowBtn_() {
    if (!ui) return;
    const h = ui.sheet.offsetHeight;
    ui.followBtn.style.bottom = (h + 20) + 'px';
    deps.stage.style.setProperty('--nav-sheet-h', h + 'px');
    if (rotating_()) rotLayout_(); // نقطة الدوران تتبع ارتفاع اللوحة / the pivot follows the sheet height
  }

  function render_() {
    const s = ui.s, q = function (sel) { return ui.sheet.querySelector(sel); };
    const smart = s.mode === 'smart', hasRoute = !smart && !!s.route && s.remaining != null, online = s.online;
    const status = s.status === 'smart' ? SMART_STATUS[(s.dir && s.dir.state) || 'init'] || SMART_STATUS.init : STATUS[s.status] || STATUS.locating;
    if (s.me) {
      const d = hasRoute ? fmtDist_(s.remaining) : fmtDist_(s.straight);
      q('.nav-dv').textContent = d.v; q('.nav-du').textContent = d.u;
      const mins = hasRoute && s.route.distance > 0 ? Math.max(1, Math.round(s.route.duration * (s.remaining / s.route.distance) / 60)) : null;
      // المسافة المباشرة لا تُعرض أبدًا كأنها مسافة قيادة — the direct distance is never shown as a driving distance
      q('.nav-kind').textContent = hasRoute ? '🛣 عبر الطرق' + (mins ? ' · ' + mins + ' د' : '') : online ? '📍 مسافة مباشرة · بانتظار مسار الطرق' : '📍 مسافة مباشرة';
      const b = T.bearingDeg(s.me, s.destination);
      q('.nav-dir').textContent = dirName_(b);
      q('.nav-arrow').style.transform = 'rotate(' + Math.round(b) + 'deg)';
      q('.nav-acc').textContent = '±' + Math.round(s.acc) + ' م';
    }
    q('.nav-note').hidden = !smart;
    // شريط الانحراف قرب المحطة فقط (5 كم بهامشه من المتتبع) — the deviation bar near the station only (5 km, the tracker's margin)
    const near = s.dir && s.dir.near != null ? s.dir.near : !!s.me && s.straight <= DIRECT_LINE_FAR_M;
    q('.nav-band-wrap').hidden = !smart || !near;
    const marker = q('.nav-band i');
    const dev = smart && s.dir && s.dir.deviation != null && ['ok', 'adjust', 'wrong'].indexOf(s.dir.state) !== -1 ? s.dir.deviation : null;
    marker.hidden = dev == null;
    if (dev != null) marker.style.left = (50 + dev / 180 * 50).toFixed(1) + '%';
    q('.nav-arrow path').setAttribute('fill', smart && TONE_COLOR[status[1]] ? TONE_COLOR[status[1]] : ME_COLOR);
    const side = smart && s.dir && s.dir.state === 'adjust' && dev != null ? (dev > 0 ? ' يمينًا' : ' يسارًا') : '';
    const stt = q('.nav-stt');
    stt.textContent = status[0] + side;
    stt.className = 'nav-stt ' + status[1];
    q('.nav-conn').textContent = online ? '🟢 متصل' : '🟠 بدون اتصال';
    q('.nav-type').textContent = hasRoute ? '🛣 مسار طرق' : '📍 اتجاه مباشر';
    ui.chip.hidden = online;
    placeFollowBtn_();
  }

  global.SecNavView = {
    init: init, start: start, stop: stop, isActive: isActive, updateTarget: updateTarget, refreshZoomSnap: function () { applyZoomSnap_(); },
    state: function () { return engine ? engine.state() : null; } // قراءة فقط: حالة المحرك كما تراها الشاشة / read-only: the engine state as the screen sees it
  };
})(typeof window !== 'undefined' ? window : globalThis);
