/* ============================================================
 * components/admin-dashboard.js — لوحة العمليات للمدير: المؤشرات والأقسام المطوية وتقرير الأمس
 * ============================================================
 * سلوك V1 (admin.html) وتصميمه ونصوصه كما هي:
 * - شريط التنبيهات (يظهر فقط مع تنبيهات فعلية)، «⚡ طلبات اليوم على السكربت» بمؤشر دائري يتغير لونه بالنسبة، «🗄️ عمليات
 *   خصائص السكربت اليوم»، «📊 أكثر ٥ أنواع طلبات اليوم»، ثلاث بطاقات (إضافات اليوم، تعديلات اليوم، إجمالي المحطات توزيع/تحويل).
 * - أقسام مطوية (يُفتح واحد فقط، ويُحمَّل محتواه أول فتح فقط): 👥 المتواجدون، + الإضافات، ✎ التعديلات (أول 5 + «عرض التفاصيل
 *   الكاملة والتصدير ←»)، 📈 زوار آخر 7 أيام (Chart.js)، 🔥 أوقات الذروة، 🗺️ نشاط المناطق، ⭐ جودة البيانات، ⚠️ سجل النظام.
 * - طلب اللوحة مرة + إعادة تلقائية واحدة بعد 2 ث لفشل الاتصال (لا لرفض الخادم)؛ «fresh» من زر التحديث يتجاوز كاش الخادم.
 * V2:
 * - كل طلبات اللوحة السبعة بتذكرة الجلسة (مدير بالبصمة) — في V1 كانت الأقسام والتفاصيل ترسل بلا تذكرة.
 * - قسم جديد «📋 تقرير الأمس» (قرار محمد): نفس أرقام البريد اليومي من getDailyReport، بلا إرسال.
 * - الحالات الخاصة: صلاحية غير كافية (NOT_ADMIN) برسالة ورابط الدخول بالبصمة، انتهاء الجلسة ← handleExpired، فشل الخادم
 *   بزر «إعادة المحاولة»، تحميل بطيء بملاحظة بعد 8 ث، بيانات جزئية ← «—» بدل NaN، أقسام فارغة برسائل V1.
 * - التواريخ ميلادي + هجري؛ الجداول بالقاعدة الموحّدة؛ كل نص من البيانات يُكتب نصًا؛ فشل مكتبة الرسم ← الأرقام جدولًا.
 *
 * The admin operations dashboard. V1's behavior, design and texts. V2: every request carries the admin ticket, a new
 * «yesterday's report» section, explicit special states, dual dates, the unified tables, text-only data, a chart fallback.
 * ============================================================ */
