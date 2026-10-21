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
 * تصميم محمد (15 أكتوبر) — الترتيب: شريط الأخطاء (مشاكل أول ظهور لها خلال 72 ساعة، شريط واحد لا بطاقات) ← «لوحة
 *   العمليات» بثلاث بطاقات (إجمالي المحطات توزيع/تحويل، إضافات اليوم، تعديلات اليوم) ← طلبات اليوم وعمليات الخصائص وأكثر 5
 *   كما هي ← الأقسام المطوية (المتواجدون بصفّ صور، الإضافات، التعديلات، تقرير الأمس) ← بطاقات ظاهرة تُحمَّل مع اللوحة
 *   (زوار 7 أيام بأعمدة وقيمها، أوقات الذروة بأعلى 3 ساعات، نشاط المناطق بدائرة) ← جودة البيانات ← سجل النظام (التصنيفات
 *   + أحدث المشاكل). كل الأرقام من ردود الخادم الحقيقية؛ ما لا مصدر له في النموذج لا يُعرض.
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
    'فشل أثناء الخلفية أو النوم': '🌙', 'نتيجة كتابة غير مؤكدة': '❔', 'تأخر وعالجه الاحتياطي': '🟡', 'تأخير اتصال': '🐢', 'تأخير اتصال طويل': '⏳', 'تعطّل الموقع': '🛑', 'كتابة تأكدت بإعادة الإرسال': '✅', 'خروج قسري': '🚪', 'خطأ برمجي': '🐞', 'رفض دخول لوحة المدير': '⛔'
  };
  const REPORT_COLOR = { green: '#2ECC71', yellow: '#C8A24E', orange: '#E08A3C', blue: 'var(--blue-mid)', teal: 'var(--teal)', red: '#E0654F' };
  // أيقونات خطية للوحة العمليات (تصميم محمد، 15 أكتوبر) — line icons for the operations board
  const SVG = function (body) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>'; };
  const ICONS = {
    bars: SVG('<path d="M6 20V12M12 20V5M18 20v-9"/>'),
    db: SVG('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
    plus: SVG('<path d="M12 5v14M5 12h14"/>'),
    pencil: SVG('<path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>')
  };
  const CARDS = ['charts', 'peak', 'regions']; // البطاقات الظاهرة التي تُحمَّل مع اللوحة / visible cards loaded with the dashboard
  const PEAK_TOP = 3, REGIONS_SHOWN = 3, AVATARS_MAX = 5, TOP_SHOWN = 5;
  // سرعة الموقع: 5 طلبات فحص حقيقية، والحدود بالثواني (أخضر/أصفر/أحمر) — site speed: 5 real pings, thresholds in seconds
  const SPEED_SAMPLES = 5, SPEED_GOOD_MS = 1500, SPEED_OK_MS = 3000, SPEED_SCALE_MS = 6000;
  const REGION_COLORS = ['#1FAE8C', '#2E7DD1', '#E5B53A', '#8FA3B8'];
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
  /* ساعة السرعة: نصف دائرة حتى 6 ث بمؤشر — the speed gauge: a half circle up to 6 s with a needle */
  function gauge_(ms, color) {
    const k = Math.min(1, Math.max(0, ms / SPEED_SCALE_MS)), angle = Math.PI * (1 - k);
    const cx = 100, cy = 100, r = 80, nx = cx + 68 * Math.cos(angle), ny = cy - 68 * Math.sin(angle);
    const arc = function (from, to, c) {
      const a1 = Math.PI * (1 - from), a2 = Math.PI * (1 - to);
      return '<path d="M' + (cx + r * Math.cos(a1)).toFixed(1) + ' ' + (cy - r * Math.sin(a1)).toFixed(1) + ' A' + r + ' ' + r + ' 0 0 1 ' + (cx + r * Math.cos(a2)).toFixed(1) + ' ' + (cy - r * Math.sin(a2)).toFixed(1) + '" fill="none" stroke="' + c + '" stroke-width="14" stroke-linecap="butt"/>';
    };
    return '<svg class="speed-gauge" viewBox="0 0 200 116" role="img" aria-label="سرعة الاستجابة ' + (ms / 1000).toFixed(2) + ' ثانية">' +
      arc(0, SPEED_GOOD_MS / SPEED_SCALE_MS, 'rgba(46,204,113,.75)') + arc(SPEED_GOOD_MS / SPEED_SCALE_MS, SPEED_OK_MS / SPEED_SCALE_MS, 'rgba(229,181,58,.75)') + arc(SPEED_OK_MS / SPEED_SCALE_MS, 1, 'rgba(224,101,79,.75)') +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="' + color + '" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="7" fill="' + color + '"/>' +
      '<text x="20" y="114" font-size="10" fill="currentColor">0</text><text x="172" y="114" font-size="10" fill="currentColor">6 ث</text></svg>';
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
      '<div data-role="main"></div>' +
      // «الأعضاء» بجانب «قياس زمن الطلبات» (طلب محمد، 15 أكتوبر) — «members» next to «request timing» (Mohammed, 15 Oct)
      '<div class="perf-link-bar"><a href="perf.html" class="perf-link-btn">📈 قياس زمن الطلبات</a>' +
        '<button type="button" class="perf-link-btn" data-act="members" aria-expanded="false">👥 الأعضاء</button>' +
        '<span class="perf-link-note">يعرض قياسات هذا الجهاز والمتصفح فقط — افتح الموقع بتبويب آخر واستخدمه، والجدول يتحدّث تلقائيًا</span></div>' +
      '<div class="ops-card members-card" data-role="members" hidden><div class="ops-card-title">👥 جميع الأعضاء <span class="members-count" data-role="members-count"></span></div>' +
        '<input type="search" class="members-search" data-role="members-search" placeholder="ابحث بالاسم أو رقم الجوال" aria-label="ابحث بالاسم أو رقم الجوال">' +
        '<div data-role="members-body"></div></div>';
    const main = container.querySelector('[data-role="main"]'), alerts = container.querySelector('[data-role="alerts"]');
    const membersCard = container.querySelector('[data-role="members"]');
    let members = null;
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
          if (err.expired) { S.handleExpired({ action: 'admin-dashboard', message: err.message }); return 'expired'; }
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
      // كل أنواع الطلبات (طلب محمد، 15 أكتوبر): أكثر 5 ظاهرة والبقية بـ«عرض الكل» — every request type: top 5 shown, the rest behind «show all»
      const allActs = Array.isArray(d.dailyRequestBreakdownAll) && d.dailyRequestBreakdownAll.length ? d.dailyRequestBreakdownAll : (Array.isArray(d.dailyRequestBreakdown) ? d.dailyRequestBreakdown : []);
      const breakdown = allActs.map(function (it, i) {
        return '<div class="ops-breakdown-row"' + (i >= TOP_SHOWN ? ' data-extra hidden' : '') + '><span>' + esc(ACTION_LABELS[it.action] || it.action) + '</span><b>' + show_(it.count) + '</b></div>';
      }).join('') + (allActs.length > TOP_SHOWN ? '<button type="button" class="detail-preview-link" data-act="all-requests">عرض كل أنواع الطلبات (' + allActs.length + ')</button>' : '');
      const propOps = num_(d.propOpsToday) !== null && num_(d.propOpsLimit) ?
        '<div class="ops-status-card" data-role="propops"><div class="ops-status-ring">' + ring_(pct_(d.propOpsToday, d.propOpsLimit), 'quota', 84) + '</div><div class="ops-status-info">' +
        '<div class="ops-status-title">🗄️ عمليات خصائص السكربت اليوم</div><div class="ops-status-count-line"><b class="ops-status-count">' + show_(d.propOpsToday) + '</b> من <b class="ops-status-count">' + show_(d.propOpsLimit) + '</b> عملية</div>' +
        '<div class="ops-status-note">عدّاد داخلي لعمليات خصائص السكربت التي رصدها النظام — وليس قراءة من جوجل للحصة المتبقية. الحد المعروض (' + show_(d.propOpsLimit) + ') هو الحد المنشور للحسابات المجانية، للمقارنة فقط.</div></div></div>' : '';
      const summary = d.alertsSummary && typeof d.alertsSummary === 'object' ? d.alertsSummary : {};
      const problems = Array.isArray(d.problems) ? d.problems : [];
      const logTotal = Object.keys(summary).reduce(function (a, c) { return a + (num_(summary[c]) || 0); }, 0);
      main.innerHTML =
        // لوحة العمليات: ثلاث بطاقات (تصميم محمد، 15 أكتوبر) — the operations board: three tiles (Mohammed's design)
        '<div class="ops-board" data-role="board"><div class="ops-board-head"><span class="ops-board-icon">' + ICONS.bars + '</span><div><div class="ops-board-title">لوحة العمليات</div>' +
          '<div class="ops-board-sub">مراجعة سريعة لحالة النظام وقاعدة البيانات</div></div></div>' +
          '<div class="ops-row3">' +
            '<div class="ops-pill ops-pill-total"><span class="ops-pill-icon">' + ICONS.db + '</span><b>' + show_(d.totalStations) + '</b><span>إجمالي المحطات</span>' +
              '<span class="ops-pill-split"><span class="ops-split-dist">● توزيع ' + show_(d.totalStationsDistribution) + '</span><span class="ops-split-sub">● تحويل ' + show_(d.totalStationsSubstations) + '</span></span></div>' +
            '<div class="ops-pill ops-pill-adds"><span class="ops-pill-icon">' + ICONS.plus + '</span><b>' + show_(d.additionsToday) + '</b><span>إضافات اليوم</span></div>' +
            '<div class="ops-pill ops-pill-edits"><span class="ops-pill-icon">' + ICONS.pencil + '</span><b>' + show_(d.editsToday) + '</b><span>تعديلات اليوم</span></div>' +
          '</div></div>' +
        // طلبات اليوم وعمليات الخصائص وأكثر 5 كما هي (قرار محمد) — today's requests, property operations and top 5 as they were
        '<div class="ops-status-card" data-role="quota"><div class="ops-status-ring">' + ring_(quota, 'quota', 84) + '</div><div class="ops-status-info">' +
          '<div class="ops-status-title">⚡ طلبات اليوم على السكربت</div><div class="ops-status-count-line"><b class="ops-status-count">' + show_(d.dailyRequests) + '</b> من <b class="ops-status-count">' + show_(d.dailyRequestLimit) + '</b> طلب</div>' +
          '<div class="ops-status-sub">' + esc(d.currentShiftLabel || '') + '</div></div></div>' +
        propOps +
        (breakdown ? '<div class="ops-breakdown-card"><div class="ops-breakdown-title">📊 أنواع طلبات اليوم — الأكثر أولًا (يوضّح سبب أي ارتفاع بالعدد)</div>' + breakdown + '</div>' : '') +
        section_('speed', '🚀 سرعة الموقع', 'قياس حي عند الفتح') +
        section_('present', '👥 المتواجدون الآن', 'اليوم ' + show_(d.activeUsersToday) + ' — الوردية ' + show_(d.activeUsersShift)) +
        section_('additions', '➕ الإضافات اليوم', show_(d.additionsToday)) +
        section_('edits', '✏️ التعديلات اليوم', show_(d.editsToday)) +
        section_('report', '📋 تقرير الأمس', 'نفس التقرير اليومي بالبريد') +
        // بطاقات ظاهرة تُحمَّل مع اللوحة — visible cards loaded with the dashboard
        card_('charts', '📈 زوار آخر 7 أيام', '') +
        '<div class="ops-grid2">' + card_('peak', '🔥 أوقات الذروة', '') + card_('regions', '🗺️ نشاط المناطق', '') + '</div>' +
        '<div class="ops-card" data-role="quality"><div class="ops-card-title">⭐ جودة البيانات</div>' +
          '<div class="quality-row">' + ring_(quality, 'quality', 72) + '<div><b class="quality-pct"' + (quality === null ? '' : ' style="color:' + gaugeColor(quality, 'quality') + '"') + '>' + (quality === null ? '—' : quality + '%') + '</b>' +
          '<div>' + show_(d.stationsNeedingReview) + ' محطة تحتاج مراجعة (إحداثية ناقصة) من أصل ' + show_(d.totalStations) + '</div></div></div></div>' +
        // سجل النظام (بطاقة الأخطاء): التصنيفات + أحدث المشاكل — the system log: categories + latest problems
        '<div class="acc-item" data-section="log"><div class="acc-head" role="button" tabindex="0" aria-expanded="false"><div class="acc-head-title">⚠️ سجل النظام</div><div class="acc-head-side"><span class="acc-head-badge">' + logTotal + '</span>' + CHEV + '</div></div>' +
          '<div class="acc-body"><div class="acc-body-inner">' + (Object.keys(summary).map(function (c) {
            return '<div class="log-row"><span>' + (ALERT_ICON[c] || '') + ' ' + esc(c) + '</span><b>' + show_(summary[c]) + '</b></div>';
          }).join('') || '<div class="coming-soon">' + MSG.NONE + '</div>') +
          // كل المشاكل بكل درجاتها: الدرجة الحالية والحالة والأعضاء المختلفون والمرات منفصلة (مواصفات محمد 16 أكتوبر)
          // Every problem at every level: current level, status, distinct members and occurrences kept separate
          (problems.length ? '<div class="log-problems-title">أحدث المشاكل</div>' + table_(['المشكلة', 'الدرجة', 'الحالة', 'الأعضاء', 'المرات', 'آخر ظهور'], problems.map(function (p) {
            const last = new Date(p && p.lastSeen);
            return '<tr><td class="log-msg">' + (ALERT_ICON[p.category] || '') + ' ' + esc(p.message) + '<span class="sub">' + esc(p.code || p.source) + (p.devices && p.devices.length ? ' · ' + esc(p.devices.join('، ')) : '') + '</span></td>' +
              '<td>' + levelBadge_(p.level || p.base) + '</td><td>' + esc(p.status || '—') + '</td><td class="mono">' + show_(p.members) + '</td><td class="mono">' + show_(p.count) + '</td>' +
              '<td>' + (isNaN(last.getTime()) ? '—' : dateCell(last) + '<span class="sub">' + esc(D.time(last)) + '</span>') + '</td></tr>';
          }).join('')) : '') + '</div></div></div>';
      renderAlerts_(d.alertsRecent);
      CARDS.forEach(function (name) { loadCard_(name); });
    }
    /* شريط الأخطاء: مشاكل أول ظهور لها خلال 72 ساعة، شريطًا واحدًا لا بطاقات (قرار محمد، 15 أكتوبر)
     * The alert strip: problems first seen within 72 hours, one strip not cards (Mohammed's decision, 15 Oct) */
    /* الشريط يعرض «حرج جدًا» و«مهم جدًا» فقط (الخادم يصفّيها)، مع عدد الأعضاء المختلفين وعدد المرات منفصلين (16 أكتوبر)
     * The strip shows only «حرج جدًا» and «مهم جدًا» (filtered by the server), with distinct members and occurrences apart */
    function renderAlerts_(list) {
      const items = (Array.isArray(list) ? list : []).filter(function (p) { return p && p.message; });
      alerts.hidden = !items.length;
      if (!items.length) { alerts.innerHTML = ''; return; }
      alerts.innerHTML = '<span class="alert-strip-title">⚠️ مشاكل تحتاج انتباهك (حرج جدًا / مهم جدًا — آخر 72 ساعة): ' + items.length + '</span><div class="alert-strip-items">' + items.map(function (p) {
        const first = new Date(p.firstSeen);
        return '<span class="alert-item" title="' + esc(p.category) + ' — ' + esc(p.code || p.source) + ' — ' + esc(p.status || '') + '">' + levelBadge_(p.level) + ' ' + (ALERT_ICON[p.category] || '⚠️') +
          ' <span class="alert-item-msg">' + esc(p.message) + '</span>' +
          '<b class="alert-item-count">' + show_(p.members) + ' عضو · ×' + show_(p.count) + '</b>' + (isNaN(first.getTime()) ? '' : '<span class="alert-item-age">' + esc(D.relativeTime(first).replace(/^قبل /, 'منذ ')) + '</span>') + '</span>';
      }).join('') + '</div>';
    }
    /* شارة الدرجة — the severity badge */
    function levelBadge_(level) {
      const cls = { 'حرج جدًا': 'lv-critical', 'مهم جدًا': 'lv-high', 'مهم': 'lv-mid', 'منخفض': 'lv-low' }[level] || 'lv-mid';
      return '<span class="lv-badge ' + cls + '">' + esc(level || '—') + '</span>';
    }
    function section_(name, title, badge) {
      return '<div class="acc-item" data-section="' + name + '"><div class="acc-head" role="button" tabindex="0" aria-expanded="false"><div class="acc-head-title">' + title + '</div>' +
        '<div class="acc-head-side">' + (badge ? '<span class="acc-head-badge">' + esc(badge) + '</span>' : '') + CHEV + '</div></div>' +
        '<div class="acc-body"><div class="acc-body-inner" data-body="' + name + '"><div class="coming-soon">' + MSG.LAZY + '</div></div></div></div>';
    }
    function card_(name, title) {
      return '<div class="ops-card" data-card="' + name + '"><div class="ops-card-title">' + title + '</div><div class="ops-card-body" data-body="' + name + '">' + spinner_() + '</div></div>';
    }
    /* بطاقة ظاهرة: تحميلها مع اللوحة، وفشلها داخلها فقط بزر إعادة — A visible card: loaded with the dashboard, its failure stays inside it */
    async function loadCard_(name) {
      const box = main.querySelector('[data-card="' + name + '"] [data-body]');
      if (!box || loaded[name]) return;
      loaded[name] = true;
      box.innerHTML = spinner_();
      try { await LOADERS[name](box); }
      catch (err) {
        delete loaded[name];
        if (err.expired) { S.handleExpired({ action: 'admin-dashboard', message: err.message }); return; }
        if (err.denied) { denied_(); return; }
        if (box.isConnected) box.innerHTML = '<div class="coming-soon">' + MSG.LOAD_FAIL + ' <button type="button" class="link-btn" data-act="section-retry" data-name="' + name + '">' + MSG.RETRY + '</button></div>';
      }
    }

    // ===== الأقسام (تحميل كسول) — Sections (lazy) =====
    const LOADERS = {
      present: async function (box) {
        const r = await call_('getActiveUsersDetail', { period: 'today' }), users = (r.users || []).slice(0, PREVIEW_ROWS);
        // صفّ صور: الأيقونة العامة + الاسم الأول + الوردية (بيانات حقيقية) — an avatar row: the generic icon + first name + shift (real data)
        const avatars = users.slice(0, AVATARS_MAX).map(function (u) {
          return '<div class="present-avatar"><img src="assets/member-avatar.webp" alt=""><b>' + esc(String(u.name || '—').split(' ')[0]) + '</b><span>' + (u.shift ? 'وردية ' + esc(u.shift) : '—') + '</span></div>';
        }).join('');
        box.innerHTML = (avatars ? '<div class="present-avatars">' + avatars + '</div>' : '') + (users.length ? table_(['الاسم', 'الجوال', 'الوردية', 'آخر نشاط'], users.map(function (u) {
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
        // أعلى 3 ساعات: مجموع الأيام لكل ساعة (من نفس المصفوفة) — the top 3 hours: each hour summed over the days
        const byHour = [];
        for (let h = 0; h < 24; h++) byHour.push({ hour: h, count: matrix.reduce(function (a, row) { return a + (num_(row[h]) || 0); }, 0) });
        const top = byHour.filter(function (x) { return x.count > 0; }).sort(function (a, b) { return b.count - a.count; }).slice(0, PEAK_TOP);
        const topMax = top.length ? top[0].count : 1;
        const hourLabel = function (h) { return (h % 12 || 12) + ':00 ' + (h < 12 ? 'ص' : 'م'); };
        let html = top.length ? '<div class="peak-top">' + top.map(function (x) {
          return '<div class="peak-row"><span class="peak-hour">' + hourLabel(x.hour) + '</span><div class="peak-track"><div class="peak-fill" style="width:' + Math.round(x.count / topMax * 100) + '%"></div></div><b class="peak-count">' + x.count + '</b></div>';
        }).join('') + '</div>' : '<div class="coming-soon">' + MSG.NO_REGIONS + '</div>';
        html += '<details class="peak-details"><summary>الخريطة الحرارية الكاملة</summary><div class="heatmap-scroll"><div class="heatmap-grid"><div></div>';
        for (let h = 0; h < 24; h++) html += '<div class="heatmap-hour">' + (h % 3 === 0 ? h : '') + '</div>';
        matrix.forEach(function (row, d) {
          html += '<div class="heatmap-label">' + esc((r.weekdayLabels || [])[d] || '') + '</div>';
          row.forEach(function (count, h) {
            const k = count / max;
            html += '<div class="heatmap-cell" style="background:' + (count ? 'rgba(31,174,140,' + (0.15 + k * 0.85).toFixed(3) + ')' : 'var(--bg-elev)') + '" title="' + count + ' — ' + h + ':00"></div>';
          });
        });
        html += '</div></div></details>';
        if (r.peak) html += '<div class="heatmap-peak-note">🔥 أكثر وقت نشاطًا: <b>' + esc(r.peak.day) + ' — الساعة ' + r.peak.hour + ':00</b> (' + show_(r.peak.count) + ' حدث)</div>';
        box.innerHTML = html;
      },
      // قرار محمد (15 أكتوبر): الدائرة = توزيع المحطات التي أُضيفت أو عُدّلت في الموقع (لها تاريخ) على المناطق — أعلى 3 +
      // «أخرى»، والمركز عددها؛ و«عرض كل المناطق» جدول: المنطقة، المحطات، إضافات وتعديلات آخر 30 يومًا
      // Mohammed's decision (15 Oct): the donut = stations added/edited on the site (dated) per region; «all regions» is a table
      regions: async function (box) {
        const r = await call_('getRegionActivity'), all = (r.stations || []).filter(function (x) { return num_(x.stations) > 0; });
        if (!all.length) { box.innerHTML = '<div class="coming-soon">' + MSG.NO_REGIONS + '</div>'; return; }
        const regions = all.map(function (x) { return { region: x.region, count: x.stations }; });
        const total = regions.reduce(function (a, x) { return a + x.count; }, 0);
        const parts = regions.slice(0, REGIONS_SHOWN).map(function (x) { return { label: x.region, count: x.count }; });
        const rest = total - parts.reduce(function (a, x) { return a + x.count; }, 0);
        if (rest > 0) parts.push({ label: 'أخرى', count: rest });
        const size = 120, rad = 46, circ = 2 * Math.PI * rad;
        let offset = 0;
        const arcs = parts.map(function (p, i) {
          const len = p.count / total * circ, arc = '<circle cx="60" cy="60" r="' + rad + '" fill="none" stroke="' + REGION_COLORS[i] + '" stroke-width="16" stroke-dasharray="' + len + ' ' + (circ - len) + '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 60 60)"/>';
          offset += len; return arc;
        }).join('');
        box.innerHTML = '<div class="region-donut-wrap"><svg class="region-donut" width="' + size + '" height="' + size + '" viewBox="0 0 120 120" role="img" aria-label="نشاط المناطق">' + arcs +
          '<text x="60" y="56" text-anchor="middle" font-size="17" font-weight="800" fill="currentColor" font-family="\'JetBrains Mono\',monospace">' + total + '</text>' +
          '<text x="60" y="74" text-anchor="middle" font-size="9.5" fill="currentColor" opacity=".7">محطة</text></svg>' +
          '<div class="region-legend">' + parts.map(function (p, i) {
            return '<div class="region-legend-row"><span class="region-dot" style="background:' + REGION_COLORS[i] + '"></span><span class="region-legend-label">' + esc(p.label) + '</span><b>' + Math.round(p.count / total * 100) + '%</b></div>';
          }).join('') + '</div></div>' +
          '<details class="peak-details region-all"><summary>عرض كل المناطق (' + all.length + ')</summary>' +
          table_(['المنطقة', 'المحطات', 'إضافات', 'تعديلات'], all.map(function (x) {
            return '<tr><td>' + esc(x.region) + '</td><td class="mono">' + show_(x.stations) + '</td><td class="mono">' + show_(x.additions) + '</td><td class="mono">' + show_(x.edits) + '</td></tr>';
          }).join('')) + '<div class="region-note">الإضافات والتعديلات: آخر 30 يومًا</div></details>';
      },
      // سرعة الموقع (طلب محمد، 15 أكتوبر): قياس حي — 5 طلبات فحص متتالية، والساعة بالوسيط، مع زمن الخادم والشبكة
      // Site speed (Mohammed, 15 Oct): a live measurement — 5 sequential pings, the gauge at the median, server vs network
      speed: async function (box) {
        box.innerHTML = spinner_('جاري قياس سرعة الاستجابة…');
        const samples = [];
        for (let i = 0; i < SPEED_SAMPLES; i++) {
          const t0 = global.performance.now();
          const res = await API.call('ping', {});
          const ms = Math.round(global.performance.now() - t0);
          const server = res && res._timing && num_(res._timing.serverMs);
          if (!res || !res.success) throw new Error(MSG.LOAD_FAIL);
          samples.push({ total: ms, server: server === null ? null : server });
        }
        if (!alive || !box.isConnected) return;
        const sorted = samples.map(function (x) { return x.total; }).sort(function (a, b) { return a - b; });
        const median = sorted[Math.floor(sorted.length / 2)];
        const servers = samples.map(function (x) { return x.server; }).filter(function (x) { return x !== null; }).sort(function (a, b) { return a - b; });
        const serverMed = servers.length ? servers[Math.floor(servers.length / 2)] : null;
        const color = median <= SPEED_GOOD_MS ? '#2ECC71' : median <= SPEED_OK_MS ? '#E5B53A' : '#E0654F';
        const label = median <= SPEED_GOOD_MS ? 'سريع' : median <= SPEED_OK_MS ? 'مقبول' : 'بطيء';
        const sec = function (ms) { return (ms / 1000).toFixed(2) + ' ث'; };
        box.innerHTML = '<div class="speed-wrap" data-role="speed">' + gauge_(median, color) +
          '<div class="speed-value" style="color:' + color + '">' + sec(median) + ' <span>' + label + '</span></div>' +
          '<div class="speed-rows">' +
            '<div class="speed-row"><span>أسرع / أبطأ استجابة</span><b>' + sec(sorted[0]) + ' / ' + sec(sorted[sorted.length - 1]) + '</b></div>' +
            '<div class="speed-row"><span>زمن الخادم (الوسيط)</span><b>' + (serverMed === null ? '—' : sec(serverMed)) + '</b></div>' +
            '<div class="speed-row"><span>الشبكة وجوجل (الباقي)</span><b>' + (serverMed === null ? '—' : sec(Math.max(0, median - serverMed))) + '</b></div>' +
          '</div><div class="speed-note">' + SPEED_SAMPLES + ' طلبات فحص حقيقية من هذا الجهاز الآن — أخضر حتى 1.5 ث، أصفر حتى 3 ث، أحمر فوقها</div>' +
          '<button type="button" class="detail-preview-link" data-act="speed-retry">↻ إعادة القياس</button></div>';
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
      return { grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)', text: dark ? '#C9D7E4' : '#2C3D50', value: dark ? '#EAF1F7' : '#102035' };
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
      // أعمدة بقيمها فوقها (تصميم محمد) — bars with their values on top (Mohammed's design)
      const valuesOnTop = { id: 'valuesOnTop', afterDatasetsDraw: function (c) {
        const ctx = c.ctx, meta = c.getDatasetMeta(0);
        ctx.save(); ctx.fillStyle = colors.value; ctx.font = '700 12px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        meta.data.forEach(function (bar, i) { ctx.fillText(String(c.data.datasets[0].data[i]), bar.x, bar.y - 4); });
        ctx.restore();
      } };
      chart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: chartData.labels, datasets: [{ label: 'أحداث النشاط', data: chartData.values, backgroundColor: '#2E7DD1', borderRadius: 4, maxBarThickness: 34 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { top: 20 } },
          plugins: { legend: { display: false }, tooltip: { rtl: true } },
          scales: { x: { ticks: { color: colors.text, font: { size: 10 } }, grid: { display: false } }, y: { display: false, beginAtZero: true } } },
        plugins: [valuesOnTop]
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
          if (err.expired) { S.handleExpired({ action: 'admin-dashboard', message: err.message }); return true; }
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
      const allReq = e.target.closest('[data-act="all-requests"]');
      if (allReq) { // كل أنواع الطلبات / every request type
        const card = allReq.closest('.ops-breakdown-card'), extra = card.querySelectorAll('[data-extra]'), open = extra.length && extra[0].hidden;
        extra.forEach(function (el) { el.hidden = !open; });
        allReq.textContent = open ? 'عرض أقل' : 'عرض كل أنواع الطلبات (' + card.querySelectorAll('.ops-breakdown-row').length + ')';
        return;
      }
      if (e.target.closest('[data-act="speed-retry"]')) { // إعادة قياس السرعة / measure again
        const box = main.querySelector('[data-body="speed"]');
        if (box) LOADERS.speed(box).catch(function () { box.innerHTML = '<div class="coming-soon">' + MSG.LOAD_FAIL + '</div>'; });
        return;
      }
      if (e.target.closest('[data-act="members"]')) { toggleMembers_(e.target.closest('[data-act="members"]')); return; }
      const sr = e.target.closest('[data-act="section-retry"]');
      if (sr && CARDS.indexOf(sr.dataset.name) !== -1) { loadCard_(sr.dataset.name); return; }
      if (sr) { const item = sr.closest('.acc-item'); item.classList.remove('open'); openSection(sr.dataset.name); }
    }
    // ===== جميع الأعضاء (طلب محمد، 15 أكتوبر) — All members (Mohammed, 15 Oct) =====
    /* فتح/طي البطاقة؛ تُحمَّل القائمة أول فتح فقط — toggle the card; the list loads on the first open only */
    async function toggleMembers_(btn) {
      const open = membersCard.hidden;
      membersCard.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open || members) return;
      const body = membersCard.querySelector('[data-role="members-body"]');
      body.innerHTML = spinner_();
      try {
        const r = await call_('getMembersList');
        members = Array.isArray(r.members) ? r.members : [];
        renderMembers_();
      } catch (err) {
        if (err.expired) { S.handleExpired({ action: 'admin-dashboard', message: err.message }); return; }
        if (err.denied) { denied_(); return; }
        body.innerHTML = '<div class="coming-soon">' + MSG.LOAD_FAIL + '</div>';
      }
    }
    /* القائمة بترتيب الخادم العكسي (آخر من سجّل أولًا)، مصفّاة بالاسم أو الجوال (الأرقام العربية تُقبل)
     * The list in the server's reverse order (latest registration first), filtered by name or phone (Arabic digits accepted) */
    function renderMembers_() {
      if (!members) return;
      const raw = membersCard.querySelector('[data-role="members-search"]').value.trim();
      const q = (global.SecTextInput ? global.SecTextInput.normalizeDigits(raw) : raw).toLowerCase();
      const list = members.filter(function (m) { return !q || String(m.name).toLowerCase().indexOf(q) !== -1 || String(m.phone).replace(/\D/g, '').indexOf(q.replace(/\D/g, '') || '\u0000') !== -1; });
      membersCard.querySelector('[data-role="members-count"]').textContent = '(' + (q ? list.length + ' من ' : '') + members.length + ')';
      membersCard.querySelector('[data-role="members-body"]').innerHTML = list.length ? table_(['ترتيب التسجيل', 'الاسم', 'الجوال', 'النوع', 'الوردية', 'القسم', 'الحالة', 'تاريخ التسجيل'], list.map(function (m) {
        const at = riyadhStamp(m.registeredAt);
        return '<tr><td class="mono">' + (members.length - members.indexOf(m)) + '</td><td>' + esc(m.name) + '</td><td class="mono" dir="ltr">' + esc(m.phone) + '</td><td>' + esc(m.memberType || '—') + '</td><td>' + esc(m.shift || '—') + '</td><td>' + esc(m.department || '—') + '</td><td>' + esc(m.status || '—') + '</td><td>' + (at ? dateCell(at) : esc(m.registeredAt || '—')) + '</td></tr>';
      }).join('')) : '<div class="coming-soon">لا يوجد عضو يطابق البحث</div>';
    }
    function onInput_(e) { if (e.target.matches('[data-role="members-search"]')) renderMembers_(); }
    container.addEventListener('input', onInput_);

    function onKey_(e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('acc-head')) { e.preventDefault(); openSection(e.target.closest('.acc-item').dataset.section); } }
    container.addEventListener('click', onClick_);
    container.addEventListener('keydown', onKey_);

    return {
      load: load, openSection: openSection,
      data: function () { return data; },
      destroy: function () {
        alive = false;
        container.removeEventListener('click', onClick_); container.removeEventListener('keydown', onKey_); container.removeEventListener('input', onInput_);
        if (typeof unTheme === 'function') unTheme();
        if (chart) { try { chart.destroy(); } catch (e) { /* لا شيء / nothing */ } }
        container.textContent = '';
      }
    };
  }

  global.SecAdminDashboard = { mount: mount, gaugeColor: gaugeColor, riyadhStamp: riyadhStamp, riyadhDayTime: riyadhDayTime, AUDIT: AUDIT, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
