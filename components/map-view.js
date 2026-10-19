/* ============================================================
 * components/map-view.js — الخريطة: أنماطها الأربعة، خريطة جدة المحفوظة تلقائيًا، التكبير، علامة المحطة، شريط الأدوات
 * ============================================================
 * تصميم V1 وسلوكه كما هما:
 * - Leaflet على جدة (21.54، 39.19، تكبير 12) بلا أزرار Leaflet؛ أزرار التكبير/التصغير الخاصة أسفل الخريطة.
 * - نوع الخريطة من الشريح «تلقائي (حسب وقت الجهاز) / نهاري / ليلي / أقمار صناعية» ويُحفظ (sec2-map-mode): التلقائي
 *   نهاري 6–18 وليلي غير ذلك ويُعاد حسابه كل 5 دقائق؛ الليلي = خريطة OSM نفسها بطبقة .map-night-tiles (قرار «ب» المعدّل).
 * - خريطة جدة المحفوظة (offline-map-ui) تلقائيًا: بلا إنترنت، أو 4 صور تعذّر تحميلها خلال 15 ث ← المحفوظة دقيقة ثم
 *   تُجرَّب العادية؛ بنفس نمط النهاري/الليلي (الأقمار بلا إنترنت ← النهاري). عودة الإنترنت ← العادية فورًا.
 * - علامة المحطة المختارة (🔍 الرقم + هالة ونبض) والانتقال إليها بتكبير 18.
 * - شريط الأدوات: شريح النوع ثم مكان لأزرار المكوّنات الأخرى (القريبة والمغذي، الأعطال، المزيد) — لا منطق لها هنا.
 * - سطر التلميح أسفل الشريط (hint) وتنبيه عائم قصير (toast) للمكوّنات.
 * V2: نص رقم المحطة على العلامة يُكتب نصًا؛ القائمة تُغلق بـ Esc أيضًا؛ تغيّر الطبقة يُبلَّغ (onLayerChange) لتعديل
 *   تكبير الملاحة بدل استدعائها مباشرة؛ مستمعات تُزال بـ destroy.
 *
 * The map: its four styles, the saved Jeddah map automatically, zoom, the station marker, the toolbar. V1's design and
 * behavior as is (Jeddah view, mode chip saved, auto = day 6–18, night = the same OSM tiles with the night filter, the
 * saved Jeddah map offline or after 4 failed tiles in 15 s, station marker at zoom 18, toolbar slot, hint and toast).
 * V2: the marker's number set as text; Esc closes the panel; layer changes are reported (onLayerChange); destroy cleans up.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, H = global.SecHtml;
  if (!CONFIG || !H) throw new Error('map-view.js يحتاج الإعدادات وhtml.js قبله / needs config and html.js first');
  const TILES = CONFIG.MAP_TILES, KEY = CONFIG.STORAGE_KEYS.MAP_MODE;
  const CENTER = [21.54, 39.19], START_ZOOM = 12, STATION_ZOOM = 18;
  const AUTO_REFRESH_MS = 5 * 60 * 1000, TILE_ERRORS = 4, TILE_WINDOW_MS = 15000, FALLBACK_MS = 60000, TOAST_MS = 2000;
  const MODES = ['auto', 'light', 'dark', 'satellite'];
  const META = {
    auto: { label: 'تلقائي', color: '#1FAE8C', option: 'تلقائي (حسب وقت الجهاز)' },
    light: { label: 'نهاري', color: '#C8A24E', option: 'نهاري' },
    dark: { label: 'ليلي', color: '#2E7DD1', option: 'ليلي' },
    satellite: { label: 'أقمار صناعية', color: '#8B6DD6', option: 'أقمار صناعية' }
  };
  const ICON = { // V1
    auto: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    light: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></svg>',
    dark: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5A8.5 8.5 0 1 1 11.5 3 6.8 6.8 0 0 0 21 12.5z"/></svg>',
    satellite: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="6" height="6" rx="1"/><rect x="1" y="10.5" width="5" height="3" rx="0.5"/><rect x="18" y="10.5" width="5" height="3" rx="0.5"/><line x1="6" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="18" y2="12"/><line x1="12" y1="9" x2="12" y2="4"/><circle cx="12" cy="3" r="1"/></svg>'
  };
  const CHEV = '<svg class="mm-chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  const CHECK = '<svg class="mm-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  function savedMode_() { try { const m = global.localStorage.getItem(KEY); return MODES.indexOf(m) !== -1 ? m : 'auto'; } catch (e) { return 'auto'; } }
  function isDaytime_(d) { const h = (d || new Date()).getHours(); return h >= 6 && h < 18; }

  function html_() {
    return '<div class="map-toolbar-bar"><div class="toolbar-scroll" data-role="toolbar">' +
        // عنوان الشريط (تصميم محمد، 15 أكتوبر) — the toolbar title (Mohammed's design)
        '<span class="tb-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>الخريطة</span>' +
        '<div class="map-mode-chip" data-act="chip" role="button" tabindex="0" title="نوع الخريطة" aria-haspopup="true" aria-expanded="false"><span class="mm-icon" data-role="chip-icon"></span><span data-role="chip-label"></span><span class="mm-auto-badge" data-role="auto-badge">تلقائي</span>' + CHEV + '</div>' +
        '<div class="tb-div"></div><span class="map-tools-slot" data-role="tools"></span></div></div>' +
      '<div class="map-mode-panel" data-role="panel" role="menu">' + MODES.map(function (m) {
        return '<button type="button" class="map-mode-opt" data-mode="' + m + '" role="menuitemradio"><span class="mm-dot" style="background:' + META[m].color + '"></span><span class="mm-opt-icon">' + ICON[m] + '</span>' + META[m].option + CHECK + '</button>';
      }).join('') + '</div>' +
      '<div class="map-panels" data-role="panels"></div>' +
      '<div class="map-tool-hint" data-role="hint" role="status"></div>' +
      '<div id="map-container" class="active"></div>' +
      '<div class="zoom-controls show"><div class="zoom-btn" data-act="zoom-in" role="button" title="تكبير" aria-label="تكبير"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>' +
        '<div class="zoom-btn" data-act="zoom-out" role="button" title="تصغير" aria-label="تصغير"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></div></div>' +
      '<div class="map-toast" data-role="toast" role="status"></div>';
  }

  /* علامة المحطة المختارة (V1) — The selected station marker (V1) */
  function stationIcon(id) {
    return global.L.divIcon({
      className: '',
      html: '<div class="selected-station-marker"><div class="ssm-label">🔍 ' + H.esc(String(id)) + '</div><div class="ssm-halo"></div><div class="ssm-pulse"></div><div class="ssm-dot"></div></div>',
      iconSize: [46, 46], iconAnchor: [23, 23]
    });
  }

  /**
   * mount(stage, opts) — stage: عنصر .globe-stage. opts: { offlineMapUI (الافتراضي window.SecOfflineMapUI)، onLayerChange()،
   *   now() للاختبار }
   * يُرجع { map، mode()، resolvedMode()، setMode(m)، showStation(s)، clearStation()، tools (مكان الأزرار)، panels،
   *   hint(text)، hideHint()، toast(text)، usingOffline()، refresh()، destroy() }
   */
  function mount(stage, opts) {
    const o = opts || {};
    const L = global.L;
    let mode = savedMode_(), offlineFlavor = null, fallbackUntil = 0, tileLayer = null, marker = null, toastTimer = null, fallbackTimer = null;
    stage.classList.add('globe-stage', 'map-active');
    stage.insertAdjacentHTML('beforeend', html_());
    const q = function (r) { return stage.querySelector('[data-role="' + r + '"]'); };
    const om = function () { return o.offlineMapUI !== undefined ? o.offlineMapUI : global.SecOfflineMapUI; };
    const now = function () { return o.now ? o.now() : new Date(); };
    const map = L.map(stage.querySelector('#map-container'), { zoomControl: false, attributionControl: false }).setView(CENTER, START_ZOOM);

    function resolved() { return mode === 'auto' ? (isDaytime_(now()) ? 'light' : 'dark') : mode; }
    function useOffline_() { const u = om(); return !!(u && u.isReady && u.isReady() && (global.navigator.onLine === false || Date.now() < fallbackUntil)); }
    function layerChanged_() { if (o.onLayerChange) { try { o.onLayerChange(); } catch (e) { /* لا شيء / nothing */ } } }

    function renderUI_() {
      const r = resolved(), meta = META[r];
      const icon = q('chip-icon'), label = q('chip-label');
      icon.innerHTML = ICON[r]; icon.style.color = meta.color;
      label.textContent = meta.label; label.style.color = meta.color;
      q('auto-badge').hidden = mode !== 'auto';
      stage.querySelectorAll('.map-mode-opt').forEach(function (b) { const on = b.dataset.mode === mode; b.classList.toggle('active', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    }

    /* الطبقة حسب النمط والاتصال (V1) — The layer from the style and the connection (V1) */
    function apply() {
      const r = resolved();
      if (useOffline_()) {
        const flavor = r === 'dark' ? 'dark' : 'light';
        if (offlineFlavor !== flavor) {
          offlineFlavor = flavor;
          Promise.resolve(om().createLayer(flavor)).then(function (layer) {
            if (!layer || offlineFlavor !== flavor || !useOffline_()) return;
            if (tileLayer) map.removeLayer(tileLayer);
            tileLayer = layer.addTo(map);
            layerChanged_();
            if (om().renderCard) om().renderCard();
          }).catch(function () { offlineFlavor = null; });
        }
        renderUI_();
        return;
      }
      offlineFlavor = null;
      if (tileLayer) map.removeLayer(tileLayer);
      // النهاري يحمل اسمًا خاصًا لتحسين وضوحه في الثيم الفاتح بالأنماط فقط (ملاحظة محمد 6) — نفس المصدر والبيانات والتحميل
      // The day layer gets its own class so the light theme can sharpen it by styles alone — same source, data and loading
      tileLayer = L.tileLayer(r === 'satellite' ? TILES.SATELLITE : TILES.STREET, { maxZoom: TILES.MAX_ZOOM, className: r === 'dark' ? 'map-night-tiles' : r === 'light' ? 'map-day-tiles' : '' }).addTo(map);
      watchErrors_(tileLayer);
      layerChanged_();
      renderUI_();
      const u = om(); if (u && u.renderCard) u.renderCard();
    }

    /* 4 صور تعذّرت خلال 15 ث والخريطة محفوظة ← المحفوظة دقيقة — 4 failed tiles in 15 s with the map saved ← the saved map for a minute */
    function watchErrors_(layer) {
      let errors = [];
      layer.on('tileerror', function () {
        const t = Date.now();
        errors = errors.filter(function (x) { return t - x < TILE_WINDOW_MS; }); errors.push(t);
        const u = om();
        if (errors.length >= TILE_ERRORS && layer === tileLayer && u && u.isReady && u.isReady()) {
          fallbackUntil = t + FALLBACK_MS;
          apply();
          global.clearTimeout(fallbackTimer);
          fallbackTimer = global.setTimeout(function () { if (Date.now() >= fallbackUntil) apply(); }, FALLBACK_MS + 1000);
        }
      });
    }

    function setMode(m) {
      if (MODES.indexOf(m) === -1) return;
      mode = m;
      try { global.localStorage.setItem(KEY, m); } catch (e) { /* محظور / blocked */ }
      apply(); closePanel_();
    }
    function togglePanel_(open) {
      const p = q('panel'), chip = stage.querySelector('[data-act="chip"]');
      p.classList.toggle('show', open); chip.classList.toggle('open', open); chip.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function closePanel_() { togglePanel_(false); }

    // ===== المحطة — The station =====
    function showStation(s) {
      map.invalidateSize();
      if (marker) map.removeLayer(marker);
      marker = null;
      const lat = Number(s && s.lat), lng = Number(s && s.lng);
      if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null; // بلا إحداثيات: لا علامة / no coordinates: no marker
      marker = L.marker([lat, lng], { icon: stationIcon(s.id) }).addTo(map);
      map.flyTo([lat, lng], STATION_ZOOM, { duration: 1.4 });
      return marker;
    }
    function clearStation() { if (marker) { map.removeLayer(marker); marker = null; } }

    // ===== التلميح والتنبيه — Hint and toast =====
    function hint(text) { const h = q('hint'); h.textContent = text; h.classList.add('show'); }
    function hideHint() { q('hint').classList.remove('show'); }
    function toast(text) {
      const t = q('toast'); t.textContent = text; t.classList.add('show');
      global.clearTimeout(toastTimer); toastTimer = global.setTimeout(function () { t.classList.remove('show'); }, TOAST_MS);
    }

    // ===== الأحداث — Events =====
    function onClick_(e) {
      const t = e.target.closest('[data-act], .map-mode-opt');
      if (!t || !stage.contains(t)) return;
      if (t.classList.contains('map-mode-opt')) { setMode(t.dataset.mode); return; }
      const act = t.dataset.act;
      if (act === 'chip') { e.stopPropagation(); togglePanel_(!q('panel').classList.contains('show')); }
      else if (act === 'zoom-in') map.zoomIn();
      else if (act === 'zoom-out') map.zoomOut();
    }
    function onDocClick_(e) { const chip = stage.querySelector('[data-act="chip"]'); if (!chip.contains(e.target) && !q('panel').contains(e.target)) closePanel_(); }
    function onKey_(e) {
      if (e.key === 'Escape') closePanel_();
      else if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.act === 'chip') { e.preventDefault(); togglePanel_(!q('panel').classList.contains('show')); }
    }
    function onOffline_() { apply(); }
    function onOnline_() { fallbackUntil = 0; apply(); }

    stage.addEventListener('click', onClick_);
    stage.addEventListener('keydown', onKey_);
    global.document.addEventListener('click', onDocClick_);
    global.addEventListener('offline', onOffline_);
    global.addEventListener('online', onOnline_);
    const autoTimer = global.setInterval(function () { if (mode === 'auto') apply(); }, AUTO_REFRESH_MS);
    apply();
    global.setTimeout(function () { map.invalidateSize(); }, 50);
    global.setTimeout(function () { map.invalidateSize(); }, 400);

    return {
      map: map, tools: q('tools'), panels: q('panels'),
      mode: function () { return mode; }, resolvedMode: resolved, setMode: setMode, refresh: apply,
      usingOffline: function () { return offlineFlavor !== null; },
      showStation: showStation, clearStation: clearStation, hint: hint, hideHint: hideHint, toast: toast,
      destroy: function () {
        global.clearInterval(autoTimer); global.clearTimeout(toastTimer); global.clearTimeout(fallbackTimer);
        stage.removeEventListener('click', onClick_); stage.removeEventListener('keydown', onKey_);
        global.document.removeEventListener('click', onDocClick_);
        global.removeEventListener('offline', onOffline_); global.removeEventListener('online', onOnline_);
        map.remove();
        stage.innerHTML = '';
      }
    };
  }

  global.SecMapView = { mount: mount, stationIcon: stationIcon, MODES: MODES.slice() };
})(typeof window !== 'undefined' ? window : globalThis);
