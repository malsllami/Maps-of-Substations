/* ============================================================
 * components/add-edit-station.js — نموذجا إضافة محطة وتعديلها (صفحتان كاملتان فوق الموقع)
 * ============================================================
 * تصميم V1 وسلوكه كما هما:
 * - الإضافة: النوع (توزيع/تحويل — المغذي والمنطقة للتوزيع فقط)، رقم المحطة، المغذي (اختياري)، المنطقة (إلزامية للتوزيع)،
 *   الإحداثيتان، «📍 استخدام موقعي الحالي»، لصق «عرض,طول» + «تطبيق»، معاينة بدبوس قابل للسحب وزر الأقمار، سبب الإضافة،
 *   «حفظ المحطة» بشريط تقدّم، ثم «✓ تمت إضافة المحطة بنجاح» + «حسنًا».
 * - التعديل: المغذي والمنطقة (للتوزيع)، الإحداثيتان، الموقع الحالي، اللصق، المعاينة، السبب، «حفظ التعديل» و«إلغاء».
 * - الحقول تقبل الأرقام العربية والإنجليزية (text-input). لا كتابة والجهاز بلا إنترنت — النموذج يبقى بما فيه.
 * - أثناء الحفظ: منع مغادرة الصفحة وإبلاغ الصفحة (onSavingChange) لتعطيل التنقل، وإعادة الإرسال بنفس مفتاح العملية
 *   (api-client) مع «الخادم لم يرد بشكل سليم، جارٍ التحقق من الحفظ…».
 * V2: التحقق من صلاحية الإحداثية (لا 0,0 ولا خارج النطاق)؛ الإغلاق ممنوع أثناء الحفظ (في V1 كان ✕ الإضافة يعمل)؛ لا
 *   ضغطة حفظ مزدوجة؛ رسائل الموقع داخل النموذج لا alert؛ عنوان التعديل برقم المحطة؛ القيم تُكتب كنص (لا HTML)؛ تعديل
 *   محطة بلا إحداثيات ممكن؛ بعد الحفظ تُبلَّغ الصفحة بالمحطة كاملة (onSaved) فتحدّث البطاقة والنسخة المحلية معًا.
 *
 * The add and edit station forms (full pages over the site). V1's design and behavior as is (fields, GPS, paste, a
 * draggable preview with satellite, reason, progress, success). Fields accept Arabic and Latin digits. No writes while
 * offline — the form keeps its contents. While saving: leaving is blocked, the page is told (onSavingChange), and the
 * save is resent with the same operation key (api-client). V2: coordinate validity; no closing while saving; no double
 * submit; location messages inline (no alert); the edit title uses the station id; values set as text; editing a
 * station without coordinates works; after saving the page gets the full station (onSaved) to update the card and copy.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, TI = global.SecTextInput, Q = global.SecStationQuery;
  if (!CONFIG || !TI || !Q) throw new Error('add-edit-station.js يحتاج الإعدادات وtext-input.js وstation-query.js قبله / needs config, text-input.js and station-query.js first');
  const TILES = CONFIG.MAP_TILES;
  const DEFAULT_VIEW = { center: [24.7, 46.7], zoom: 6 }; // من V1: المملكة كاملة قبل تحديد الموقع / from V1: the whole kingdom before a location
  const MSG = {
    LOGIN_ADD: 'سجّل دخول أولاً لإضافة محطة',
    LOGIN_EDIT: 'سجّل دخول أولاً لتعديل المحطة',
    ID_REQUIRED: 'رقم المحطة مطلوب',
    REGION_REQUIRED: 'المنطقة مطلوبة',
    ADD_COORDS: 'الإحداثية إجبارية — حدّد موقعك أو أدخلها يدوياً قبل الحفظ',
    BAD_COORDS: 'الرجاء إدخال إحداثية صحيحة',
    PASTE: 'صيغة غير صحيحة، المطلوب: خط العرض,خط الطول',
    GPS_UNSUPPORTED: 'المتصفح لا يدعم تحديد الموقع',
    GPS_WAIT: 'جاري تحديد موقعك...',
    GPS_FAILED: 'تعذّر تحديد الموقع، تأكد من صلاحية الوصول للموقع',
    OFFLINE: 'هذه العملية تحتاج إلى اتصال بالإنترنت',
    RETRY: 'الخادم لم يرد بشكل سليم، جارٍ التحقق من الحفظ…',
    FAILED: 'فشل الحفظ',
    ADDED: '✓ تمت إضافة المحطة بنجاح — يمكنك البحث عنها مباشرة',
    EDITED: '✓ تم حفظ التعديل بنجاح',
    // متى يراها الآخرون (اختيار محمد 16 أكتوبر: الثقة بالنسخة المحلية دقيقتان) — when others see it (local trust window: 2 minutes)
    SHARED_ADD: 'تظهر الإضافة عند جميع المستخدمين خلال دقيقتين كحد أقصى',
    SHARED_EDIT: 'يظهر التعديل عند جميع المستخدمين خلال دقيقتين كحد أقصى',
    LEAVE: 'عملية الحفظ لسه ما خلصت'
  };
  const NOFILL = ' autocomplete="new-password" data-lpignore="true" data-form-type="other" autocorrect="off" autocapitalize="off" spellcheck="false"';
  const CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  let deps = null, add = null, edit = null, saving = false;

  function input_(role, placeholder, extra) { return '<input class="edit-input" data-f="' + role + '" placeholder="' + placeholder + '"' + NOFILL + (extra || '') + '>'; }

  /* حقول الإحداثية + الموقع الحالي + اللصق + المعاينة (مشتركة) — Coordinates, GPS, paste and preview (shared) */
  function coordsBlock_() {
    return '<div class="edit-grid"><div>' +
        '<label class="form-field-label">الإحداثيات (خط العرض والطول)</label>' +
        '<div class="sf-row sf-coords">' + input_('lat', 'مثال: 21.523456', ' inputmode="decimal"') + input_('lng', 'مثال: 39.187654', ' inputmode="decimal"') + '</div>' +
        '<button class="use-gps-btn" type="button" data-act="gps">📍 استخدام موقعي الحالي</button>' +
        '<div class="paste-coord-row"><span class="paste-coord-label">أو الصق الإحداثية مباشرة (بصيغة: خط العرض,خط الطول)</span>' +
          '<div class="sf-row">' + input_('paste', 'مثال: 21.5234,39.1876', ' style="flex:1"') + '<button type="button" class="paste-apply-btn" data-act="paste">تطبيق</button></div></div>' +
      '</div>' +
      '<div class="edit-map-wrap"><div class="sf-preview-map" data-role="map"></div><button type="button" class="edit-map-sat-btn" data-act="sat" title="تبديل القمر الصناعي">🛰️</button></div>' +
    '</div>';
  }
  function progressBlock_() {
    return '<div class="add-station-progress-track" data-role="track" hidden><div class="add-station-progress-fill" data-role="fill"></div></div>' +
      '<div class="sf-progress-label" data-role="plabel" hidden>0%</div>';
  }
  function overlay_(title, body) {
    const el = global.document.createElement('div');
    el.className = 'fullpage-form-overlay';
    el.innerHTML = '<div class="fullpage-form-header"><div class="fullpage-form-title" data-role="title">' + title + '</div>' +
      '<div class="fullpage-form-close" data-act="close" role="button" aria-label="إغلاق">' + CLOSE_SVG + '</div></div>' +
      '<div class="fullpage-form-body">' + body + '</div>';
    global.document.body.appendChild(el);
    return el;
  }

  function addHtml_() {
    return '<div class="add-station-panel"><div class="sf-form" data-role="form">' +
        '<div><label class="form-field-label">نوع المحطة</label><div class="add-station-type">' +
          '<button class="type-btn active" type="button" data-type="توزيع">توزيع</button><button class="type-btn" type="button" data-type="تحويل">تحويل</button></div></div>' +
        '<div><label class="form-field-label">رقم المحطة</label>' + input_('id', 'مثال: 39070') + '</div>' +
        '<div class="sf-row sf-dist" data-role="dist">' +
          '<div class="sf-col"><label class="form-field-label">المغذي (اختياري)</label>' + input_('feeder', 'مثال: SNB38') + '</div>' +
          '<div class="sf-col"><label class="form-field-label">المنطقة</label>' + input_('region', 'مثال: القرينية') + '</div></div>' +
        coordsBlock_() +
        '<div><label class="form-field-label">سبب الإضافة</label>' + input_('reason', 'مثال: محطة جديدة بحي القرينية لتغذية المنطقة الصناعية') + '</div>' +
        '<div class="add-station-error" data-role="error" role="alert"></div>' +
        '<button class="add-station-submit" type="button" data-act="save">حفظ المحطة</button>' +
      '</div>' + progressBlock_() +
      '<div class="sf-success" data-role="success" hidden><div class="sf-success-text">' + MSG.ADDED + '</div><div class="sf-success-note">⏱ ' + MSG.SHARED_ADD + '</div><button class="add-station-submit" type="button" data-act="done">حسنًا</button></div>' +
    '</div>';
  }
  function editHtml_() {
    return '<div class="sb-inner"><div class="sf-form" data-role="form">' +
        '<div class="add-station-error" data-role="error" role="alert"></div>' +
        '<div class="sf-dist-edit" data-role="dist">' +
          '<div><label class="form-field-label">المغذي</label>' + input_('feeder', 'مثال: SNB38') + '</div>' +
          '<div><label class="form-field-label">المنطقة</label>' + input_('region', 'مثال: القرينية') + '</div></div>' +
        coordsBlock_() +
        '<div><label class="form-field-label">سبب التعديل</label>' + input_('reason', 'مثال: تصحيح موقع المحطة بعد معاينة ميدانية') + '</div>' +
        progressBlock_() +
        '<div class="st-actions"><button class="st-btn primary" type="button" data-act="save">حفظ التعديل</button><button class="st-btn" type="button" data-act="close">إلغاء</button></div>' +
      '</div>' +
      '<div class="sf-success" data-role="success" hidden><div class="sf-success-text">' + MSG.EDITED + '</div><div class="sf-success-note">⏱ ' + MSG.SHARED_EDIT + '</div><button class="add-station-submit" type="button" data-act="done">حسنًا</button></div>' +
    '</div>';
  }

  /* نموذج واحد (إضافة أو تعديل) بحالته ومعاينته — One form (add or edit) with its state and preview */
  function createForm_(mode) {
    const el = overlay_(mode === 'add' ? '+ إضافة محطة جديدة' : 'تعديل المحطة', mode === 'add' ? addHtml_() : editHtml_());
    const f = function (name) { return el.querySelector('[data-f="' + name + '"]'); };
    const r = function (name) { return el.querySelector('[data-role="' + name + '"]'); };
    const form = { mode: mode, el: el, f: f, r: r, type: 'توزيع', station: null, map: null, marker: null, tiles: null, sat: false };

    if (mode === 'add') TI.code(f('id'), 24);
    TI.upper(f('feeder')); TI.digits(f('region')); TI.digits(f('reason'));
    TI.coord(f('lat')); TI.coord(f('lng')); TI.coordPair(f('paste'));
    f('lat').addEventListener('input', function () { syncPreview_(form); });
    f('lng').addEventListener('input', function () { syncPreview_(form); });
    el.addEventListener('click', function (e) { onClick_(form, e); });
    return form;
  }

  function error_(form, text, ok) {
    const e = form.r('error');
    e.textContent = text || '';
    e.classList.toggle('sf-info', !!ok);
  }

  function setType_(form, type) {
    form.type = type;
    form.el.querySelectorAll('.type-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.type === type); });
    form.r('dist').hidden = type !== 'توزيع';
  }

  const MAP_MISSING = 'تعذّر تحميل الخريطة — أدخل الإحداثيات يدويًا أو باللصق أو من «موقعي الحالي»';

  /* المعاينة: تُنشأ عند أول فتح (الحاوية ظاهرة) — The preview: created on first open (container visible) */
  function ensureMap_(form) {
    const L = global.L;
    if (!L) { // مكتبة الخريطة تعذّرت: الإدخال يعمل بدون معاينة، برسالة واضحة / the map library unavailable: input works without a preview, with a clear message
      const box = form.r('map');
      if (!box.querySelector('.sf-map-missing')) box.innerHTML = '<div class="sf-map-missing" role="status">' + MAP_MISSING + '</div>';
      return;
    }
    if (!form.map) {
      form.map = L.map(form.r('map'), { zoomControl: false, attributionControl: false, dragging: true }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
      form.tiles = L.tileLayer(TILES.STREET, { maxZoom: TILES.MAX_ZOOM }).addTo(form.map);
      form.marker = L.marker(DEFAULT_VIEW.center, { draggable: true, opacity: 0 }).addTo(form.map);
      form.marker.on('dragend', function () {
        const p = form.marker.getLatLng();
        form.f('lat').value = p.lat.toFixed(6); form.f('lng').value = p.lng.toFixed(6);
      });
    }
    global.setTimeout(function () { if (form.map) form.map.invalidateSize(); }, 100);
  }
  function readCoords_(form) {
    const s = { lat: form.f('lat').value.trim(), lng: form.f('lng').value.trim() };
    return Q.hasCoordinates(s) ? { lat: Number(s.lat), lng: Number(s.lng) } : null;
  }
  function syncPreview_(form, zoom) {
    if (!form.map) return;
    const c = readCoords_(form);
    if (!c) return;
    form.marker.setLatLng([c.lat, c.lng]); form.marker.setOpacity(1);
    form.map.setView([c.lat, c.lng], zoom || Math.max(form.map.getZoom(), 17));
  }
  function setCoords_(form, lat, lng) {
    form.f('lat').value = Number(lat).toFixed(6); form.f('lng').value = Number(lng).toFixed(6);
    syncPreview_(form);
  }
  function resetPreview_(form, station) {
    if (!form.map) return;
    if (station && Q.hasCoordinates(station)) {
      form.marker.setLatLng([Number(station.lat), Number(station.lng)]); form.marker.setOpacity(1);
      form.map.setView([Number(station.lat), Number(station.lng)], 17);
    } else { form.marker.setOpacity(0); form.map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom); }
  }

  function onClick_(form, e) {
    const t = e.target.closest('[data-act], .type-btn');
    if (!t || !form.el.contains(t)) return;
    if (t.classList.contains('type-btn')) { if (!saving) setType_(form, t.dataset.type); return; }
    const act = t.dataset.act;
    if (act === 'close' || act === 'done') { if (!saving) close(); }
    else if (act === 'gps') gps_(form);
    else if (act === 'paste') {
      const c = TI.parseCoordPair(form.f('paste').value);
      if (!c) { error_(form, MSG.PASTE); return; }
      error_(form, ''); setCoords_(form, c.lat, c.lng);
    } else if (act === 'sat') {
      if (!form.map) return;
      form.sat = !form.sat;
      t.classList.toggle('active', form.sat);
      form.map.removeLayer(form.tiles);
      form.tiles = global.L.tileLayer(form.sat ? TILES.SATELLITE : TILES.STREET, { maxZoom: TILES.MAX_ZOOM }).addTo(form.map);
    } else if (act === 'save') save_(form);
  }

  /* الموقع الحالي (عند الضغط فقط) — The current location (on tap only) */
  function gps_(form) {
    const geo = global.navigator.geolocation;
    if (!geo) { error_(form, MSG.GPS_UNSUPPORTED); return; }
    error_(form, MSG.GPS_WAIT, true);
    geo.getCurrentPosition(function (pos) {
      if (form.r('error').textContent !== MSG.GPS_WAIT) return; // أُغلق النموذج أو ظهر خطأ آخر / closed or another message shown
      error_(form, ''); setCoords_(form, pos.coords.latitude, pos.coords.longitude);
    }, function () {
      if (form.r('error').textContent === MSG.GPS_WAIT) error_(form, MSG.GPS_FAILED);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  /* التحقق قبل الإرسال (ترتيب V1) ← { payload, station } أو نص خطأ — Validation before sending (V1's order) */
  function validate_(form) {
    const loggedIn = !deps.isLoggedIn || deps.isLoggedIn();
    if (!loggedIn) return form.mode === 'add' ? MSG.LOGIN_ADD : MSG.LOGIN_EDIT;
    const dist = (form.mode === 'add' ? form.type : form.station.type) === 'توزيع';
    const feeder = dist ? TI.normalizeCode(form.f('feeder').value.trim()) : '';
    const region = dist ? TI.stripInvisible(form.f('region').value.trim()) : '';
    const reason = TI.stripInvisible(form.f('reason').value.trim());
    const at = readCoords_(form);
    if (form.mode === 'add') {
      const id = TI.normalizeCode(form.f('id').value.trim());
      if (!id) return MSG.ID_REQUIRED;
      if (dist && !region) return MSG.REGION_REQUIRED;
      if (!at) return MSG.ADD_COORDS;
      return { action: 'addNewStation', station: { id: id, type: form.type, feeder: feeder, region: region, lat: at.lat, lng: at.lng },
        payload: { stationId: id, type: form.type, lat: at.lat, lng: at.lng, feeder: dist ? feeder : undefined, region: dist ? region : undefined, reason: reason } };
    }
    if (!at) return MSG.BAD_COORDS;
    const s = form.station;
    // الخادم يُبقي المغذي/المنطقة إن أُرسلا فارغين، فالبطاقة تعرض الحقيقة نفسها / the server keeps an empty feeder/region, so does the card
    return { action: 'updateCoordinates', station: Object.assign({}, s, { lat: at.lat, lng: at.lng, feeder: dist ? (feeder || s.feeder || '') : s.feeder, region: dist ? (region || s.region || '') : s.region }),
      payload: { stationId: s.id, type: s.type, lat: at.lat, lng: at.lng, method: 'يدوي/GPS', feeder: dist ? feeder : undefined, region: dist ? region : undefined, reason: reason } };
  }

  function onBeforeUnload_(e) { e.preventDefault(); e.returnValue = MSG.LEAVE; return MSG.LEAVE; }
  function setSaving_(on) {
    saving = on;
    if (on) global.addEventListener('beforeunload', onBeforeUnload_); else global.removeEventListener('beforeunload', onBeforeUnload_);
    try { if (deps.onSavingChange) deps.onSavingChange(on); } catch (e) { /* الصفحة لا توقف الحفظ / the page never stops the save */ }
  }

  /* شريط التقدّم (تقديري حتى 90٪ كما في V1) — The progress bar (estimated up to 90% as in V1) */
  function progress_(form) {
    const track = form.r('track'), fill = form.r('fill'), label = form.r('plabel');
    let p = 0, note = '';
    track.hidden = false; label.hidden = false; fill.style.width = '0%'; label.textContent = '0%';
    const tick = global.setInterval(function () {
      p = Math.min(p + Math.random() * 12, 90);
      fill.style.width = p + '%'; label.textContent = note || Math.round(p) + '%';
    }, 150);
    return {
      retry: function () { note = MSG.RETRY; label.textContent = note; },
      done: function () { global.clearInterval(tick); fill.style.width = '100%'; label.textContent = '100%'; },
      stop: function () { global.clearInterval(tick); track.hidden = true; label.hidden = true; }
    };
  }

  async function save_(form) {
    if (saving) return;
    error_(form, '');
    const v = validate_(form);
    if (typeof v === 'string') { error_(form, v); return; }
    if (global.navigator.onLine === false) { error_(form, MSG.OFFLINE); return; }

    setSaving_(true);
    const btns = form.el.querySelectorAll('[data-act="save"], [data-act="close"]');
    btns.forEach(function (b) { b.disabled = true; });
    if (form.mode === 'add') form.r('form').hidden = true;
    const bar = progress_(form);
    try {
      const res = await global.SecApi.call(v.action, v.payload, { phone: true, onRetry: bar.retry });
      if (!res || !res.success) throw new Error((res && res.error) || MSG.FAILED);
      bar.done();
      try { if (deps.onSaved) deps.onSaved(v.station, form.mode); } catch (e) { /* الحفظ تم؛ خطأ الصفحة لا يُظهره فاشلًا / saved; a page error doesn't make it look failed */ }
      await new Promise(function (r) { global.setTimeout(r, 300); });
      bar.stop();
      form.r('form').hidden = true;
      form.r('success').hidden = false;
    } catch (err) {
      bar.stop();
      form.r('form').hidden = false;
      error_(form, err && err.message ? err.message : MSG.FAILED);
    } finally {
      btns.forEach(function (b) { b.disabled = false; });
      setSaving_(false);
    }
  }

  function clearFields_(form) {
    ['id', 'feeder', 'region', 'lat', 'lng', 'paste', 'reason'].forEach(function (n) { const i = form.f(n); if (i) i.value = ''; });
    error_(form, '');
    form.r('form').hidden = false; form.r('success').hidden = true;
  }

  // ===== الواجهة العامة — Public API =====

  /**
   * init(d) — d: { isLoggedIn() → bool، onSaved(station, 'add'|'edit')، onSavingChange(bool) }
   */
  function init(d) {
    if (add) return;
    deps = d || {};
    add = createForm_('add');
    edit = createForm_('edit');
  }

  /* فتح الإضافة (برقم مقترح من «غير موجودة» إن وُجد) — Open add (with an id from «not found» if any) */
  function openAdd(prefillId) {
    if (saving) return;
    close();
    if (add.r('success').hidden === false) { clearFields_(add); setType_(add, 'توزيع'); resetPreview_(add, null); }
    if (prefillId !== undefined && prefillId !== null) add.f('id').value = TI.normalizeCode(prefillId);
    add.el.classList.add('show');
    ensureMap_(add);
  }

  /* فتح التعديل لمحطة — Open edit for a station */
  function openEdit(station) {
    if (saving || !station) return;
    close();
    clearFields_(edit);
    edit.station = Object.assign({}, station);
    edit.r('title').textContent = 'تعديل: ' + station.id;
    edit.r('dist').hidden = station.type !== 'توزيع';
    edit.f('feeder').value = station.feeder || '';
    edit.f('region').value = station.region || '';
    if (Q.hasCoordinates(station)) { edit.f('lat').value = Number(station.lat).toFixed(6); edit.f('lng').value = Number(station.lng).toFixed(6); }
    edit.el.classList.add('show');
    ensureMap_(edit);
    resetPreview_(edit, station);
  }

  /* إغلاق (ممنوع أثناء الحفظ) — Close (not while saving) */
  function close() {
    if (saving) return false;
    [add, edit].forEach(function (form) {
      if (!form) return;
      form.el.classList.remove('show');
      if (form.r('error').textContent === MSG.GPS_WAIT) error_(form, '');
    });
    if (add && add.r('success').hidden === false) { clearFields_(add); setType_(add, 'توزيع'); resetPreview_(add, null); }
    return true;
  }

  global.SecStationForm = {
    init: init, openAdd: openAdd, openEdit: openEdit, close: close,
    isOpen: function () { return !!((add && add.el.classList.contains('show')) || (edit && edit.el.classList.contains('show'))); },
    isSaving: function () { return saving; },
    MSG: MSG
  };
})(typeof window !== 'undefined' ? window : globalThis);
