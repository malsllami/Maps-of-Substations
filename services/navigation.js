/* ============================================================
 * services/navigation.js — مسؤول عن "🧭 المسار من موقعي" فقط: الملاحة مع الإنترنت عبر OSRM.
 * يتابع موقع المستخدم (watchPosition)، يرسم مسار الطرق الفعلي، يعرض المسافة عبر الطرق والوقت
 * التقريبي، ويعيد حساب المسار عند الخروج عنه (~150 م) أو كل ~60 ثانية. أثناء الملاحة تُطوى بطاقة
 * المحطة، والكاميرا تتابع المستخدم والمحطة بتكبير تدريجي؛ تحريك الخريطة يدويًا يوقف الكاميرا فقط
 * (GPS والمسافة مستمرة) ويظهر «⌖ متابعة». لا يغيّر أي ميزة قائمة، وزر قوقل ماب يبقى كما هو.
 *
 * Owns "🧭 route from my location" only: online navigation via OSRM. Tracks the user (watchPosition),
 * draws the real road route, shows road distance and approximate time, and recomputes the route when
 * the user leaves it (~150 m) or every ~60 s. While navigating the station card collapses and the camera
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
  const ME_COLOR = '#2E7DD1';        // موقعي أزرق — دبوس المحطة الحالي أخضر فلا تلتبس / me in blue — the existing station pin is green

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

  function fmtDist(m) { return m >= 1000 ? { v: (m / 1000).toFixed(1), u: 'كم' } : { v: String(Math.max(0, Math.round(m / 10) * 10)), u: 'م' }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ===== بدء/إيقاف — Start/stop =====
  function start(station) {
    if (!deps || !station) return;
    if (nav) stop();
    const map = deps.getMap();
    if (!map) return;
    if (!('geolocation' in navigator)) { deps.hint('المتصفح لا يدعم تحديد الموقع'); return; }
    if (navigator.onLine === false) { deps.hint('الملاحة بالطرق تحتاج اتصالًا بالإنترنت'); return; }

    nav = {
      st: [station.lat, station.lng], station: station, map: map,
      me: null, acc: null, meDot: null, accCircle: null, routeLine: null,
      route: null, lastRouteAt: 0, routing: false, routeFailed: false,
      follow: true, programmatic: 0, lastCameraAt: 0, expanded: false, watchId: null, timer: null, arrived: false
    };
    // طي بطاقة المحطة — نفس دالة التخطيط الحالية تعيد حساب ارتفاع الخريطة / collapse the card — the existing layout function recomputes the map height
    deps.topArea.classList.add('nav-collapsed');
    deps.relayout();
    buildSheet_();
    setStatus_('جارٍ تحديد موقعك…', 'wait');

    // تحريك المستخدم للخريطة يوقف الكاميرا فقط — the user moving the map stops the camera only
    nav.onUserMove = function () { if (nav && nav.programmatic === 0) pauseFollow_(); };
    nav.onMoveEnd = function () { if (nav && nav.programmatic > 0) nav.programmatic--; };
    map.on('dragstart', nav.onUserMove);
    map.on('zoomstart', nav.onUserMove);
    map.on('moveend', nav.onMoveEnd);

    nav.watchId = navigator.geolocation.watchPosition(onFix_, onGeoError_, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    nav.timer = setInterval(function () { // إعادة حساب دورية ~60 ث، أو فور انتهاء الفاصل إن كان خارج المسار — periodic ~60 s, or once the gap passes if off-route
      if (!nav || !nav.me) return;
      const since = Date.now() - nav.lastRouteAt;
      if (nav.offRoute) requestRoute_('off');
      else if (nav.routeFailed && since >= RETRY_AFTER_FAIL_MS) requestRoute_('retry');
      else if (since >= REROUTE_EVERY_MS) requestRoute_('periodic');
    }, 5000);
  }

  function stop() {
    if (!nav) return;
    const n = nav; nav = null;
    if (n.watchId != null) navigator.geolocation.clearWatch(n.watchId);
    clearInterval(n.timer);
    n.map.off('dragstart', n.onUserMove); n.map.off('zoomstart', n.onUserMove); n.map.off('moveend', n.onMoveEnd);
    [n.meDot, n.accCircle, n.routeLine].forEach(function (l) { if (l) n.map.removeLayer(l); });
    if (n.sheet) n.sheet.remove();
    if (n.followBtn) n.followBtn.remove();
    deps.topArea.classList.remove('nav-collapsed');
    deps.relayout();
  }

  // ===== GPS =====
  function onFix_(pos) {
    if (!nav) return;
    const first = !nav.me;
    nav.me = [pos.coords.latitude, pos.coords.longitude];
    nav.acc = pos.coords.accuracy;
    drawMe_();
    if (first) { requestRoute_('first'); moveCamera_(true); }
    evaluate_();
  }
  function onGeoError_(err) {
    if (!nav) return;
    if (err && err.code === 1) { // رفض الصلاحية — permission denied
      stop();
      deps.hint('لم يُسمح بالوصول لموقعك — فعّل صلاحية الموقع للمتصفح ثم أعد المحاولة');
      return;
    }
    if (!nav.me) setStatus_('جارٍ تحديد موقعك… (الإشارة ضعيفة)', 'wait');
  }

  function drawMe_() {
    const map = nav.map;
    if (!nav.meDot) {
      nav.accCircle = L.circle(nav.me, { radius: nav.acc, color: ME_COLOR, weight: 1, fillColor: ME_COLOR, fillOpacity: 0.15, interactive: false }).addTo(map);
      nav.meDot = L.circleMarker(nav.me, { radius: 8, color: '#fff', weight: 3, fillColor: ME_COLOR, fillOpacity: 1, interactive: false }).addTo(map);
    } else {
      nav.accCircle.setLatLng(nav.me).setRadius(nav.acc);
      nav.meDot.setLatLng(nav.me);
    }
  }

  // ===== OSRM =====
  async function requestRoute_(reason) {
    if (!nav || nav.routing || !nav.me) return;
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
      n.route = { pts: pts, cum: cum, distance: r.distance, duration: r.duration };
      n.routeFailed = false;
      if (n.routeLine) n.routeLine.setLatLngs(pts);
      else n.routeLine = L.polyline(pts, { color: ME_COLOR, weight: 6, opacity: 0.9, interactive: false }).addTo(n.map);
      if (n.meDot) n.meDot.bringToFront();
      evaluate_();
    } catch (e) {
      if (nav !== n) return;
      n.routeFailed = true;
      setStatus_('تعذّر حساب مسار الطرق — ستُعاد المحاولة تلقائيًا', 'warn');
      render_();
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
  function moveCamera_(force) {
    if (!nav || !nav.me || !nav.follow) return;
    if (!force && Date.now() - nav.lastCameraAt < CAMERA_EVERY_MS) return;
    nav.lastCameraAt = Date.now();
    const map = nav.map;
    const sheetH = nav.sheet ? nav.sheet.offsetHeight : 180;
    const bounds = L.latLngBounds([nav.me, nav.st]);
    const tl = L.point(30, 80), br = L.point(30, sheetH + 30);
    const target = Math.min(MAX_FOLLOW_ZOOM, map.getBoundsZoom(bounds, false, tl.add(br)));
    const cur = map.getZoom();
    // التصغير فوري (ليبقى الاثنان ظاهرين)، والتكبير درجة واحدة كل مرة — zoom out at once (keep both visible), zoom in one level at a time
    const zoom = target < cur ? target : Math.min(target, cur + 1);
    nav.programmatic++;
    map.fitBounds(bounds, { paddingTopLeft: tl, paddingBottomRight: br, maxZoom: zoom, animate: true, duration: 0.8 });
    // إن لم يتحرك شيء لا يصل moveend — لا يبقى العدّاد عالقًا / if nothing moved, moveend may not fire — don't leave the counter stuck
    setTimeout(function () { if (nav) nav.programmatic = 0; }, 1200);
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
  function buildSheet_() {
    const s = nav.station;
    const sheet = document.createElement('div');
    sheet.className = 'nav-sheet';
    sheet.innerHTML =
      '<div class="nav-grab"></div>' +
      '<button type="button" class="nav-x" aria-label="إيقاف الملاحة" title="إيقاف الملاحة">✕</button>' +
      '<div class="nav-head"><div class="nav-dial"><b>N</b><svg class="nav-arrow" width="30" height="30" viewBox="0 0 24 24"><path d="M12 2l6.5 18L12 16l-6.5 4z" fill="' + ME_COLOR + '"/></svg></div>' +
      '<div class="nav-big"><div class="nav-d"><span class="nav-dv">—</span><small class="nav-du"></small></div>' +
      '<div class="nav-kind"></div><div class="nav-dir"></div><div class="nav-stt"></div></div></div>' +
      '<div class="nav-details" hidden>' +
      '<div class="nav-tiles">' +
      '<div class="nav-tile"><span class="k">رقم المحطة</span><span class="v">' + esc(s.id) + '</span></div>' +
      '<div class="nav-tile"><span class="k">' + (s.region ? 'المنطقة' : 'النوع') + '</span><span class="v ar">' + esc(s.region || s.type) + '</span></div>' +
      '<div class="nav-tile"><span class="k">دقة الموقع</span><span class="v nav-acc">—</span></div></div>' +
      '<a class="nav-gm" href="' + deps.googleMapsUrl(s) + '" target="_blank" rel="noopener">🧭 افتح بقوقل ماب</a></div>' +
      '<button type="button" class="nav-more">⌃ تفاصيل المحطة</button>';
    deps.stage.appendChild(sheet);
    nav.sheet = sheet;
    sheet.querySelector('.nav-x').addEventListener('click', stop);
    sheet.querySelector('.nav-more').addEventListener('click', function () { setExpanded_(!nav.expanded); });
    // سحب للأعلى/للأسفل — swipe up/down
    let y0 = null;
    sheet.addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    sheet.addEventListener('touchend', function (e) {
      if (y0 == null || !nav) return;
      const dy = e.changedTouches[0].clientY - y0; y0 = null;
      if (dy < -30) setExpanded_(true); else if (dy > 30) setExpanded_(false);
    });
    // لمس اللوحة لا يُعتبر تحريكًا للخريطة — touching the sheet isn't moving the map
    L.DomEvent.disableClickPropagation(sheet); L.DomEvent.disableScrollPropagation(sheet);

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
    nav.sheet.querySelector('.nav-more').textContent = on ? '⌄ إخفاء التفاصيل' : '⌃ تفاصيل المحطة';
    placeFollowBtn_();
    moveCamera_(true);
  }
  function placeFollowBtn_() {
    if (nav && nav.followBtn) nav.followBtn.style.bottom = (nav.sheet.offsetHeight + 20) + 'px';
  }
  function setStatus_(text, tone) { if (nav) { nav.status = text; nav.tone = tone; render_(); } }

  function render_() {
    if (!nav || !nav.sheet) return;
    const q = sel => nav.sheet.querySelector(sel);
    const hasRoute = !!nav.route && nav.remaining != null;
    if (nav.me) {
      const d = hasRoute ? fmtDist(nav.remaining) : fmtDist(distM(nav.me, nav.st));
      q('.nav-dv').textContent = d.v; q('.nav-du').textContent = d.u;
      const mins = hasRoute && nav.route.distance > 0 ? Math.max(1, Math.round(nav.route.duration * (nav.remaining / nav.route.distance) / 60)) : null;
      q('.nav-kind').textContent = hasRoute ? '🛣 عبر الطرق' + (mins ? ' · ' + mins + ' د' : '') : '📍 مسافة مباشرة — بانتظار مسار الطرق';
      const b = bearingDeg(nav.me, nav.st);
      q('.nav-dir').textContent = dirName(b);
      q('.nav-arrow').style.transform = 'rotate(' + Math.round(b) + 'deg)';
      q('.nav-acc').textContent = '±' + Math.round(nav.acc) + ' م';
    }
    const stt = q('.nav-stt');
    stt.textContent = nav.status || '';
    stt.className = 'nav-stt ' + (nav.tone || '');
  }

  global.SecNavigation = { init: init, start: start, stop: stop, isActive: isActive, _locateOnRoute: locateOnRoute };
})(window);
