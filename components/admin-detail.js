/* ============================================================
 * components/admin-detail.js — نافذة التفاصيل الكاملة في لوحة المدير: المتواجدون / الإضافات / التعديلات
 * ============================================================
 * سلوك V1 (admin.html) ونصوصه كما هي: نافذة من الأسفل بعنوان القسم، بحث (برقم المحطة أو الاسم أو الجوال، الأرقام
 * العربية والأحرف الصغيرة تتحول فورًا)، من/إلى (الافتراضي آخر 7 أيام) وتحتهما «📅 هجري: من … إلى …»، «تطبيق»، «تصدير CSV»،
 * عدد النتائج، و«لا توجد نتائج ضمن هذا النطاق». الإغلاق بـ✕ أو بالضغط خارج النافذة.
 * V2: الطلبات بتذكرة المدير؛ عمود التاريخ ميلادي + هجري (والتصدير بالقيم الأصلية)؛ التصدير بـ SecHtml.csv (خلايا مقتبسة
 * وحماية الصيغ) بدل بناء يدوي؛ «لا توجد بيانات للتصدير» داخل النافذة بدل alert؛ Esc يغلق؛ الجدول بالقاعدة الموحّدة؛
 * طلب أقدم يصل بعد أحدث يُتجاهل.
 *
 * The admin full-detail window (present / additions / edits). V1's behavior and texts. V2: the admin ticket, dual dates,
 * a safe CSV, in-window messages instead of alert, Esc closes, the unified table, stale replies ignored.
 * ============================================================ */
