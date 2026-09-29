/* ============================================================
 * services/navigation.js — مسؤول عن "🧭 المسار من موقعي" فقط: الملاحة مع الإنترنت عبر OSRM.
 * يتابع موقع المستخدم (watchPosition)، يرسم مسار الطرق الفعلي، يعرض المسافة عبر الطرق والوقت
 * التقريبي، ويعيد حساب المسار عند الخروج عنه (~150 م) أو كل ~60 ثانية. الملاحة بشاشة كاملة: الخريطة
 * تملأ الشاشة، ✕ عائم أعلاها، ولوحة سفلية صغيرة تُسحب للتفاصيل ومظهر اللوحة (واضحة/متوازنة/معتمة).
 * الكاميرا تتابع المستخدم والمحطة بتكبير تدريجي؛ تحريك الخريطة يدويًا يوقف الكاميرا فقط
 * (GPS والمسافة مستمرة) ويظهر «⌖ متابعة». لا يغيّر أي ميزة قائمة، وزر قوقل ماب يبقى كما هو.
 *
 * Owns "🧭 route from my location" only: online navigation via OSRM. Tracks the user (watchPosition),
 * draws the real road route, shows road distance and approximate time, and recomputes the route when
 * the user leaves it (~150 m) or every ~60 s. Full-screen navigation: the map fills the screen, a floating ✕
 * on top, a small bottom sheet pulled up for details and the panel look (clear/balanced/solid). The camera
 * follows user + station with gradual zoom; dragging the map stops the camera only (GPS and distance
 * keep updating) and shows «⌖ متابعة». Changes no existing feature; the Google Maps button stays as is.
 * ============================================================ */
