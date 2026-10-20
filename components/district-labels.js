/* ============================================================
 * components/district-labels.js — أسماء أحياء جدة على الخريطة من بيانات المحطات الحقيقية (طلب محمد 20 أكتوبر)
 * ============================================================
 * - الحي = حقل «المنطقة» في نسخة المحطات؛ موضع اسمه = الوسيط لإحداثيات محطاته (يتجاهل المحطة ذات الإحداثيات الخاطئة)،
 *   ولا يُعرض حيّ له أقل من MIN_STATIONS محطات. لا أسماء ثابتة في الكود — كل شيء من البيانات ويتحدث معها.
 * - تظهر على التكبير 11–15 (نظرة على المدينة والأحياء) وتختفي من 16 فأعلى فتبقى الشوارع والمحطة واضحة.
 * - بلا تداخل: الأحياء الأكبر (محطات أكثر) أولًا، وأي اسم يتقاطع مع اسم ظاهر يُترك.
 * كل نص من البيانات يُكتب نصًا.
 *
 * Jeddah's district names on the map from the real station data (Mohammed, 20 Oct). The district is the stations'
 * «region»; its label sits at the median of its stations' coordinates; none with fewer than MIN_STATIONS stations.
 * Shown at zoom 11–15, hidden from 16. No overlap: larger districts first, a colliding label is skipped.
 * ============================================================ */
(function (global) {
  'use strict';

  const MIN_STATIONS = 5, MIN_ZOOM = 11, MAX_ZOOM = 15, PAD = 6;
  const SIDE_W = 64; // عرض عمود أزرار الخريطة على اليمين / the right-hand map button column's width
  const doc = global.document;

  function median_(xs) { const a = xs.slice().sort(function (p, q) { return p - q; }), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

  /* الأحياء من نسخة المحطات: { name, lat, lng, count } مرتبة بالأكبر — the districts from the copy, largest first */
  function districts(stations) {
    const by = {};
    (stations || []).forEach(function (s) {
      const name = String(s.region || '').trim(), lat = Number(s.lat), lng = Number(s.lng);
      if (!name || !isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return;
      (by[name] = by[name] || { lat: [], lng: [] }).lat.push(lat); by[name].lng.push(lng);
    });
    return Object.keys(by).filter(function (n) { return by[n].lat.length >= MIN_STATIONS; })
      .map(function (n) { return { name: n, lat: median_(by[n].lat), lng: median_(by[n].lng), count: by[n].lat.length }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  /**
   * mount(view, deps) ← { refresh(), shown(), destroy() }
   * deps: { stations() → Array|null (نسخة المحطات / the station copy) }
   */
  function mount(view, deps) {
    const L = global.L, map = view.map, layer = L.layerGroup().addTo(map);
    let list = [], shown = [];
    const measure = doc.createElement('span'); measure.className = 'district-label'; measure.style.cssText = 'position:fixed;visibility:hidden;left:0;top:0;pointer-events:none;'; // ثابت لا يوسّع الصفحة (RTL) / fixed: never widens the page
    doc.body.appendChild(measure);
    const widthOf = function (t) { measure.textContent = t; return measure.offsetWidth || t.length * 8 + 16; };

    function draw_() {
      layer.clearLayers(); shown = [];
      const z = map.getZoom();
      if (z < MIN_ZOOM || z > MAX_ZOOM || !list.length) return;
      // لا اسم تحت البحث والأدوات أعلاها، ولا تحت عمود الأزرار، ولا تحت البطاقة — no name under the search/tools, the column or the card
      const size = map.getSize(), boxes = [], ins = view.insets ? view.insets() : { top: 0, bottom: 0 }, right = size.x - SIDE_W;
      list.forEach(function (d) {
        const p = map.latLngToContainerPoint([d.lat, d.lng]);
        const w = widthOf(d.name), h = 24, b = { x1: p.x - w / 2 - PAD, y1: p.y - h / 2 - PAD, x2: p.x + w / 2 + PAD, y2: p.y + h / 2 + PAD };
        if (b.x1 < 0 || b.x2 > right || b.y1 < ins.top || b.y2 > size.y - ins.bottom) return;
        if (boxes.some(function (o) { return b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1; })) return; // يتقاطع ← يُترك / overlaps ← skipped
        boxes.push(b);
        const el = doc.createElement('span'); el.className = 'district-label'; el.textContent = d.name;
        L.marker([d.lat, d.lng], { icon: L.divIcon({ className: 'district-label-wrap', html: el.outerHTML, iconSize: [w, h], iconAnchor: [w / 2, h / 2] }), interactive: false, keyboard: false, zIndexOffset: -1000 }).addTo(layer);
        shown.push(d.name);
      });
    }
    function refresh() { list = districts(deps.stations ? deps.stations() : null); draw_(); }
    map.on('zoomend moveend', draw_);
    refresh();
    return {
      refresh: refresh,
      shown: function () { return shown.slice(); },
      destroy: function () { map.off('zoomend moveend', draw_); map.removeLayer(layer); measure.remove(); }
    };
  }

  global.SecDistrictLabels = { mount: mount, districts: districts };
})(typeof window !== 'undefined' ? window : globalThis);
