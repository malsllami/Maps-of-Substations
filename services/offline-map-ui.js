/* ============================================================
 * services/offline-map-ui.js — مسؤول عن واجهة خريطة جدة بدون إنترنت فقط (المحرك في services/offline-map.js):
 * - بطاقة صغيرة مطوية أعلى الخريطة تحت الشريط: الحالة والحجم (لا تتمدد إلا بطلب المستخدم، ومطوية أثناء الملاحة).
 * - نافذة من الأسفل (النموذج أ + شريط التخزين من النموذج ج): الحالة، معلومات النسخة، التنزيل/الإيقاف/الاستكمال،
 *   التحديث، الحذف، مساحة التخزين، وسجل الخريطة (🟢 مكتمل · 🟠 غير مكتمل · 🔴 فشل). تُغلق بالضغط خارجها أو السحب للأسفل.
 * - اختيار الطبقة: بدون إنترنت + الخريطة محفوظة ← الخريطة المحفوظة تلقائيًا (نهاري/ليلي من نفس الملف).
 *
 * Owns the offline Jeddah map UI only (the engine is services/offline-map.js):
 * - A small collapsed card at the top of the map under the toolbar: state and size (expands only on request, collapsed while navigating).
 * - A bottom sheet (design A + the storage bar from design C): state, copy info, download/pause/resume, update, delete,
 *   storage space, and the map log (complete · incomplete · failed). Closes on outside tap or swipe down.
 * - Layer choice: offline + map saved ← the saved map automatically (day/night from the same file).
 * ============================================================ */
