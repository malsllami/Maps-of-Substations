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
 * button above it, one button row and the search time below it (drawn into deps.actionsContainer); the map stays
 * in its own container (full navigation folds the card and keeps it). Actions go to their owners (navigation view,
 * the Jeddah map sheet — managed there and from «My account» too —, the edit form); the card owns none of their logic.
 * Nearby and feeder (map-toolbar buttons as in V1): from the device copy with no server request, the server only without
 * a copy. V2: a station without valid coordinates ← route, Google Maps and nearby disabled with a clear note; all data
 * text is escaped; one listener on the card (no duplicates on re-render) removed by destroy; an external failure never
 * breaks the card.
 * ============================================================ */
(function (global) {
  'use strict';

  const Q = global.SecStationQuery, H = global.SecHtml;
  if (!Q || !H) throw new Error('station-card.js يحتاج station-query.js وhtml.js قبله / needs station-query.js and html.js first');
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


  /* مدة البحث ومصدره (طلب محمد، 16 أكتوبر): يظهر فقط حين تأتي المحطة من البحث (searchMs)، فيرى العضو فائدة نسخة الجهاز
   * The search time and its source (Mohammed, 16 Oct): only when the station came from a search, showing the device copy's value */
  function searchTime_(s) {
    const ms = Number(s && s.searchMs);
    if (!isFinite(ms) || ms < 0 || !s.source) return '';
    // أقل من 1 ملي ثانية يُكتب «أقل من 0.001 ث» بدل «0.000 ث» — under 1 ms reads «under 0.001 s», not «0.000 s»
    // الرقم وحده باتجاه اليسار، والوحدة «ث» بعده بالعربي فيُقرأ «2.56 ث» لا «ث 2.56» — the number alone is LTR, the unit follows in RTL
    const sec = (ms < 1 ? 'أقل من <b dir="ltr">0.001</b>' : '<b dir="ltr">' + (ms / 1000).toFixed(ms < 100 ? 3 : 2) + '</b>') + ' ث';
    // شارة قصيرة في رأس البطاقة (المدة والمصدر)، والجملة الكاملة في title وaria-label — a short chip in the card head, the full sentence in title/aria-label
    const full = s.source === 'local' ? 'وُجدت في ' + sec.replace(/<[^>]+>/g, '') + ' — من نسخة جهازك'
      : s.newOnServer ? 'وُجدت في ' + sec.replace(/<[^>]+>/g, '') + ' — من الخادم (محطة مضافة حديثًا، تُضاف لنسخة جهازك تلقائيًا)'
        : 'وُجدت في ' + sec.replace(/<[^>]+>/g, '') + ' — من الخادم · حمّل البيانات المؤقتة لبحث فوري';
    const local = s.source === 'local';
    return '<span class="st-search-time ' + (local ? 'local' : 'server') + '" data-role="search-time" title="' + full + '" aria-label="' + full + '">' +
      (local ? '⚡ ' : '⏱ ') + sec + ' · ' + (local ? 'جهازك' : 'الخادم') + '</span>';
  }

  /* إعادة التصميم — المرحلة ج (19 أكتوبر، نموذج محمد): لوحة مدمجة تحت الخريطة بدل جزأين فوقها وتحتها، فتأخذ الخريطة
   * باقي الشاشة وتظهر كل الأزرار بلا تمرير. الرأس: شارة النوع (أخضر توزيع / أزرق تحويل) ورقم المحطة، ثم المغذي والمنطقة.
   * Redesign — stage C (19 Oct, Mohammed's mock-up): one compact sheet under the map instead of parts above and below it,
   * so the map takes the rest of the screen and every button shows with no scrolling. */
  const TYPE_ICON = {
    // الرمزان المعتمدان (ملاحظة محمد 2.8): الشبكة للتوزيع، والسهمان للتحويل — نفس رمزي بطاقات الأرقام (stats-cards.js)
    // The approved symbols (Mohammed's note 2.8): the network for distribution, the two arrows for substations
    'توزيع': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.5 5.2M12 11.5l5.5 5.2"/></svg>',
    'تحويل': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></svg>'
  };
  const BTN_ICON = {
    navigate: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3 3 10.5l7.5 2.9L13.4 21z"/></svg>',
    // دبوس قوقل ماب بألوانه (طلب محمد) — the Google Maps pin in its colors
    google: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5a8 8 0 0 0-8 8c0 5.6 6.4 11.9 7.3 12.8a1 1 0 0 0 1.4 0C13.6 21.4 20 15.1 20 9.5a8 8 0 0 0-8-8z" fill="#EA4335"/><path d="M12 1.5a8 8 0 0 0-6.6 3.5l4.3 3.6A3 3 0 0 1 12 6.5V1.5z" fill="#1A73E8"/><path d="M5.4 5A8 8 0 0 0 4 9.5c0 1.7.6 3.5 1.5 5.2l4.4-4.6a3 3 0 0 1-.2-1.5z" fill="#FBBC04"/><path d="M5.5 14.7c1.7 3.2 4.8 6.3 5.8 7.6a1 1 0 0 0 1.4 0l-2.8-12.2z" fill="#34A853"/><circle cx="12" cy="9.5" r="3" fill="#fff"/></svg>',
    share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>',
    edit: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/></svg>',
    del: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
    feeder: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    om: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>'
  };
  function btn_(act, cls, icon, label, extra) {
    return '<button class="st-btn ' + cls + '" type="button" data-act="' + act + '"' + (extra || '') + '><span class="st-ico">' + BTN_ICON[icon] + '</span><span class="st-lbl">' + label + '</span></button>';
  }

  /* رأس البطاقة المختصرة (نموذج محمد 20 أكتوبر): مقبض، ثم رمز النوع ومعه «محطة توزيع» والرقم كبيرًا و«التفاصيل»، ثم خانات
   * «المغذي | المنطقة | عدد محطات المغذي» — خانة العدد تُظهر محطات المغذي على الخريطة بالضغط عليها.
   * The compact card head (Mohammed, 20 Oct): a handle, the type symbol with the type and a large number and «details»,
   * then the cells «feeder | region | feeder count» — the count cell shows the feeder's stations when tapped. */
  function topHtml_(s, deps) {
    const coords = Q.hasCoordinates(s), sub = s.type === 'تحويل', kind = sub ? 'is-sub' : 'is-dist';
    const fc = feederCount_(s, deps);
    return '<div class="sb-inner sb-top">' +
      '<div class="sheet-head">' +
        // الصف الأول: رمز النوع ثم جدول «المحطة | المنطقة | المغذي» — row one: the type symbol, then the «station | district | feeder» table
        '<div class="sheet-line">' +
          '<span class="sheet-badge ' + kind + '" aria-hidden="true">' + (TYPE_ICON[s.type] || TYPE_ICON['توزيع']) + '</span>' +
          // جدول بثلاث خانات في الوسط: المحطة | المنطقة | المغذي (طلب محمد 20 أكتوبر) — a centered 3-cell table: station | district | feeder
          '<div class="sheet-grid">' +
            '<div class="sheet-title sg-cell"><span class="sg-k">المحطة</span><span class="sheet-type sr-only ' + kind + '">' + (sub ? 'محطة تحويل' : 'محطة توزيع') + '</span>' +
              '<bdi class="sheet-id">' + esc(s.id) + '</bdi><span class="sheet-explore-txt" data-role="explore-txt"></span></div>' +
            '<div class="sg-cell sg-region"><span class="sg-k">المنطقة</span><span class="ss-region">' + (s.region ? esc(s.region) : '—') + '</span></div>' +
            '<div class="sg-cell sg-feeder"><span class="sg-k">المغذي</span><bdi class="sheet-feeder">' + (s.feeder ? esc(s.feeder) : '—') + '</bdi></div>' +
          '</div>' +
          // وضع الاستكشاف (قريب/مغذي): المسار وإنهاء العرض في السطر نفسه — explore mode: route and end in the same line
          '<div class="sheet-explore">' +
            '<button type="button" class="sheet-go" data-act="navigate"' + (coords ? '' : ' disabled') + '>' + BTN_ICON.navigate + '<span>المسار</span></button>' +
            '<button type="button" class="sheet-end" data-act="end-explore">إنهاء العرض</button></div>' +
        '</div>' +
        // الصف الثاني: مدة البحث | عدد محطات المغذي (يعرضها) | التفاصيل — row two: search time | feeder count (shows them) | details
        '<div class="sheet-row2">' +
          '<span class="sheet-time">' + searchTime_(s) + '</span>' +
          (fc != null ? '<button type="button" class="ss-count st-feeder" data-act="feeder" title="عرض محطات المغذي على الخريطة"><b class="st-count">' + fc + '</b> محطة ›</button>' : '') +
          (deps && deps.onDetails ? '<button type="button" class="sheet-more" data-act="details">التفاصيل ‹</button>' : '') +
        '</div>' +
      '</div>' +
      (coords ? '' : '<div class="st-note-warn" data-role="no-coords">' + NO_COORDS_MSG + '</div>') +
    '</div>';
  }

  /* عدد محطات المغذي من نسخة الجهاز (طلب محمد 19 أكتوبر): كل محطة بنفس اسم المغذي بعد إزالة المسافات الطرفية (قاعدة الخادم
   * وstation-query)، والمحطة نفسها منها. بلا مغذي أو بلا نسخة مكتملة ← null فلا تُعرض البطاقة (لا رقم غير مؤكد).
   * The feeder's station count from the device copy: every station with the same trimmed feeder name (the server's rule),
   * this one included. No feeder or no complete copy ← null, so no card (never an unconfirmed number). */
  function feederCount_(s, deps) {
    const feeder = String(s.feeder || '').trim(), all = deps.localStations ? deps.localStations() : null;
    if (!feeder || !Array.isArray(all) || !all.length) return null;
    return all.filter(function (x) { return String(x.feeder || '').trim() === feeder; }).length;
  }

  /* الأزرار في صف واحد دائمًا (نموذج محمد 20 أكتوبر)، ثم مدة البحث — the buttons always in one row, then the search time */
  function bottomHtml_(s, deps) {
    const coords = Q.hasCoordinates(s), om = !!deps.offlineMapUI, canEdit = !!(deps.canEdit && deps.canEdit());
    const canDelete = !!(deps.isAdmin && deps.isAdmin() && deps.onDelete); // للمدير فقط (التصميم «أ») / admin only (design «A»)
    const buttons = [
      btn_('navigate', 'primary st-main', 'navigate', 'المسار', coords ? '' : ' disabled'),
      coords ? '<a class="st-btn st-google" data-act="google" href="' + esc(googleMapsUrl(s)) + '" target="_blank" rel="noopener"><span class="st-ico">' + BTN_ICON.google + '</span><span class="st-lbl">قوقل ماب</span></a>'
        : '<span class="st-btn st-google st-disabled" aria-disabled="true"><span class="st-ico">' + BTN_ICON.google + '</span><span class="st-lbl">قوقل ماب</span></span>',
      btn_('share', 'st-share', 'share', 'مشاركة')
    ];
    if (canEdit) buttons.push(btn_('edit', 'st-edit', 'edit', 'تعديل'));
    if (canDelete) buttons.push(btn_('delete', 'st-danger', 'del', 'حذف'));
    // عدد محطات المغذي صار خانة في الرأس (النموذج)؛ «خريطة جدة» زر حين لا توجد تلك الخانة — إدارتها باقية في «المزيد»
    // The feeder count is now a head cell (the mock-up); «Jeddah map» is a button when that cell is absent — also in «More»
    if (feederCount_(s, deps) == null && om) buttons.push('<button class="st-btn st-om" type="button" data-act="offline-map"><span class="st-ico">' + BTN_ICON.om + '</span><span class="st-lbl">خريطة جدة</span><small data-om-status></small></button>');
    return '<div class="sb-inner sb-bottom">' +
      '<div class="st-sub sheet-actions" style="--n:' + buttons.length + '">' + buttons.join('') +
        (canEdit ? '' : '<button class="st-btn" type="button" data-act="edit" hidden>✏️ تعديل</button>') +
      '</div>' +
      // مدة البحث ومصدره تبقى في البطاقة، و«آخر تحديث» لنسخة المحطات انتقل إلى «التفاصيل» (قرار محمد 20 أكتوبر)
      // The search time/source stays on the card; the copy's «last update» moved to «details» (Mohammed, 20 Oct)
    '</div>';
  }

  /**
   * render(container, station, deps) ← { update(station), nearby(), feeder(), station(), destroy() }
   * deps: { onNavigate(s), onEdit(s), canEdit(), isAdmin(), onDelete(s), onFeeder(s) (عرض محطات المغذي), onDetails(s) (شاشة التفاصيل), onEndExplore() (إنهاء عرض القريبة/المغذي), offlineMapUI, toast(text),
   *         localStations() → Array|null, actionsContainer } — isAdmin + onDelete يُظهران «🗑️ حذف» (نافذته في delete-station.js)؛
   *         actionsContainer: مكان الجزء السفلي تحت الخريطة (بدونه يُرسم الجزءان معًا في container)
   *         / where the bottom part goes under the map (without it both parts draw in container)
   */
  function render(container, station, deps) {
    let s = station, alive = true;
    const bottom = deps.actionsContainer || null;
    const boxes = bottom ? [container, bottom] : [container];
    const toast = function (t) { try { if (deps.toast) deps.toast(t); } catch (e) { /* التنبيه لا يكسر البطاقة / never breaks the card */ } };

    let explore = null; // نص وضع الاستكشاف أو null — the explore-mode text or null
    function paintExplore_() {
      boxes.forEach(function (b) { b.classList.toggle('is-explore', explore != null); });
      const t = container.querySelector('[data-role="explore-txt"]'); if (t) t.textContent = explore || '';
    }
    function draw_() {
      if (bottom) { container.innerHTML = topHtml_(s, deps); bottom.innerHTML = bottomHtml_(s, deps); }
      else container.innerHTML = topHtml_(s, deps) + bottomHtml_(s, deps);
      boxes.forEach(function (b) { b.classList.add('show'); });
      paintExplore_();
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
        else if (act === 'feeder') { if (deps.onFeeder) deps.onFeeder(s); }
        else if (act === 'details') { if (deps.onDetails) deps.onDetails(s); }
        else if (act === 'end-explore') { if (deps.onEndExplore) deps.onEndExplore(); }
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
      try { return await Q.query(mode, s, local, mode === 'nearby' ? Q.MAP_NEARBY_KM : null); } // قريب الخريطة: 5 كم / the map's nearby: 5 km
      catch (err) { return { error: 'تعذّر جلب المحطات، حاول مرة أخرى' }; }
    }

    boxes.forEach(function (b) { b.addEventListener('click', onClick_); });
    draw_();

    return {
      update: function (next) { if (alive) { s = next; draw_(); } },
      /* بطاقة مختصرة أثناء استكشاف القريبة أو المغذي (نص العدد)، وnull للبطاقة الكاملة — compact while exploring, null for the full card */
      setExplore: function (text) { if (alive) { explore = text == null ? null : String(text); paintExplore_(); } },
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
