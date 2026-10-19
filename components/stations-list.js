/* ============================================================
 * components/stations-list.js — شاشة «المحطات»: القريبة من موقعي والتصفية (إعادة التصميم — المرحلة و، لوحة محمد 5 و6)
 * ============================================================
 * - من نسخة الجهاز فقط (stations-sync) بلا أي طلب للخادم؛ المسافة بنفس دالة القريبة (station-query.distanceKm).
 * - الموقع يُطلب بالضغط على «تحديد موقعي» فقط (قاعدة الملاحة المعتمدة: الصلاحية عند الحاجة لا عند الفتح)، قراءة واحدة.
 * - التصفية: النوع (الكل/توزيع/تحويل)، الحي (من أحياء المحطات الفعلية)، المسافة (0.5–10 كم أو «بلا حد»).
 *   بموقع ← الأقرب أولًا ضمن المسافة؛ بلا موقع ← الحي وحده مرتّبًا بالرقم (بلا مسافة لا تُعرض).
 * - القائمة تتمرر داخل مساحتها، أول PAGE ثم «عرض المزيد»؛ الضغط على محطة يفتحها (onOpen).
 * - حالات واضحة: النسخة لم تُحمَّل، جارٍ تحديد الموقع، الصلاحية مرفوضة، تعذّر الموقع، لا نتائج.
 * كل نص من البيانات يُكتب نصًا.
 *
 * «Stations»: nearby from my location with filters (redesign stage F, Mohammed's board 5 and 6). From the device copy
 * only, no server request; the distance uses the nearby function. Location only on «locate me» (one reading). Filters:
 * type, district (from the real stations), distance (0.5–10 km or none). With a location ← nearest first within the
 * distance; without ← the district alone, by number. The list scrolls inside its area; PAGE first, then «show more».
 * Clear states: copy not loaded, locating, denied, failed, no results. Every data text set as text.
 * ============================================================ */
