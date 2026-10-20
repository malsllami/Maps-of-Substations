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
 * 20 أكتوبر (مواصفات محمد): نطاق «قريب» 5 كم ثابت حول المحطة المبحوث عنها (لا يتغير مع التكبير)؛ الأخضر حتى 3.5 كم والرمادي
 *   حتى 5 كم؛ الخريطة تُضبط لإظهار النطاق كله بحلقتين خافتتين (3.5 و5 كم)؛ كل المحطات نقاط ملوّنة في مواقعها بلا تجميع،
 *   وبطاقات الرقم والمسافة تظهر حيث تتسع لها المساحة بلا تداخل (الأقرب أولًا، فتزيد مع التكبير)؛ لا سطر توضيحي أعلى الخريطة
 *   (العدد واسم المرشح في الشريط السفلي)؛ الزر يكتب «5كم».
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
  const MAX_CARDS = 80, CARD_GAP = 3; // أقصى بطاقات في الشاشة، والفراغ بينها / the most cards on screen, and the gap between them
  const MSG = { LOADING: 'جاري التحميل...', FAILED: 'تعذّر جلب المحطات، حاول مرة أخرى' };

  /* اللون بالمسافة: قريبة حتى 3.5 كم أخضر، وبعيدة نسبيًا حتى 5 كم رمادي — color by distance: close green, farther gray */
  function tier(km) {
    return km <= Q.MAP_CLOSE_KM ? { tier: 0, color: '#2ECC71' } : { tier: 2, color: '#A8B5C2' };
  }
  /* المسافة بصيغة قصيرة (م تحت الكيلو) — the distance, short (metres under a kilometre) */
  function dist_(km) { return km < 1 ? Math.round(km * 1000) + ' م' : (Math.round(km * 10) / 10) + ' كم'; }
  /* withDist: القريبة — الرقم وتحته المسافة من المحطة المبحوث عنها (نموذج محمد 20 أكتوبر)؛ المغذي: الرقم وحده
   * withDist: nearby — the number with the distance from the searched station under it; feeder: the number alone */
  function pinIcon_(s, t, withDist) {
    const scale = t.tier === 0 ? 1 : t.tier === 1 ? 0.92 : 0.82, opacity = t.tier === 0 ? 1 : t.tier === 1 ? 0.92 : 0.72;
    const w = Math.round(52 * scale), h = Math.round((withDist ? 36 : 22) * scale);
    return global.L.divIcon({
      className: '',
      html: '<div class="nearby-pin-wrap" style="transform:scale(' + scale + ');opacity:' + opacity + '"><div class="nearby-pin-card' + (withDist ? ' has-dist' : '') + '" style="border-color:' + t.color + '">' +
        '<span>' + (s.type === 'تحويل' ? '⚡' : '') + H.esc(s.id) + '</span>' + (withDist ? '<small class="nearby-pin-dist" style="color:' + t.color + '">' + dist_(s._dist) + '</small>' : '') + '</div>' +
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
      '<button type="button" class="toolbar-btn" data-nearby="nearby" title="محطات قريبة (٥ كم)"><span class="tb-icon">📍</span><span class="tb-label" data-role="nearby-label">قريب</span></button>' +
      '<button type="button" class="toolbar-btn" data-nearby="feeder" title="محطات المغذي"><span class="tb-icon">⚡</span><span class="tb-label" data-role="feeder-label">مغذي</span></button>');
    const btn = function (m) { return view.tools.querySelector('[data-nearby="' + m + '"]'); };

    function syncButtons_() {
      if (deps.onChange) { try { deps.onChange(mode, data.length); } catch (e) { /* لا تكسر الطبقة / never breaks the layer */ } }
      const st = deps.getStation ? deps.getStation() : null;
      btn('nearby').classList.toggle('active', mode === 'nearby');
      btn('feeder').classList.toggle('active', mode === 'feeder');
      btn('nearby').querySelector('[data-role="nearby-label"]').textContent = mode === 'nearby' ? '5كم' : 'قريب';
      btn('feeder').querySelector('[data-role="feeder-label"]').textContent = mode === 'feeder' && st && st.feeder ? String(st.feeder) : 'مغذي';
    }
    function clear_() { markers.forEach(function (m) { map.removeLayer(m); }); markers = []; }

    const dotRenderer = L.canvas({ padding: 0.5 }); // آلاف النقاط بلا بطء / thousands of dots without lag
    let center = null;
    /* كل محطة نقطة ملوّنة في موقعها الحقيقي (بلا تجميع)، وبطاقات الرقم والمسافة: من التكبير 15 لكل ما في الشاشة، وقبله لأقرب 10
     * Every station a colored dot at its real place (no clustering); number/distance cards for everything on screen from
     * zoom 15, and for the nearest 10 before it */
    function render() {
      if (!mode) return;
      clear_();
      const zoom = map.getZoom();
      if (mode === 'nearby' && center) [Q.MAP_CLOSE_KM, Q.MAP_NEARBY_KM].forEach(function (km, i) {
        markers.push(L.circle([center.lat, center.lng], { radius: km * 1000, color: i ? '#A8B5C2' : '#2ECC71', weight: 1.5, opacity: 0.55, dashArray: '6 6', fill: false, interactive: false }).addTo(map));
      });
      // حجم النقطة بالتكبير: صغيرة عند رؤية النطاق كله (آلاف المحطات تبقى مقروءة كتوزيع)، وتكبر مع التقريب
      // The dot size by zoom: small when the whole range shows (thousands stay readable as a spread), larger as you zoom in
      const dotR = zoom <= 12 ? 2.2 : zoom === 13 ? 3 : zoom === 14 ? 4 : 5, dotW = zoom <= 13 ? 0 : 1;
      data.forEach(function (s) {
        const dot = L.circleMarker([s.lat, s.lng], { renderer: dotRenderer, radius: dotR, color: '#08101A', weight: dotW, fillColor: tier(s._dist).color, fillOpacity: 0.9 });
        dot.bindPopup(popup_(s, deps.googleMapsUrl ? deps.googleMapsUrl(s) : ''));
        dot._secStation = s;
        markers.push(dot.addTo(map));
      });
      // بطاقات الرقم والمسافة بلا تداخل (مراجعة 20 أكتوبر): الأقرب أولًا، وكل بطاقة تُوضع فقط حيث لا تغطي بطاقة أخرى ولا علامة
      // المحطة المختارة؛ النقاط كلها تبقى في مواقعها، والمحجوبة تظهر بطاقتها مع التكبير.
      // Number/distance cards without overlap: nearest first, each placed only where it covers no other card nor the chosen
      // station's label; every dot stays at its place, a hidden card appears as you zoom in.
      const size = map.getSize(), boxes = [];
      if (center) { const c = map.latLngToContainerPoint([center.lat, center.lng]); boxes.push({ x1: c.x - 80, y1: c.y - 64, x2: c.x + 80, y2: c.y + 16 }); }
      const show = [];
      data.slice().sort(function (a, b) { return a._dist - b._dist; }).some(function (s) {
        const p = map.latLngToContainerPoint([s.lat, s.lng]);
        if (p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y) return false;
        const w = String(s.id).length * 7.5 + (s.type === 'تحويل' ? 12 : 0) + 20, h = (mode === 'nearby' ? 36 : 22) + 6;
        const b = { x1: p.x - w / 2 - CARD_GAP, y1: p.y - h - CARD_GAP, x2: p.x + w / 2 + CARD_GAP, y2: p.y + CARD_GAP };
        if (boxes.some(function (o) { return b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1; })) return false;
        boxes.push(b); show.push(s);
        return show.length >= MAX_CARDS;
      });
      show.forEach(function (s) {
        const mk = L.marker([s.lat, s.lng], { icon: pinIcon_(s, tier(s._dist), mode === 'nearby') });
        mk.bindPopup(popup_(s, deps.googleMapsUrl ? deps.googleMapsUrl(s) : ''));
        mk.bindTooltip(H.esc(s.id) + ' — ' + s._dist.toFixed(2) + ' كم', { direction: 'top', offset: [0, -16] });
        mk._secStation = s;
        mk.addTo(map);
        markers.push(mk);
      });
    }

    function reset() { seq++; mode = null; data = []; center = null; clear_(); view.hideHint(); syncButtons_(); }
    /* الخريطة على النطاق كله في المساحة المرئية: دائرة 5 كم للقريبة، ومحطات المغذي كلها للمغذي (التكبير اليدوي متاح بعدها)
     * The map on the whole range in the visible area: the 5 km circle for nearby, all the feeder's stations for feeder */
    function fit_() {
      const pad = view.fitPadding ? view.fitPadding(16) : { padding: [16, 16] };
      if (mode === 'nearby' && center) { map.fitBounds(L.latLng(center.lat, center.lng).toBounds(Q.MAP_NEARBY_KM * 2000), pad); return; }
      const pts = data.map(function (s) { return [s.lat, s.lng]; }).concat(center ? [[center.lat, center.lng]] : []);
      if (pts.length) map.fitBounds(pts.length > 1 ? pts : [pts[0], pts[0]], Object.assign(pad, { maxZoom: 16 }));
    }

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
      const hasCenter = Q.hasCoordinates(st);
      center = hasCenter ? { lat: Number(st.lat), lng: Number(st.lng) } : null;
      data = (res.stations || []).filter(function (s) { return Q.hasCoordinates(s) && !(String(s.id) === String(st.id) && s.type === st.type); })
        .map(function (s) { const d = typeof s.distanceKm === 'number' ? s.distanceKm : (hasCenter ? Q.distanceKm(center, { lat: Number(s.lat), lng: Number(s.lng) }) : 0); return Object.assign({}, s, { lat: Number(s.lat), lng: Number(s.lng), _dist: d }); });
      view.hideHint(); // العدد واسم المرشح في الشريط السفلي، فلا سطر يأخذ من الخريطة / the count and filter are in the bottom strip
      syncButtons_(); // العدد صار معروفًا / the count is now known
      fit_();
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
