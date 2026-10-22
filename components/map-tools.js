/* ============================================================
 * components/map-tools.js — «⋯ المزيد»: قياس المسافة، ورسم مسار متعدد النقاط (على الخريطة)
 * ============================================================
 * سلوك V1 وتصميمه كما هما:
 * - «📐 قياس المسافة»: اضغط نقطتين أو أكثر ← نقاط وخط متقطع بلون الثيم، و«المسافة الإجمالية: … كم (… نقاط)».
 * - «🔗 رسم مسار متعدد النقاط»: اضغط النقاط بالترتيب (موقعك ثم كل محطة) ← أرقام 1، 2، …؛ خط مباشر تقريبي فورًا ثم
 *   مسار شارع حقيقي من OSRM (أقصر البدائل) بالمسافة والزمن؛ تعذّر OSRM ← يبقى الخط المباشر برسالة واضحة.
 * - تفعيل أداة يلغي الأخرى ويمسح رسمها؛ الضغط مرة أخرى ينهيها. الأداة لا تعمل وقت الملاحة (الخريطة للملاحة).
 * - المسافة من station-query (هافرساين)، والمسار من services/osrm.js المشترك مع الملاحة — لا حساب مسار ولا GPS هنا.
 * V2: بلا إنترنت لا يُرسل طلب OSRM محكوم بالفشل؛ رد OSRM قديم (بعد نقطة جديدة أو إنهاء) يُتجاهل ويُلغى؛ النصوص تُكتب نصًا.
 *
 * «⋯ More»: distance measuring and a multi-point route on the map. V1's behavior and design. Distance from station-query,
 * the route from the shared services/osrm.js — no route maths or GPS here. V2: no doomed OSRM request offline; a stale
 * OSRM reply is ignored and aborted; texts set as text.
 * ============================================================ */