(function (global) {
  'use strict';

  const API = global.SecApi, S = global.SecSession, H = global.SecHtml, D = global.SecDates, TI = global.SecTextInput, DASH = global.SecAdminDashboard;
  if (!API || !S || !H || !D || !TI || !DASH) throw new Error('admin-detail.js يحتاج api-client وsession وhtml وdates وtext-input وadmin-dashboard قبله / missing dependencies');
  const esc = H.esc;
  const DEFAULT_DAYS = 7, MAX_ROWS = 500;
  const KINDS = {
    present: { title: '👥 المتواجدون — التفاصيل الكاملة', columns: ['الاسم', 'الجوال', 'الوردية', 'آخر نشاط'] },
    additions: { title: '+ الإضافات — التفاصيل الكاملة', columns: ['المحطة', 'العضو', 'الجوال', 'الوردية', 'التاريخ', 'الوقت'], type: DASH.AUDIT.ADD },
    edits: { title: '✎ التعديلات — التفاصيل الكاملة', columns: ['المحطة', 'العضو', 'الجوال', 'الوردية', 'التاريخ', 'الوقت'], type: DASH.AUDIT.EDIT }
  };
  const MSG = { EMPTY: 'لا توجد نتائج ضمن هذا النطاق', FAIL: 'تعذّر تحميل التفاصيل', NO_EXPORT: 'لا توجد بيانات للتصدير', RESULTS: ' نتيجة' };

  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hijriOf_(text) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text); return m ? D.hijri(new Date(+m[1], +m[2] - 1, +m[3], 12)) : ''; }

  let ui = null, kind = null, rows = [], seq = 0;
  const hooks = { download: null }; // للاختبار: التقاط ملف التصدير بدل تنزيله / test hook: capture the export instead of downloading

  function build_() {
    if (ui) return ui;
    const doc = global.document;
    doc.body.insertAdjacentHTML('beforeend',
      '<div class="detail-modal-overlay" data-role="detail-overlay" role="dialog" aria-modal="true" aria-labelledby="detailTitle"><div class="detail-modal">' +
      '<div class="detail-modal-head"><div class="detail-modal-title" id="detailTitle" data-role="title"></div>' +
        '<button type="button" class="detail-modal-close" data-act="close" aria-label="إغلاق نافذة التفاصيل"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' +
      '<div class="detail-modal-filters">' +
        '<div class="detail-filter-row"><input type="text" data-f="search" placeholder="بحث برقم المحطة أو الاسم أو الجوال..." autocomplete="off"></div>' +
        '<div class="detail-filter-row"><label class="detail-date"><span>من</span><input type="date" data-f="from"></label><label class="detail-date"><span>إلى</span><input type="date" data-f="to"></label></div>' +
        '<div class="detail-hijri-note" data-role="hijri"></div>' +
        '<div class="detail-filter-actions"><button type="button" class="detail-btn primary" data-act="apply">تطبيق</button><button type="button" class="detail-btn" data-act="export">تصدير CSV</button></div>' +
        '<div class="detail-msg" data-role="msg" aria-live="polite"></div>' +
      '</div>' +
      '<div class="detail-modal-body"><div class="detail-count-badge" data-role="count"></div><div data-role="table"></div></div></div></div>');
    const el = doc.querySelector('[data-role="detail-overlay"]');
    const f = function (n) { return el.querySelector('[data-f="' + n + '"]'); };
    ui = { el: el, f: f, q: function (r) { return el.querySelector('[data-role="' + r + '"]'); } };
    TI.upper(f('search')); // الأرقام العربية والأحرف الصغيرة تتحول فورًا (V1) / Arabic digits and lower case convert at once (V1)
    f('from').addEventListener('change', hijri_); f('to').addEventListener('change', hijri_);
    f('search').addEventListener('keydown', function (e) { if (e.key === 'Enter') apply(); });
    el.addEventListener('click', function (e) {
      if (e.target === el || e.target.closest('[data-act="close"]')) close();
      else if (e.target.closest('[data-act="apply"]')) apply();
      else if (e.target.closest('[data-act="export"]')) exportCsv();
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(); });
    return ui;
  }
  function hijri_() {
    const from = ui.f('from').value, to = ui.f('to').value;
    ui.q('hijri').textContent = from && to ? '📅 هجري: من ' + hijriOf_(from) + ' إلى ' + hijriOf_(to) : '';
  }

  /* فتح قسم بآخر 7 أيام — Open a kind with the last 7 days */
  function open(k, now) {
    if (!KINDS[k]) return false;
    build_(); kind = k; rows = [];
    const today = now || new Date();
    ui.q('title').textContent = KINDS[k].title;
    ui.f('search').value = '';
    ui.f('to').value = ymd(today);
    ui.f('from').value = ymd(new Date(today.getTime() - (DEFAULT_DAYS - 1) * 86400000));
    ui.q('msg').textContent = '';
    hijri_();
    ui.el.classList.add('show');
    return apply();
  }
  function close() { if (ui) { ui.el.classList.remove('show'); seq++; } }
  function isOpen() { return !!ui && ui.el.classList.contains('show'); }

  async function apply() {
    const my = ++seq, cfg = KINDS[kind], wrap = ui.q('table');
    ui.q('msg').textContent = '';
    ui.q('count').textContent = ''; rows = []; // لا يظهر عدد أو تصدير قسم سابق أثناء التحميل / no previous count or export while loading
    wrap.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    const payload = { search: ui.f('search').value.trim(), dateFrom: ui.f('from').value, dateTo: ui.f('to').value };
    let res;
    try {
      res = kind === 'present' ? await API.call('getActiveUsersDetail', payload, { token: true })
        : await API.call('getChangesLog', Object.assign({ type: cfg.type, limit: MAX_ROWS }, payload), { token: true });
    } catch (err) { if (my === seq) { rows = []; wrap.innerHTML = '<div class="coming-soon">' + MSG.FAIL + '</div>'; ui.q('count').textContent = ''; } return false; }
    if (my !== seq) return false; // طلب أحدث بدأ / a newer request started
    if (S.isTokenInvalid(res)) { close(); S.handleExpired(); return false; }
    if (!res || !res.success) { rows = []; wrap.innerHTML = '<div class="coming-soon">' + esc((res && res.error) || MSG.FAIL) + '</div>'; ui.q('count').textContent = ''; return false; }
    rows = kind === 'present'
      ? (res.users || []).map(function (u) { return { csv: [u.name, u.phone, u.shift || '—', u.lastActivity], when: DASH.riyadhStamp(u.lastActivity) }; })
      : (res.changes || []).map(function (c) { return { csv: [c.stationId, c.memberName, c.phone, c.shift || '—', c.date, c.time], when: DASH.riyadhDayTime(c.date, c.time) }; });
    ui.q('count').textContent = rows.length + MSG.RESULTS;
    if (!rows.length) { wrap.innerHTML = '<div class="coming-soon">' + MSG.EMPTY + '</div>'; return true; }
    const dateCol = kind === 'present' ? 3 : 4;
    wrap.innerHTML = '<div class="sec-table-wrap detail-table"><table class="sec-table"><thead><tr>' + cfg.columns.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.csv.map(function (v, i) {
          if (i === dateCol && r.when) return '<td>' + esc(D.gregorian(r.when)) + '<span class="sub">' + esc(D.hijri(r.when)) + (kind === 'present' ? ' · ' + esc(D.time(r.when)) : '') + '</span></td>';
          if (kind !== 'present' && i === 5 && r.when) return '<td class="mono">' + esc(D.time(r.when)) + '</td>';
          return '<td' + (/^\+?\d[\d\s]*$/.test(String(v)) || i === 0 && kind !== 'present' ? ' dir="ltr" class="mono"' : '') + '>' + esc(v) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    return true;
  }

  /* تصدير النتائج المعروضة نفسها (بلا طلب جديد) — Export the shown results (no new request) */
  function exportCsv() {
    if (!rows.length) { ui.q('msg').textContent = MSG.NO_EXPORT; return null; }
    const text = H.csv([KINDS[kind].columns].concat(rows.map(function (r) { return r.csv; })));
    const name = kind + '-' + ymd(new Date()) + '.csv';
    if (hooks.download) { hooks.download(name, text); return text; }
    const a = global.document.createElement('a');
    a.href = global.URL.createObjectURL(new global.Blob([text], { type: 'text/csv;charset=utf-8;' }));
    a.download = name; a.click();
    global.setTimeout(function () { global.URL.revokeObjectURL(a.href); }, 1000);
    return text;
  }

  global.SecAdminDetail = { open: open, close: close, isOpen: isOpen, apply: apply, exportCsv: exportCsv, rows: function () { return rows.slice(); }, hooks: hooks, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