(function (global) {
  'use strict';

  const API = global.SecApi, S = global.SecSession, H = global.SecHtml, D = global.SecDates, CONFIG = global.SEC2_CONFIG;
  if (!API || !S || !H || !D || !CONFIG) throw new Error('admin-dashboard.js يحتاج api-client وsession وhtml وdates والإعدادات قبله / missing dependencies');
  const esc = H.esc;
  const RETRY_MS = 2000, SLOW_MS = 8000, PREVIEW_ROWS = 5;
  const AUDIT = { ADD: 'إضافة_محطة_جديدة', EDIT: 'تعديل_إحداثية' }; // أنواع «سجل التعديلات» في الخادم / the server's audit types
  const MSG = {
    LOADING: 'جاري التحميل...', SLOW: 'التحميل أبطأ من المعتاد — الخادم ما زال يعمل على الطلب...',
    FAILED: 'تعذّر تحميل البيانات: ', RETRY: 'إعادة المحاولة', LAZY: 'جاري التحميل عند الفتح...', LOAD_FAIL: 'تعذّر التحميل',
    NOT_ADMIN: 'هذه اللوحة مخصّصة للمدير المسجّل بالبصمة فقط', NOT_ADMIN_HINT: 'سجّل الدخول بالبصمة من جهازك لفتح لوحة المدير',
    NO_PRESENT: 'لا يوجد نشاط اليوم بعد', NO_ADDS: 'لا توجد إضافات مسجّلة بعد', NO_EDITS: 'لا توجد تعديلات مسجّلة بعد',
    NO_REGIONS: 'لا توجد بيانات نشاط كافية آخر 30 يومًا', CHART_FAIL: 'تعذّر تحميل مكتبة الرسم — الأرقام كما هي:',
    MORE: 'عرض التفاصيل الكاملة والتصدير ←', NONE: 'لا شيء'
  };
  // تسميات عرض لأسماء الإجراءات التقنية (V1) — display labels for technical action names (V1)
  const ACTION_LABELS = {
    ping: 'فحص الاتصال', searchStation: 'بحث بالخادم (احتياطي)', getAllStations: 'تحميل فهرس المحطات', getDataVersion: 'فحص إصدار البيانات',
    getUpdatedStationsSince: 'مزامنة المحطات', updateCoordinates: 'تعديل إحداثية', addNewStation: 'إضافة محطة', deleteStation: 'حذف محطة',
    getNearbyStations: 'محطات قريبة', getFeederStations: 'محطات المغذي', getMemberProfile: 'ملف العضو', getMemberProfileLite: 'ملف العضو (مختصر)',
    getOperationsDashboard: 'تحميل لوحة العمليات', registerUser: 'تسجيل عضو', loginByPhone: 'دخول برقم الجوال', getStats: 'الإحصاءات',
    generateLoginChallenge: 'تحدي دخول بالبصمة', verifyAssertion: 'تحقق دخول بالبصمة', generateRegisterChallenge: 'تحدي تسجيل بصمة',
    registerCredential: 'حفظ بصمة', refreshIdentityToken: 'تجديد الجلسة', getSettingsLists: 'قوائم الإعدادات', logClientError: 'تسجيل أخطاء المتصفح'
  };
  const ALERT_ICON = {
    'فشل تحديث بيانات': '⚠️', 'محاولة دخول خاطئة': '🔒', 'مشاكل اتصال': '📡', 'تنبيهات': 'ℹ️', 'صفحة 404 بدل الرد': '🚫',
    'فشل أثناء الخلفية أو النوم': '🌙', 'نتيجة كتابة غير مؤكدة': '❔', 'تأخر وعالجه الاحتياطي': '🟡', 'خطأ برمجي': '🐞', 'رفض دخول لوحة المدير': '⛔'
  };
  const REPORT_COLOR = { green: '#2ECC71', yellow: '#C8A24E', orange: '#E08A3C', blue: 'var(--blue-mid)', teal: 'var(--teal)', red: '#E0654F' };
  const CHEV = '<svg class="acc-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  // ===== أدوات العرض — Display helpers =====
  function num_(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function show_(v) { const n = num_(v); return n === null ? '—' : String(n); }
  function pct_(part, whole) { const a = num_(part), b = num_(whole); return a === null || !b ? null : Math.min(100, Math.round(a / b * 100)); }
  /* لون المؤشر: quota (الأعلى أسوأ) أو quality (الأعلى أفضل) — V1 */
  function gaugeColor(p, type) {
    const good = type === 'quality' ? p >= 90 : p <= 60, warn = type === 'quality' ? (p >= 70 && p < 90) : (p > 60 && p <= 85);
    return good ? '#2ECC71' : warn ? '#C8A24E' : '#E0654F';
  }
  function ring_(p, type, size) {
    if (p === null) return '<div class="ops-ring-empty" style="width:' + size + 'px;height:' + size + 'px">—</div>';
    const color = gaugeColor(p, type), r = size / 2 - 7, c = 2 * Math.PI * r, off = c - (Math.min(100, Math.max(0, p)) / 100) * c;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + p + '%">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--border-strong)" stroke-width="7"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="7" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '" stroke-linecap="round" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')" style="transition:stroke-dashoffset .6s ease, stroke .4s ease"/>' +
      '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="' + Math.round(size * 0.2) + '" font-weight="800" fill="' + color + '" font-family="\'JetBrains Mono\',monospace">' + p + '%</text></svg>';
  }
  /* «yyyy-MM-dd HH:mm» بتوقيت الرياض ← Date — Riyadh "yyyy-MM-dd HH:mm" ← Date */
  function riyadhStamp(text) { const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(text || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5])) : null; }
  /* «dd/MM/yyyy» + «HH:mm:ss» بتوقيت الرياض ← Date — Riyadh date + time ← Date */
  function riyadhDayTime(date, time) {
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(date || '')), t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(time || '00:00:00'));
    return d && t ? new Date(Date.UTC(+d[3], +d[2] - 1, +d[1], +t[1] - 3, +t[2], +(t[3] || 0))) : null;
  }
  /* خلية تاريخ: ميلادي وتحته هجري (أو النص كما هو) — A date cell: Gregorian with Hijri below */
  function dateCell(date) { return date ? esc(D.gregorian(date)) + '<span class="sub">' + esc(D.hijri(date)) + '</span>' : '—'; }
  function table_(head, rows) { return '<div class="sec-table-wrap"><table class="sec-table"><thead><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'; }

  /**
   * mount(container, opts) — opts: { onOpenDetail(kind: 'present'|'additions'|'edits'), loadChart() → Promise<Chart|null> (للاختبار) }
   * يُرجع { load(fresh) → Promise<'ok'|'failed'|'denied'|'expired'>، data()، openSection(name)، destroy() }
   */
  function mount(container, opts) {
    const o = opts || {}, doc = global.document;
    container.innerHTML =
      '<div class="alert-strip" data-role="alerts" hidden></div>' +
      '<div class="perf-link-bar"><a href="perf.html" class="perf-link-btn">📈 قياس زمن الطلبات</a>' +
        '<span class="perf-link-note">يعرض قياسات هذا الجهاز والمتصفح فقط — افتح الموقع بتبويب آخر واستخدمه، والجدول يتحدّث تلقائيًا</span></div>' +
      '<div data-role="main"></div>';
    const main = container.querySelector('[data-role="main"]'), alerts = container.querySelector('[data-role="alerts"]');
    let data = null, busy = null, alive = true, chart = null, chartData = null;
    const loaded = {};

    /* طلب إداري بتذكرة الجلسة؛ يرمي { expired } أو { denied } أو خطأ الاتصال — An admin request with the session ticket */
    async function call_(action, payload) {
      const res = await API.call(action, payload || {}, { token: true });
      if (S.isTokenInvalid(res)) { const e = new Error('expired'); e.expired = true; throw e; }
      if (res && res.code === 'NOT_ADMIN') { const e = new Error(MSG.NOT_ADMIN); e.denied = true; throw e; }
      if (!res || !res.success) { const e = new Error((res && res.error) || 'خطأ غير معروف'); e.refused = true; throw e; }
      return res;
    }
    function spinner_(text) { return '<div class="loading-overlay"><div class="spinner"></div> <span>' + (text || MSG.LOADING) + '</span></div>'; }
    function denied_() {
      main.innerHTML = '<div class="err-msg" data-role="denied"><b>' + MSG.NOT_ADMIN + '</b><div class="err-hint">' + MSG.NOT_ADMIN_HINT + '</div>' +
        '<a class="detail-btn primary err-btn" href="auth.html">الدخول بالبصمة</a></div>';
    }
    function failed_(message) {
      main.innerHTML = '<div class="err-msg" data-role="failed"><div>' + MSG.FAILED + esc(message) + '</div>' +
        '<button type="button" class="detail-btn primary err-btn" data-act="retry">' + MSG.RETRY + '</button></div>';
    }

    // ===== التحميل — Loading =====
    async function load(fresh) {
      if (busy) return busy;
      busy = (async function () {
        Object.keys(loaded).forEach(function (k) { delete loaded[k]; });
        if (!data) main.innerHTML = spinner_();
        const slow = global.setTimeout(function () { const s = main.querySelector('.loading-overlay span'); if (s) s.textContent = MSG.SLOW; }, SLOW_MS);
        try {
          let d;
          try { d = await call_('getOperationsDashboard', { fresh: fresh === true }); }
          catch (first) {
            if (first.expired || first.denied || first.refused) throw first;
            await new Promise(function (r) { global.setTimeout(r, RETRY_MS); }); // إعادة واحدة لفشل الاتصال (V1) / one retry for connection failures (V1)
            d = await call_('getOperationsDashboard', { fresh: fresh === true });
          }
          if (!alive) return 'ok';
          data = d; render_(d);
          return 'ok';
        } catch (err) {
          if (!alive) return 'failed';
          if (err.expired) { S.handleExpired(); return 'expired'; }
          if (err.denied) { denied_(); return 'denied'; }
          failed_(err && err.message ? err.message : MSG.LOAD_FAIL);
          return 'failed';
        } finally { global.clearTimeout(slow); busy = null; }
      })();
      return busy;
    }

    // ===== الرسم الرئيسي — The main render =====
    function render_(d) {
      const quota = pct_(d.dailyRequests, d.dailyRequestLimit), quality = num_(d.dataQualityPct);
      const breakdown = (Array.isArray(d.dailyRequestBreakdown) ? d.dailyRequestBreakdown : []).map(function (it) {
        return '<div class="ops-breakdown-row"><span>' + esc(ACTION_LABELS[it.action] || it.action) + '</span><b>' + show_(it.count) + '</b></div>';
      }).join('');
      const propOps = num_(d.propOpsToday) !== null && num_(d.propOpsLimit) ?
        '<div class="ops-status-card" data-role="propops"><div class="ops-status-ring">' + ring_(pct_(d.propOpsToday, d.propOpsLimit), 'quota', 84) + '</div><div class="ops-status-info">' +
        '<div class="ops-status-title">🗄️ عمليات خصائص السكربت اليوم</div><div class="ops-status-count-line"><b class="ops-status-count">' + show_(d.propOpsToday) + '</b> من <b class="ops-status-count">' + show_(d.propOpsLimit) + '</b> عملية</div>' +
        '<div class="ops-status-note">عدّاد داخلي لعمليات خصائص السكربت التي رصدها النظام — وليس قراءة من جوجل للحصة المتبقية. الحد المعروض (' + show_(d.propOpsLimit) + ') هو الحد المنشور للحسابات المجانية، للمقارنة فقط.</div></div></div>' : '';
      const summary = d.alertsSummary && typeof d.alertsSummary === 'object' ? d.alertsSummary : {};
      main.innerHTML =
        '<div class="ops-status-card" data-role="quota"><div class="ops-status-ring">' + ring_(quota, 'quota', 84) + '</div><div class="ops-status-info">' +
          '<div class="ops-status-title">⚡ طلبات اليوم على السكربت</div><div class="ops-status-count-line"><b class="ops-status-count">' + show_(d.dailyRequests) + '</b> من <b class="ops-status-count">' + show_(d.dailyRequestLimit) + '</b> طلب</div>' +
          '<div class="ops-status-sub">' + esc(d.currentShiftLabel || '') + '</div></div></div>' +
        propOps +
        (breakdown ? '<div class="ops-breakdown-card"><div class="ops-breakdown-title">📊 أكثر ٥ أنواع طلبات اليوم (يوضّح سبب أي ارتفاع بالعدد)</div>' + breakdown + '</div>' : '') +
        '<div class="ops-row3">' +
          '<div class="ops-pill"><b style="color:var(--teal)">' + show_(d.additionsToday) + '</b><span>إضافات اليوم</span></div>' +
          '<div class="ops-pill"><b style="color:var(--blue-mid)">' + show_(d.editsToday) + '</b><span>تعديلات اليوم</span></div>' +
          '<div class="ops-pill"><b>' + show_(d.totalStations) + '</b><span>إجمالي المحطات</span><span class="ops-pill-split"><span style="color:var(--teal)">توزيع ' + show_(d.totalStationsDistribution) + '</span> · <span style="color:var(--blue-mid)">تحويل ' + show_(d.totalStationsSubstations) + '</span></span></div>' +
        '</div>' +
        section_('present', '👥 المتواجدون', 'اليوم ' + show_(d.activeUsersToday) + ' — الوردية ' + show_(d.activeUsersShift)) +
        section_('additions', '+ الإضافات', show_(d.additionsToday) + ' اليوم') +
        section_('edits', '✎ التعديلات', show_(d.editsToday) + ' اليوم') +
        section_('report', '📋 تقرير الأمس', 'نفس التقرير اليومي بالبريد') +
        section_('charts', '📈 زوار آخر 7 أيام', '') +
        section_('peak', '🔥 أوقات الذروة', '') +
        section_('regions', '🗺️ نشاط المناطق', '') +
        '<div class="acc-item" data-section="quality"><div class="acc-head" role="button" tabindex="0" aria-expanded="false"><div class="acc-head-title">⭐ جودة البيانات</div>' +
          '<div class="acc-head-side"><span class="acc-head-badge"' + (quality === null ? '' : ' style="color:' + gaugeColor(quality, 'quality') + '"') + '>' + (quality === null ? '—' : quality + '%') + '</span>' + CHEV + '</div></div>' +
          '<div class="acc-body"><div class="acc-body-inner"><div class="quality-row">' + ring_(quality, 'quality', 60) + '<div>' + show_(d.stationsNeedingReview) + ' محطة تحتاج مراجعة (إحداثية ناقصة) من أصل ' + show_(d.totalStations) + '</div></div></div></div></div>' +
        '<div class="acc-item" data-section="log"><div class="acc-head" role="button" tabindex="0" aria-expanded="false"><div class="acc-head-title">⚠️ سجل النظام</div><div class="acc-head-side">' + CHEV + '</div></div>' +
          '<div class="acc-body"><div class="acc-body-inner">' + (Object.keys(summary).map(function (c) {
            return '<div class="log-row"><span>' + (ALERT_ICON[c] || '') + ' ' + esc(c) + '</span><b>' + show_(summary[c]) + '</b></div>';
          }).join('') || '<div class="coming-soon">' + MSG.NONE + '</div>') + '</div></div></div>';
      const chips = Object.keys(summary).filter(function (c) { return num_(summary[c]) > 0; })
        .map(function (c) { return '<div class="alert-chip">' + (ALERT_ICON[c] || '⚠️') + ' ' + summary[c] + ' ' + esc(c) + '</div>'; }).join('');
      alerts.innerHTML = chips; alerts.hidden = !chips;
    }
    function section_(name, title, badge) {
      return '<div class="acc-item" data-section="' + name + '"><div class="acc-head" role="button" tabindex="0" aria-expanded="false"><div class="acc-head-title">' + title + '</div>' +
        '<div class="acc-head-side">' + (badge ? '<span class="acc-head-badge">' + esc(badge) + '</span>' : '') + CHEV + '</div></div>' +
        '<div class="acc-body"><div class="acc-body-inner" data-body="' + name + '"><div class="coming-soon">' + MSG.LAZY + '</div></div></div></div>';
    }

    // ===== الأقسام (تحميل كسول) — Sections (lazy) =====
    const LOADERS = {
      present: async function (box) {
        const r = await call_('getActiveUsersDetail', { period: 'today' }), users = (r.users || []).slice(0, PREVIEW_ROWS);
        box.innerHTML = (users.length ? table_(['الاسم', 'الجوال', 'الوردية', 'آخر نشاط'], users.map(function (u) {
          return '<tr><td>' + esc(u.name) + '</td><td dir="ltr" class="mono">' + esc(u.phone) + '</td><td>' + esc(u.shift || '—') + '</td><td>' + dateCell(riyadhStamp(u.lastActivity)) + '</td></tr>';
        }).join('')) : '<div class="coming-soon">' + MSG.NO_PRESENT + '</div>') + more_('present');
      },
      additions: function (box) { return changes_(box, AUDIT.ADD, MSG.NO_ADDS, 'additions'); },
      edits: function (box) { return changes_(box, AUDIT.EDIT, MSG.NO_EDITS, 'edits'); },
      report: async function (box) {
        const r = await call_('getDailyReport');
        const day = riyadhDayTime(r.dateLabel, '12:00');
        const badge = function (text, color) { return '<span class="rep-badge" style="color:' + (REPORT_COLOR[color] || REPORT_COLOR.teal) + ';border-color:' + (REPORT_COLOR[color] || REPORT_COLOR.teal) + '">' + esc(text) + '</span>'; };
        const rows = [
          ['أ) عدد طلبات السكربت', show_(r.requests) + ' / ' + show_(r.requestLimit) + ' (' + show_(r.quotaPct) + '%)', r.quotaColor],
          ['ب) الأعضاء الجدد المسجلين', show_(r.newMembers), 'teal'],
          ['ج) محطات مُعدَّلة (توزيع | تحويل)', show_(r.editsDistribution) + ' | ' + show_(r.editsSubstations), 'orange'],
          ['د) محطات مُضافة (توزيع | تحويل)', show_(r.additionsDistribution) + ' | ' + show_(r.additionsSubstations), 'blue'],
          ['س) الأخطاء الفعلية (برمجي | فشل تحديث | كتابة غير مؤكدة)', show_(r.realErrors), num_(r.realErrors) > 0 ? 'red' : 'green'],
          ['ص) مسجَّل للعلم (اتصال | 404 | خلفية | عالجه الاحتياطي…)', show_(r.infoErrors), 'teal']
        ];
        const cats = (r.categories || []).map(function (c) { return '<div class="rep-cat' + (c.real ? ' real' : '') + '">' + (c.real ? '● ' : '○ ') + esc(c.label) + ': <b>' + show_(c.count) + '</b></div>'; }).join('') || '<span class="rep-none">' + MSG.NONE + '</span>';
        box.innerHTML = '<div class="rep-date" data-role="report-date">' + (day ? esc(D.dualDate(day)) : esc(r.dateLabel || '—')) + '</div>' +
          '<div class="rep-rows">' + rows.map(function (x) { return '<div class="rep-row"><span>' + x[0] + '</span>' + badge(x[1], x[2]) + '</div>'; }).join('') +
          '<div class="rep-row rep-cats"><span>ش) تفصيل سجل الأخطاء حسب التصنيف</span><div>' + cats + '</div></div>' +
          '<div class="rep-row"><span>ر) حالة النظام (من الأخطاء الفعلية والحصة)</span>' + badge(r.status ? r.status.label : '—', r.status ? r.status.color : 'teal') + '</div></div>';
      },
      charts: async function (box) {
        const r = await call_('getVisitorsChart');
        chartData = { labels: r.labels || [], values: r.values || [] };
        box.innerHTML = '<div class="chart-box"><canvas data-role="chart" aria-label="زوار آخر 7 أيام"></canvas></div>';
        await drawChart_(box);
      },
      peak: async function (box) {
        const r = await call_('getPeakHoursHeatmap'), matrix = Array.isArray(r.matrix) ? r.matrix : [];
        const max = Math.max.apply(null, [1].concat(matrix.reduce(function (a, row) { return a.concat(row); }, [])));
        let html = '<div class="heatmap-grid"><div></div>';
        for (let h = 0; h < 24; h++) html += '<div class="heatmap-hour">' + (h % 3 === 0 ? h : '') + '</div>';
        matrix.forEach(function (row, d) {
          html += '<div class="heatmap-label">' + esc((r.weekdayLabels || [])[d] || '') + '</div>';
          row.forEach(function (count, h) {
            const k = count / max;
            html += '<div class="heatmap-cell" style="background:' + (count ? 'rgba(31,174,140,' + (0.15 + k * 0.85).toFixed(3) + ')' : 'var(--bg-elev)') + '" title="' + count + ' — ' + h + ':00"></div>';
          });
        });
        html += '</div>';
        if (r.peak) html += '<div class="heatmap-peak-note">🔥 أكثر وقت نشاطًا: <b>' + esc(r.peak.day) + ' — الساعة ' + r.peak.hour + ':00</b> (' + show_(r.peak.count) + ' حدث)</div>';
        box.innerHTML = html;
      },
      regions: async function (box) {
        const r = await call_('getRegionActivity'), regions = r.regions || [];
        if (!regions.length) { box.innerHTML = '<div class="coming-soon">' + MSG.NO_REGIONS + '</div>'; return; }
        const max = Math.max.apply(null, regions.map(function (x) { return x.count; }));
        box.innerHTML = regions.map(function (x) {
          return '<div class="region-bar-row"><div class="region-bar-label">' + esc(x.region) + '</div><div class="region-bar-track"><div class="region-bar-fill" style="width:' + Math.round(x.count / max * 100) + '%"></div></div><div class="region-bar-count">' + show_(x.count) + '</div></div>';
        }).join('');
      }
    };
    async function changes_(box, type, empty, kind) {
      const r = await call_('getChangesLog', { type: type, limit: PREVIEW_ROWS }), list = r.changes || [];
      box.innerHTML = (list.length ? table_(['المحطة', 'العضو', 'التاريخ'], list.map(function (c) {
        return '<tr><td class="mono" dir="ltr">' + esc(c.stationId) + '</td><td>' + esc(c.memberName) + '</td><td>' + dateCell(riyadhDayTime(c.date, c.time)) + '</td></tr>';
      }).join('')) : '<div class="coming-soon">' + empty + '</div>') + more_(kind);
    }
    function more_(kind) { return '<button type="button" class="detail-preview-link" data-detail="' + kind + '">' + MSG.MORE + '</button>'; }

    // ===== الرسم البياني — The chart =====
    function chartColors_() {
      const dark = (global.SecTheme ? global.SecTheme.get() : 'dark') === 'dark';
      return { grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)', text: dark ? '#8FA3B8' : '#52647A' };
    }
    function loadChartLib_() {
      if (o.loadChart) return o.loadChart();
      if (global.Chart) return Promise.resolve(global.Chart);
      return new Promise(function (resolve) {
        const s = doc.createElement('script');
        s.src = CONFIG.LIBRARIES.CHART_JS; s.async = true;
        s.onload = function () { resolve(global.Chart || null); };
        s.onerror = function () { resolve(null); };
        doc.head.appendChild(s);
      });
    }
    async function drawChart_(box) {
      const Chart = await loadChartLib_();
      if (!alive || !box.isConnected) return;
      const canvas = box.querySelector('[data-role="chart"]');
      if (!Chart || !canvas) { // المكتبة لم تُحمَّل ← الأرقام جدولًا (V2) / no library ← the numbers as a table (V2)
        box.innerHTML = '<div class="coming-soon">' + MSG.CHART_FAIL + '</div>' + table_(['اليوم', 'أحداث النشاط'], chartData.labels.map(function (l, i) { return '<tr><td>' + esc(l) + '</td><td class="mono">' + show_(chartData.values[i]) + '</td></tr>'; }).join(''));
        return;
      }
      const colors = chartColors_();
      if (chart) { try { chart.destroy(); } catch (e) { /* لا شيء / nothing */ } }
      chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels: chartData.labels, datasets: [{ label: 'أحداث النشاط', data: chartData.values, borderColor: '#1FAE8C', backgroundColor: 'rgba(31,174,140,.15)', fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: '#1FAE8C' }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { rtl: true } },
          scales: { x: { ticks: { color: colors.text, font: { size: 10 } }, grid: { color: colors.grid } }, y: { ticks: { color: colors.text, precision: 0 }, grid: { color: colors.grid }, beginAtZero: true } } }
      });
    }
    // تغيير الثيم يعيد ألوان الرسم (V2) — a theme change recolours the chart (V2)
    const unTheme = global.SecTheme && global.SecTheme.onChange ? global.SecTheme.onChange(function () {
      const box = main.querySelector('[data-body="charts"]'); if (chart && box) drawChart_(box);
    }) : null;

    // ===== الفتح والطي — Open and close =====
    async function openSection(name) {
      const item = main.querySelector('.acc-item[data-section="' + name + '"]');
      if (!item) return false;
      const wasOpen = item.classList.contains('open');
      main.querySelectorAll('.acc-item.open').forEach(function (el) { el.classList.remove('open'); el.querySelector('.acc-head').setAttribute('aria-expanded', 'false'); });
      if (wasOpen) return false;
      item.classList.add('open'); item.querySelector('.acc-head').setAttribute('aria-expanded', 'true');
      const box = item.querySelector('[data-body]');
      if (box && LOADERS[name] && !loaded[name]) {
        loaded[name] = true;
        box.innerHTML = spinner_();
        try { await LOADERS[name](box); }
        catch (err) {
          delete loaded[name];
          if (err.expired) { S.handleExpired(); return true; }
          if (err.denied) { denied_(); return true; }
          box.innerHTML = '<div class="coming-soon">' + MSG.LOAD_FAIL + ' <button type="button" class="link-btn" data-act="section-retry" data-name="' + name + '">' + MSG.RETRY + '</button></div>';
        }
      }
      return true;
    }
    function onClick_(e) {
      const head = e.target.closest('.acc-head');
      if (head) { openSection(head.closest('.acc-item').dataset.section); return; }
      const more = e.target.closest('[data-detail]');
      if (more && o.onOpenDetail) { o.onOpenDetail(more.dataset.detail); return; }
      if (e.target.closest('[data-act="retry"]')) { load(true); return; }
      const sr = e.target.closest('[data-act="section-retry"]');
      if (sr) { const item = sr.closest('.acc-item'); item.classList.remove('open'); openSection(sr.dataset.name); }
    }
    function onKey_(e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('acc-head')) { e.preventDefault(); openSection(e.target.closest('.acc-item').dataset.section); } }
    container.addEventListener('click', onClick_);
    container.addEventListener('keydown', onKey_);

    return {
      load: load, openSection: openSection,
      data: function () { return data; },
      destroy: function () {
        alive = false;
        container.removeEventListener('click', onClick_); container.removeEventListener('keydown', onKey_);
        if (typeof unTheme === 'function') unTheme();
        if (chart) { try { chart.destroy(); } catch (e) { /* لا شيء / nothing */ } }
        container.textContent = '';
      }
    };
  }

  global.SecAdminDashboard = { mount: mount, gaugeColor: gaugeColor, riyadhStamp: riyadhStamp, riyadhDayTime: riyadhDayTime, AUDIT: AUDIT, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