(function (global) {
  'use strict';

  const Q = global.SecStationQuery, OSRM = global.SecOsrm;
  if (!Q || !OSRM) throw new Error('map-tools.js يحتاج station-query.js وosrm.js قبله / needs station-query.js and osrm.js first');
  const MIN_GAP_MS = 1000, DEBOUNCE_MS = 350; // V1: لا أكثر من طلب في الثانية، وانتظار 350 م ث بعد آخر نقطة / at most one request a second
  const ROUTE_COLOR = '#C8A24E';
  const MSG = {
    MEASURE: 'اضغط نقطتين أو أكثر على الخريطة لقياس المسافة',
    ROUTE: 'اضغط نقاط الطريق بالترتيب (موقعك، ثم كل محطة تنتقل لها)',
    FETCHING: 'جاري محاولة جلب مسار الشارع...',
    FAILED: 'تعذّر جلب مسار الشارع، معروض الخط المباشر'
  };

  function teal_() { const t = global.SecTheme ? global.SecTheme.get() : 'dark'; return t === 'dark' ? '#4DD6B5' : '#1FAE8C'; }

  /**
   * mount(view, opts) — view: من map-view.mount. opts: { onStart(tool) (لتمسح الصفحة أدوات أخرى كالأعطال والقريبة)،
   *   isBlocked() → bool (أثناء الملاحة) }
   * يُرجع { active()، start(tool)، stop()، points()، destroy() }
   */
  function mount(view, opts) {
    const o = opts || {};
    const map = view.map, L = global.L;
    let tool = null, points = [], layers = [], line = null, seq = 0, req = null, debounce = null, lastCall = 0;
    // زرّان في الصف مباشرة بدل «⋯» ولوحته (محمد 22 أكتوبر) — two buttons right in the row instead of «⋯» and its panel
    view.tools.insertAdjacentHTML('beforeend',
      '<button type="button" class="toolbar-btn" data-tool="measure" title="قياس المسافة"><span class="tb-icon">📐</span><span class="tb-label">قياس</span></button>' +
      '<button type="button" class="toolbar-btn" data-tool="route" title="رسم مسار متعدد النقاط"><span class="tb-icon">🔗</span><span class="tb-label">مسار متعدد</span></button>');
    const toolBtns = view.tools.querySelectorAll('[data-tool]');

    function clearDrawing_() {
      layers.forEach(function (l) { map.removeLayer(l); }); layers = [];
      if (line) { map.removeLayer(line); line = null; }
      points = []; seq++;
      global.clearTimeout(debounce);
      if (req) { req.abort(); req = null; }
    }
    function syncButtons_() { toolBtns.forEach(function (b) { b.classList.toggle('active', b.dataset.tool === tool); }); }

    function start(t) {
      if (o.isBlocked && o.isBlocked()) return false;
      const next = tool === t ? null : t; // نفس الأداة ← إنهاء (V1) / the same tool ← end (V1)
      clearDrawing_();
      tool = next;
      syncButtons_();
      if (!tool) { view.hideHint(); return false; }
      if (o.onStart) { try { o.onStart(tool); } catch (e) { /* لا شيء / nothing */ } }
      view.hint(tool === 'measure' ? MSG.MEASURE : MSG.ROUTE);
      return true;
    }
    function stop() { if (tool) start(tool); }

    function total_() {
      let km = 0;
      for (let i = 1; i < points.length; i++) km += Q.distanceKm({ lat: points[i - 1].lat, lng: points[i - 1].lng }, { lat: points[i].lat, lng: points[i].lng });
      return km;
    }

    // ===== القياس — Measure =====
    function measureClick_(ll) {
      points.push(ll);
      layers.push(L.circleMarker(ll, { radius: 6, color: teal_(), fillColor: teal_(), fillOpacity: 1, weight: 2 }).addTo(map));
      if (points.length < 2) return;
      if (line) map.removeLayer(line);
      line = L.polyline(points, { color: teal_(), weight: 3, dashArray: '6,6' }).addTo(map);
      view.hint('المسافة الإجمالية: ' + total_().toFixed(2) + ' كم (' + points.length + ' نقاط)');
    }

    // ===== المسار — Route =====
    function numberIcon_(n) {
      return L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
        html: '<div class="route-point" style="background:' + teal_() + '">' + n + '</div>' });
    }
    function straight_() {
      if (line) map.removeLayer(line);
      line = L.polyline(points, { color: ROUTE_COLOR, weight: 3, dashArray: '8,6' }).addTo(map);
      return 'خط مباشر (تقريبي) — ' + points.length + ' نقاط — ' + total_().toFixed(2) + ' كم';
    }
    async function fetchRoute_(mySeq) {
      const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
      if (wait) await new Promise(function (r) { global.setTimeout(r, wait); });
      if (mySeq !== seq) return;
      lastCall = Date.now();
      if (req) req.abort();
      const r = OSRM.request(points.map(function (p) { return [p.lat, p.lng]; }), { alternatives: true });
      req = r;
      try {
        const result = await r.promise;
        if (mySeq !== seq) return; // نقطة جديدة أو إنهاء — رد قديم / a new point or an end — a stale reply
        const best = OSRM.shortest(result.routes);
        if (line) map.removeLayer(line);
        line = L.polyline(best.pts, { color: ROUTE_COLOR, weight: 4 }).addTo(map);
        const alt = result.routes.length > 1 ? ' (أقصر ' + result.routes.length + ' بدائل متاحة)' : '';
        view.hint('مسار شارع حقيقي — ' + points.length + ' نقاط — ' + (best.distance / 1000).toFixed(2) + ' كم — ~' + Math.round(best.duration / 60) + ' دقيقة' + alt + ' (OSRM · © OpenStreetMap)');
      } catch (err) {
        if (mySeq !== seq) return;
        view.hint(straight_() + ' — ' + MSG.FAILED);
      } finally { if (req === r) req = null; }
    }
    function routeClick_(ll) {
      points.push(ll);
      layers.push(L.marker(ll, { icon: numberIcon_(points.length) }).addTo(map));
      if (points.length < 2) return;
      const text = straight_();
      const mySeq = ++seq;
      global.clearTimeout(debounce);
      if (req) { req.abort(); req = null; }
      if (global.navigator.onLine === false) { view.hint(text + ' — ' + MSG.FAILED); return; } // V2: بلا طلب محكوم بالفشل / no doomed request
      view.hint(text + ' — ' + MSG.FETCHING);
      debounce = global.setTimeout(function () { fetchRoute_(mySeq); }, DEBOUNCE_MS);
    }

    function onMapClick_(e) { if (tool === 'measure') measureClick_(e.latlng); else if (tool === 'route') routeClick_(e.latlng); }
    function onToolsClick_(e) { const b = e.target.closest('[data-tool]'); if (b) start(b.dataset.tool); }

    map.on('click', onMapClick_);
    view.tools.addEventListener('click', onToolsClick_);

    return {
      start: start, stop: stop,
      active: function () { return tool; },
      points: function () { return points.map(function (p) { return { lat: p.lat, lng: p.lng }; }); },
      destroy: function () {
        clearDrawing_(); tool = null;
        map.off('click', onMapClick_);
        view.tools.removeEventListener('click', onToolsClick_);
        toolBtns.forEach(function (b) { b.remove(); });
      }
    };
  }

  global.SecMapTools = { mount: mount, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
