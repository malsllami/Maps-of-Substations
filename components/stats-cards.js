/* ============================================================
 * components/stats-cards.js — «📊 لوحة المعلومات»: بطاقات الإحصاءات الثلاث القابلة للتوسع
 * ============================================================
 * تصميم V1 وسلوكه كما هما:
 * - ثلاث بطاقات: ✏️ تعديلات اليوم (برتقالي)، ➕ إضافات اليوم (أزرق)، 🏢 إجمالي المحطات (أخضر).
 * - الضغط على بطاقة يفتح تفاصيلها (توزيع/تحويل + «آخر تحديث» بالزمن النسبي) ويغلق غيرها؛ الضغط مرة أخرى يغلقها.
 * - طلب getStats واحد فقط في أي لحظة (أي استدعاء أثناء طلب جارٍ ينتظره)؛ عند العودة للصفحة (visibilitychange/focus)
 *   يُحدَّث فقط إن مرّت 3 دقائق على آخر جلب؛ «آخر تحديث» يُعاد حسابه كل 30 ث.
 * - الفشل لا يكسر الصفحة ولا يغيّر الأرقام المعروضة.
 * V2: بلا إنترنت فعلًا لا يُرسل طلب؛ قبل أول جلب ناجح تُعرض «—» لا «0» (في V1 كانت 0 حتى لو فشل الطلب — رقم غير حقيقي)؛ الأرقام تُكتب نصًا؛ «آخر
 *   تحديث» من آخر جلب ناجح فقط (في V1 من آخر محاولة حتى الفاشلة)؛ refresh(true) للصفحة بعد إضافة/تعديل وزر «تحديث».
 *
 * The «📊 dashboard»: three expandable stats cards. V1's design and behavior as is: tapping a card opens its details
 * (distribution/substation + relative «last update») and closes the others; one getStats request at a time; on return to
 * the page refresh only if 3 minutes passed; «last update» recomputed every 30 s; a failure never breaks the page nor
 * changes the shown numbers. V2: «—» before the first successful fetch, not «0» (V1 showed 0 even on failure — not a real
 * number); numbers set as text; «last update» from the last SUCCESSFUL fetch only (V1 used the last attempt, even failed);
 * refresh(true) for the page after an add/edit and the «refresh» button.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, D = global.SecDates;
  if (!CONFIG || !D) throw new Error('stats-cards.js يحتاج الإعدادات وutils/dates.js قبله / needs config and utils/dates.js first');
  const STALE_MS = CONFIG.TIMING.STATS_STALE_MS;
  const LABEL_REFRESH_MS = 30 * 1000;

  // البطاقات بترتيب V1 — the cards in V1's order
  const CARDS = [
    { key: 'edits', cls: 'sc-orange', icon: '✏️', label: 'تعديلات اليوم', total: 'edits',
      rows: [['توزيع', 'editsDistribution', 'var(--teal)'], ['تحويل', 'editsSubstations', 'var(--blue-mid)']] },
    { key: 'additions', cls: 'sc-blue', icon: '➕', label: 'إضافات اليوم', total: 'additions',
      rows: [['توزيع', 'additionsDistribution', 'var(--teal)'], ['تحويل', 'additionsSubstations', 'var(--blue-mid)']] },
    { key: 'stations', cls: 'sc-green', icon: '🏢', label: 'إجمالي المحطات', total: 'totalStations',
      rows: [['محطات توزيع', 'distribution', 'var(--teal)'], ['محطات تحويل', 'substations', 'var(--blue-mid)']] }
  ];

  function html_() {
    return '<div class="dashboard-label">📊 لوحة المعلومات</div><div class="cards-row">' + CARDS.map(function (c) {
      return '<div class="stat-card ' + c.cls + '" data-card="' + c.key + '" role="button" tabindex="0" aria-expanded="false">' +
        '<div class="top"><div class="sc-icon">' + c.icon + '</div><span class="chev">▾</span></div>' +
        '<span class="num" data-v="' + c.total + '">—</span><div class="label">' + c.label + '</div>' +
        '<div class="stat-panel"><div class="stat-panel-inner">' +
          c.rows.map(function (r) {
            return '<div class="stat-panel-row"><span><span class="legend-dot" style="background:' + r[2] + '"></span>' + r[0] + '</span><span class="v" data-v="' + r[1] + '">—</span></div>';
          }).join('') +
          '<div class="stat-panel-row"><span>آخر تحديث</span><span class="v" data-role="updated">—</span></div>' +
        '</div></div></div>';
    }).join('') + '</div>';
  }

  /**
   * mount(container) — يرسم البطاقات داخل الحاوية ويجلب الإحصاءات بجوال الجلسة (session.js)
   * يُرجع { refresh(force) → Promise<bool>، refreshIfStale()، stats()، lastFetchAt()، destroy() }
   */
  function mount(container) {
    let stats = null, lastOkAt = 0, lastTryAt = 0, inFlight = null, alive = true;
    container.innerHTML = html_();
    const cards = Array.prototype.slice.call(container.querySelectorAll('.stat-card'));

    function paint_() {
      container.querySelectorAll('[data-v]').forEach(function (el) {
        const v = stats ? stats[el.dataset.v] : undefined;
        el.textContent = typeof v === 'number' && isFinite(v) ? String(v) : '—';
      });
      paintUpdated_();
    }
    function paintUpdated_() {
      const txt = lastOkAt ? D.relativeTime(new Date(lastOkAt)) : '—';
      container.querySelectorAll('[data-role="updated"]').forEach(function (el) { el.textContent = txt; });
    }

    /* طلب واحد في أي لحظة — One request at a time */
    function refresh() {
      if (!alive) return Promise.resolve(false);
      if (inFlight) return inFlight;
      if (global.navigator.onLine === false) return Promise.resolve(false); // V2: بلا إنترنت فعلًا ← لا طلب محكوم بالفشل / truly offline ← no doomed request
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

    function toggle_(card) {
      const wasOpen = card.classList.contains('expanded');
      cards.forEach(function (c) { c.classList.remove('expanded'); c.setAttribute('aria-expanded', 'false'); });
      if (!wasOpen) { card.classList.add('expanded'); card.setAttribute('aria-expanded', 'true'); }
    }
    function onClick_(e) { const card = e.target.closest('.stat-card'); if (card && container.contains(card)) toggle_(card); }
    function onKey_(e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('stat-card')) { e.preventDefault(); toggle_(e.target); } }
    function onVisible_() { if (global.document.visibilityState === 'visible') refreshIfStale(); }

    container.addEventListener('click', onClick_);
    container.addEventListener('keydown', onKey_);
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
        container.removeEventListener('click', onClick_);
        container.removeEventListener('keydown', onKey_);
        global.document.removeEventListener('visibilitychange', onVisible_);
        global.removeEventListener('focus', refreshIfStale);
        container.innerHTML = '';
      }
    };
  }

  global.SecStatsCards = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
