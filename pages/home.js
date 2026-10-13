/* ============================================================
 * pages/home.js — الصفحة الرئيسية: تربط المكوّنات المعتمدة بتدفق V1 (لا منطق أعمال هنا)
 * ============================================================
 * تدفق V1 كما هو:
 * - الشاشة الافتتاحية حتى تجهز الكرة (مكوّن الكرة يحدد اللحظة). الزائر: الكرة + زر الدخول فقط (guest-mode).
 * - العضو: تبدأ نسخة المحطات (stations-sync) وتقدّمها في سطر «آخر تحديث»، و«اضغط للمتابعة» عند توقفها؛ بوابة اكتمال الملف
 *   بعد تجديد الجلسة؛ البحث بالعدسة، وبحث الأعطال، وأزرار «+ إضافة محطة» و«🕐 آخر المحطات» و«تحديث»، والإحصاءات وقسم الذاكرة.
 * - وُجدت محطة ← تُسجَّل في «آخر المحطات»، وتلتفّ الكرة نحوها وتتمدد ثم تظهر الخريطة والبطاقة وشريط البحث الصغير؛ الخريطة
 *   تُنشأ أول مرة فقط ثم تبقى. محطة أخرى والخريطة ظاهرة ← تنتقل الخريطة مباشرة. الرجوع (رابط «الصفحة الرئيسية» والخريطة
 *   ظاهرة) ← يعود القسم العلوي والكرة وتُمسح أدوات الخريطة وتتوقف الملاحة.
 * - زر التحديث في الشريط: الخادم يعيد بناء فهرسه، ثم مزامنة (أو تحميل كامل بلا نسخة) — للعضو فقط.
 * V2: كل جزء في مكوّنه المختبر؛ الخريطة في حاوية خاصة تحت البطاقة؛ حفظ الإضافة/التعديل يحدّث البطاقة والعلامة والنسخة
 *   (إصلاح بند V1 رقم 3)؛ حذف المدير يعيد للبحث؛ الإحصاءات تتحدث بعد أي حفظ أو حذف.
 *
 * The home page: links the approved components in V1's flow (no business logic here). V2: each part in its tested
 * component; the map in its own container under the card; a save updates the card, marker and copy (V1 bug 3).
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document, S = global.SecSession, SYNC = global.SecStationsSync;
  const $ = function (id) { return doc.getElementById(id); };
  const INTRO_FADE_MS = 480, MORPH_SETTLE_MS = 200, OUTAGE_AFTER_MS = 650;
  const loggedIn = function () { return S.isLoggedIn(); };

  SecTiming.recordPageOpen();
  doc.body.classList.toggle('guest-mode', !loggedIn());

  // ===== الرأس وشريط الحالة — The header and status bar =====
  const header = SecAppHeader.mount($('appHeader'), {
    page: 'index', title: 'الشركة السعودية للطاقة', subtitle: 'نظام الإحداثيات الجغرافية',
    refreshTitle: 'تحديث بيانات المحطات — لو لاحظت نتائج بحث غير محدّثة'
  });
  const status = SecConnStatus.mount(header.status, {
    hasLocalData: function () { return SYNC.state().loaded; },
    lastUpdateAt: function () { return SYNC.state().syncedAt; }
  });
  function syncHeaderHeight() { doc.documentElement.style.setProperty('--header-h', $('appHeader').getBoundingClientRect().height + 'px'); }
  syncHeaderHeight();
  if (global.ResizeObserver) new global.ResizeObserver(function () { syncHeaderHeight(); layout(); }).observe($('appHeader'));
  global.addEventListener('resize', function () { syncHeaderHeight(); layout(); alignHeroBelowGlobe(); });

  // ===== الكرة والشاشة الافتتاحية — The globe and the intro =====
  const globe = SecGlobe.mount($('globeStage'), {
    onIntroDone: function () {
      const o = $('introOverlay');
      o.classList.add('fade-out');
      global.setTimeout(function () { o.classList.add('hidden-done'); }, INTRO_FADE_MS);
    }
  });
  /* البحث تحت الكرة الظاهرة (V1) — the search under the visible globe (V1) */
  function alignHeroBelowGlobe() {
    const heading = doc.querySelector('.hero-heading'), stage = $('globeStage');
    if (!heading || $('heroSection').classList.contains('map-active')) return;
    const r = stage.getBoundingClientRect(), gap = Math.max(0, r.top + r.height * 0.88 - heading.getBoundingClientRect().bottom);
    doc.querySelectorAll('.globe-bottom-anchor').forEach(function (el) { el.style.marginTop = (gap + (el.classList.contains('guest-login-cta') ? 46 : 2)) + 'px'; });
  }
  global.addEventListener('load', alignHeroBelowGlobe);
  global.setTimeout(alignHeroBelowGlobe, 400);
  global.setTimeout(alignHeroBelowGlobe, 1200);

  // ===== خريطة جدة بدون إنترنت — The offline Jeddah map =====
  let view = null;
  if (global.SecOfflineMapUI && global.SecOfflineMap) {
    SecOfflineMapUI.init({
      isUsingOffline: function () { return !!(view && view.usingOffline()); },
      onReadyChange: function () { if (view) view.refresh(); },
      hint: function (text) { if (view) view.hint(text); }
    });
  }

  // ===== الخريطة (تُنشأ أول مرة فقط) — The map (created the first time only) =====
  // مكتبة الخريطة قد تتعذّر (لم تُحفظ والجهاز بلا اتصال): تظهر البطاقة بكل بياناتها مع رسالة واضحة بدل الخريطة
  // The map library may be unavailable (not stored, device offline): the card shows all its data with a clear message instead
  const MAP_MISSING = 'تعذّر تحميل الخريطة — بيانات المحطة متاحة، ويمكن فتح الموقع في قوقل ماب';
  const NAV_NEEDS_MAP = 'الملاحة تحتاج الخريطة — افتح الموقع في قوقل ماب';
  let card = null, nearby = null, outageMap = null, tools = null, current = null, noteTimer = 0;
  /* تنبيه قصير: على الخريطة إن وُجدت، وإلا في سطر الحالة — a short notice: on the map if any, else in the status line */
  function notify_(text) {
    if (view) { view.toast(text); return; }
    status.setNote(text);
    global.clearTimeout(noteTimer);
    noteTimer = global.setTimeout(function () { status.clearNote(); }, 4000);
  }
  function showMapMissing_() {
    if ($('mapStage').querySelector('.map-unavailable')) return;
    $('mapStage').insertAdjacentHTML('beforeend', '<div class="map-unavailable" role="status">🗺️ ' + MAP_MISSING + '</div>');
  }
  function layout() {
    if (!view || !$('heroSection').classList.contains('map-active') || doc.body.classList.contains('nav-full')) return;
    const box = $('mapStage').querySelector('#map-container');
    const top = box.getBoundingClientRect().top + global.scrollY;
    box.style.height = Math.max(320, global.innerHeight - top - 16) + 'px'; // كل ما تبقى من الشاشة (V1) / the rest of the screen (V1)
    global.requestAnimationFrame(function () { view.map.invalidateSize(); });
  }
  function ensureMap_() {
    if (view) return view;
    if (!global.L) { showMapMissing_(); return null; }
    view = SecMapView.mount($('mapStage'), {});
    nearby = SecNearbyLayer.mount(view, {
      getStation: function () { return current; },
      query: function (mode) { return mode === 'nearby' ? card.nearby() : card.feeder(); },
      googleMapsUrl: SecStationCard.googleMapsUrl,
      onShare: function (s) { goToStation(s); },
      onEdit: function (s) { goToStation(s); global.setTimeout(function () { SecStationForm.openEdit(s); }, MORPH_SETTLE_MS); }
    });
    const blocked = function () { return SecNavView.isActive(); };
    outageMap = SecOutageSearch.mountMap(view, { onStart: function () { tools.stop(); nearby.reset(); }, isBlocked: blocked });
    tools = SecMapTools.mount(view, { onStart: function () { outageMap.clear(); nearby.reset(); }, isBlocked: blocked });
    SecNavView.init({
      getMap: function () { return view.map; }, stage: $('mapStage'), topArea: $('topContentArea'),
      relayout: layout, hint: view.hint, hideHint: view.hideHint, googleMapsUrl: SecStationCard.googleMapsUrl,
      fractionalZoom: function () { return view.usingOffline(); }
    });
    // البطاقة أو شريط الأدوات يغيّر ارتفاعه ← الخريطة تأخذ ما تبقى (V1) / the card or toolbar resizes ← the map takes the rest (V1)
    if (global.ResizeObserver) {
      const ro = new global.ResizeObserver(function () { global.requestAnimationFrame(layout); });
      ro.observe($('topContentArea')); ro.observe($('mapStage').querySelector('.map-toolbar-bar'));
    }
    return view;
  }

  // ===== البطاقة — The card =====
  function cardDeps_() {
    return {
      onNavigate: function (s) { if (!view) { notify_(NAV_NEEDS_MAP); return false; } return SecNavView.start(s); },
      onEdit: function (s) { SecStationForm.openEdit(s); },
      canEdit: loggedIn,
      isAdmin: function () { return S.isAdmin(); },
      onDelete: function (s) { SecDeleteStation.open(s, { toast: notify_, onDeleted: function () { goBackToSearch(); stats.refresh(true); } }); },
      offlineMapUI: global.SecOfflineMapUI || null,
      toast: notify_,
      dataFreshness: function () { return SYNC.state().syncedAt; },
      localStations: function () { return SYNC.stations(); }
    };
  }
  function showCard_(s) {
    if (card) card.update(s);
    else card = SecStationCard.render($('stationTable'), s, cardDeps_());
  }

  // ===== الانتقال لمحطة والرجوع — Going to a station and back =====
  /* يُرجع وعدًا يتم حين تظهر المحطة على الخريطة — returns a promise settled once the station shows on the map */
  function goToStation(s) {
    if (!s) return Promise.resolve(false);
    if (SecNavView.isActive()) SecNavView.stop(); // محطة أخرى تنهي الملاحة السابقة (V1) / another station ends navigation (V1)
    current = s;
    SecRecentStations.add(s);
    const hero = $('heroSection'), wasMap = hero.classList.contains('map-active');
    $('heroContent').classList.add('hidden');
    $('cardsSection').classList.add('hidden');
    lens.clear();
    if (wasMap) { showStation_(s); return Promise.resolve(true); }
    const lat = Number(s.lat), lng = Number(s.lng);
    return (isFinite(lat) && isFinite(lng) ? globe.turnTo(lat, lng) : Promise.resolve()).then(function () {
      if (current !== s) return false;
      ensureMap_();
      globe.pause();
      hero.classList.add('map-active');
      showStation_(s);
      if (view) global.setTimeout(function () { layout(); view.map.invalidateSize(); }, MORPH_SETTLE_MS);
      return true;
    });
  }
  function showStation_(s) {
    if (!view) { showCard_(s); return; } // بلا خريطة: البطاقة وحدها مع الرسالة / no map: the card alone with the message
    tools.stop(); outageMap.clear(); nearby.reset(); view.hideHint();
    showCard_(s);
    view.showStation(s);
    global.setTimeout(layout, 50);
  }
  function goBackToSearch() {
    if (SecNavView.isActive()) SecNavView.stop();
    if (SecStationForm.isOpen()) SecStationForm.close();
    const hero = $('heroSection');
    if (!hero.classList.contains('map-active')) return;
    current = null;
    if (view) { tools.stop(); outageMap.clear(); nearby.reset(); view.hideHint(); view.clearStation(); }
    if (card) { card.destroy(); card = null; }
    bar.clear();
    hero.classList.remove('map-active');
    $('heroContent').classList.remove('hidden');
    $('cardsSection').classList.remove('hidden');
    globe.reset();
    global.setTimeout(alignHeroBelowGlobe, 50);
    global.scrollTo(0, 0);
  }
  // «الصفحة الرئيسية» من القائمة والخريطة ظاهرة ← رجوع بلا إعادة تحميل (V1) / «home» from the menu while the map shows ← back, no reload (V1)
  $('appHeader').addEventListener('click', function (e) {
    const link = e.target.closest('a[data-page="index"]');
    if (link && $('heroSection').classList.contains('map-active')) { e.preventDefault(); header.closeMenu(); goBackToSearch(); }
  });

  // ===== البحث — Search =====
  function onUpdated_(s) { // إحداثيات تغيّرت بعد التحقق بالخلفية — coordinates changed after the background check
    if (!current || String(current.id).toUpperCase() !== String(s.id).toUpperCase() || current.type !== s.type) return;
    current = Object.assign({}, current, s);
    showCard_(current);
    if (view) { view.showStation(current); view.toast('تم تحديث إحداثيات المحطة'); }
    if (SecNavView.isActive()) SecNavView.updateTarget(current);
  }
  const lens = SecStationSearchBox.mount($('lensBox'), { variant: 'lens', isLoggedIn: loggedIn, onFound: goToStation, onAdd: function (q) { SecStationForm.openAdd(q); }, onUpdated: onUpdated_ });
  const bar = SecStationSearchBox.mount($('barBox'), { variant: 'bar', isLoggedIn: loggedIn, onFound: goToStation, onAdd: function (q) { SecStationForm.openAdd(q); }, onUpdated: onUpdated_ });
  SecOutageSearch.mountHome($('homeOutage'), {
    isLoggedIn: loggedIn,
    onResult: function (found, notFound) {
      // بعد ظهور الخريطة على أول محطة تُرسم كلها بالأحرف (V1) / once the map shows the first station, all are drawn with letters (V1)
      goToStation(found[0]).then(function (shown) {
        if (shown && outageMap && (found.length > 1 || notFound.length)) global.setTimeout(function () { if (current === found[0]) outageMap.render(found, notFound); }, OUTAGE_AFTER_MS);
      });
    }
  });

  // ===== الإضافة والتعديل — Add and edit =====
  SecStationForm.init({
    isLoggedIn: loggedIn,
    onSaved: function (s, mode) {
      SYNC.upsert(s).catch(function () { /* تتزامن لاحقًا / syncs later */ });
      if (mode === 'edit' && current && String(current.id).toUpperCase() === String(s.id).toUpperCase() && current.type === s.type) {
        current = Object.assign({}, current, s); // يحدّث المغذي والمنطقة والإحداثيات في البطاقة المفتوحة (إصلاح بند V1 رقم 3)
        showCard_(current); if (view) view.showStation(current);
        if (SecNavView.isActive()) SecNavView.updateTarget(current);
      }
      stats.refresh(true);
    }
  });

  // ===== البطاقات السفلية — The lower cards =====
  // الإحصاءات للعضو فقط (الزائر لا يرى البطاقات ولا يُرسل طلبًا) / stats for members only (a guest sends no request)
  const stats = loggedIn() ? SecStatsCards.mount($('statsSlot')) : { refresh: function () { return Promise.resolve(false); }, refreshIfStale: function () {} };
  const recent = SecRecentStations.mount($('recentSlot'), { onSelect: goToStation });
  SecStorageSection.mount($('storageSlot'), { onCleared: function () { status.refreshOffline(); } });
  $('addStationToggle').addEventListener('click', function () { recent.toggle(false); SecStationForm.openAdd(); });
  $('recentToggleBtn').addEventListener('click', function () { recent.toggle(); });
  $('refreshStatsBtn').addEventListener('click', async function () {
    const b = this;
    if (b.disabled) return;
    b.disabled = true; b.classList.add('spinning');
    try { await stats.refresh(true); } finally { global.setTimeout(function () { b.classList.remove('spinning'); b.disabled = false; }, 600); }
  });
  global.addEventListener('focus', function () { if (loggedIn()) stats.refreshIfStale(); });
  doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'visible' && loggedIn()) stats.refreshIfStale(); });

  // ===== بوابة اكتمال الملف — The profile gate =====
  const gate = SecProfileGate.mount(doc.body, { onOpenMenu: function () { header.openMenu(); } });

  // ===== نسخة المحطات — The stations copy =====
  function progress_(loaded, total) { status.setNote('جاري تحميل بيانات المحطات: ' + loaded + (total ? '/' + total : '')); }
  function afterLoad_() {
    const st = SYNC.state();
    if (!st.loaded && st.resumable) { // توقف ولو عند أول دفعة ← «اضغط للمتابعة» (V1) / stopped, even at the first batch ← «tap to continue» (V1)
      status.setNote(SYNC.MSG.STOPPED(st.resumable.loaded, st.resumable.total), function () { SYNC.fullLoad({ onProgress: progress_ }).then(afterLoad_, afterLoad_); });
    } else {
      status.clearNote();
      status.refreshOffline();
    }
  }
  header.refreshButton.addEventListener('click', async function () {
    if (!loggedIn()) { status.setNote('سجّل دخول أولًا لاستخدام تحديث البيانات'); global.setTimeout(function () { status.clearNote(); }, 4000); return; }
    if (SYNC.state().loading || header.refreshButton.disabled) return; // تحميل جارٍ ← لا شيء (V1) / a load is running ← nothing (V1)
    header.refreshButton.disabled = true; header.refreshButton.classList.add('spinning');
    try {
      try { await SecApi.call('clearSearchCache', {}, { phone: true }); } catch (e) { /* المزامنة تكمل / the sync goes on */ }
      if (SYNC.state().loaded) await SYNC.sync(); else await SYNC.fullLoad({ onProgress: progress_ });
    } catch (e) { /* يظهر بالحالة / shown by the state */ }
    finally { header.refreshButton.disabled = false; header.refreshButton.classList.remove('spinning'); afterLoad_(); }
  });

  if (loggedIn()) {
    SYNC.start({ onProgress: progress_ }).then(afterLoad_, afterLoad_);
    S.ensureFresh().then(function (ok) { if (ok) gate.check(); });
  }

  // للاختبار والتكامل: الحالة الحالية فقط — for tests: the current state only
  global.SecHome = {
    goToStation: goToStation, goBackToSearch: goBackToSearch,
    state: function () { return { map: !!view && $('heroSection').classList.contains('map-active'), station: current, card: !!card }; },
    parts: function () { return { view: view, globe: globe, lens: lens, bar: bar, stats: stats, recent: recent, gate: gate, status: status, header: header }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
