/* ============================================================
 * components/station-card.js — بطاقة المحطة: العرض والإجراءات فقط
 * ============================================================
 * تصميم محمد (15 أكتوبر): بطاقة واحدة تحيط بالخريطة — فوقها رقم المحطة والمغذي والمنطقة في ثلاثة أقسام ثم «🧭 المسار
 * من موقعي» بعرض البطاقة؛ وتحتها صفّان متساويان: «قوقل ماب» | «مشاركة»، ثم «تعديل» | «حذف» (للمدير) أو «خريطة جدة بدون
 * إنترنت» (لغيره؛ للمدير صف ثالث)، ثم «آخر تحديث لبيانات المحطات». الخريطة نفسها تبقى في حاويتها المستقلة (الملاحة الكاملة
 * تطوي البطاقة وتبقيها)، والجزء السفلي يُرسم في deps.actionsContainer.
 * - الإجراءات تُحال لأصحابها: الملاحة (navigation-view)، نافذة خريطة جدة (offline-map-ui — إدارتها هناك ومن «حسابي»
 *   أيضًا)، التعديل (نموذج الإضافة/التعديل)، الحذف للمدير فقط (delete-station — التصميم «أ»: زر أحمر خافت بجانب «تعديل»)؛
 *   والبطاقة لا تملك منطقها.
 * - القريبة والمغذي (أزرار شريط الخريطة كما في V1): من نسخة الجهاز بلا طلب للخادم، والخادم فقط بلا نسخة (station-query).
 * - V2: محطة بلا إحداثيات صالحة ← تعطيل المسار وقوقل ماب والقريبة مع ملاحظة واضحة؛ كل نص من البيانات يُهرَّب؛ مستمع
 *   واحد على البطاقة (لا تكرار عند إعادة الرسم) يُزال بـ destroy؛ فشل أي إجراء خارجي لا يكسر البطاقة.
 *
 * The station card: display and actions only. Mohammed's design (15 Oct): one card around the map — data and the route
 * button above it, two equal button rows and the freshness line below it (drawn into deps.actionsContainer); the map stays
 * in its own container (full navigation folds the card and keeps it). Actions go to their owners (navigation view,
 * the Jeddah map sheet — managed there and from «My account» too —, the edit form); the card owns none of their logic.
 * Nearby and feeder (map-toolbar buttons as in V1): from the device copy with no server request, the server only without
 * a copy. V2: a station without valid coordinates ← route, Google Maps and nearby disabled with a clear note; all data
 * text is escaped; one listener on the card (no duplicates on re-render) removed by destroy; an external failure never
 * breaks the card.
 * ============================================================ */