(function (global) {
  'use strict';

  let deps = null;                 // ما تمرره الصفحة — provided by the page
  let state = { state: 'none' };   // آخر حالة معروفة من المحرك — last known engine state
  let meta = null;                 // معلومات الخريطة على الموقع — the map info on the site
  let controller = null;           // تنزيل جارٍ — a running download
  let progress = null;             // { got, total }
  let card = null, sheet = null, dim = null;

  // ===== تنسيق — Formatting =====
  // نفس وحدة سطر «بيانات المحطات المحمّلة» الحالي (1024×1024) — the same unit as the existing cache line
  const mb = b => (b / 1048576).toFixed(2) + ' MB';
  const greg = ts => new Date(ts).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
  const hijri = ts => new Date(ts).toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
  const clock = ts => new Date(ts).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function isReady() { return state.state === 'complete'; }
  function updateAvailable() { return !!(meta && isReady() && meta.version !== state.version); }

  // ===== البطاقة المطوية — The collapsed card =====
  function cardLine_() {
    if (controller && progress) return { dot: '⬇', text: 'جارٍ التنزيل ' + Math.round(progress.got / progress.total * 100) + '٪' };
    if (state.pending) return { dot: '🟠', text: 'تحديث غير مكتمل · ' + mb(state.pending.receivedBytes) + ' / ' + mb(state.pending.bytes) };
    if (state.state === 'complete') {
      const inUse = deps.isUsingOffline();
      return { dot: '🟢', text: (inUse ? 'مستخدمة الآن' : 'جاهزة') + ' · ' + mb(state.bytes) + (updateAvailable() ? ' · تحديث متاح' : '') };
    }
    if (state.state === 'partial') return { dot: '🟠', text: 'غير مكتملة · ' + mb(state.receivedBytes) + ' / ' + mb(state.bytes) };
    return { dot: '⬇', text: 'غير محفوظة' + (meta ? ' · ' + mb(meta.bytes) : '') };
  }
  function renderCard_() {
    if (!card) return;
    const l = cardLine_();
    card.querySelector('.omc-line').textContent = l.dot + ' ' + l.text;
  }

  // ===== النافذة — The sheet =====
  function open() {
    if (sheet) return;
    dim = document.createElement('div'); dim.className = 'om-dim';
    sheet = document.createElement('div'); sheet.className = 'om-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'خريطة جدة بدون إنترنت');
    document.body.appendChild(dim); document.body.appendChild(sheet);
    dim.addEventListener('click', close); // الضغط خارجها ← مطوية / tap outside ← collapsed
    let y0 = null; // السحب للأسفل ← مطوية / swipe down ← collapsed
    sheet.addEventListener('touchstart', e => { y0 = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    sheet.addEventListener('touchend', e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 50) close(); y0 = null; });
    refresh_(); // حالة وسجل حديثان عند كل فتح (ثم الرسم) / fresh state and log on every open (then render)
  }
  function close() {
    if (sheet) sheet.remove(); if (dim) dim.remove();
    sheet = null; dim = null;
  }

  async function renderSheet_() {
    if (!sheet) return;
    const s = state, rows = [];
    const statusText = controller ? '⬇ جارٍ التنزيل' : s.pending ? '🟠 تحديث غير مكتمل — النسخة الحالية تعمل' : s.state === 'complete' ? '<span class="om-ok">✓ محفوظة وجاهزة بدون إنترنت</span>'
      : s.state === 'partial' ? '🟠 غير مكتملة — يمكن استكمالها' : 'غير محفوظة على الجهاز';
    rows.push(['الحالة', statusText]);
    if (s.state === 'complete') {
      rows.push(['إصدار الخريطة', '<span class="om-num">' + esc(s.version) + '</span>' + (updateAvailable() ? ' <span class="om-warn">(متاح ' + esc(meta.version) + ')</span>' : '')]);
      rows.push(['الحجم', '<span class="om-num">' + mb(s.bytes) + '</span>']);
      if (s.completedAt) rows.push(['تاريخ التنزيل', greg(s.completedAt) + '<br><span class="om-dim-text">' + hijri(s.completedAt) + '</span>']);
    } else rows.push(['حجم التنزيل', '<span class="om-num">' + (meta ? mb(meta.bytes) : '—') + '</span>']);

    let prog = '';
    const showProg = controller || s.state === 'partial' || s.pending;
    if (showProg) {
      const got = progress ? progress.got : (s.pending ? s.pending.receivedBytes : s.receivedBytes || 0);
      const total = progress ? progress.total : (s.pending ? s.pending.bytes : s.bytes || (meta && meta.bytes) || 1);
      const pct = Math.round(got / total * 100);
      prog = '<div><div class="om-bar"><i style="width:' + pct + '%"></i></div><div class="om-bar-lbl"><span>' + (controller ? 'جارٍ التنزيل — ' : 'تم تنزيل ') + pct + '٪ (' + mb(got) + ' / ' + mb(total) + ')</span><span>يُستكمل من حيث توقف</span></div></div>';
    }

    let est = null;
    try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) {}
    const storage = est && est.quota ? '<div><div class="om-bar-lbl" style="margin:0 0 4px"><span>مساحة التخزين المستخدمة للموقع</span><span class="om-num">' + mb(est.usage || 0) + '</span></div><div class="om-bar om-bar-thin"><i style="width:' + Math.max(2, Math.min(100, (est.usage || 0) / est.quota * 100)).toFixed(1) + '%"></i></div></div>' : '';

    const warn = s.state !== 'complete' && !controller ? '<div class="om-note-warn">قد يستهلك هذه الكمية من بياناتك — Wi‑Fi أو بيانات الجوال.</div>' : '';
    let btns;
    if (controller) btns = '<button type="button" class="om-btn sec" data-act="pause">إيقاف مؤقت</button>';
    else if (s.state === 'complete') btns = '<button type="button" class="om-btn sec" data-act="' + (updateAvailable() || s.pending ? 'download' : 'check') + '">' + (s.pending ? 'متابعة التحديث' : updateAvailable() ? 'تحديث الخريطة' : 'التحقق من تحديث') + '</button><button type="button" class="om-btn dan" data-act="delete">حذف من الجهاز</button>';
    else if (s.state === 'partial') btns = '<button type="button" class="om-btn pri" data-act="download">متابعة التنزيل</button><button type="button" class="om-btn dan" data-act="delete">حذف الجزء المنزّل</button>';
    else btns = '<button type="button" class="om-btn pri" data-act="download" style="grid-column:1/-1">تنزيل الخريطة</button>';

    sheet.innerHTML = '<div class="om-grab"></div><h3 class="om-h">🗺 خريطة جدة بدون إنترنت</h3>' +
      rows.map(r => '<div class="om-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('') + prog + warn + storage +
      '<p class="om-sub">تظهر تلقائيًا عند انقطاع الإنترنت · حدود محافظة جدة الرسمية · © OpenStreetMap</p>' +
      '<div class="om-btns">' + btns + '</div><div class="om-msg" hidden></div>' + await historyHtml_();
    sheet.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act_(b.dataset.act)));
  }

  /* سجل الخريطة: الإصدارات المكتملة (🟢) ومشكلات التنزيل (🟠/🔴) معروضة معًا بالوقت — يبقيان سجلين منفصلين داخليًا
   * The map log: completed versions and download issues shown together by time — they stay two separate logs internally */
  async function historyHtml_() {
    let h = { versions: [], issues: [] };
    try { h = await global.SecOfflineMap.history(); } catch (e) {}
    const items = h.versions.map(v => ({ at: v.at, icon: '🟢', title: (v.kind === 'update' ? 'تحديث مكتمل' : 'تنزيل مكتمل') + ' · ' + esc(v.version), sub: mb(v.bytes) }))
      .concat(h.issues.map(i => ({ at: i.at, icon: i.result === 'incomplete' ? '🟠' : '🔴', title: (i.result === 'incomplete' ? 'غير مكتمل' : 'فشل') + (i.version ? ' · ' + esc(i.version) : ''),
        sub: esc(i.reason) + (i.result === 'incomplete' && i.bytes ? ' · ' + mb(i.receivedBytes || 0) + ' / ' + mb(i.bytes) : '') })))
      .sort((a, b) => b.at - a.at).slice(0, 20);
    if (!items.length) return '';
    return '<div class="om-log"><div class="om-log-h">سجل الخريطة</div>' + items.map(it =>
      '<div class="om-log-i"><span class="om-log-ic">' + it.icon + '</span><div><div class="om-log-t">' + it.title + '</div><div class="om-dim-text">' + it.sub + '</div><div class="om-dim-text">' + greg(it.at) + ' · ' + hijri(it.at) + ' · ' + clock(it.at) + '</div></div></div>').join('') + '</div>';
  }

  function message_(text, bad) {
    const m = sheet && sheet.querySelector('.om-msg');
    if (!m) { deps.hint(text); return; }
    m.hidden = false; m.textContent = text; m.className = 'om-msg' + (bad ? ' bad' : '');
  }

  async function act_(what) {
    if (what === 'pause') { if (controller) controller.abort(); return; }
    if (what === 'delete') {
      if (!global.confirm('حذف خريطة جدة من هذا الجهاز؟ يمكنك تنزيلها مرة أخرى في أي وقت.')) return;
      await global.SecOfflineMap.remove(); await refresh_(); deps.onReadyChange(); message_('حُذفت الخريطة من الجهاز'); return;
    }
    if (what === 'check') {
      try { meta = await global.SecOfflineMap.fetchMeta(); } catch (e) { message_('تعذّر التحقق — يحتاج اتصالًا بالإنترنت', true); return; }
      await renderSheet_(); renderCard_();
      message_(updateAvailable() ? 'يوجد إصدار أحدث: ' + meta.version : 'الخريطة محدّثة (الإصدار ' + state.version + ')');
      return;
    }
    if (what === 'download') {
      if (navigator.onLine === false) { message_('التنزيل يحتاج اتصالًا بالإنترنت', true); return; }
      controller = new AbortController(); progress = null;
      renderCard_(); await renderSheet_();
      try {
        await global.SecOfflineMap.download({ signal: controller.signal, onProgress: (got, total) => { progress = { got, total }; renderCard_(); updateProgress_(); } });
        controller = null; progress = null; await refresh_(); deps.onReadyChange();
        message_('✓ اكتمل التنزيل وتم التحقق من الخريطة');
      } catch (e) {
        controller = null; progress = null; await refresh_();
        message_(e.name === 'AbortError' ? 'أُوقف التنزيل — يمكنك متابعته لاحقًا من حيث توقف' : e instanceof TypeError ? 'انقطع الاتصال — يمكنك متابعة التنزيل لاحقًا من حيث توقف' : e.message, e.name !== 'AbortError');
      }
    }
  }
  /* تحديث شريط التقدم فقط دون إعادة رسم النافذة — updates the progress bar only, without redrawing the sheet */
  function updateProgress_() {
    if (!sheet || !progress) return;
    const pct = Math.round(progress.got / progress.total * 100);
    const bar = sheet.querySelector('.om-bar i'), lbl = sheet.querySelector('.om-bar-lbl span');
    if (bar) bar.style.width = pct + '%';
    if (lbl) lbl.textContent = 'جارٍ التنزيل — ' + pct + '٪ (' + mb(progress.got) + ' / ' + mb(progress.total) + ')';
  }

  async function refresh_() {
    try { state = await global.SecOfflineMap.status(); } catch (e) { state = { state: 'none' }; }
    if (!meta && navigator.onLine !== false) { try { meta = await global.SecOfflineMap.fetchMeta(); } catch (e) {} }
    renderCard_();
    if (sheet) await renderSheet_();
  }

  /**
   * deps: { isUsingOffline(), onReadyChange(), hint(text) } — تُقرأ الحالة فورًا (قبل فتح أي خريطة) لتعمل الخريطة المحفوظة من أول فتح بدون إنترنت
   * The state is read at once (before any map opens) so the saved map works from the very first offline open
   */
  function init(pageDeps) {
    deps = pageDeps;
    global.addEventListener('online', () => { refresh_(); });
    global.addEventListener('offline', () => renderCard_());
    return refresh_().then(() => { deps.onReadyChange(); });
  }

  /* البطاقة كأداة خريطة أعلى يمين الخريطة (تحت الشريط دائمًا وتتبع الخريطة أينما كانت) — The card as a map control at the map's top right (always under the toolbar, following the map wherever it is) */
  function attach(map) {
    if (card || !global.L) return;
    const Ctl = L.Control.extend({ options: { position: 'topright' }, onAdd: function () {
      card = L.DomUtil.create('button', 'om-card');
      card.type = 'button';
      card.innerHTML = '<span class="omc-title">🗺️ خريطة جدة بدون إنترنت</span><span class="omc-line"></span><span class="omc-chev">⌄</span>';
      L.DomEvent.disableClickPropagation(card); L.DomEvent.disableScrollPropagation(card);
      card.addEventListener('click', open);
      return card;
    } });
    new Ctl().addTo(map);
    renderCard_();
  }

  global.SecOfflineMapUI = { init: init, attach: attach, isReady: isReady, open: open, close: close, refresh: refresh_, renderCard: renderCard_ };
})(window);
