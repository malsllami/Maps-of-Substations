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
 *
 * The home page: links the approved components in V1's flow (no business logic here). V2: each part in its tested
 * component; the map in its own container under the card; a save updates the card, marker and copy (V1 bug 3).
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document, S = global.SecSession, SYNC = global.SecStationsSync;
  const $ = function (id) { return doc.getElementById(id); };
  const MORPH_SETTLE_MS = 200, OUTAGE_AFTER_MS = 650;
  const MAP_MIN_H = 200; // أصغر ارتفاع للخريطة على الشاشات القصيرة / the map's smallest height on short screens
  const SYNC_NOTE_MS = 6000; // مدة رسالة «تم تحديث بيانات المحطات» / how long the «stations updated» note stays
  const loggedIn = function () { return S.isLoggedIn(); };

  SecTiming.recordPageOpen();
  doc.body.classList.toggle('guest-mode', !loggedIn());

  // ===== الرأس وشريط الحالة — The header and status bar =====
  const header = SecAppHeader.mount($('appHeader'), {
    page: 'index', title: 'إحداثيات المحطات', subtitle: 'الشركة السعودية للطاقة',
    refreshTitle: 'تحديث بيانات المحطات — لو لاحظت نتائج بحث غير محدّثة'
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

  // ===== الشاشات والشريط السفلي (إعادة التصميم) — The screens and the bottom bar (redesign) =====
  const VIEWS = ['home', 'map', 'stations'];
  let nav = null;
  /* يعرض شاشة واحدة؛ الخريطة تُنشأ عند أول فتح لشاشتها وتبقى — shows one screen; the map is created on first open and kept */
  function setView(name) {
    if (VIEWS.indexOf(name) === -1) return;
    doc.body.dataset.view = name;
    $('heroSection').classList.toggle('map-active', name === 'map');
    if (nav) nav.setActive(name);
    if (name === 'map') {
      ensureMap_();
      global.setTimeout(function () { layout(); if (view) view.map.invalidateSize(); }, 30);
    }
    global.scrollTo(0, 0);
  }
  function bottomNavHeight_() {
    const el = $('bottomNav');
    return el && global.getComputedStyle(el).display !== 'none' ? el.getBoundingClientRect().height : 0;
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
    const box = $('mapStage').querySelector('#map-container');
    const top = box.getBoundingClientRect().top + global.scrollY;
    // الخريطة تأخذ باقي الشاشة فوق لوحة المحطة والشريط السفلي، فتظهر كل الأزرار بلا تمرير (ملاحظة محمد، المرحلة ج)
    // The map takes the rest of the screen above the station sheet and the bottom bar, so every button shows unscrolled
    const sheet = $('stationTable').classList.contains('show') ? $('stationTable').offsetHeight + 8 : 0;
    box.style.height = Math.max(MAP_MIN_H, global.innerHeight - top - sheet - bottomNavHeight_() - 10) + 'px';
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
      ro.observe($('topContentArea')); ro.observe($('mapStage').querySelector('.map-toolbar-bar')); ro.observe($('stationTable'));
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
    lens.clear();
    if (doc.body.dataset.view !== 'map') setView('map');
    showStation_(s);
    if (view) global.setTimeout(function () { layout(); view.map.invalidateSize(); }, MORPH_SETTLE_MS);
    return Promise.resolve(true);
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
    if (!current && doc.body.dataset.view === 'home') return;
    current = null;
    if (view) { tools.stop(); outageMap.clear(); nearby.reset(); view.hideHint(); view.clearStation(); }
    if (card) { card.destroy(); card = null; }
    $('heroSection').classList.remove('station-framed');
    bar.clear();
    setView('home');
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
  const bar = SecStationSearchBox.mount($('barBox'), { variant: 'bar', isLoggedIn: loggedIn, onFound: goToStation, onAdd: function (q) { SecStationForm.openAdd(q); }, onUpdated: onUpdated_ });
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

  if (loggedIn()) {
    SYNC.start({ onProgress: progress_ }).then(afterLoad_, afterLoad_);
    S.ensureFresh().then(function (ok) { if (ok) gate.check(); });
  }

  // ===== الشريط السفلي — The bottom bar =====
  nav = SecBottomNav.mount($('bottomNav'), {
    active: 'home',
    onSelect: function (name) {
      // «المزيد» مؤقتًا = القائمة الحالية حتى مرحلتها؛ تُفتح بعد انتهاء الضغطة، وإلا أغلقها «الضغط خارج القائمة» فورًا
      // «more» = the current menu for now; opened after the tap ends, or «tap outside the menu» would close it at once
      if (name === 'more') { global.setTimeout(function () { header.openMenu(); }, 0); return; }
      if (name === 'home') { goBackToSearch(); setView('home'); return; }
      setView(name);
    },
    onAdd: function () { if (loggedIn()) SecStationForm.openAdd(); else global.location.href = 'auth.html'; }
  });

  // للاختبار والتكامل: الحالة الحالية فقط — for tests: the current state only
  global.SecHome = {
    goToStation: goToStation, goBackToSearch: goBackToSearch, setView: setView,
    state: function () { return { view: doc.body.dataset.view, map: !!view && doc.body.dataset.view === 'map', station: current, card: !!card }; },
    parts: function () { return { view: view, lens: lens, bar: bar, stats: stats, recent: recent, gate: gate, status: status, header: header, nav: nav }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
