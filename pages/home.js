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
 * إعادة التصميم (19 أكتوبر): بلا كرة؛ ثلاث شاشات (الرئيسية، الخريطة، المحطات) يبدّل بينها الشريط السفلي (setView) بلا إعادة
 *   تحميل — الخريطة تُنشأ مرة وتبقى، والملاحة الجارية لا تتأثر بالتنقل. وُجدت محطة ← شاشة الخريطة مباشرة.
 * 20 أكتوبر (طلب محمد): تبويب «الرئيسية» يفتح الخريطة بكامل الصفحة (الشاشة الافتراضية)، وشاشة الأرقام والإجراءات (view
 *   'home') صار تبويبها «البيانات». عند الدخول تطلب شاشة «تحديد موقعك» الموقع قبل ظهور البحث (مع «متابعة بدون موقع»)، فتتوسط
 *   الخريطة موقعه بنقطة زرقاء؛ وزر «موقعي» يعيد القراءة. وجد محطة ← البطاقة، و«المسار» (أو زر الملاحة في العمود) ← الملاحة.
 *
 * The home page: links the approved components in V1's flow (no business logic here). V2: each part in its tested
 * component; the map in its own container under the card; a save updates the card, marker and copy (V1 bug 3).
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document, S = global.SecSession, SYNC = global.SecStationsSync;
  const $ = function (id) { return doc.getElementById(id); };
  const MORPH_SETTLE_MS = 200, OUTAGE_AFTER_MS = 650;
  const MAP_GAP = 12; // هامش المساحة المرئية تحت ما يعلو الخريطة وفوق البطاقة / the visible area's margin under the top items and above the card
  const ME_ZOOM = 16; // تكبير الخريطة على موقع المستخدم / the map zoom on the user's location
  let myPos = null; // آخر موقع للمستخدم { lat, lng, accuracy } / the user's last location
  const SYNC_NOTE_MS = 6000; // مدة رسالة «تم تحديث بيانات المحطات» / how long the «stations updated» note stays
  const loggedIn = function () { return S.isLoggedIn(); };

  SecTiming.recordPageOpen();
  doc.body.classList.toggle('guest-mode', !loggedIn());

  // ===== الرأس وشريط الحالة — The header and status bar =====
  const header = SecAppHeader.mount($('appHeader'), {
    page: 'index', title: 'إحداثيات المحطات', subtitle: 'الشركة السعودية للطاقة',
    refreshTitle: 'تحديث بيانات المحطات — لو لاحظت نتائج بحث غير محدّثة',
    // هوية العضو في الرأس، وعناصر القائمة كلها في «المزيد» (طلب محمد) — the identity in the header, the menu items in «More»
    identity: true, onIdentity: function () { if (nav) { setView('more'); more.render(); } }
  });
  const status = SecConnStatus.mount(header.status, {
    hasLocalData: function () { return SYNC.state().loaded; },
    lastUpdateAt: function () { return SYNC.state().syncedAt; }
  });
  // التاريخ (ميلادي + هجري) في أعلى الرئيسية بدل سطر الحالة، فيبقى الرأس سطرًا واحدًا مدمجًا (ملاحظة محمد)
  // The date (Gregorian + Hijri) at the top of home instead of the status line, keeping the header one compact line
  if (header.status.dateLine) $('homeDate').appendChild(header.status.dateLine);
  function syncHeaderHeight() { doc.documentElement.style.setProperty('--header-h', $('appHeader').getBoundingClientRect().height + 'px'); }
  syncHeaderHeight();
  if (global.ResizeObserver) new global.ResizeObserver(function () { syncHeaderHeight(); layout(); }).observe($('appHeader'));
  global.addEventListener('resize', function () { syncHeaderHeight(); layout(); });

  // ===== صفحة الزائر: الكرة وتحتها «تسجيل الدخول» (طلب محمد 19 أكتوبر) — The guest page: the globe, «login» below =====
  // مكتبة الكرة تُحمَّل للزائر وحده فلا تُبطئ الرئيسية على الأعضاء؛ تعذّرها ← الكرة تختفي ويبقى الزر (حالة globe.js البديلة)
  // The globe library loads for guests only, never slowing members' home; if it fails ← no globe, the button stays
  function loadThree_() {
    return new Promise(function (resolve) {
      if (global.THREE) { resolve(); return; }
      const s = doc.createElement('script');
      s.src = global.SEC2_CONFIG.LIBRARIES.THREE_JS; s.onload = s.onerror = function () { resolve(); };
      doc.head.appendChild(s);
    });
  }
  /* الزر تحت الكرة كاملة (طلب محمد): من حدها السفلي الفعلي بعد الرسم — the button under the whole globe, from its real bottom edge */
  const CTA_GAP = 18;
  function alignGuestCta_() {
    const stage = $('globeStage'), cta = doc.querySelector('.guest-landing .guest-login-cta');
    if (!stage || !cta || $('guestLanding').hidden) return;
    const bottom = stage.getBoundingClientRect().bottom, cur = parseFloat(cta.style.marginTop) || 0;
    const delta = bottom + CTA_GAP - cta.getBoundingClientRect().top;
    cta.style.marginTop = Math.max(0, Math.round(cur + delta)) + 'px';
  }
  if (!loggedIn()) {
    $('guestLanding').hidden = false;
    loadThree_().then(function () {
      SecGlobe.mount($('globeStage'), { onIntroDone: function () { /* بلا شاشة افتتاحية / no intro */ } });
      alignGuestCta_(); global.setTimeout(alignGuestCta_, 300); global.setTimeout(alignGuestCta_, 1200);
    });
    global.addEventListener('resize', alignGuestCta_);
  }

  // ===== الشاشات والشريط السفلي (إعادة التصميم) — The screens and the bottom bar (redesign) =====
  const VIEWS = ['home', 'map', 'stations', 'details', 'more', 'storage'];
  // الخريطة تحت تبويب «الرئيسية»، وشاشة الأرقام (home) تحت «البيانات»، والشاشات الفرعية تُبقي تبويب أصلها
  // The map is under «home», the numbers screen (home) under «data», and sub-screens keep their parent's tab
  const TAB_OF = { map: 'home', details: 'home', home: 'data', storage: 'more' };
  let nav = null;
  /* يعرض شاشة واحدة؛ الخريطة تُنشأ عند أول فتح لشاشتها وتبقى — shows one screen; the map is created on first open and kept */
  function setView(name) {
    if (VIEWS.indexOf(name) === -1) return;
    doc.body.dataset.view = name;
    $('heroSection').classList.toggle('map-active', name === 'map');
    if (nav) nav.setActive(TAB_OF[name] || name);
    if (name === 'map') {
      ensureMap_();
      global.setTimeout(function () { layout(); if (view) view.map.invalidateSize(); }, 30);
    }
    global.scrollTo(0, 0);
  }

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
    // الخريطة بكامل الصفحة (طلب محمد 20 أكتوبر): البحث والأدوات عائمة فوقها والبطاقة عائمة أسفلها. يُقاس ما يغطي الخريطة
    // من أعلى (آخر عنصر عائم في الأعلى) ومن أسفل (البطاقة)، فيتوسط كل شيء في المساحة المرئية وتصعد أزرار التكبير فوق البطاقة.
    // The full-page map: the search and tools float above it, the card below. What covers it from the top (the last floating
    // element up there) and the bottom (the card) is measured, so centering uses the visible area and zoom sits above the card.
    const hero = $('heroSection'), hr = hero.getBoundingClientRect(), stage = $('mapStage');
    stage.querySelector('#map-container').style.height = '';
    const sheetEl = $('stationTable'), sheet = sheetEl.classList.contains('show') ? Math.max(0, hr.bottom - sheetEl.getBoundingClientRect().top) : 0;
    hero.style.setProperty('--search-h', Math.round($('topContentArea').offsetHeight) + 'px');
    hero.style.setProperty('--sheet-h', Math.round(sheet) + 'px');
    // أدوات الخريطة العائمة تقيسها الخريطة بنفسها لحظة التوسيط — the map measures its own floating tools when centering
    const searchBottom = $('topContentArea').getBoundingClientRect().bottom - hr.top;
    view.setInsets(searchBottom + MAP_GAP, sheet ? sheet + MAP_GAP : 0);
    view.fitSide(searchBottom + 10, sheet + 10); // العمود بين البحث (أو الأدوات) والبطاقة / the column between the search (or tools) and the card
    global.requestAnimationFrame(function () { view.map.invalidateSize(); view.recenter(); }); // المحطة تبقى في المنتصف المرئي / the station stays mid visible
  }
  function ensureMap_() {
    if (view) return view;
    if (!global.L) { showMapMissing_(); return null; }
    view = SecMapView.mount($('mapStage'), {
      onNavigate: function () { if (current) SecNavView.start(current); }, // الملاحة المباشرة من العمود / direct navigation from the column
      onLocate: locateMe_,
      onOverlayChange: function () { global.requestAnimationFrame(layout); }
    });
    if (myPos) view.showMe(myPos);
    // أسماء أحياء جدة الحقيقية من نسخة المحطات، وتتحدث حين يتغير عدد المحطات — the real district names from the copy
    const districts = SecDistrictLabels.mount(view, {
      stations: function () { return SYNC.state().loaded ? SYNC.stations() : null; },
      avoid: function () { return current && SecStationQuery.hasCoordinates(current) ? [Number(current.lat), Number(current.lng)] : null; }
    });
    let districtsN = -1;
    SYNC.onChange(function () { const st = SYNC.state(), n = st.loaded ? SYNC.stations().length : 0; if (st.loaded && n !== districtsN) { districtsN = n; districts.refresh(); } });
    nearby = SecNearbyLayer.mount(view, {
      getStation: function () { return current; },
      query: function (mode) { return mode === 'nearby' ? card.nearby() : card.feeder(); },
      googleMapsUrl: SecStationCard.googleMapsUrl,
      onShare: function (s) { goToStation(s); },
      // استكشاف القريبة/المغذي ← بطاقة مختصرة بسطر واحد (العدد والمسار وإنهاء العرض) — exploring ← a one-line compact card
      onChange: function (mode, count) {
        if (!card) return;
        // اسم المرشح مع العدد (مراجعة 20 أكتوبر) — the filter's name with the count
        card.setExplore(mode ? (mode === 'feeder' ? 'المغذي ' + String((current && current.feeder) || '').trim() + ' — ' + count + ' محطة' : 'قريب 5 كم — ' + count + ' محطة') : null);
        global.requestAnimationFrame(layout);
      },
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
      ro.observe($('topContentArea')); ro.observe($('mapStage').querySelector('.map-toolbar-bar')); ro.observe($('stationTable'));
      // لوحات الأدوات والتلميح تطفو فوق الخريطة: ظهورها يعيد حدود العمود والتوسيط — the tool panels and hint float over the map
      $('mapStage').querySelectorAll('.map-mode-panel, .map-tool-hint, .map-panels > *').forEach(function (el) { ro.observe(el); });
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
      localStations: function () { return SYNC.stations(); },
      // «محطات المغذي» في اللوحة ← نفس زر «مغذي» في شريط الخريطة — the sheet's feeder card ← the toolbar's feeder button
      onFeeder: function () { const b = $('mapStage').querySelector('[data-nearby="feeder"]'); if (b) b.click(); },
      onDetails: function (s) { openDetails_(s); },
      onEndExplore: function () { if (nearby) nearby.reset(); }
    };
  }
  function showCard_(s) {
    if (card) card.update(s);
    else card = SecStationCard.render($('stationTable'), s, cardDeps_());
  }

  // ===== الانتقال لمحطة والرجوع — Going to a station and back =====
  /* يُرجع وعدًا يتم حين تظهر المحطة على الخريطة — returns a promise settled once the station shows on the map */
  // ===== وضع البحث (اقتراح محمد 20 أكتوبر): لمس مربع البحث أو فتح محطة ← يختفي الشريطان العلوي والسفلي وتتمدد الخريطة ويرتفع
  // البحث؛ زر × (أو رجوع الجوال) يعيد الوضع العادي فورًا ويمسح المحطة المحددة. الملاحة تبقى بشاشتها الكاملة كما هي.
  // Search mode: touching the search box or opening a station ← both bars hide, the map expands and the search rises;
  // × (or the phone's back) restores normal mode at once and clears the chosen station. Navigation keeps its full screen.
  function inSearchMode_() { return doc.body.classList.contains('search-mode'); }
  function enterSearchMode_() {
    if (inSearchMode_() || !loggedIn()) return;
    doc.body.classList.add('search-mode');
    try { global.history.pushState({ secView: 'search' }, ''); } catch (e) { /* بلا سجل تنقل / no history */ }
    global.requestAnimationFrame(layout); global.setTimeout(layout, 250);
  }
  function leaveSearchMode_() {
    if (!inSearchMode_()) return;
    doc.body.classList.remove('search-mode');
    goBackToSearch(); // تُمسح المحطة والأدوات وتعود الخريطة لموقعه — the station and tools clear, the map returns to his location
    global.requestAnimationFrame(layout); global.setTimeout(layout, 250);
  }
  function closeSearchMode_() {
    leaveSearchMode_();
    if (global.history.state && global.history.state.secView === 'search') global.history.back(); // يُزيل خطوة السجل فقط / only drops the history step
  }
  global.addEventListener('popstate', function () {
    const st = global.history.state;
    if (inSearchMode_() && doc.body.dataset.view === 'map' && !(st && (st.secView === 'search' || st.secView === 'details'))) leaveSearchMode_();
  });

  function goToStation(s) {
    if (!s) return Promise.resolve(false);
    if (SecNavView.isActive()) SecNavView.stop(); // محطة أخرى تنهي الملاحة السابقة (V1) / another station ends navigation (V1)
    current = s;
    SecRecentStations.add(s);
    lens.clear();
    if (doc.body.dataset.view !== 'map') setView('map');
    enterSearchMode_(); // فتح محطة من أي مكان يدخل وضع البحث / opening a station from anywhere enters search mode
    showStation_(s);
    if (view) global.setTimeout(function () { layout(); view.map.invalidateSize(); }, MORPH_SETTLE_MS);
    return Promise.resolve(true);
  }
  function showStation_(s) {
    if (!view) { showCard_(s); return; } // بلا خريطة: البطاقة وحدها مع الرسالة / no map: the card alone with the message
    tools.stop(); outageMap.clear(); nearby.reset(); view.hideHint();
    showCard_(s);
    layout();
    view.setNavTarget(true);
    view.showStation(s);
    global.setTimeout(layout, 50);
  }
  function goBackToSearch() {
    if (SecNavView.isActive()) SecNavView.stop();
    if (SecStationForm.isOpen()) SecStationForm.close();
    if (!current && doc.body.dataset.view === 'map') return;
    current = null;
    if (view) { tools.stop(); outageMap.clear(); nearby.reset(); view.hideHint(); view.clearStation(); view.setNavTarget(false); }
    if (card) { card.destroy(); card = null; }
    $('heroSection').classList.remove('station-framed');
    bar.clear();
    doc.body.classList.remove('search-mode'); // أي رجوع للبحث يُنهي وضع البحث / any return to search ends search mode
    setView('map'); // البحث على الخريطة (الرئيسية) / the search is on the map (home)
    // الخريطة تعود لموقعه إن طلبه، وإلا لجدة كلها — the map returns to his location if he asked for it, else to all of Jeddah
    if (view) { if (myPos) view.centerOn([myPos.lat, myPos.lng], ME_ZOOM); else view.overview(); }
  }
  // «الصفحة الرئيسية» من القائمة والخريطة ظاهرة ← رجوع بلا إعادة تحميل (V1) / «home» from the menu while the map shows ← back, no reload (V1)
  $('appHeader').addEventListener('click', function (e) {
    const link = e.target.closest('a[data-page="index"]');
    if (link && doc.body.dataset.view !== 'home') { e.preventDefault(); header.closeMenu(); goBackToSearch(); }
  });

  // ===== البحث — Search =====
  function onUpdated_(s) { // إحداثيات تغيّرت بعد التحقق بالخلفية — coordinates changed after the background check
    if (!current || String(current.id).toUpperCase() !== String(s.id).toUpperCase() || current.type !== s.type) return;
    current = Object.assign({}, current, s);
    showCard_(current);
    if (view) { view.showStation(current); view.toast('تم تحديث إحداثيات المحطة'); }
    if (SecNavView.isActive()) SecNavView.updateTarget(current);
  }
  // حقل ظاهر دائمًا بدل العدسة الدائرية (ملاحظة محمد 19 أكتوبر) — an always-visible field instead of the round lens
  const lens = SecStationSearchBox.mount($('lensBox'), { variant: 'bar', placeholder: 'اكتب رقم المحطة أو رمزها', isLoggedIn: loggedIn, onFound: goToStation, onAdd: function (q) { SecStationForm.openAdd(q); }, onUpdated: onUpdated_ });
  const bar = SecStationSearchBox.mount($('barBox'), { variant: 'bar', isLoggedIn: loggedIn, onFound: goToStation, onAdd: function (q) { SecStationForm.openAdd(q); }, onUpdated: onUpdated_,
    onFocus: function () { enterSearchMode_(); }, onClose: function () { closeSearchMode_(); },
    onStatus: function () { statusOpen = !statusOpen; paintSync_(); }, // نقطة الحالة / the status dot
    onTools: function () { return view ? view.toggleTools() : false; } }); // أدوات الخريطة من مربع البحث (النموذج) / the map tools from the search box
  // بطاقة «بحث عن حالة عطل» في صف الإجراءات تفتح لوحة الأرقام تحته (تصميم محمد، 15 أكتوبر) / the outage tile opens the panel below it
  const outage = SecOutageSearch.mountHome($('homeOutage'), {
    toggle: $('outageTileBtn'),
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
  // لوحة واحدة مفتوحة في كل مرة: الأعطال أو آخر المحطات / one panel open at a time: outage or recent
  $('recentToggleBtn').addEventListener('click', function () { outage.toggle(false); $('recentToggleBtn').setAttribute('aria-expanded', recent.toggle() ? 'true' : 'false'); });
  $('outageTileBtn').addEventListener('click', function () { $('recentToggleBtn').setAttribute('aria-expanded', 'false'); });
  $('outageTileBtn').addEventListener('click', function () { recent.toggle(false); });
  // زر «تحديث» في البطاقات يحدّث أرقام لوحة المعلومات فقط، ويشرح ذلك برسالة (طلب محمد، 15 أكتوبر) — بخلاف زر الشريط العلوي الذي يزامن بيانات المحطات
  // The tiles' «refresh» updates the dashboard numbers only, and says so (Mohammed, 15 Oct) — unlike the header button, which syncs the stations
  const REFRESH_NOTE = {
    BUSY: 'جارٍ تحديث أرقام لوحة المعلومات…',
    OK: '✓ تم تحديث أرقام لوحة المعلومات: إجمالي المحطات، وإضافات اليوم وتعديلاته. هذا الزر لا يحدّث بيانات المحطات — لها زر التحديث في الشريط العلوي.',
    FAIL: 'تعذّر تحديث أرقام لوحة المعلومات الآن — تبقى الأرقام السابقة، حاول بعد قليل. (بيانات المحطات تُحدَّث من زر الشريط العلوي)'
  };
  const REFRESH_NOTE_MS = 7000;
  let refreshNoteTimer = 0;
  function refreshNote_(text, kind) {
    const n = $('refreshNote');
    global.clearTimeout(refreshNoteTimer);
    n.textContent = text; n.dataset.kind = kind; n.hidden = false;
    if (kind !== 'busy') refreshNoteTimer = global.setTimeout(function () { n.hidden = true; }, REFRESH_NOTE_MS);
  }
  $('refreshStatsBtn').addEventListener('click', async function () {
    const b = this;
    if (b.disabled) return;
    b.disabled = true; b.classList.add('spinning');
    refreshNote_(REFRESH_NOTE.BUSY, 'busy');
    let ok = false;
    try { ok = await stats.refresh(true); } catch (e) { ok = false; }
    finally { global.setTimeout(function () { b.classList.remove('spinning'); b.disabled = false; }, 600); }
    refreshNote_(ok ? REFRESH_NOTE.OK : REFRESH_NOTE.FAIL, ok ? 'ok' : 'fail');
  });
  global.addEventListener('focus', function () { if (loggedIn()) stats.refreshIfStale(); });
  doc.addEventListener('visibilitychange', function () {
    if (doc.visibilityState !== 'visible' || !loggedIn()) return;
    stats.refreshIfStale();
    // العودة للتطبيق ← تحقق بالخلفية من تعديلات الآخرين (لا طلب إن كانت النسخة مؤكدة خلال دقيقتين) — returning ← a background check for others' edits
    if (SYNC.state().loaded) SYNC.ensureFresh().catch(function () { /* لا شيء / nothing */ });
  });

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
  /* تحديث تلقائي جلب إضافات أو تعديلات من الزملاء ← رسالة قصيرة في شريط الحالة (طلب محمد 16 أكتوبر)
     An automatic update that brought colleagues' additions or edits ← a short note in the status bar */
  let syncNoteTimer = 0;
  SYNC.onChange(function (event, st, detail) {
    if (event !== 'synced' || !detail || !(detail.added + detail.modified + (detail.removed || 0))) return;
    const parts = [];
    if (detail.added) parts.push('إضافة ' + detail.added);
    if (detail.modified) parts.push('تعديل ' + detail.modified);
    if (detail.removed) parts.push('حذف ' + detail.removed);
    status.setNote('🔄 تم تحديث بيانات المحطات: ' + parts.join(' و') + ' من الزملاء');
    global.clearTimeout(syncNoteTimer);
    syncNoteTimer = global.setTimeout(function () { if (!SYNC.state().loading) status.clearNote(); }, SYNC_NOTE_MS);
  });

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

  // ===== لون حالة النسخة (طلب محمد 19 أكتوبر) — The copy's state color =====
  // شريط الحالة العلوي وبطاقة البيانات المؤقتة يأخذان لونًا واحدًا بالأولوية: أحمر انقطاع الإنترنت، أصفر تحميل جزئي توقف (وزر
  // التحميل يصير تحذيرًا)، رمادي بلا نسخة، برتقالي متقطع تحديث جديد لم يُحمَّل بعد (التلقائي بموعده، والزر يسرّعه)، أخضر مكتملة.
  // The status bar and the cached-data card share one color by priority: red offline, yellow a stopped partial load (the
  // load button becomes a warning), gray no copy, dashed orange a newer update not loaded yet, green complete.
  // النص يتغير مع اللون (طلب محمد): الأخضر يُبقي سطر الاتصال وآخر تحديث كما هو، وبقية الحالات نص يشرحها في الشريط نفسه
  // The text changes with the color: green keeps the connection/last-update line; every other state explains itself in the bar
  const D = global.SecDates, AUTO_MS = global.SEC2_CONFIG.TIMING.STATIONS_CONFIRM_MAX_AGE_MS; // التحديث التلقائي بمدة الثقة نفسها (دقيقتان)
  const SYNC_TEXT = {
    offlineCopy: function (at) { return 'لا يوجد اتصال بالإنترنت — آخر تحديث للنسخة: ' + (at ? D.relativeTime(at) : '—'); },
    offlineNone: 'لا توجد نسخة محطات على الجهاز ولا يوجد اتصال بالإنترنت',
    partial: function (r) { return 'توقف تحميل النسخة عند ' + r.loaded + (r.total ? '/' + r.total : '') + ' — اضغط ⚠ لإكمال التحميل'; },
    none: 'لم تُحمَّل نسخة المحطات على هذا الجهاز بعد',
    notStarted: 'تعذّر بدء تحميل نسخة المحطات — اضغط ⟳ للمحاولة',
    loading: function (l) { return 'جارٍ تحميل نسخة المحطات: ' + l.loaded + (l.total ? '/' + l.total : ''); },
    pending: function (sec) { return 'توجد نسخة جديدة — تحديث تلقائي بعد ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ' أو اضغط ⟳ الآن'; },
    pendingNow: 'توجد نسخة جديدة — جارٍ التحديث…',
    ready: 'نسخة المحطات مكتملة ومطابقة للخادم'
  };
  const SYNC_BTN = { partial: 'إكمال تحميل نسخة المحطات', pending: 'تحميل النسخة الجديدة الآن' };
  let pendingDueAt = 0, autoRunning = false;
  function syncState_() {
    const st = SYNC.state(), conn = status.state ? status.state() : '';
    if (global.navigator.onLine === false || conn === 'offline' || conn === 'saved') {
      return st.loaded ? { k: 'offline', t: SYNC_TEXT.offlineCopy(st.syncedAt || (st.lastSync ? new Date(st.lastSync) : null)) } : { k: 'offline', t: SYNC_TEXT.offlineNone };
    }
    // «قابل للاستكمال» لا يوجد إلا بعد التوقف (يُصفَّر عند بدء أي تحميل) — «resumable» exists only after a stop (reset when any load starts)
    if (!st.loaded && st.resumable && st.resumable.loaded > 0) return { k: 'partial', t: SYNC_TEXT.partial(st.resumable) };
    if (!st.loaded) return { k: 'none', t: st.resumable ? SYNC_TEXT.notStarted : st.loading ? SYNC_TEXT.loading(st.loading) : SYNC_TEXT.none };
    if (st.pending) {
      if (!pendingDueAt) pendingDueAt = Date.now() + AUTO_MS;
      const sec = Math.max(0, Math.ceil((pendingDueAt - Date.now()) / 1000));
      return { k: 'pending', t: autoRunning || sec === 0 ? SYNC_TEXT.pendingNow : SYNC_TEXT.pending(sec), due: sec === 0 };
    }
    pendingDueAt = 0;
    return { k: 'ready', t: SYNC_TEXT.ready };
  }
  /* التحديث التلقائي عند انتهاء العدّاد؛ تعذّر ← عدّاد جديد — the automatic update when the countdown ends; failed ← a new countdown */
  function autoSync_() {
    if (autoRunning) return;
    autoRunning = true;
    SYNC.sync().catch(function () { return null; }).then(function () { autoRunning = false; pendingDueAt = SYNC.state().pending ? Date.now() + AUTO_MS : 0; paintSync_(); });
  }
  let lastSyncKind = '';
  /* الرئيسية بلا شريط علوي (قرار محمد 20 أكتوبر): حالة النسخة نقطة ملوّنة في مربع البحث، والضغط عليها يُظهر بطاقة النص وزر
   * التحديث تحت البحث؛ وتظهر البطاقة وحدها حين لا تكون الحالة خضراء (انقطاع، توقف، نسخة جديدة) حتى لا تفوت المستخدم.
   * Home has no top bar: the copy status is a colored dot in the search box; tapping it shows the text and the refresh
   * button under the search; the card shows by itself whenever the status isn't green so the user never misses it. */
  let statusOpen = false;
  function paintMapStatus_(s) {
    const dot = doc.querySelector('#barBox [data-act="status"]'), card = $('mapStatus');
    if (!dot || !card) return;
    const st = SYNC.state(), ready = s.k === 'ready';
    dot.dataset.sync = s.k; dot.title = s.t;
    card.dataset.sync = s.k;
    card.querySelector('[data-role="map-status-text"]').textContent = ready ? s.t + (st.syncedAt ? ' — آخر تحديث: ' + D.relativeTime(st.syncedAt) : '') : s.t;
    const show = statusOpen || !ready;
    if (card.hidden === show) { card.hidden = !show; global.requestAnimationFrame(layout); }
    dot.setAttribute('aria-expanded', show ? 'true' : 'false');
  }
  function paintSync_() {
    const s = syncState_(), bar = header.status.bar, btn = header.refreshButton;
    paintMapStatus_(s);
    if (bar) {
      bar.dataset.sync = s.k; bar.title = s.t;
      let line = bar.querySelector('[data-role="sync-text"]');
      if (!line) { line = doc.createElement('span'); line.className = 'sync-text'; line.dataset.role = 'sync-text'; line.setAttribute('role', 'status'); bar.querySelector('.conn-status-pill').prepend(line); }
      line.textContent = s.k === 'ready' ? '' : s.t;
    }
    if (btn) { btn.dataset.sync = s.k; btn.setAttribute('aria-label', SYNC_BTN[s.k] || btn.title); }
    const box = doc.querySelector('.storage-screen'), line2 = $('storageSyncLine');
    if (box) box.dataset.sync = s.k;
    if (line2) line2.textContent = s.t;
    lastSyncKind = s.k;
    if (s.due) autoSync_();
  }
  if ($('mapStatus')) $('mapStatus').querySelector('[data-act="map-refresh"]').addEventListener('click', function () { if (header.refreshButton) header.refreshButton.click(); });
  if (loggedIn()) {
    SYNC.onChange(paintSync_);
    global.addEventListener('online', paintSync_); global.addEventListener('offline', paintSync_);
    global.setInterval(paintSync_, 1000); // العدّاد ثانية بثانية، وحالة الاتصال تُفحص من مكوّنها / the countdown per second
    paintSync_();
  }

  if (loggedIn()) {
    SYNC.start({ onProgress: progress_ }).then(afterLoad_, afterLoad_);
    S.ensureFresh().then(function (ok) { if (ok) gate.check(); });
  }

  // ===== تفاصيل المحطة (إعادة التصميم) — Station details (redesign) =====
  // تُفتح من لوحة المحطة؛ «رجوع» (أو زر الرجوع في الجوال) يعيد للخريطة على المحطة نفسها
  // Opened from the station sheet; «back» (or the phone's back button) returns to the map on the same station
  const details = SecStationDetails.mount($('detailsBox'), {
    onBack: function () { closeDetails_(); },
    onNavigate: function (s) { closeDetails_(); if (!view) { notify_(NAV_NEEDS_MAP); return; } SecNavView.start(s); },
    onEdit: function (s) { if (global.navigator.onLine === false) { notify_(SecStationCard.MSG.OFFLINE_WRITE); return; } SecStationForm.openEdit(s); },
    canEdit: loggedIn,
    onShowOnMap: function () { closeDetails_(); },
    onOpenStation: function (s) { closeDetails_(); goToStation(s); },
    googleMapsUrl: SecStationCard.googleMapsUrl, shareText: SecStationCard.shareText,
    localStations: function () { return SYNC.stations(); },
    dataFreshness: function () { return SYNC.state().syncedAt; }, // «آخر تحديث» لنسخة المحطات / the copy's last update
    toast: notify_
  });
  function openDetails_(s) {
    details.open(s);
    setView('details');
    try { global.history.pushState({ secView: 'details' }, ''); } catch (e) { /* بلا سجل تنقل / no history */ }
  }
  function closeDetails_() {
    if (doc.body.dataset.view !== 'details') return;
    setView('map'); // فورًا قبل أي إجراء بعدها (الملاحة تحتاج الخريطة ظاهرة) — at once, before any next action (navigation needs the map shown)
    if (global.history.state && global.history.state.secView === 'details') global.history.back(); // يُزيل خطوة السجل فقط / only drops the history step
  }
  global.addEventListener('popstate', function () { const v = doc.body.dataset.view; if (v === 'details') setView('map'); else if (v === 'storage') setView('more'); });

  // ===== «المزيد» والبيانات المؤقتة (المرحلة ز) — «More» and the cached data screen =====
  const more = SecMoreMenu.mount($('moreBox'), { onStorage: function () { openStorage_(); } });
  function openStorage_() {
    setView('storage');
    try { global.history.pushState({ secView: 'storage' }, ''); } catch (e) { /* بلا سجل تنقل / no history */ }
  }
  $('storageBack').addEventListener('click', function () {
    setView('more');
    if (global.history.state && global.history.state.secView === 'storage') global.history.back();
  });

  // ===== شاشة «المحطات»: القريبة من موقعي والتصفية (المرحلة و) — the stations screen: nearby and filters =====
  const stationsList = SecStationsList.mount($('stationsBox'), {
    localStations: function () { return SYNC.stations(); },
    onOpen: function (s) { goToStation(s); },
    onChange: function (fn) { return SYNC.onChange(fn); }
  });

  // ===== موقعي عند الطلب فقط (قرار محمد 20 أكتوبر): لا يُطلب الموقع عند الدخول؛ زر «موقعي» يقرأه ويتوسطه، والقريبة والملاحة
  // لهما قراءتهما — My location on request only: no location on entry; «my location» reads and centers it
  /* زر «موقعي»: قراءة جديدة وتوسيط عليها — «my location»: a fresh reading, centered */
  function locateMe_() {
    SecMyLocation.read().then(function (pos) {
      myPos = pos; view.showMe(pos); view.centerOn([pos.lat, pos.lng], Math.max(view.map.getZoom(), ME_ZOOM), true);
    }, function (e) {
      notify_(e.code === 'denied' ? 'صلاحية الموقع مرفوضة — فعّلها من إعدادات المتصفح' : e.code === 'nogeo' ? 'هذا الجهاز لا يدعم تحديد الموقع' : 'تعذّر تحديد موقعك الآن — حاول مرة أخرى');
    });
  }
  // ===== الشريط السفلي — The bottom bar =====
  nav = SecBottomNav.mount($('bottomNav'), {
    active: 'home',
    onSelect: function (name) {
      if (name === 'more') more.render(); // حالة التثبيت والجلسة الحالية / the current install and session state
      if (name === 'home') { setView('map'); return; } // «الرئيسية» = الخريطة (المحطة المختارة تبقى) / home = the map (the chosen station stays)
      if (name === 'data') { setView('home'); return; } // «البيانات» = الأرقام والإجراءات / data = the numbers and actions
      setView(name);
    },
    onAdd: function () { if (loggedIn()) SecStationForm.openAdd(); else global.location.href = 'auth.html'; }
  });

  // ===== الوصول من صفحة أخرى بالشريط السفلي: #map، #stations، #more، #add — arriving from another page through the bottom bar =====
  if (loggedIn()) {
    if (global.SecContactAdmin) SecContactAdmin.loadInfo();
    const want = String(global.location.hash || '').replace('#', '');
    if (want) {
      try { global.history.replaceState(null, '', global.location.pathname + global.location.search); } catch (e) { /* لا شيء / nothing */ }
      if (want === 'add') SecStationForm.openAdd();
      else if (want === 'more') { setView('more'); more.render(); }
      else if (want === 'data') setView('home');
      else if (want === 'map' || want === 'stations') setView(want);
    } else setView('map');
  }

  // للاختبار والتكامل: الحالة الحالية فقط — for tests: the current state only
  global.SecHome = {
    goToStation: goToStation, goBackToSearch: goBackToSearch, setView: setView, openDetails: openDetails_,
    state: function () { return { view: doc.body.dataset.view, map: !!view && doc.body.dataset.view === 'map', station: current, card: !!card, sync: lastSyncKind, me: myPos }; },
    parts: function () { return { view: view, details: details, stationsList: stationsList, more: more, lens: lens, bar: bar, stats: stats, recent: recent, gate: gate, status: status, header: header, nav: nav }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
