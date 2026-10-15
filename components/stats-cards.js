/* ============================================================
 * components/stats-cards.js — «📊 لوحة المعلومات»: بطاقة إحصاءات واحدة (تصميم محمد — 15 أكتوبر)
 * ============================================================
 * - أعلى البطاقة: إجمالي المحطات للجدولين معًا.
 * - تحته ثلاثة أعمدة ظاهرة دائمًا بلا ضغط، لكل عمود عدد محطاته ثم إضافة/تعديل اليوم: توزيع، تحويل،
 *   والإجمالي (الجدولان معًا) — فيُرى مكان أي فرق مباشرة.
 * - تُعدّ المحطات الموجودة فعلًا فقط (الخادم 09_Stats.gs)؛ وعمليات اليوم على محطات لم تعد موجودة تظهر في
 *   جدول «فرق للمراجعة» أسفل البطاقة، ولا يظهر الجدول إلا إذا وُجد فرق.
 * - طلب getStats واحد فقط في أي لحظة (أي استدعاء أثناء طلب جارٍ ينتظره)؛ عند العودة للصفحة (visibilitychange/focus)
 *   يُحدَّث فقط إن مرّت 3 دقائق على آخر جلب؛ «آخر تحديث» يُعاد حسابه كل 30 ث.
 * - الفشل لا يكسر الصفحة ولا يغيّر الأرقام المعروضة؛ بلا إنترنت لا طلب؛ قبل أول جلب ناجح «—» لا «0»؛ النصوص تُكتب
 *   نصًا (textContent) لا HTML.
 *
 * The «📊 dashboard»: one stats card (Mohammed's design — 15 Oct). Top: total stations of both tables. Below, three
 * always-visible columns, each with its station count then today's adds/edits: distribution, substation, and the total. Only existing stations are counted; today's operations on stations that no longer exist show in
 * a «difference to review» table, shown only when there is one. One getStats request at a time; refresh on return only
 * after 3 minutes; «last update» recomputed every 30 s; failures keep the shown numbers; «—» before the first success.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, D = global.SecDates;
  if (!CONFIG || !D) throw new Error('stats-cards.js يحتاج الإعدادات وutils/dates.js قبله / needs config and utils/dates.js first');
  const STALE_MS = CONFIG.TIMING.STATS_STALE_MS;
  const LABEL_REFRESH_MS = 30 * 1000;

  // أيقونات خطية بسيطة — simple line icons
  const SVG = function (body) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>'; };
  const ICONS = {
    dist: SVG('<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.5 5.2M12 11.5l5.5 5.2"/>'),
    sub: SVG('<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>'),
    all: SVG('<path d="M18 5H7l6 7-6 7h11"/>')
  };

  const OP_ICONS = {
    add: SVG('<path d="M12 5v14M5 12h14"/>'),
    edit: SVG('<path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>')
  };
  // الأعمدة الثلاثة: [المفتاح، الصنف، العنوان، عدد محطات الجدول، إضافات اليوم، تعديلات اليوم] — the three columns
  const COLUMNS = [
    ['dist', 'sb-dist', 'توزيع', 'distribution', 'additionsDistribution', 'editsDistribution'],
    ['sub', 'sb-sub', 'تحويل', 'substations', 'additionsSubstations', 'editsSubstations'],
    ['all', 'sb-all', 'الإجمالي', 'totalStations', 'additions', 'edits']
  ];
  const REMOVED_HEAD = ['رقم المحطة', 'الجدول', 'العملية', 'الوقت', 'بواسطة'];

  function html_() {
    return '<div class="dashboard-label">📊 لوحة المعلومات</div>' +
      '<div class="stats-board">' +
        '<div class="sb-head"><span class="sb-icon">🏢</span><span class="sb-title">إجمالي المحطات</span></div>' +
        '<span class="sb-total" data-v="totalStations">—</span>' +
        '<div class="sb-cols">' + COLUMNS.map(function (c) {
          return '<div class="sb-col ' + c[1] + '" data-col="' + c[0] + '">' +
            '<div class="sb-col-icon">' + ICONS[c[0]] + '</div>' +
            '<div class="sb-col-title">' + c[2] + '</div><span class="sb-col-num" data-v="' + c[3] + '">—</span>' +
            '<div class="sb-pair">' +
              '<div class="sb-cell"><span class="sb-op sb-add">' + OP_ICONS.add + '</span><span class="sb-k">إضافة</span><span class="sb-v" data-v="' + c[4] + '">—</span></div>' +
              '<div class="sb-cell"><span class="sb-op sb-edit">' + OP_ICONS.edit + '</span><span class="sb-k">تعديل</span><span class="sb-v" data-v="' + c[5] + '">—</span></div>' +
            '</div></div>';
        }).join('') + '</div>' +
        '<div class="sb-foot">الإضافة والتعديل لليوم · آخر تحديث: <span data-role="updated">—</span></div>' +
        '<details class="sb-removed" hidden><summary data-role="removed-summary"></summary>' +
          '<p class="sb-removed-note">عمليات اليوم على محطات لم تعد موجودة في أي جدول — غير محسوبة في الأرقام أعلاه. راجعها: حذف طبيعي بعد إضافة/تعديل، أم مشكلة فعلية.</p>' +
          '<div class="sec-table-wrap"><table class="sec-table"><thead><tr>' + REMOVED_HEAD.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
          '</tr></thead><tbody data-role="removed-rows"></tbody></table></div>' +
        '</details>' +
      '</div>';
  }

  /* وقت العملية بتوقيت الرياض — The operation time in Riyadh time */
  function timeOf_(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    try { return d.toLocaleTimeString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }); } catch (e) { return d.toISOString().slice(11, 16); }
  }

  /**
   * mount(container) — يرسم البطاقة داخل الحاوية ويجلب الإحصاءات بجوال الجلسة (session.js)
   * يُرجع { refresh(force) → Promise<bool>، refreshIfStale()، stats()، lastFetchAt()، destroy() }
   */
  function mount(container) {
    let stats = null, lastOkAt = 0, lastTryAt = 0, inFlight = null, alive = true;
    container.innerHTML = html_();
    const removedBox = container.querySelector('.sb-removed');

    function paint_() {
      container.querySelectorAll('[data-v]').forEach(function (el) {
        const v = stats ? stats[el.dataset.v] : undefined;
        el.textContent = typeof v === 'number' && isFinite(v) ? String(v) : '—';
      });
      paintRemoved_();
      paintUpdated_();
    }
    function paintUpdated_() {
      const txt = lastOkAt ? D.relativeTime(new Date(lastOkAt)) : '—';
      container.querySelectorAll('[data-role="updated"]').forEach(function (el) { el.textContent = txt; });
    }
    /* جدول الفرق: يظهر فقط إن وُجد فرق — The difference table: shown only when there is one */
    function paintRemoved_() {
      const list = stats && Array.isArray(stats.removedToday) ? stats.removedToday : [];
      const count = stats && typeof stats.removedTodayCount === 'number' && isFinite(stats.removedTodayCount) ? stats.removedTodayCount : list.length;
      removedBox.hidden = count < 1;
      if (count < 1) return;
      container.querySelector('[data-role="removed-summary"]').textContent = '⚠️ فرق للمراجعة: ' + count + ' عملية اليوم على محطات لم تعد موجودة' + (list.length < count ? ' (يُعرض أحدث ' + list.length + ')' : '');
      const body = container.querySelector('[data-role="removed-rows"]');
      body.textContent = '';
      list.forEach(function (r) {
        const tr = global.document.createElement('tr');
        [[r && r.id, 'mono sb-ltr'], [r && r.table], [r && r.op], [timeOf_(r && r.at), 'mono'], [r && r.by, 'mono sb-ltr']].forEach(function (cell) {
          const td = global.document.createElement('td');
          td.textContent = cell[0] == null || cell[0] === '' ? '—' : String(cell[0]);
          if (cell[1]) td.className = cell[1];
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
    }

    /* طلب واحد في أي لحظة — One request at a time */
    function refresh() {
      if (!alive) return Promise.resolve(false);
      if (inFlight) return inFlight;
      if (global.navigator.onLine === false) return Promise.resolve(false); // بلا إنترنت فعلًا ← لا طلب محكوم بالفشل / truly offline ← no doomed request
      lastTryAt = Date.now();
      inFlight = (async function () {
        try {
          const res = await global.SecApi.call('getStats', {}, { phone: true });
          if (!alive || !res || !res.success) return false;
          stats = res; lastOkAt = Date.now();
          paint_();
          return true;
        } catch (e) {
          return false; // الأرقام الحالية تبقى كما هي / the shown numbers stay
        } finally { inFlight = null; }
      })();
      return inFlight;
    }
    /* العودة للصفحة: فقط إن مرّت 3 دقائق على آخر محاولة — Returning: only if 3 minutes passed since the last try */
    function refreshIfStale() { if (Date.now() - lastTryAt > STALE_MS) refresh(); }
    function onVisible_() { if (global.document.visibilityState === 'visible') refreshIfStale(); }

    global.document.addEventListener('visibilitychange', onVisible_);
    global.addEventListener('focus', refreshIfStale);
    const timer = global.setInterval(paintUpdated_, LABEL_REFRESH_MS);
    refresh();

    return {
      refresh: refresh, refreshIfStale: refreshIfStale,
      stats: function () { return stats ? Object.assign({}, stats) : null; },
      lastFetchAt: function () { return lastOkAt ? new Date(lastOkAt) : null; },
      destroy: function () {
        if (!alive) return;
        alive = false;
        global.clearInterval(timer);
        global.document.removeEventListener('visibilitychange', onVisible_);
        global.removeEventListener('focus', refreshIfStale);
        container.innerHTML = '';
      }
    };
  }

  global.SecStatsCards = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