(function (global) {
  'use strict';

  // ===== الإعدادات (قيم البداية — تُضبط بالتجربة) — Settings (starting values — tuned by testing) =====
  const OFF_ROUTE_M = 150;           // الابتعاد عن المسار الذي يستدعي إعادة الحساب / distance off the route that triggers a recompute
  const REROUTE_EVERY_MS = 60000;    // إعادة حساب دورية / periodic recompute
  const MIN_REROUTE_GAP_MS = 10000;  // أقل فاصل بين طلبين لـOSRM (خدمة عامة) / min gap between OSRM calls (public service)
  const RETRY_AFTER_FAIL_MS = 15000; // إعادة المحاولة بعد فشل OSRM / retry after an OSRM failure
  const MAX_ACCURACY_FOR_REROUTE_M = 100; // قراءة أضعف لا تُعتبر خروجًا عن المسار / a weaker fix never counts as leaving the route
  const ARRIVED_M = 40;              // اعتبار الوصول / arrival radius
  const CAMERA_EVERY_MS = 2500;      // تحديث الكاميرا بهدوء لا مع كل قراءة / camera updates calmly, not on every fix
  const MAX_FOLLOW_ZOOM = 17;
  const USER_ZOOM_WINDOW_MS = 1500;  // تكبير بعد لمس/نقر حقيقي خلال هذه المدة = من المستخدم / a zoom within this time after a real touch/click = the user's
  const ME_COLOR = '#2E7DD1';        // موقعي أزرق — دبوس المحطة الحالي أخضر فلا تلتبس / me in blue — the existing station pin is green
  // أول موقع: الجوال قد يرجع أولًا موقعًا تقريبيًا بعيدًا جدًا (شبكة/IP) — لا تبدأ الملاحة إلا بقراءة GPS دقيقة
  // First fix: the phone may first return a rough, very far position (network/IP) — navigation starts only on a precise GPS fix
  const FIRST_FIX_GOOD_M = 100;      // دقة كافية للبدء فورًا / accurate enough to start at once
  const FIRST_FIX_OK_M = 500;        // مقبولة بعد انتهاء مهلة الانتظار / acceptable once the wait runs out
  const FIRST_FIX_WAIT_MS = 20000;   // مهلة انتظار قراءة دقيقة / how long to wait for a precise fix
  const IGNORE_FIX_M = 500;          // أثناء الملاحة: قراءة أسوأ من هذا لا تحرّك موقعي / while navigating: a worse fix never moves me
  const DENIED_QUICK_MS = 700;       // رفض أسرع من هذا = مرفوض مسبقًا بلا نافذة / a refusal faster than this = denied earlier, no prompt shown
  const MSG = {
    refused: 'يلزم السماح بتحديد موقعك لبدء الملاحة.',
    settings: 'صلاحية تحديد الموقع غير مفعلة. فعّلها من إعدادات المتصفح أو الجهاز للمتابعة.',
    // الموقع محدد لكن دقته لا تكفي — تُعرض الدقة الفعلية لتسهيل معرفة السبب / located but not precise enough — the real accuracy is shown to ease diagnosis
    inaccurate: acc => 'دقة موقعك غير كافية للملاحة (الدقة الحالية ' + fmtAcc(acc) + '). تأكد من تفعيل خدمات الموقع و«الموقع الدقيق»، ثم حاول مرة أخرى.',
    noFix: 'تعذّر الحصول على موقعك. تأكد من تفعيل خدمات الموقع، ثم حاول مرة أخرى.',
    unsupported: 'المتصفح لا يدعم تحديد الموقع',
    locating: '📍 جارٍ تحديد موقعك…'
  };

  // نصوص التوجيه المباشر لكل حالة من services/direction-tracker.js — Direct-guidance texts per tracker state
  const SMART_STATUS = {
    ok: ['🟢 الاتجاه صحيح', 'ok'],
    adjust: ['🟡 عدّل الاتجاه قليلًا', 'warn'],
    wrong: ['🔴 الاتجاه غير صحيح', 'bad'],
    init: ['جارٍ تحديد اتجاه حركتك…', 'wait'],
    stopped: ['متوقف — تحرّك ليُحدَّد اتجاهك', 'wait'],
    weak: ['دقة الموقع ضعيفة — بانتظار قراءة أدق', 'wait']
  };
  const TONE_COLOR = { ok: '#18A957', warn: '#E8A317', bad: '#E5484D' };

  let deps = null;   // ما تمرره الصفحة — provided by the page
  let nav = null;    // حالة الملاحة الجارية — the running navigation state

  function init(pageDeps) { deps = pageDeps; }
  function isActive() { return !!nav; }

  // ===== حسابات المسافة — Distance math =====
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
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
  const DIR_NAMES = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
  function dirName(deg) { return DIR_NAMES[Math.round(deg / 45) % 8]; }

  /* أقرب نقطة على المسار: البعد عنه + المتبقي عبر الطرق من تلك النقطة للنهاية (إسقاط محلي بالأمتار)
   * Nearest point on the route: distance off it + remaining road distance from there to the end (local metric projection) */
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

  function fmtAcc(m) { return m >= 1000 ? '±' + (m / 1000).toFixed(1) + ' كم' : '±' + Math.round(m) + ' م'; }
  function fmtDist(m) { return m >= 1000 ? { v: (m / 1000).toFixed(1), u: 'كم' } : { v: String(Math.max(0, Math.round(m / 10) * 10)), u: 'م' }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ===== الصلاحية وأول موقع — Permission and first fix =====
  /* حالة الصلاحية دون أي طلب: 'granted' | 'prompt' | 'denied' | 'unknown' (متصفح بلا واجهة الصلاحيات)
   * Permission state without requesting anything ('unknown' = browser without the Permissions API) */
  async function permissionState_() {
    try {
      if (navigator.permissions && navigator.permissions.query) return (await navigator.permissions.query({ name: 'geolocation' })).state;
    } catch (e) { /* بعض المتصفحات لا تدعم الاسم / some browsers reject the name */ }
    return 'unknown';
  }

  /* ينتظر أول قراءة GPS صالحة: دقيقة (≤ 100 م) فورًا، أو الأفضل (≤ 500 م) عند انتهاء المهلة. أول استدعاء يُظهر نافذة الصلاحية عند الحاجة.
   * Waits for the first valid GPS fix: precise (≤ 100 m) at once, or the best (≤ 500 m) when the wait ends. The first call shows the permission prompt if needed. */
  function acquireFirstFix_() {
    return new Promise(function (resolve, reject) {
      const startedAt = Date.now();
      let best = null, done = false, watchId = null;
      const finish = function (fn, arg) { if (done) return; done = true; clearTimeout(timer); if (watchId != null) navigator.geolocation.clearWatch(watchId); fn(arg); };
      const timer = setTimeout(function () {
        if (best && best.coords.accuracy <= FIRST_FIX_OK_M) finish(resolve, best);
        else if (best) finish(reject, { kind: 'inaccurate', accuracy: best.coords.accuracy });
        else finish(reject, { kind: 'noFix' });
      }, FIRST_FIX_WAIT_MS);
      watchId = navigator.geolocation.watchPosition(function (pos) {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        if (pos.coords.accuracy <= FIRST_FIX_GOOD_M) finish(resolve, pos);
      }, function (err) {
        if (err && err.code === 1) finish(reject, { kind: 'denied', quick: Date.now() - startedAt < DENIED_QUICK_MS });
        // غير ذلك (إشارة ضعيفة/مهلة): الانتظار مستمر حتى المهلة الكلية — otherwise (weak signal/timeout): keep waiting until the overall deadline
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: FIRST_FIX_WAIT_MS });
    });
  }

  // ===== بدء/إيقاف — Start/stop =====
  let starting = false; // يمنع تكرار الطلب بضغطات متتالية / prevents repeated requests from repeated taps
  let startToken = 0;   // stop() أثناء تحديد الموقع يلغي البدء المنتظر / stop() while locating cancels the pending start

  /* الترتيب: فحص الصلاحية ← طلبها عند الحاجة (نافذة النظام) ← انتظار أول موقع GPS دقيق ← ثم فقط بدء الملاحة وطلب OSRM.
   * الرفض أو عدم الدقة ← رسالة واضحة، ولا تبدأ الملاحة، وبطاقة المحطة كما هي.
   * Order: check permission ← request it if needed (system prompt) ← wait for the first precise GPS fix ← only then start and call OSRM.
   * Refusal or imprecision ← a clear message, no navigation, the station card untouched. */
  async function start(station) {
    if (!deps || !station || starting) return;
    if (!('geolocation' in navigator)) { deps.hint(MSG.unsupported); return; }
    if (nav) stop();
    const perm = await permissionState_();
    if (perm === 'denied') { deps.hint(MSG.settings); return; } // مرفوضة سابقًا: لا نافذة ستظهر — لا حلقة طلبات / denied before: no prompt will show — no request loop
    starting = true;
    const token = ++startToken;
    deps.hint(MSG.locating, true);
    let firstFix;
    try {
      firstFix = await acquireFirstFix_();
    } catch (e) {
      if (token !== startToken) return; // أُلغي (محطة أخرى/رجوع) / cancelled (another station / back)
      starting = false;
      // الصلاحية شيء ودقة الموقع شيء آخر — لا خلط بين الرسالتين / permission and accuracy are separate — never mixed
      if (e.kind === 'denied') deps.hint(perm === 'prompt' || (perm === 'unknown' && !e.quick) ? MSG.refused : MSG.settings);
      else if (e.kind === 'inaccurate') deps.hint(MSG.inaccurate(e.accuracy));
      else deps.hint(MSG.noFix);
      return;
    }
    if (token !== startToken) return;
    starting = false;
    deps.hideHint();
    begin_(station, firstFix);
  }

  function begin_(station, firstFix) {
    const map = deps.getMap();
    if (!map) return;

    nav = {
      st: [station.lat, station.lng], station: station, map: map,
      me: null, acc: null, meDot: null, accCircle: null, routeLine: null, directLine: null,
      route: null, lastRouteAt: 0, routing: false, routeFailed: false,
      // road = مسار طرق عبر OSRM / smart = توجيه مباشر بدون مسار طرق (بدون إنترنت أو تعذّر OSRM)
      // road = road route via OSRM / smart = direct guidance with no road route (offline or OSRM unavailable)
      mode: navigator.onLine === false ? 'smart' : 'road',
      tracker: global.SecDirectionTracker ? global.SecDirectionTracker.create([station.lat, station.lng]) : null, dir: null,
      follow: true, lastCameraAt: 0, expanded: false, watchId: null, timer: null, arrived: false
    };
    // طي بطاقة المحطة — نفس دالة التخطيط الحالية تعيد حساب ارتفاع الخريطة / collapse the card — the existing layout function recomputes the map height
    deps.topArea.classList.add('nav-collapsed');
    deps.stage.classList.add('nav-active'); // يرفع أزرار +/− فوق اللوحة / lifts +/− above the sheet
    document.body.classList.add('nav-full'); // شاشة ملاحة كاملة: الخريطة تملأ الشاشة / full-screen navigation: the map fills the screen
    deps.relayout();
    // خطوات التكبير تُضبط حسب نوع الخريطة الظاهرة (انظر applyZoomSnap_)؛ تعود كما كانت عند الإيقاف / zoom steps follow the map type shown (see applyZoomSnap_); restored on stop
    nav.prevZoomSnap = map.options.zoomSnap;
    applyZoomSnap_();
    buildSheet_();
    setStatus_('جارٍ تحديد موقعك…', 'wait');

    // تحريك المستخدم للخريطة يوقف الكاميرا فقط: السحب لا يأتي إلا من المستخدم؛ والتكبير يُعتبر منه فقط إن سبقه لمس/نقر/تمرير
    // حقيقي على الخريطة (أو أزرار +/−) خلال 1.5 ث — لا لمس لوحة الملاحة نفسها. حركات الكاميرا الآلية لا توقف المتابعة أبدًا.
    // The user moving the map stops the camera only: dragging only ever comes from the user; a zoom counts as theirs only if a
    // real touch/click/scroll on the map (or the +/− buttons) came within 1.5 s — not touches on the navigation sheet. The
    // camera's own moves never stop following.
    nav.lastUserInputAt = 0; nav.cameraMovedAt = 0;
    nav.onUserInput = function (e) {
      if (!nav || nav.sheet.contains(e.target) || nav.followBtn.contains(e.target)) return;
      nav.lastUserInputAt = Date.now();
    };
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (type) { deps.stage.addEventListener(type, nav.onUserInput, { capture: true, passive: true }); });
    nav.onDrag = function () { pauseFollow_(); };
    // لمس سابق لبدء حركة الكاميرا الآلية لا يُنسب تكبيرها للمستخدم — a touch that predates the camera's own move never makes its zoom the user's
    nav.onZoom = function () {
      if (nav && nav.lastUserInputAt > nav.cameraMovedAt && Date.now() - nav.lastUserInputAt < USER_ZOOM_WINDOW_MS) pauseFollow_();
    };
    map.on('dragstart', nav.onDrag);
    map.on('zoomstart', nav.onZoom);

    // انقطاع الإنترنت ← توجيه مباشر فورًا؛ عودته ← محاولة مسار الطرق فورًا — internet lost ← direct guidance at once; back ← try the road route at once
    nav.onOffline = function () { enterSmart_(); };
    nav.onOnline = function () { if (nav) { nav.lastRouteAt = 0; render_(); requestRoute_('online'); } }; // الشارة تختفي فورًا / the chip hides at once
    global.addEventListener('offline', nav.onOffline);
    global.addEventListener('online', nav.onOnline);
    if (nav.mode === 'smart') enterSmart_(true);

    onFix_(firstFix); // أول موقع دقيق مؤكد ← الموقع على الخريطة ثم مسار OSRM / the confirmed precise first fix ← me on the map, then the OSRM route
    nav.watchId = navigator.geolocation.watchPosition(onFix_, onGeoError_, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    nav.timer = setInterval(function () { // إعادة حساب دورية ~60 ث، أو فور انتهاء الفاصل إن كان خارج المسار — periodic ~60 s, or once the gap passes if off-route
      if (!nav || !nav.me || navigator.onLine === false) return; // بدون إنترنت لا طلبات محكومة بالفشل / offline: no doomed requests
      const since = Date.now() - nav.lastRouteAt;
      if (nav.offRoute) requestRoute_('off');
      else if (nav.routeFailed && since >= RETRY_AFTER_FAIL_MS) requestRoute_('retry');
      else if (since >= REROUTE_EVERY_MS) requestRoute_('periodic');
    }, 5000);
  }

  /* التحويل للتوجيه المباشر: يُزال مسار الطرق (لا ادعاء لمسار) ويُرسم خط مباشر متقطع — Switch to direct guidance: the road route is removed (no route claim) and a dashed direct line drawn */
  function enterSmart_(atStart) {
    if (!nav || (nav.mode === 'smart' && !atStart)) return;
    nav.mode = 'smart';
    nav.route = null; nav.offRoute = false; nav.remaining = null;
    if (nav.routeLine) { nav.map.removeLayer(nav.routeLine); nav.routeLine = null; }
    drawDirectLine_();
    evaluate_();
  }
  function enterRoad_() {
    if (!nav) return;
    nav.mode = 'road';
    if (nav.directLine) { nav.map.removeLayer(nav.directLine); nav.directLine = null; }
  }
  /* خط مستقيم متصل من موقعي إلى المحطة بسماكة مسار الطرق — يقصر بالاقتراب ويطول بالابتعاد لأنه يُعاد رسمه من موقعي الحالي دائمًا
   * A solid straight line from me to the station, as thick as the road route — it shrinks when approaching and grows when
   * moving away, since it's always redrawn from my current position */
  /* أرفع في المسافة البعيدة (أكثر من 5 كم) حتى لا يطغى على شبكة الطرق التي يختار منها المستخدم، ويعود لسماكته (6) عند الاقتراب —
   * بهامش 50 م كحد الـ5 كم المعتمد. Thinner at long range (over 5 km) so it doesn't drown the road network the user picks from,
   * back to its thickness (6) when near — with a 50 m margin like the approved 5 km rule. */
  const DIRECT_LINE_FAR_M = 5000, DIRECT_LINE_MARGIN_M = 50, DIRECT_LINE_W = 6, DIRECT_LINE_FAR_W = 4;
  function drawDirectLine_() {
    if (!nav || !nav.me || nav.mode !== 'smart') return;
    const d = Math.round(L.latLng(nav.me).distanceTo(nav.st));
    nav.lineFar = nav.lineFar ? d > DIRECT_LINE_FAR_M : d > DIRECT_LINE_FAR_M + DIRECT_LINE_MARGIN_M;
    const weight = nav.lineFar ? DIRECT_LINE_FAR_W : DIRECT_LINE_W;
    if (nav.directLine) { nav.directLine.setLatLngs([nav.me, nav.st]); if (nav.directLine.options.weight !== weight) nav.directLine.setStyle({ weight: weight }); }
    else nav.directLine = L.polyline([nav.me, nav.st], { color: ME_COLOR, weight: weight, opacity: 0.9, interactive: false, className: 'nav-direct-line' }).addTo(nav.map);
  }

  function stop() {
    if (starting) { starting = false; startToken++; deps.hideHint(); } // إلغاء بدء ينتظر الموقع / cancel a start still locating
    if (!nav) return;
    const n = nav; nav = null;
    if (n.watchId != null) navigator.geolocation.clearWatch(n.watchId);
    clearInterval(n.timer);
    n.map.off('dragstart', n.onDrag); n.map.off('zoomstart', n.onZoom);
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (type) { deps.stage.removeEventListener(type, n.onUserInput, { capture: true }); });
    global.removeEventListener('offline', n.onOffline);
    global.removeEventListener('online', n.onOnline);
    [n.meDot, n.accCircle, n.routeLine, n.directLine].forEach(function (l) { if (l) n.map.removeLayer(l); });
    n.map.options.zoomSnap = n.prevZoomSnap; // كما كان قبل الملاحة / as before navigation
    if (n.sheet) n.sheet.remove();
    if (n.followBtn) n.followBtn.remove();
    if (n.xBtn) n.xBtn.remove();
    if (n.chip) n.chip.remove();
    document.body.classList.remove('nav-full');
    deps.topArea.classList.remove('nav-collapsed');
    deps.stage.classList.remove('nav-active');
    deps.stage.style.removeProperty('--nav-sheet-h');
    deps.relayout();
  }

  // ===== GPS =====
  function onFix_(pos) {
    if (!nav) return;
    if (pos.coords.accuracy > IGNORE_FIX_M) return; // موقع تقريبي بعيد (شبكة/IP) لا يحرّك موقعي / a rough far fix (network/IP) never moves me
    const first = !nav.me;
    nav.me = [pos.coords.latitude, pos.coords.longitude];
    nav.acc = pos.coords.accuracy;
    // كل قراءة تُسجَّل بالمتتبع دائمًا، فيكون جاهزًا لحظة التحويل للتوجيه المباشر — every fix feeds the tracker, so it's ready the moment direct guidance kicks in
    if (nav.tracker) nav.dir = nav.tracker.push({ lat: nav.me[0], lng: nav.me[1], acc: nav.acc, t: pos.timestamp || Date.now() });
    drawMe_();
    drawDirectLine_();
    if (first) { requestRoute_('first'); moveCamera_(true); }
    evaluate_();
  }
  function onGeoError_(err) {
    if (!nav) return;
    if (err && err.code === 1) { // سُحبت الصلاحية أثناء الملاحة — permission revoked mid-navigation
      stop();
      deps.hint(MSG.settings);
      return;
    }
    if (!nav.me) setStatus_('جارٍ تحديد موقعك… (الإشارة ضعيفة)', 'wait');
  }

  /* موقعي: سهم يدور مع اتجاه الحركة الفعلي (من services/direction-tracker.js)، ونقطة عند الوقوف أو قبل معرفة الاتجاه
   * Me: an arrow turning with the real direction of travel (from the tracker), a dot when standing or before the direction is known */
  function drawMe_() {
    const map = nav.map;
    if (!nav.meDot) {
      nav.accCircle = L.circle(nav.me, { radius: nav.acc, color: ME_COLOR, weight: 1, fillColor: ME_COLOR, fillOpacity: 0.15, interactive: false }).addTo(map);
      nav.meDot = L.marker(nav.me, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({
        className: 'nav-me', iconSize: [34, 34], iconAnchor: [17, 17],
        html: '<span class="nav-me-dot"></span><svg class="nav-me-arrow" width="34" height="34" viewBox="0 0 24 24"><path d="M12 2.5l7 18-7-4.2-7 4.2z" fill="' + ME_COLOR + '" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>'
      }) }).addTo(map);
    } else {
      nav.accCircle.setLatLng(nav.me).setRadius(nav.acc);
      nav.meDot.setLatLng(nav.me);
    }
    const d = nav.dir, el = nav.meDot.getElement();
    const moving = !!(d && d.course != null && d.state !== 'stopped' && d.state !== 'weak');
    if (el) {
      el.classList.toggle('moving', moving);
      if (moving) el.querySelector('.nav-me-arrow').style.transform = 'rotate(' + Math.round(d.course) + 'deg)';
    }
  }

  // ===== OSRM =====
  async function requestRoute_(reason) {
    if (!nav || nav.routing || !nav.me) return;
    if (navigator.onLine === false) { enterSmart_(); return; } // بدون إنترنت: لا طلب — offline: no request
    if (reason !== 'first' && Date.now() - nav.lastRouteAt < MIN_REROUTE_GAP_MS) return;
    const n = nav; n.routing = true; n.lastRouteAt = Date.now();
    if (!n.route) setStatus_('جارٍ حساب المسار…', 'wait');
    try {
      const url = deps.osrmUrl + n.me[1] + ',' + n.me[0] + ';' + n.st[1] + ',' + n.st[0] + '?overview=full&geometries=geojson';
      const res = await fetch(url);
      if (!res.ok) throw new Error('osrm-http-' + res.status);
      const data = await res.json();
      if (nav !== n) return; // أُوقفت الملاحة أثناء الطلب / navigation stopped during the request
      if (data.code !== 'Ok' || !data.routes || !data.routes[0]) throw new Error('osrm-no-route');
      const r = data.routes[0];
      const pts = r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distM(pts[i - 1], pts[i]));
      if (navigator.onLine === false) return; // انقطع الإنترنت أثناء الطلب — يبقى التوجيه المباشر / internet dropped mid-request — direct guidance stays
      n.route = { pts: pts, cum: cum, distance: r.distance, duration: r.duration };
      n.routeFailed = false;
      enterRoad_();
      if (n.routeLine) n.routeLine.setLatLngs(pts);
      else n.routeLine = L.polyline(pts, { color: ME_COLOR, weight: 6, opacity: 0.9, interactive: false }).addTo(n.map);
      evaluate_();
    } catch (e) {
      if (nav !== n) return;
      n.routeFailed = true;
      // لا مسار صالح (أول طلب، أو خارج المسار) ← توجيه مباشر مؤقتًا مع إعادة المحاولة؛ مسار صالح قائم ← يبقى كما هو
      // No usable route (first request, or off it) ← direct guidance for now, with retries; a usable route in hand ← kept as is
      if (!n.route || n.offRoute) enterSmart_();
    } finally {
      n.routing = false;
    }
  }

  /* تقييم كل قراءة: المتبقي عبر الطرق، الخروج عن المسار، الوصول — Evaluate each fix: remaining road distance, off-route, arrival */
  function evaluate_() {
    if (!nav || !nav.me) return;
    const straight = distM(nav.me, nav.st);
    if (straight <= ARRIVED_M) {
      nav.arrived = true;
      setStatus_('وصلت إلى المحطة ✓', 'ok');
    } else if (nav.mode === 'smart') {
      nav.arrived = false;
      nav.remaining = null;
      const d = nav.dir || { state: 'init' };
      const S = SMART_STATUS[d.state] || SMART_STATUS.init;
      setStatus_(S[0], S[1]);
    } else if (nav.route) {
      nav.arrived = false;
      const loc = locateOnRoute(nav.me, nav.route.pts, nav.route.cum);
      nav.remaining = Math.max(0, loc.remaining + (loc.off > 30 ? loc.off : 0));
      nav.offRoute = loc.off > OFF_ROUTE_M && nav.acc <= MAX_ACCURACY_FOR_REROUTE_M;
      if (nav.offRoute) { setStatus_('خرجت عن المسار — إعادة حساب المسار…', 'warn'); requestRoute_('off'); }
      else if (!nav.routeFailed) setStatus_(nav.acc > MAX_ACCURACY_FOR_REROUTE_M ? 'دقة الموقع ضعيفة — المسار محسوب بالشوارع' : 'المسار محسوب بالشوارع', nav.acc > MAX_ACCURACY_FOR_REROUTE_M ? 'warn' : 'ok');
    }
    render_();
    moveCamera_(false);
  }

  // ===== الكاميرا: متابعة المستخدم والمحطة بتكبير تدريجي — Camera: follow user + station with gradual zoom =====
  /* الإطار: أقرب تكبير يُظهر موقعي والمحطة معًا بهامش مريح فوق لوحة الملاحة. سبب الإطار البعيد سابقًا: أول إطار كان يُحسب
   * قبل أن يُحدِّث Leaflet حجم الخريطة بعد طي بطاقة المحطة (458 بدل 619 نقطة) وقبل اكتمال ارتفاع اللوحة، فيخرج أبعد بدرجة كاملة،
   * ولا يُصحَّح لأن التكبير أثناء المتابعة تدريجي. الآن: تحديث حجم الخريطة قبل كل إطار، وإطار مباشر ثانٍ بعد استقرار التخطيط،
   * وتكبير كسري أثناء الملاحة (خطوات 0.25) بدل النزول لأقرب درجة صحيحة، ويُطرح من الخريطة الجزء الذي تغطيه اللوحة فعلًا.
   * البدء وزر «متابعة» ينتقلان للإطار مباشرة؛ أثناء المتابعة التصغير فوري والتكبير تدريجي كما اعتمد.
   * The frame: the closest zoom showing me and the station together with a comfortable margin above the navigation sheet.
   * Why the frame used to be far: the first frame was computed before Leaflet updated the map size after the station card
   * collapsed (458 instead of 619 px) and before the sheet reached its height, so it came out a whole level farther, and was
   * never corrected because zooming in while following is gradual. Now: the map size is refreshed before every frame, a second
   * direct frame follows once the layout settles, a fractional zoom is used while navigating (0.25 steps) instead of dropping to
   * the next whole level, and only the part of the map the sheet really covers is subtracted. Start and «follow» jump straight
   * to the frame; while following, zooming out is immediate and zooming in gradual as approved. */
  const FIT_PAD_SIDE = 36, FIT_PAD_TOP = 80, FIT_PAD_BOTTOM = 40, FRAME_SETTLE_MS = 900;
  /* التكبير الكسري (خطوات 0.25) مع خريطة جدة المحلية فقط (رسم متجهي حاد بأي تكبير)؛ مع الخريطة العادية (صور مربعات) يبقى
   * بدرجات صحيحة — التكبير الكسري يُظهر فواصل رفيعة بين المربعات (قيست: 11 بلا فواصل، 11.5 بفواصل كل 181 نقطة). عند
   * التحول للخريطة العادية بتكبير كسري يُقرَّب للدرجة الأدنى (تبقى النقطتان ظاهرتين). Fractional zoom (0.25 steps) only with the saved Jeddah map
   * (sharp vector rendering at any zoom); with the regular map (image tiles) it stays at whole levels — fractional zoom shows
   * thin seams between tiles (measured: 11 without seams, 11.5 with seams every 181 px). Switching to the regular map at a
   * fractional zoom rounds down to the whole level below (both points stay visible). */
  function applyZoomSnap_() {
    if (!nav) return;
    const fractional = !!(deps.fractionalZoom && deps.fractionalZoom());
    nav.map.options.zoomSnap = fractional ? 0.25 : 1;
    const z = nav.map.getZoom();
    // للأسفل لا لأقرب درجة: التقريب للأعلى قد يُخرج إحدى النقطتين من الشاشة — down, not to the nearest: rounding up could push a point off screen
    if (!fractional && z % 1) { nav.cameraMovedAt = Date.now(); nav.map.setZoom(Math.floor(z), { animate: false }); } // حركة آلية لا توقف المتابعة / an automatic move that never stops following
  }
  function moveCamera_(force) {
    if (!nav || !nav.me || !nav.follow) return;
    if (!force && Date.now() - nav.lastCameraAt < CAMERA_EVERY_MS) return;
    nav.lastCameraAt = Date.now();
    const map = nav.map;
    applyZoomSnap_(); // حسب الخريطة الظاهرة الآن / per the map shown now
    map.invalidateSize({ pan: false }); // حجم الخريطة الفعلي بعد أي تغيير بالتخطيط / the map's real size after any layout change
    const mapRect = map.getContainer().getBoundingClientRect();
    const sheetRect = nav.sheet ? nav.sheet.getBoundingClientRect() : null;
    const covered = sheetRect ? Math.max(0, Math.min(mapRect.bottom, sheetRect.bottom) - Math.max(mapRect.top, sheetRect.top)) : 0;
    const bounds = L.latLngBounds([nav.me, nav.st]);
    const tl = L.point(FIT_PAD_SIDE, FIT_PAD_TOP), br = L.point(FIT_PAD_SIDE, covered + FIT_PAD_BOTTOM);
    const target = Math.min(MAX_FOLLOW_ZOOM, map.getBoundsZoom(bounds, false, tl.add(br)));
    const cur = map.getZoom();
    const jump = force || !nav.framed; // أول إطار أو «متابعة» ← مباشرة / first frame or «follow» ← straight there
    // التصغير فوري (ليبقى الاثنان ظاهرين)، والتكبير درجة واحدة كل مرة — zoom out at once (keep both visible), zoom in one level at a time
    const zoom = jump || target < cur ? target : Math.min(target, cur + 1);
    const first = !nav.framed;
    nav.framed = true;
    nav.cameraMovedAt = Date.now();
    map.fitBounds(bounds, { paddingTopLeft: tl, paddingBottomRight: br, maxZoom: zoom, animate: true, duration: 0.8 });
    // إطار مباشر ثانٍ بعد استقرار التخطيط (ارتفاع اللوحة النهائي) — ما لم يحرّك المستخدم الخريطة / a second direct frame once the layout settles (the sheet's final height) — unless the user moved the map
    if (first) setTimeout(function () { if (nav && nav.follow) moveCamera_(true); }, FRAME_SETTLE_MS);
  }
  function pauseFollow_() {
    if (!nav || !nav.follow) return;
    nav.follow = false;
    nav.followBtn.hidden = false;
    placeFollowBtn_();
  }
  function resumeFollow_() {
    if (!nav) return;
    nav.follow = true;
    nav.followBtn.hidden = true;
    moveCamera_(true);
  }

  // ===== اللوحة — The sheet =====
  /* شاشة الملاحة الكاملة (التصميم الهجين المعتمد): ✕ عائم أعلى الشاشة، شارة «بدون اتصال»، ولوحة سفلية صغيرة:
   * المسافة + مؤشر الاتجاه دائمًا + حالة الاتجاه؛ شريط الانحراف عند 5 كم أو أقل؛ التفاصيل والمظهر وإنهاء الملاحة عند السحب.
   * Full-screen navigation (the approved hybrid design): a floating ✕ on top, an «offline» chip, and a small bottom sheet:
   * distance + the direction indicator always + the direction verdict; the deviation bar at 5 km or less; details, look and
   * ending navigation when pulled up. */
  const GLASS_KEY = 'sec-nav-glass';
  const GLASS_MODES = [['clear', 'واضحة'], ['bal', 'متوازنة'], ['solid', 'معتمة']];
  function readGlass_() { try { const g = localStorage.getItem(GLASS_KEY); return GLASS_MODES.some(m => m[0] === g) ? g : 'bal'; } catch (e) { return 'bal'; } }
  function setGlass_(g) {
    if (!nav) return;
    try { localStorage.setItem(GLASS_KEY, g); } catch (e) { /* تخزين محظور — يبقى للجلسة فقط / storage blocked — this session only */ }
    GLASS_MODES.forEach(function (m) { nav.sheet.classList.toggle('glass-' + m[0], m[0] === g); });
    nav.sheet.querySelectorAll('.nav-glass button').forEach(function (b) { b.classList.toggle('on', b.dataset.glass === g); });
  }

  function buildSheet_() {
    const s = nav.station;
    const sheet = document.createElement('div');
    sheet.className = 'nav-sheet';
    sheet.innerHTML =
      '<div class="nav-grab"></div>' +
      '<div class="nav-head"><div class="nav-big"><div class="nav-d"><span class="nav-dv">—</span><small class="nav-du"></small></div></div>' +
      '<div class="nav-dirbox"><div class="nav-dir"></div><div class="nav-dial"><b>N</b><svg class="nav-arrow" width="26" height="26" viewBox="0 0 24 24"><path d="M12 2l6.5 18L12 16l-6.5 4z" fill="' + ME_COLOR + '"/></svg></div></div></div>' +
      '<div class="nav-line2"><div class="nav-stt"></div><div class="nav-kind"></div></div>' +
      '<div class="nav-note" hidden>🟠 اتجاه مباشر، وليس مسار طرق</div>' +
      // شريط الانحراف (التوجيه المباشر، 5 كم أو أقل): الأخضر ±30°، الأصفر ±70° — deviation bar (direct guidance, 5 km or less)
      '<div class="nav-band-wrap" hidden><div class="nav-band"><i hidden></i></div>' +
      '<div class="nav-lbl"><span class="bad">يمين كثيرًا</span><span class="warn">يمين</span><span class="ok">في الاتجاه الصحيح</span><span class="warn">يسار</span><span class="bad">يسار كثيرًا</span></div></div>' +
      '<div class="nav-details" hidden>' +
      '<div class="nav-rows">' +
      '<div class="nav-row"><span class="k">حالة الاتصال</span><span class="v nav-conn">—</span></div>' +
      '<div class="nav-row"><span class="k">نوع الملاحة</span><span class="v nav-type">—</span></div>' +
      '<div class="nav-row"><span class="k">رقم المحطة</span><span class="v num">' + esc(s.id) + '</span></div>' +
      '<div class="nav-row"><span class="k">' + (s.region ? 'المنطقة' : 'النوع') + '</span><span class="v">' + esc(s.region || s.type) + '</span></div>' +
      '<div class="nav-row"><span class="k">دقة الموقع</span><span class="v num nav-acc">—</span></div></div>' +
      '<div class="nav-lbl2">🌓 مظهر اللوحة</div>' +
      '<div class="nav-glass">' + GLASS_MODES.map(function (m) { return '<button type="button" data-glass="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>' +
      '<a class="nav-gm" href="' + deps.googleMapsUrl(s) + '" target="_blank" rel="noopener">🧭 فتح المحطة في قوقل ماب</a>' +
      '<button type="button" class="nav-end">🔴 إنهاء الملاحة</button></div>' +
      '<button type="button" class="nav-more">⌃ التفاصيل</button>';
    deps.stage.appendChild(sheet);
    nav.sheet = sheet;
    setGlass_(readGlass_());
    sheet.querySelector('.nav-end').addEventListener('click', stop);
    sheet.querySelector('.nav-more').addEventListener('click', function () { setExpanded_(!nav.expanded); });
    sheet.querySelectorAll('.nav-glass button').forEach(function (b) { b.addEventListener('click', function () { setGlass_(b.dataset.glass); }); });
    // سحب للأعلى/للأسفل — swipe up/down
    let y0 = null;
    sheet.addEventListener('touchstart', function (e) { y0 = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    sheet.addEventListener('touchend', function (e) {
      if (y0 == null || !nav) return;
      const dy = e.changedTouches[0].clientY - y0; y0 = null;
      if (dy < -30) setExpanded_(true); else if (dy > 30) setExpanded_(false);
    });
    // لمس اللوحة لا يُعتبر تحريكًا للخريطة — touching the sheet isn't moving the map
    L.DomEvent.disableClickPropagation(sheet); L.DomEvent.disableScrollPropagation(sheet);

    // ✕ عائم أعلى الشاشة: إنهاء الملاحة والرجوع لبطاقة المحطة — a floating ✕ on top: ends navigation, back to the station card
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'nav-x'; x.textContent = '✕';
    x.setAttribute('aria-label', 'إنهاء الملاحة'); x.title = 'إنهاء الملاحة';
    x.addEventListener('click', stop);
    L.DomEvent.disableClickPropagation(x);
    deps.stage.appendChild(x);
    nav.xBtn = x;
    // شارة الانقطاع أعلى الخريطة — the offline chip at the top of the map
    const chip = document.createElement('div');
    chip.className = 'nav-chip'; chip.textContent = '🟠 بدون اتصال · اتجاه مباشر'; chip.hidden = true;
    deps.stage.appendChild(chip);
    nav.chip = chip;

    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'nav-follow'; btn.textContent = '⌖ متابعة'; btn.hidden = true;
    btn.addEventListener('click', resumeFollow_);
    L.DomEvent.disableClickPropagation(btn);
    deps.stage.appendChild(btn);
    nav.followBtn = btn;
  }
  function setExpanded_(on) {
    if (!nav) return;
    nav.expanded = on;
    nav.sheet.querySelector('.nav-details').hidden = !on;
    nav.sheet.querySelector('.nav-more').textContent = on ? '⌄ إخفاء التفاصيل' : '⌃ التفاصيل';
    placeFollowBtn_();
    moveCamera_(true);
  }
  /* زر المتابعة (يسارًا) وأزرار +/− (يمينًا، عبر --nav-sheet-h) فوق اللوحة دائمًا — the follow button (left) and +/− (right, via --nav-sheet-h) always sit above the sheet */
  function placeFollowBtn_() {
    if (!nav || !nav.sheet) return;
    const h = nav.sheet.offsetHeight;
    if (nav.followBtn) nav.followBtn.style.bottom = (h + 20) + 'px';
    deps.stage.style.setProperty('--nav-sheet-h', h + 'px');
  }
  function setStatus_(text, tone) { if (nav) { nav.status = text; nav.tone = tone; render_(); } }

  function render_() {
    if (!nav || !nav.sheet) return;
    const q = sel => nav.sheet.querySelector(sel);
    const smart = nav.mode === 'smart';
    const hasRoute = !smart && !!nav.route && nav.remaining != null;
    const online = navigator.onLine !== false;
    if (nav.me) {
      const d = hasRoute ? fmtDist(nav.remaining) : fmtDist(distM(nav.me, nav.st));
      q('.nav-dv').textContent = d.v; q('.nav-du').textContent = d.u;
      const mins = hasRoute && nav.route.distance > 0 ? Math.max(1, Math.round(nav.route.duration * (nav.remaining / nav.route.distance) / 60)) : null;
      // المسافة المباشرة لا تُعرض أبدًا كأنها مسافة قيادة — the direct distance is never shown as a driving distance
      q('.nav-kind').textContent = hasRoute ? '🛣 عبر الطرق' + (mins ? ' · ' + mins + ' د' : '')
        : online ? '📍 مسافة مباشرة · بانتظار مسار الطرق' : '📍 مسافة مباشرة';
      const b = bearingDeg(nav.me, nav.st);
      q('.nav-dir').textContent = dirName(b);
      q('.nav-arrow').style.transform = 'rotate(' + Math.round(b) + 'deg)';
      q('.nav-acc').textContent = '±' + Math.round(nav.acc) + ' م';
    }
    q('.nav-note').hidden = !smart;
    // شريط الانحراف ومؤشره قرب المحطة فقط (5 كم) — بعيدًا: «صحيح/غير صحيح» فقط / the deviation bar near the station only (5 km) — far: right/wrong only
    // نفس حالة القرب بهامشها من services/direction-tracker.js — الشريط والحالات لا يختلفان أبدًا
    // the same margin-aware near state from the tracker — the bar and the verdicts never disagree
    const near = nav.dir && nav.dir.near != null ? nav.dir.near : !!nav.me && distM(nav.me, nav.st) <= 5000;
    q('.nav-band-wrap').hidden = !smart || !near;
    const marker = q('.nav-band i');
    const dev = smart && nav.dir && nav.dir.deviation != null && ['ok', 'adjust', 'wrong'].indexOf(nav.dir.state) !== -1 ? nav.dir.deviation : null;
    marker.hidden = dev == null;
    if (dev != null) marker.style.left = (50 + dev / 180 * 50).toFixed(1) + '%'; // المحطة يمينك ← المؤشر يمينًا / station to your right ← marker to the right
    q('.nav-arrow path').setAttribute('fill', smart && TONE_COLOR[nav.tone] ? TONE_COLOR[nav.tone] : ME_COLOR);
    const stt = q('.nav-stt');
    // «عدّل قليلًا» لا تظهر إلا قرب المحطة (5 كم) — ومعها الجهة من نفس الانحراف الذي يرسم المؤشر
    // «adjust slightly» only appears near the station (5 km) — with the side from the same deviation that draws the marker
    const side = smart && nav.dir && nav.dir.state === 'adjust' && dev != null ? (dev > 0 ? ' يمينًا' : ' يسارًا') : '';
    stt.textContent = (nav.status || '') + side;
    stt.className = 'nav-stt ' + (nav.tone || '');
    // التفاصيل وشارة الانقطاع — the details and the offline chip
    q('.nav-conn').textContent = online ? '🟢 متصل' : '🟠 بدون اتصال';
    q('.nav-type').textContent = hasRoute ? '🛣 مسار طرق' : '📍 اتجاه مباشر';
    if (nav.chip) nav.chip.hidden = online;
    placeFollowBtn_(); // ارتفاع اللوحة قد يتغيّر مع النص — the sheet height may change with the text
  }

  global.SecNavigation = { init: init, start: start, stop: stop, isActive: isActive, refreshZoomSnap: applyZoomSnap_, _locateOnRoute: locateOnRoute };
})(window);
