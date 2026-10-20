/* ============================================================
 * components/nearby-layer.js — طبقة «قريب» و«مغذي» على الخريطة: زرّا الشريط، العلامات حسب التكبير، النوافذ المنبثقة
 * ============================================================
 * سلوك V1 وتصميمه كما هما:
 * - زرّا «📍 قريب» و«⚡ مغذي» في شريط أدوات الخريطة؛ الضغط يعرض الطبقة والضغط مرة أخرى يخفيها.
 * - العرض حسب التكبير: 13 فأقل لا شيء («قرّب الخريطة لعرض المحطات المجاورة»)، 14–15 أقرب 10، 16 فأكثر كل ما في الشاشة.
 * - لون العلامة وحجمها بالمسافة: أقل من 100 م أخضر، حتى 300 م فيروزي، أبعد رمادي أصغر؛ ⚡ لمحطة التحويل.
 * - النافذة المنبثقة: الرقم والمغذي والمسافة + «قوقل ماب» و«مشاركة» و«تعديل»؛ تلميح «الرقم — المسافة كم».
 * - السطر: «📍 محطات قريبة (٢ كم) — العدد» أو «⚡ المغذي "…" — عدد … محطة مرتبطة»، وتنبيه «تم عرض …» أول مرة.
 * - الجلب نفسه ليس هنا: من بطاقة المحطة (nearby/feeder) — نسخة الجهاز أولًا بلا طلب، والخادم بلا نسخة فقط.
 * V2: زر القريبة يكتب «2كم» عند تفعيله (V1 كان «3كم» خطأً — بند V1 رقم 1)؛ كل نص في العلامات والنوافذ يُهرَّب؛
 *   أزرار النافذة بتفويض لا بـ onclick وكائنات عامة؛ رسالة خطأ للمستخدم بدل «الميزة تحتاج تفعيل بالباك إند»؛ محطة بلا
 *   إحداثيات صالحة لا تُرسم؛ تغيير المحطة يعيد الطبقة (reset).
 *
 * The «nearby» and «feeder» map layer. V1's behavior and design (toolbar buttons, zoom-based display, distance colors,
 * popups, hint line and first-time toast). The fetching itself isn't here: it's the station card's nearby/feeder.
 * V2: the active nearby label reads «2كم» (V1 said «3كم» — V1 bug 1); all text escaped; popup buttons delegated; a user
 * error message; stations without valid coordinates aren't drawn; changing the station resets the layer.
 * ============================================================ */