(function (global) {
  'use strict';

  const Q = global.SecStationQuery, D = global.SecDates, H = global.SecHtml;
  if (!Q || !D || !H) throw new Error('station-card.js يحتاج station-query.js وdates.js وhtml.js قبله / needs station-query.js, dates.js and html.js first');
  const esc = H.esc;
  const OFFLINE_WRITE_MSG = 'هذه العملية تحتاج إلى اتصال بالإنترنت';
  const NO_COORDS_MSG = 'لا توجد إحداثيات صالحة لهذه المحطة — يمكن إضافتها بزر «تعديل»';

  function googleMapsUrl(s) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + Number(s.lat) + ',' + Number(s.lng) + '&travelmode=driving';
  }

  /* نص المشاركة (من V1)، بلا رابط إن لم تكن هناك إحداثيات — The share text (from V1), no link without coordinates */
  function shareText(s) {
    const lines = ['رقم المحطة: ' + s.id];
    if (s.feeder) lines.push('المغذي: ' + s.feeder);
    if (s.region) lines.push('المنطقة: ' + s.region);
    if (Q.hasCoordinates(s)) lines.push('رابط قوقل ماب: ' + googleMapsUrl(s));
    return lines.join('\n');
  }

  /* آخر تحديث لبيانات المحطات بالصيغة الموحدة (utils/dates) — The data freshness in the single format */
  function freshness_(date) {
    try { return D.dualDateTime(date); } catch (e) { return '—'; }
  }

  /* مدة البحث ومصدره (طلب محمد، 16 أكتوبر): يظهر فقط حين تأتي المحطة من البحث (searchMs)، فيرى العضو فائدة نسخة الجهاز
   * The search time and its source (Mohammed, 16 Oct): only when the station came from a search, showing the device copy's value */
  function searchTime_(s) {
    const ms = Number(s && s.searchMs);
    if (!isFinite(ms) || ms < 0 || !s.source) return '';
    // أقل من 1 ملي ثانية يُكتب «أقل من 0.001 ث» بدل «0.000 ث» — under 1 ms reads «under 0.001 s», not «0.000 s»
    // الرقم وحده باتجاه اليسار، والوحدة «ث» بعده بالعربي فيُقرأ «2.56 ث» لا «ث 2.56» — the number alone is LTR, the unit follows in RTL
    const sec = (ms < 1 ? 'أقل من <b dir="ltr">0.001</b>' : '<b dir="ltr">' + (ms / 1000).toFixed(ms < 100 ? 3 : 2) + '</b>') + ' ث';
    return s.source === 'local'
      ? '<div class="st-search-time local" data-role="search-time">⚡ وُجدت في ' + sec + ' — من نسخة جهازك</div>'
      : '<div class="st-search-time server" data-role="search-time">⏱ وُجدت في ' + sec + ' — من الخادم · حمّل البيانات المؤقتة لبحث فوري</div>';
  }

  /* الجزء العلوي (فوق الخريطة): البيانات في ثلاثة أقسام ثم «المسار من موقعي» بعرض البطاقة
   * The top part (above the map): the data in three sections, then a full-width «route from my location» */
  function topHtml_(s) {
    const coords = Q.hasCoordinates(s);
    return '<div class="sb-inner sb-top">' +
      '<div class="sb-data-row">' +
        '<div class="sb-data-cell"><div class="cell-label">' + (s.type === 'تحويل' ? '⚡ رقم المحطة' : '🏭 رقم المحطة') + '</div><div class="cell-value">' + esc(s.id) + '</div></div>' +
        (s.feeder ? '<div class="sb-data-cell"><div class="cell-label">🔌 المغذي</div><div class="cell-value">' + esc(s.feeder) + '</div></div>' : '') +
        (s.region ? '<div class="sb-data-cell"><div class="cell-label">📍 المنطقة</div><div class="cell-value ar">' + esc(s.region) + '</div></div>' : '') +
      '</div>' +
      searchTime_(s) +
      (coords ? '' : '<div class="st-note-warn" data-role="no-coords">' + NO_COORDS_MSG + '</div>') +
      '<div class="st-actions st-actions-v2">' +
        '<button class="st-btn primary st-main" type="button" data-act="navigate"' + (coords ? '' : ' disabled') + '>🧭 المسار من موقعي</button>' +
      '</div>' +
    '</div>';
  }

  /* الجزء السفلي (تحت الخريطة — تصميم محمد، 15 أكتوبر): صفّان متساويان — قوقل ماب | مشاركة، ثم تعديل | حذف للمدير
   * أو «خريطة جدة بدون إنترنت» لغيره (للمدير صف ثالث بعرض البطاقة)؛ ثم «آخر تحديث لبيانات المحطات».
   * The bottom part (under the map — Mohammed's design, 15 Oct): two equal rows — Google Maps | share, then edit | delete
   * for the admin or «Jeddah offline map» for others (a third full-width row for the admin); then the data freshness. */
  function bottomHtml_(s, deps) {
    const coords = Q.hasCoordinates(s), om = !!deps.offlineMapUI, canEdit = !!(deps.canEdit && deps.canEdit());
    const canDelete = !!(deps.isAdmin && deps.isAdmin() && deps.onDelete); // للمدير فقط (التصميم «أ») / admin only (design «A»)
    const fresh = deps.dataFreshness ? deps.dataFreshness() : null;
    const buttons = [
      coords ? '<a class="st-btn st-google" data-act="google" href="' + esc(googleMapsUrl(s)) + '" target="_blank" rel="noopener">🗺️ قوقل ماب</a>' : '<span class="st-btn st-google st-disabled" aria-disabled="true">🗺️ قوقل ماب</span>',
      '<button class="st-btn st-share" type="button" data-act="share">📤 مشاركة</button>'
    ];
    if (canEdit) buttons.push('<button class="st-btn st-edit" type="button" data-act="edit">✏️ تعديل</button>');
    if (canDelete) buttons.push('<button class="st-btn st-danger" type="button" data-act="delete">🗑️ حذف</button>');
    if (om) buttons.push('<button class="st-btn st-om" type="button" data-act="offline-map"><span class="st-om-text"><b>🗺️ خريطة جدة بدون إنترنت</b><small data-om-status></small></span></button>');
    if (buttons.length % 2) buttons[buttons.length - 1] = buttons[buttons.length - 1].replace('class="st-btn ', 'class="st-btn st-span ');
    return '<div class="sb-inner sb-bottom">' +
      '<div class="st-sub">' + buttons.join('') +
        (canEdit ? '' : '<button class="st-btn" type="button" data-act="edit" hidden>✏️ تعديل</button>') +
      '</div>' +
      (fresh ? '<div class="db-freshness-note"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5A8.5 8.5 0 1 1 3 12.5a8.38 8.38 0 0 1 .9-3.8"/><path d="M21 3v6h-6"/></svg><span>آخر تحديث لبيانات المحطات من قاعدة البيانات: ' + freshness_(fresh) + '</span></div>' : '') +
    '</div>';
  }

  /**
   * render(container, station, deps) ← { update(station), nearby(), feeder(), station(), destroy() }
   * deps: { onNavigate(s), onEdit(s), canEdit(), isAdmin(), onDelete(s), offlineMapUI, toast(text), dataFreshness() → Date|null,
   *         localStations() → Array|null, actionsContainer } — isAdmin + onDelete يُظهران «🗑️ حذف» (نافذته في delete-station.js)؛
   *         actionsContainer: مكان الجزء السفلي تحت الخريطة (بدونه يُرسم الجزءان معًا في container)
   *         / where the bottom part goes under the map (without it both parts draw in container)
   */
  function render(container, station, deps) {
    let s = station, alive = true;
    const bottom = deps.actionsContainer || null;
    const boxes = bottom ? [container, bottom] : [container];
    const toast = function (t) { try { if (deps.toast) deps.toast(t); } catch (e) { /* التنبيه لا يكسر البطاقة / never breaks the card */ } };

    function draw_() {
      if (bottom) { container.innerHTML = topHtml_(s); bottom.innerHTML = bottomHtml_(s, deps); }
      else container.innerHTML = topHtml_(s) + bottomHtml_(s, deps);
      boxes.forEach(function (b) { b.classList.add('show'); });
      if (deps.offlineMapUI) { try { deps.offlineMapUI.renderCard(); } catch (e) { /* سطر الحالة اختياري / the status line is optional */ } }
    }

    /* مستمع واحد لكل جزء (تفويض) — One listener per part (delegation) */
    async function onClick_(e) {
      const el = e.target.closest('[data-act]');
      if (!el || !boxes.some(function (b) { return b.contains(el); }) || el.disabled) return;
      const act = el.dataset.act;
      try {
        if (act === 'navigate') { if (Q.hasCoordinates(s)) await deps.onNavigate(s); else toast(NO_COORDS_MSG); }
        else if (act === 'offline-map') deps.offlineMapUI.open();
        else if (act === 'share') await share_();
        else if (act === 'edit') {
          if (global.navigator.onLine === false) { toast(OFFLINE_WRITE_MSG); return; }
          await deps.onEdit(s);
        }
        else if (act === 'delete') {
          if (global.navigator.onLine === false) { toast(OFFLINE_WRITE_MSG); return; }
          await deps.onDelete(s);
        }
      } catch (err) {
        toast('تعذّر تنفيذ الإجراء، حاول مرة أخرى'); // فشل خارجي لا يكسر البطاقة / an external failure never breaks the card
      }
    }

    /* المشاركة: واجهة المشاركة في الجوال، وإلا النسخ للحافظة (من V1) — Share: the phone's share sheet, else copy (from V1) */
    async function share_() {
      const text = shareText(s), nav = global.navigator;
      if (nav.share) {
        try { await nav.share({ title: 'بيانات محطة ' + s.id, text: text }); return; }
        catch (err) { if (err && err.name === 'AbortError') return; }
      }
      try { await nav.clipboard.writeText(text); toast('تم نسخ بيانات المحطة 📋'); }
      catch (err) { toast('تعذّر نسخ البيانات'); }
    }

    /* القريبة/المغذي للشريط: { source, stations } أو { error } — Nearby/feeder for the toolbar */
    async function run_(mode) {
      if (mode === 'feeder' && !String(s.feeder || '').trim()) return { error: 'لا يوجد مغذي مسجّل لهذه المحطة' };
      if (mode === 'nearby' && !Q.hasCoordinates(s)) return { error: NO_COORDS_MSG };
      const local = deps.localStations ? deps.localStations() : null;
      if ((!local || !local.length) && global.navigator.onLine === false) return { error: 'تحتاج نسخة المحطات أو اتصالًا بالإنترنت' };
      try { return await Q.query(mode, s, local); }
      catch (err) { return { error: 'تعذّر جلب المحطات، حاول مرة أخرى' }; }
    }

    boxes.forEach(function (b) { b.addEventListener('click', onClick_); });
    draw_();

    return {
      update: function (next) { if (alive) { s = next; draw_(); } },
      station: function () { return s; },
      nearby: function () { return run_('nearby'); },
      feeder: function () { return run_('feeder'); },
      destroy: function () {
        if (!alive) return;
        alive = false;
        boxes.forEach(function (b) { b.removeEventListener('click', onClick_); b.innerHTML = ''; b.classList.remove('show'); });
      }
    };
  }

  global.SecStationCard = { render: render, shareText: shareText, googleMapsUrl: googleMapsUrl, MSG: { OFFLINE_WRITE: OFFLINE_WRITE_MSG, NO_COORDS: NO_COORDS_MSG } };
})(typeof window !== 'undefined' ? window : globalThis);