(function (global) {
  'use strict';

  const Q = global.SecStationQuery;
  if (!Q) throw new Error('stations-list.js يحتاج station-query.js قبله / needs station-query.js first');
  const doc = global.document;
  const PAGE = 50, KM_MIN = 0.5, KM_MAX = 10, KM_STEP = 0.5;
  const GEO_OPTS = { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 };
  const TYPES = [{ v: '', t: 'الكل' }, { v: 'توزيع', t: 'توزيع' }, { v: 'تحويل', t: 'تحويل' }];
  const TYPE_ICON = { // الرمزان المعتمدان — the approved symbols
    'توزيع': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.5 5.2M12 11.5l5.5 5.2"/></svg>',
    'تحويل': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></svg>'
  };
  const ICON = {
    locate: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>',
    filter: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
  };
  const MSG = {
    NO_COPY: 'نسخة المحطات لم تُحمَّل بعد على هذا الجهاز — تظهر القائمة بعد اكتمال التحميل',
    LOCATING: 'جارٍ تحديد موقعك…',
    DENIED: 'صلاحية تحديد الموقع غير مفعلة — فعّلها من إعدادات المتصفح، أو اختر حيًّا من التصفية',
    GEO_FAIL: 'تعذّر تحديد موقعك الآن — حاول مرة أخرى، أو اختر حيًّا من التصفية',
    NO_GEO: 'هذا الجهاز لا يدعم تحديد الموقع — اختر حيًّا من التصفية',
    START: 'اضغط «تحديد موقعي» لعرض المحطات القريبة منك، أو اختر حيًّا من التصفية',
    EMPTY: 'لا توجد محطات تطابق التصفية الحالية — وسّع المسافة أو غيّر الحي أو النوع'
  };

  function el_(tag, cls, text) { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function km_(d) { return d < 1 ? Math.round(d * 1000) + ' م' : (Math.round(d * 10) / 10) + ' كم'; }
  function kmLabel_(v) { return v == null ? 'بلا حد' : (v < 1 ? Math.round(v * 1000) + ' م' : v + ' كم'); }

  /**
   * mount(container, deps) ← { refresh(), state(), destroy() }
   * deps: { localStations() → Array|null, onOpen(station), onChange(fn) (اختياري: تحديث بعد المزامنة) }
   */
  function mount(container, deps) {
    const d = deps || {};
    const f = { type: '', region: '', km: Q.NEARBY_KM }; // المطبّقة — applied
    let draft = null, me = null, geo = 'idle', shown = PAGE, last = [];
    container.classList.add('stations-list');
    container.innerHTML =
      '<div class="sl-head"><span class="sl-title">المحطات القريبة</span></div>' +
      '<div class="sl-bar">' +
        '<button type="button" class="sl-chip sl-locate" data-act="locate">' + ICON.locate + '<span>تحديد موقعي</span></button>' +
        '<button type="button" class="sl-chip" data-act="filter" aria-expanded="false">' + ICON.filter + '<span>التصفية</span></button>' +
      '</div>' +
      '<div class="sl-summary" data-role="summary"></div>' +
      '<div class="sl-filter" data-role="filter" hidden></div>' +
      '<div class="sl-body" data-role="body"></div>';
    const q = function (r) { return container.querySelector('[data-role="' + r + '"]'); };

    function stations_() { const a = d.localStations ? d.localStations() : null; return Array.isArray(a) && a.length ? a : null; }
    /* أحياء المحطات الفعلية مرتّبة — the real stations' districts, sorted */
    function regions_() {
      const all = stations_(); if (!all) return [];
      const set = {}; all.forEach(function (s) { const r = String(s.region || '').trim(); if (r) set[r] = 1; });
      return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ar'); });
    }

    /* النتائج حسب التصفية — the results for the filters */
    function compute_() {
      const all = stations_(); if (!all) return null;
      let list = all.filter(function (s) {
        return (!f.type || s.type === f.type) && (!f.region || String(s.region || '').trim() === f.region);
      });
      if (me) {
        list = list.filter(Q.hasCoordinates).map(function (s) {
          return { s: s, dist: Q.distanceKm(me, { lat: Number(s.lat), lng: Number(s.lng) }) };
        }).filter(function (x) { return f.km == null || x.dist <= f.km; }).sort(function (a, b) { return a.dist - b.dist; });
      } else {
        if (!f.region) return []; // بلا موقع ولا حي: لا قائمة بعشرات الآلاف — no location, no district: no list of tens of thousands
        list = list.map(function (s) { return { s: s, dist: null }; }).sort(function (a, b) { return String(a.s.id).localeCompare(String(b.s.id), 'en', { numeric: true }); });
      }
      return list;
    }

    function summary_() {
      const parts = [f.type ? 'محطات ' + f.type : 'كل الأنواع', f.region ? 'حي ' + f.region : 'كل الأحياء', me ? 'ضمن ' + kmLabel_(f.km) : 'بلا موقع'];
      q('summary').textContent = parts.join(' · ');
    }
    function state_(text, retry) {
      const box = el_('div', 'sl-state', text);
      if (retry) { const b = el_('button', 'sl-retry', 'إعادة المحاولة'); b.type = 'button'; b.dataset.act = 'locate'; box.appendChild(b); }
      return box;
    }

    function draw_() {
      summary_();
      const body = q('body'); body.textContent = '';
      const all = stations_();
      if (!all) { body.appendChild(state_(MSG.NO_COPY)); return; }
      if (geo === 'locating') { body.appendChild(state_(MSG.LOCATING)); return; }
      if (!me && !f.region) {
        body.appendChild(state_(geo === 'denied' ? MSG.DENIED : geo === 'failed' ? MSG.GEO_FAIL : geo === 'nogeo' ? MSG.NO_GEO : MSG.START, geo === 'failed'));
        return;
      }
      last = compute_() || [];
      if (!last.length) { body.appendChild(state_(MSG.EMPTY)); return; }
      body.appendChild(el_('div', 'sl-count', last.length + ' محطة' + (me ? ' — الأقرب أولًا' : ' — حسب الرقم')));
      const ul = el_('div', 'sl-list');
      last.slice(0, shown).forEach(function (x, i) {
        const b = el_('button', 'sl-row'); b.type = 'button'; b.dataset.act = 'open'; b.dataset.i = String(i);
        const sub = x.s.type === 'تحويل';
        const ic = el_('span', 'sl-ic ' + (sub ? 'is-sub' : 'is-dist')); ic.innerHTML = TYPE_ICON[x.s.type] || TYPE_ICON['توزيع'];
        const tx = el_('span', 'sl-tx');
        tx.appendChild(el_('bdi', 'sl-id', String(x.s.id)));
        tx.appendChild(el_('span', 'sl-sub', (sub ? 'محطة تحويل' : 'محطة توزيع') + (x.s.region ? ' · ' + x.s.region : '') + (x.s.feeder ? ' · ' + x.s.feeder : '')));
        b.appendChild(ic); b.appendChild(tx);
        if (x.dist != null) b.appendChild(el_('span', 'sl-km', km_(x.dist)));
        const ch = el_('span', 'sl-ch'); ch.innerHTML = ICON.chev; b.appendChild(ch);
        ul.appendChild(b);
      });
      if (last.length > shown) {
        const more = el_('button', 'sl-more', 'عرض المزيد (' + (last.length - shown) + ' أخرى)'); more.type = 'button'; more.dataset.act = 'more';
        ul.appendChild(more);
      }
      body.appendChild(ul);
    }

    /* لوحة التصفية (شاشة 6): تُطبَّق بزر «تطبيق» فقط — the filter panel: applied with «apply» only */
    function drawFilter_() {
      const p = q('filter'); p.textContent = '';
      const sec = function (title) { const s = el_('div', 'sl-sec'); s.appendChild(el_('div', 'sl-sec-t', title)); p.appendChild(s); return s; };
      const t = sec('نوع المحطة'), seg = el_('div', 'sl-seg');
      TYPES.forEach(function (x) { const b = el_('button', 'sl-seg-b' + (draft.type === x.v ? ' active' : ''), x.t); b.type = 'button'; b.dataset.act = 'type'; b.dataset.v = x.v; seg.appendChild(b); });
      t.appendChild(seg);
      const r = sec('الحي'), sel = el_('select', 'sl-select'); sel.dataset.role = 'region';
      const opt0 = el_('option', null, 'كل الأحياء'); opt0.value = ''; sel.appendChild(opt0);
      regions_().forEach(function (name) { const o = el_('option', null, name); o.value = name; if (name === draft.region) o.selected = true; sel.appendChild(o); });
      r.appendChild(sel);
      const k = sec('نطاق البحث من موقعي'), row = el_('div', 'sl-range');
      const range = el_('input', 'sl-slider'); range.type = 'range'; range.min = String(KM_MIN); range.max = String(KM_MAX); range.step = String(KM_STEP);
      range.value = String(draft.km == null ? KM_MAX : draft.km); range.disabled = draft.km == null; range.dataset.role = 'km'; range.setAttribute('aria-label', 'نطاق البحث بالكيلومتر');
      const val = el_('bdi', 'sl-km-val', kmLabel_(draft.km)); val.dataset.role = 'km-val';
      row.appendChild(range); row.appendChild(val); k.appendChild(row);
      const all = el_('label', 'sl-check'); const cb = el_('input'); cb.type = 'checkbox'; cb.checked = draft.km == null; cb.dataset.role = 'no-limit';
      all.appendChild(cb); all.appendChild(el_('span', null, 'بلا حد للمسافة')); k.appendChild(all);
      const acts = el_('div', 'sl-f-acts');
      const ap = el_('button', 'sl-apply', 'تطبيق'); ap.type = 'button'; ap.dataset.act = 'apply';
      const rs = el_('button', 'sl-reset', 'إعادة الضبط'); rs.type = 'button'; rs.dataset.act = 'reset';
      acts.appendChild(ap); acts.appendChild(rs); p.appendChild(acts);
    }
    function openFilter_(open) {
      const p = q('filter'), btn = container.querySelector('[data-act="filter"]');
      p.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      q('body').hidden = open; // القائمة تُخفى أثناء التصفية فلا تطول الصفحة — the list hides while filtering, so the page stays short
      if (open) { draft = { type: f.type, region: f.region, km: f.km }; drawFilter_(); }
    }

    function locate_() {
      const g = global.navigator.geolocation;
      if (!g) { geo = 'nogeo'; draw_(); return; }
      geo = 'locating'; draw_();
      g.getCurrentPosition(function (pos) {
        me = { lat: pos.coords.latitude, lng: pos.coords.longitude }; geo = 'ok'; shown = PAGE;
        container.querySelector('.sl-locate span').textContent = 'تحديث موقعي';
        draw_();
      }, function (err) {
        geo = err && err.code === 1 ? 'denied' : 'failed'; draw_();
      }, GEO_OPTS);
    }

    container.addEventListener('click', function (e) {
      const t = e.target.closest('[data-act]');
      if (!t || !container.contains(t) || t.disabled) return;
      const act = t.dataset.act;
      if (act === 'locate') locate_();
      else if (act === 'filter') openFilter_(q('filter').hidden);
      else if (act === 'type') { draft.type = t.dataset.v; drawFilter_(); }
      else if (act === 'apply') { f.type = draft.type; f.region = draft.region; f.km = draft.km; shown = PAGE; openFilter_(false); draw_(); }
      else if (act === 'reset') { draft = { type: '', region: '', km: Q.NEARBY_KM }; drawFilter_(); }
      else if (act === 'more') { shown += PAGE; draw_(); }
      else if (act === 'open') { const x = last[Number(t.dataset.i)]; if (x && d.onOpen) d.onOpen(x.s); }
    });
    container.addEventListener('input', function (e) {
      if (!draft) return;
      if (e.target.dataset.role === 'km') { draft.km = Number(e.target.value); q('filter').querySelector('[data-role="km-val"]').textContent = kmLabel_(draft.km); }
      else if (e.target.dataset.role === 'region') draft.region = e.target.value;
    });
    container.addEventListener('change', function (e) {
      if (!draft) return;
      if (e.target.dataset.role === 'no-limit') { draft.km = e.target.checked ? null : Number(q('filter').querySelector('[data-role="km"]').value); drawFilter_(); }
      else if (e.target.dataset.role === 'region') draft.region = e.target.value;
    });
    const off = d.onChange ? d.onChange(function () { if (!container.closest('[hidden]')) draw_(); }) : null;
    draw_();

    return {
      refresh: draw_,
      state: function () { return { geo: geo, me: me, filters: Object.assign({}, f), count: last.length }; },
      destroy: function () { if (typeof off === 'function') off(); container.innerHTML = ''; }
    };
  }

  global.SecStationsList = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