(function (global) {
  'use strict';

  const H = global.SecHtml, Q = global.SecStationQuery;
  if (!H || !Q) throw new Error('nearby-layer.js يحتاج html.js وstation-query.js قبله / needs html.js and station-query.js first');
  const NEAREST = 10;
  const MSG = { LOADING: 'جاري التحميل...', FAILED: 'تعذّر جلب المحطات، حاول مرة أخرى', ZOOM_IN: ' — قرّب الخريطة لعرض المحطات المجاورة', NEAREST: ' — أقرب 10 محطات', ALL: ' — كل المحطات بالشاشة الحالية' };

  function tier(km) {
    if (km < 0.1) return { tier: 0, color: '#2ECC71' };
    if (km <= 0.3) return { tier: 1, color: '#4DD6B5' };
    return { tier: 2, color: '#A8B5C2' };
  }
  function pinIcon_(s, t) {
    const scale = t.tier === 0 ? 1 : t.tier === 1 ? 0.92 : 0.82, opacity = t.tier === 0 ? 1 : t.tier === 1 ? 0.92 : 0.72;
    const w = Math.round(48 * scale), h = Math.round(22 * scale);
    return global.L.divIcon({
      className: '',
      html: '<div class="nearby-pin-wrap" style="transform:scale(' + scale + ');opacity:' + opacity + '"><div class="nearby-pin-card" style="border-color:' + t.color + '">' + (s.type === 'تحويل' ? '⚡' : '') + H.esc(s.id) + '</div>' +
        '<div class="nearby-pin-tail" style="border-top-color:' + t.color + '"></div></div>',
      iconSize: [w, h + 6], iconAnchor: [w / 2, h + 6]
    });
  }
  function popup_(s, mapsUrl) {
    return '<div class="sb-inner nearby-popup"><div class="sb-data-row">' +
      '<div class="sb-data-cell"><div class="cell-label">' + (s.type === 'تحويل' ? '⚡' : '🏭') + ' رقم المحطة</div><div class="cell-value">' + H.esc(s.id) + '</div></div>' +
      (s.feeder ? '<div class="sb-data-cell"><div class="cell-label">🔌 المغذي</div><div class="cell-value">' + H.esc(s.feeder) + '</div></div>' : '') +
      '<div class="sb-data-cell"><div class="cell-label">📏 المسافة</div><div class="cell-value">' + s._dist.toFixed(2) + ' كم</div></div></div>' +
      '<div class="st-actions"><a href="' + H.esc(mapsUrl) + '" target="_blank" rel="noopener" class="st-btn primary">قوقل ماب 🧭</a>' +
      '<button type="button" class="st-btn" data-nearby-act="share">مشاركة 📤</button><button type="button" class="st-btn" data-nearby-act="edit">تعديل ✏️</button></div></div>';
  }

  /**
   * mount(view, deps) — view: من map-view.mount. deps: { getStation() → المحطة الحالية، query(mode) → Promise
   *   ({ source, stations } أو { error }) — من بطاقة المحطة، googleMapsUrl(s)، onShare(s)، onEdit(s) }
   * يُرجع { activate(mode)، active()، data()، reset()، destroy() }
   */
  function mount(view, deps) {
    const map = view.map, L = global.L;
    let mode = null, data = [], markers = [], seq = 0;
    const toasted = { nearby: false, feeder: false };
    view.tools.insertAdjacentHTML('beforeend',
      '<button type="button" class="toolbar-btn" data-nearby="nearby" title="محطات قريبة (٢ كم)"><span class="tb-icon">📍</span><span class="tb-label" data-role="nearby-label">قريب</span></button>' +
      '<button type="button" class="toolbar-btn" data-nearby="feeder" title="محطات المغذي"><span class="tb-icon">⚡</span><span class="tb-label" data-role="feeder-label">مغذي</span></button>');
    const btn = function (m) { return view.tools.querySelector('[data-nearby="' + m + '"]'); };

    function syncButtons_() {
      if (deps.onChange) { try { deps.onChange(mode, data.length); } catch (e) { /* لا تكسر الطبقة / never breaks the layer */ } }
      const st = deps.getStation ? deps.getStation() : null;
      btn('nearby').classList.toggle('active', mode === 'nearby');
      btn('feeder').classList.toggle('active', mode === 'feeder');
      btn('nearby').querySelector('[data-role="nearby-label"]').textContent = mode === 'nearby' ? '2كم' : 'قريب';
      btn('feeder').querySelector('[data-role="feeder-label"]').textContent = mode === 'feeder' && st && st.feeder ? String(st.feeder) : 'مغذي';
    }
    function clear_() { markers.forEach(function (m) { map.removeLayer(m); }); markers = []; }

    /* العرض حسب التكبير (V1) — Display by zoom (V1) */
    function render() {
      if (!mode) return;
      clear_();
      const zoom = map.getZoom();
      let show = [];
      if (zoom <= 13) show = [];
      else if (zoom <= 15) show = data.slice().sort(function (a, b) { return a._dist - b._dist; }).slice(0, NEAREST);
      else { const b = map.getBounds(); show = data.filter(function (s) { return b.contains([s.lat, s.lng]); }); }
      show.forEach(function (s) {
        const mk = L.marker([s.lat, s.lng], { icon: pinIcon_(s, tier(s._dist)) });
        mk.bindPopup(popup_(s, deps.googleMapsUrl ? deps.googleMapsUrl(s) : ''));
        mk.bindTooltip(H.esc(s.id) + ' — ' + s._dist.toFixed(2) + ' كم', { direction: 'top', offset: [0, -16] });
        mk._secStation = s;
        mk.addTo(map);
        markers.push(mk);
      });
      const st = deps.getStation();
      const label = mode === 'feeder' ? '⚡ المغذي "' + (st && st.feeder) + '" — عدد ' + data.length + ' محطة مرتبطة' : '📍 محطات قريبة (٢ كم) — ' + data.length + ' محطة';
      view.hint(label + (zoom <= 13 ? MSG.ZOOM_IN : zoom <= 15 ? MSG.NEAREST : MSG.ALL));
    }

    function reset() { seq++; mode = null; data = []; clear_(); view.hideHint(); syncButtons_(); }

    /* تفعيل/إخفاء نمط (V1) — Toggle a mode (V1) */
    async function activate(m) {
      const st = deps.getStation ? deps.getStation() : null;
      if (!st) return;
      if (mode === m) { reset(); return; }
      const my = ++seq;
      clear_(); data = []; mode = m; syncButtons_();
      view.hint(MSG.LOADING);
      let res;
      try { res = await deps.query(m); } catch (e) { res = { error: MSG.FAILED }; }
      if (my !== seq) return; // تغيّرت المحطة أو النمط أثناء الجلب / the station or mode changed meanwhile
      if (!res || res.error) { view.hint((res && res.error) || MSG.FAILED); mode = null; syncButtons_(); return; }
      const center = { lat: Number(st.lat), lng: Number(st.lng) };
      const hasCenter = Q.hasCoordinates(st);
      data = (res.stations || []).filter(function (s) { return Q.hasCoordinates(s) && !(String(s.id) === String(st.id) && s.type === st.type); })
        .map(function (s) { const d = typeof s.distanceKm === 'number' ? s.distanceKm : (hasCenter ? Q.distanceKm(center, { lat: Number(s.lat), lng: Number(s.lng) }) : 0); return Object.assign({}, s, { lat: Number(s.lat), lng: Number(s.lng), _dist: d }); });
      syncButtons_(); // العدد صار معروفًا / the count is now known
      if (data.length && hasCenter) { if (view.centerOn) view.centerOn([center.lat, center.lng], 17); else map.setView([center.lat, center.lng], 17); } // في المساحة المرئية / in the visible area
      render();
      if (!toasted[m]) { view.toast(m === 'nearby' ? 'تم عرض ' + data.length + ' محطة قريبة' : 'تم عرض ' + data.length + ' محطة بالمغذي'); toasted[m] = true; }
    }

    // أزرار الشريط والنوافذ (تفويض) — toolbar and popup buttons (delegation)
    function onToolClick_(e) { const b = e.target.closest('[data-nearby]'); if (b && view.tools.contains(b)) activate(b.dataset.nearby); }
    let openMarker = null;
    function onPopupOpen_(e) { openMarker = e.popup && e.popup._source ? e.popup._source : null; }
    function onMapClick_(e) {
      const b = e.target.closest('[data-nearby-act]');
      if (!b || !openMarker || !openMarker._secStation) return;
      const s = openMarker._secStation;
      try {
        if (b.dataset.nearbyAct === 'share' && deps.onShare) deps.onShare(s);
        if (b.dataset.nearbyAct === 'edit' && deps.onEdit) deps.onEdit(s);
      } catch (err) { /* لا تكسر الخريطة / never breaks the map */ }
    }
    view.tools.addEventListener('click', onToolClick_);
    map.on('zoomend moveend', render);
    map.on('popupopen', onPopupOpen_);
    map.getContainer().addEventListener('click', onMapClick_);

    return {
      activate: activate, reset: reset, render: render,
      active: function () { return mode; }, data: function () { return data.slice(); },
      destroy: function () {
        reset();
        view.tools.removeEventListener('click', onToolClick_);
        map.off('zoomend moveend', render); map.off('popupopen', onPopupOpen_);
        map.getContainer().removeEventListener('click', onMapClick_);
        ['nearby', 'feeder'].forEach(function (m) { const b = btn(m); if (b) b.remove(); });
      }
    };
  }

  global.SecNearbyLayer = { mount: mount, tier: tier, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
