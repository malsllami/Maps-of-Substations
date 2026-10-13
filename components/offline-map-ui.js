/* ============================================================
 * components/offline-map-ui.js — واجهة خريطة جدة بدون إنترنت (البيانات والتنزيل والتحقق في services/offline-map.js)
 * ============================================================
 * واجهة V1 المعتمدة كما هي (النموذج أ + شريط التخزين من ج)، فوق الخدمة المختبرة:
 * - سطر الحالة والحجم لأي عنصر [data-om-status] (بطاقة المحطة و«حسابي») — كلاهما يفتح نفس النافذة.
 * - نافذة من الأسفل: الحالة، معلومات النسخة، التنزيل/الإيقاف/الاستكمال/الإلغاء، التحديث، الحذف، مساحة التخزين، وسجل الخريطة.
 *   تُغلق بالضغط خارجها أو بالسحب للأسفل، ويُعاد رسمها من حالة الخدمة عند كل فتح.
 * - V2: لا تنزيل بلا موافقة صريحة (لوحة الموافقة بالحجم الحقيقي وتنبيه البيانات واختيار «Wi‑Fi فقط»)؛ والانقطاع يُستكمل؛
 *   والنسخة المرفوضة (فشل التحقق) يُعاد تنزيلها من البداية؛ والنسخة القديمة تبقى تعمل حتى تُعتمد الجديدة.
 * - الطبقة المرسومة: createLayer(flavor) تقرأ الملف المحفوظ من الخدمة (openSource) وترسمه بـ pmtiles + protomaps-leaflet.
 *
 * The offline Jeddah map UI (data, download and verification live in services/offline-map.js). V1's approved UI as is, over
 * the tested service: the [data-om-status] line, and the bottom sheet. V2: no download without explicit consent, interruptions
 * resume, a rejected copy restarts from zero, the old copy keeps working until the new one is committed. The drawn layer:
 * createLayer(flavor) reads the saved file through the service and draws it with pmtiles + protomaps-leaflet.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, MAP = global.SecOfflineMap, D = global.SecDates, H = global.SecHtml;
  if (!CONFIG || !MAP || !D || !H) throw new Error('offline-map-ui.js يحتاج الإعدادات وoffline-map.js وdates.js وhtml.js قبله / needs config, offline-map.js, dates.js and html.js first');

  let deps = null;                 // ما تمرره الصفحة / provided by the page
  let state = { state: 'none' };   // آخر حالة من الخدمة / the last service state
  let meta = null;                 // معلومات الخريطة على الموقع / the map info on the site
  let controller = null;           // تنزيل جارٍ / a running download
  let progress = null;             // { got, total }
  let consent = null;              // لوحة الموافقة مفتوحة: { wifiOnly } / the consent panel is open
  let sheet = null, dim = null;
  const doc = global.document;

  // ===== تنسيق: التاريخ والتهريب من المصدر الموحد (utils) — Formatting: dates and escaping from the single source =====
  const mb = function (b) { return (b / 1048576).toFixed(2) + ' MB'; };
  const greg = D.gregorian, hijri = D.hijri, clock = D.time, esc = H.esc;

  function isReady() { return state.state === 'complete'; }
  function updateAvailable() { return !!(meta && isReady() && meta.version !== state.version); }
  function partOf_(s) { return s.state === 'complete' ? s.pending || null : s.state !== 'none' ? s : null; } // التنزيل غير المكتمل إن وُجد / the incomplete download, if any

  // ===== سطر الحالة — The status line =====
  function cardLine_() {
    if (controller && progress) return { dot: '🟢', text: 'جارٍ التنزيل ' + Math.round(progress.got / progress.total * 100) + '٪' };
    if (state.state === 'complete') {
      const p = state.pending;
      const upd = p ? (p.state === 'rejected' ? ' · تعذّر التحديث' : ' · تحديث غير مكتمل') : updateAvailable() ? ' · تحديث متاح' : '';
      return { dot: '🟢', text: (deps && deps.isUsingOffline() ? 'مستخدمة الآن' : 'جاهزة') + ' · ' + mb(state.bytes) + upd };
    }
    if (state.state === 'paused' || state.state === 'interrupted') return { dot: '🟠', text: 'غير مكتملة · ' + mb(state.receivedBytes) + ' / ' + mb(state.bytes) };
    if (state.state === 'rejected') return { dot: '🟠', text: 'تعذّر التحقق من الخريطة' };
    return { dot: '⬇', text: 'غير محفوظة' + (meta ? ' · ' + mb(meta.bytes) : '') };
  }
  function statusText() { const l = cardLine_(); return l.dot + ' ' + l.text; }
  function renderCard() {
    const line = statusText();
    doc.querySelectorAll('[data-om-status]').forEach(function (el) { el.textContent = line; });
  }

  // ===== النافذة — The sheet =====
  function open() {
    if (sheet) return;
    dim = doc.createElement('div'); dim.className = 'om-dim';
    sheet = doc.createElement('div'); sheet.className = 'om-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'خريطة جدة بدون إنترنت');
    doc.body.appendChild(dim); doc.body.appendChild(sheet);
    dim.addEventListener('click', close);
    let y0 = null;
    sheet.addEventListener('touchstart', function (e) { y0 = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    sheet.addEventListener('touchend', function (e) { if (y0 != null && e.changedTouches[0].clientY - y0 > 50) close(); y0 = null; });
    refresh();
  }
  function close() {
    if (sheet) sheet.remove(); if (dim) dim.remove();
    sheet = null; dim = null; consent = null;
  }
  function isOpen() { return !!sheet; }

  async function renderSheet_() {
    if (!sheet) return;
    const s = state, rows = [], p = s.pending, part = partOf_(s);
    const stateText = controller ? '<span class="om-ok">🟢 جارٍ التنزيل</span>'
      : s.state === 'complete' ? '<span class="om-ok">✓ محفوظة وجاهزة بدون إنترنت</span>'
      : s.state === 'paused' ? '🟠 غير مكتملة، يمكن استكمالها'
      : s.state === 'interrupted' ? '🟠 توقف التنزيل قبل اكتماله، يمكن استكماله'
      : s.state === 'rejected' ? '🟠 فشل التحقق من الخريطة، يمكن إعادة التحميل'
      : 'غير محفوظة على الجهاز';
    rows.push(['الحالة', stateText]);
    if (s.state === 'complete') {
      rows.push(['إصدار الخريطة', '<span class="om-num">' + esc(s.version) + '</span>' + (updateAvailable() && !p ? ' <span class="om-warn">(متاح ' + esc(meta.version) + ')</span>' : '')]);
      rows.push(['الحجم', '<span class="om-num">' + mb(s.bytes) + '</span>']);
      if (s.completedAt) rows.push(['تاريخ التنزيل', greg(s.completedAt) + '<br><span class="om-dim-text">' + hijri(s.completedAt) + '</span>']);
      if (p && !controller) rows.push(['التحديث ' + esc(p.version), p.state === 'rejected' ? '🟠 فشل التحقق — الخريطة الحالية سليمة وتعمل'
        : '🟠 غير مكتمل (' + mb(p.receivedBytes) + ' / ' + mb(p.bytes) + ') — الخريطة الحالية تعمل']);
    } else rows.push(['حجم الخريطة', '<span class="om-num">' + (meta ? mb(meta.bytes) : s.bytes ? mb(s.bytes) : '—') + '</span>']);
    const reason = part && !controller && (part.state === 'rejected' || part.state === 'interrupted') ? part.reason : null;
    if (reason) rows.push(['السبب', '<span class="om-dim-text">' + esc(reason) + (part.state === 'rejected' ? ' — حُذف الجزء المؤقت' : ' — الأجزاء المنزّلة محفوظة') + '</span>']);

    // التقدم: أثناء التنزيل، أو المحفوظ بعد إيقاف/انقطاع — progress: while downloading, or what's kept after a pause/interruption
    let prog = '';
    const keptPart = !controller && part && (part.state === 'paused' || part.state === 'interrupted') ? part : null;
    if (controller || keptPart) {
      const got = progress ? progress.got : keptPart ? keptPart.receivedBytes : 0, total = progress ? progress.total : keptPart ? keptPart.bytes : (meta ? meta.bytes : 1);
      const pct = Math.round(got / total * 100);
      prog = '<div><div class="om-bar"><i style="width:' + pct + '%"></i></div><div class="om-bar-lbl"><span>' + mb(got) + ' / ' + mb(total) + ' · ' + pct + '٪</span><span>' + (controller ? 'جارٍ التنزيل' : 'يُستكمل من ' + mb(got)) + '</span></div></div>';
    }

    let est = null;
    try { est = global.navigator.storage && global.navigator.storage.estimate ? await global.navigator.storage.estimate() : null; } catch (e) { est = null; }
    const storage = est && est.quota ? '<div><div class="om-bar-lbl" style="margin:0 0 4px"><span>مساحة التخزين المستخدمة للموقع</span><span class="om-num">' + mb(est.usage || 0) + '</span></div><div class="om-bar om-bar-thin"><i style="width:' + Math.max(2, Math.min(100, (est.usage || 0) / est.quota * 100)).toFixed(1) + '%"></i></div></div>' : '';

    let btns;
    const del = '<button type="button" class="om-btn dan" data-act="delete">حذف من الجهاز</button>';
    if (consent) btns = consentHtml_();
    else if (controller) btns = '<button type="button" class="om-btn sec" data-act="pause">إيقاف مؤقت</button><button type="button" class="om-btn dan" data-act="cancel">إلغاء التنزيل</button>';
    else if (s.state === 'complete') {
      if (p && p.state !== 'rejected') btns = '<button type="button" class="om-btn pri" data-act="download">استكمال التحديث</button>' + del;
      else if (p) btns = '<button type="button" class="om-btn pri" data-act="download">إعادة تحميل التحديث</button>' + del;
      else btns = '<button type="button" class="om-btn sec" data-act="' + (updateAvailable() ? 'download' : 'check') + '">' + (updateAvailable() ? 'تحديث الخريطة' : 'التحقق من تحديث') + '</button>' + del;
    }
    else if (s.state === 'paused' || s.state === 'interrupted') btns = '<button type="button" class="om-btn pri" data-act="download">استكمال التنزيل</button><button type="button" class="om-btn dan" data-act="delete">حذف الجزء المنزّل</button>';
    else if (s.state === 'rejected') btns = '<button type="button" class="om-btn pri" data-act="download" style="grid-column:1/-1">إعادة التحميل</button>';
    else btns = '<button type="button" class="om-btn pri" data-act="download" style="grid-column:1/-1">تنزيل الخريطة</button>';

    sheet.innerHTML = '<div class="om-grab"></div><h3 class="om-h">🗺 خريطة جدة بدون إنترنت</h3>' +
      rows.map(function (r) { return '<div class="om-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') + prog + storage +
      '<p class="om-sub">تظهر تلقائيًا عند انقطاع الإنترنت · حدود محافظة جدة الرسمية · © OpenStreetMap</p>' +
      '<div class="om-btns">' + btns + '</div><div class="om-msg" hidden></div>' + await historyHtml_();
    sheet.querySelectorAll('[data-act]').forEach(function (b) { b.addEventListener('click', function () { act_(b.dataset.act); }); });
    const wifi = sheet.querySelector('.om-wifi input');
    if (wifi) wifi.addEventListener('change', function () { consent.wifiOnly = wifi.checked; });
  }

  /* لوحة الموافقة قبل أي تنزيل: الحجم الحقيقي، تنبيه البيانات (غير مانع)، واختيار «Wi‑Fi فقط»
   * The consent panel before any download: the real size, a data note (non-blocking), and a «Wi‑Fi only» choice */
  function consentHtml_() {
    const total = meta ? meta.bytes : state.bytes || 0, part = partOf_(state);
    const left = part && part.state !== 'rejected' && part.version === (meta && meta.version) ? Math.max(0, total - part.receivedBytes) : total;
    return '<div class="om-consent" style="grid-column:1/-1"><b>تنزيل ' + mb(left) + (left < total ? ' (المتبقي من ' + mb(total) + ')' : '') + '؟</b>' +
      '<div class="om-note-warn">قد يستهلك هذه الكمية من بياناتك — Wi‑Fi أو بيانات الجوال.</div>' +
      '<label class="om-wifi"><input type="checkbox"' + (consent.wifiOnly ? ' checked' : '') + '> التنزيل عبر Wi‑Fi فقط</label></div>' +
      '<button type="button" class="om-btn pri" data-act="confirm">موافق، نزّل</button><button type="button" class="om-btn sec" data-act="decline">إلغاء</button>';
  }

  async function historyHtml_() {
    let h = { versions: [], issues: [] };
    try { h = await MAP.history(); } catch (e) { /* السجل وصفي فقط / the log is descriptive only */ }
    const items = h.versions.map(function (v) { return { at: v.at, icon: '🟢', title: (v.kind === 'update' ? 'تحديث مكتمل' : 'تنزيل مكتمل') + ' · ' + esc(v.version), sub: mb(v.bytes) }; })
      .concat(h.issues.map(function (i) {
        const title = i.result === 'paused' ? 'تنزيل متوقف مؤقتًا' : i.result === 'interrupted' ? 'توقف التنزيل (انقطاع)' : 'فشل التحقق';
        const sub = i.result === 'rejected' ? esc(i.reason) + ' — يلزم إعادة التحميل من البداية' : mb(i.receivedBytes || 0) + ' / ' + mb(i.bytes || 0) + ' — يمكن استكماله';
        return { at: i.at, icon: '🟠', title: title + (i.version ? ' · ' + esc(i.version) : ''), sub: sub };
      }))
      .sort(function (a, b) { return b.at - a.at; }).slice(0, 20);
    if (!items.length) return '';
    return '<div class="om-log"><div class="om-log-h">سجل الخريطة</div>' + items.map(function (it) {
      return '<div class="om-log-i"><span class="om-log-ic">' + it.icon + '</span><div><div class="om-log-t">' + it.title + '</div><div class="om-dim-text">' + it.sub + '</div><div class="om-dim-text">' + greg(it.at) + ' · ' + hijri(it.at) + ' · ' + clock(it.at) + '</div></div></div>';
    }).join('') + '</div>';
  }

  function message_(text, bad) {
    const m = sheet && sheet.querySelector('.om-msg');
    if (!m) { if (deps) deps.hint(text); return; }
    m.hidden = false; m.textContent = text; m.className = 'om-msg' + (bad ? ' bad' : '');
  }

  async function act_(what) {
    if (what === 'pause' || what === 'cancel') {
      if (!controller) return;
      controller.cancelRequested = what === 'cancel';
      controller.abort();
      return;
    }
    if (what === 'delete') {
      if (!global.confirm('حذف خريطة جدة من هذا الجهاز؟ يمكنك تنزيلها مرة أخرى في أي وقت.')) return;
      await MAP.remove(); await refresh(); if (deps) deps.onReadyChange(); message_('حُذفت الخريطة من الجهاز');
      return;
    }
    if (what === 'check') {
      try { meta = await MAP.fetchMeta(); } catch (e) { message_('تعذّر التحقق — يحتاج اتصالًا بالإنترنت', true); return; }
      await renderSheet_(); renderCard();
      message_(updateAvailable() ? 'يوجد إصدار أحدث: ' + meta.version : 'الخريطة محدّثة (الإصدار ' + state.version + ')');
      return;
    }
    if (what === 'download') { // الموافقة أولًا — consent first
      if (global.navigator.onLine === false) { message_('التنزيل يحتاج اتصالًا بالإنترنت', true); return; }
      if (!meta) { try { meta = await MAP.fetchMeta(); } catch (e) { /* يُعرض الحجم المعروف / the known size is shown */ } }
      consent = { wifiOnly: false };
      await renderSheet_();
      return;
    }
    if (what === 'decline') { consent = null; await renderSheet_(); return; }
    if (what === 'confirm') await download_();
  }

  async function download_() {
    const wifiOnly = !!(consent && consent.wifiOnly);
    consent = null;
    const hadComplete = isReady();
    controller = new global.AbortController(); progress = null;
    renderCard(); await renderSheet_();
    const c = controller;
    try {
      await MAP.download({ consent: true, wifiOnly: wifiOnly, signal: c.signal, onProgress: function (got, total) { progress = { got: got, total: total }; renderCard(); updateProgress_(); } });
      controller = null; progress = null; await refresh(); if (deps) deps.onReadyChange();
      message_('✓ اكتمل التنزيل وتم التحقق من الخريطة');
    } catch (e) {
      controller = null; progress = null;
      // الإلغاء في أول تنزيل يحذف الجزء المنزّل؛ وفي التحديث تبقى الخريطة الحالية والجزء للاستكمال
      // A cancel in a first download deletes the part; in an update the current map stays and the part is kept to resume
      if (e.name === 'AbortError' && c.cancelRequested && !hadComplete) { try { await MAP.remove(); } catch (x) { /* يبقى للحذف اليدوي / left for manual delete */ } }
      await refresh();
      message_(e.name === 'AbortError' ? (c.cancelRequested ? (hadComplete ? 'أُلغي التحديث — الخريطة الحالية تعمل' : 'أُلغي التنزيل وحُذف الجزء المنزّل') : 'أُوقف التنزيل — يمكنك استكماله من حيث توقف')
        : e.name === 'Rejected' ? 'فشل التحقق من الخريطة (' + e.message + ') — حُذف الجزء المؤقت، ويمكن إعادة التحميل من البداية'
        : e.name === 'CellularNotAllowed' ? 'اخترت Wi‑Fi فقط والجهاز على بيانات الجوال — لم يبدأ التنزيل'
        : e.name === 'AlreadyRunning' ? 'يوجد تنزيل جارٍ في تبويب آخر'
        : 'توقف التنزيل (' + e.message + ') — الأجزاء المنزّلة محفوظة، ويمكن استكماله', e.name !== 'AbortError');
    }
  }

  function updateProgress_() {
    if (!sheet || !progress) return;
    const pct = Math.round(progress.got / progress.total * 100);
    const bar = sheet.querySelector('.om-bar i'), lbl = sheet.querySelector('.om-bar-lbl span');
    if (bar) bar.style.width = pct + '%';
    if (lbl) lbl.textContent = mb(progress.got) + ' / ' + mb(progress.total) + ' · ' + pct + '٪';
  }

  async function refresh() {
    try { state = await MAP.status(); } catch (e) { state = { state: 'none' }; }
    if (!meta && global.navigator.onLine !== false) { try { meta = await MAP.fetchMeta(); } catch (e) { /* بلا إنترنت / offline */ } }
    renderCard();
    if (sheet) await renderSheet_();
  }

  // ===== الطبقة المرسومة — The drawn layer =====
  let libsPromise = null;
  /* مكتبتا الرسم عند الحاجة فقط؛ الجلب بطلب CORS يجعل sw.js يحفظهما فتعملان بدون إنترنت (من V1)
   * The two rendering libraries only when needed; a CORS fetch lets sw.js store them for offline use (from V1) */
  function loadLibs() {
    if (global.pmtiles && global.protomapsL) return Promise.resolve();
    if (!libsPromise) {
      libsPromise = [CONFIG.LIBRARIES.PMTILES, CONFIG.LIBRARIES.PROTOMAPS_LEAFLET].reduce(function (p, src) {
        return p.then(function () {
          return global.fetch(src, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
            .then(function (code) {
              return new Promise(function (resolve, reject) {
                const s = doc.createElement('script'), url = global.URL.createObjectURL(new global.Blob([code], { type: 'text/javascript' }));
                s.src = url;
                s.onload = function () { global.URL.revokeObjectURL(url); resolve(); };
                s.onerror = function () { reject(new Error('تعذّر تشغيل مكتبة الخريطة المحفوظة')); };
                doc.head.appendChild(s);
              });
            });
        });
      }, Promise.resolve()).catch(function (e) { libsPromise = null; throw new Error('تعذّر تحميل مكتبة الخريطة المحفوظة: ' + e.message); });
    }
    return libsPromise;
  }

  /* طبقة Leaflet للخريطة المحفوظة (null إن لم تكتمل). flavor: 'light' | 'dark' — نفس الملف للوضعين
   * A Leaflet layer for the saved map (null if not complete). flavor: 'light' | 'dark' — the same file for both */
  async function createLayer(flavor) {
    const source = await MAP.openSource();
    if (!source) return null;
    await loadLibs();
    const archive = new global.pmtiles.PMTiles(source);
    return global.protomapsL.leafletLayer({ url: archive, flavor: flavor === 'dark' ? 'dark' : 'light', lang: 'ar', attribution: '© OpenStreetMap' });
  }

  /* deps: { isUsingOffline(), onReadyChange(), hint(text) } — تُقرأ الحالة فورًا لتعمل الخريطة المحفوظة من أول فتح بدون إنترنت
   * The state is read at once so the saved map works from the very first offline open */
  function init(pageDeps) {
    deps = pageDeps;
    global.addEventListener('online', function () { refresh(); });
    global.addEventListener('offline', function () { renderCard(); });
    return refresh().then(function () { if (deps) deps.onReadyChange(); });
  }

  global.SecOfflineMapUI = {
    init: init, isReady: isReady, open: open, close: close, isOpen: isOpen, refresh: refresh, renderCard: renderCard,
    statusText: statusText, createLayer: createLayer, loadLibs: loadLibs, isDownloading: function () { return !!controller; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
