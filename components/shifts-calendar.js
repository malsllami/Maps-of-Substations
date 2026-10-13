/* ============================================================
 * components/shifts-calendar.js — صفحة الورديات: «دوام اليوم لكل وردية»، تبويبات الورديات، والتقويم الشهري
 * ============================================================
 * سلوك V1 (shifts.html) ونصوصه كما هي — بلا أي تغيير في الحساب أو الترتيب:
 * - «دوام اليوم لكل وردية»: سطر اليوم (اليوم بالاسم والتاريخ الميلادي — والهجري) وبطاقة لكل وردية بأيقونة حالتها؛
 *   الضغط على بطاقة أو تبويب يختار الوردية.
 * - التقويم: الشهر ميلادي + هجري، السابق/التالي، المفتاح (صباحي 7ص - 7م، مسائي 7م - 7ص، راحة)، أسماء الأيام، وكل يوم:
 *   الرقم الميلادي، اليوم الهجري، وأيقونة الحالة؛ اليوم الحالي مميز. ملاحظة «المرجع المعتمد للحساب» أسفل الصفحة.
 * - الحساب من services/shift-rotation.js (رياضي، لا بيانات مخزّنة).
 * التغيير الوحيد المطلوب من محمد (الورديات): بطاقات أيام التقويم بخلفية البطاقات العادية، والحدود ورقم التاريخ والتاريخ
 *   الهجري والرمز هي التي تُلوَّن بلون الحالة (بدل الخلفية الملوّنة كلها في V1).
 * V2: النصوص تُكتب نصًا؛ اختيار وردية العضو يأتي من الصفحة (select)؛ الأسماء والثوابت من الإعدادات.
 *
 * The shifts page body, V1's behavior and texts with no change to the maths. The only change Mohammed asked for: calendar
 * day cards keep the normal card background; the border, the date and the icon take the status colour.
 * ============================================================ */
(function (global) {
  'use strict';

  const ROT = global.SecShiftRotation;
  if (!ROT) throw new Error('shifts-calendar.js يحتاج shift-rotation.js قبله / needs shift-rotation.js first');
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const DOW = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  const ICONS = {
    morning: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>',
    evening: '<path d="M21 12.5A8.5 8.5 0 1 1 11.5 3 6.8 6.8 0 0 0 21 12.5z"/>',
    rest: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'
  };
  function icon_(kind, cls) { return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[kind] + '</svg>'; }

  const hijriNum = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const hijriDay = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', timeZone: 'UTC' });
  const hijriMonth = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayLong = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const weekday = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', timeZone: 'UTC' });
  const clean_ = function (s) { return String(s).replace(/\s*هـ$/, '').replace(/[‎‏]/g, ''); };
  const POS_NAMES = ['أول', 'ثاني', 'ثالث', 'رابع'];

  /* ملاحظة المرجع من الإعدادات (نفس نص V1) — The reference note from the config (V1's text) */
  function referenceNote() {
    const R = global.SEC2_CONFIG.SHIFT_ROTATION, ref = ROT.REF_UTC;
    const rest = R.CYCLE_DAYS - R.MORNING_DAYS - R.EVENING_DAYS;
    const order = R.GROUPS.slice().sort(function (a, b) { return R.REF_POSITION[a] - R.REF_POSITION[b]; });
    const where = order.map(function (g) {
      const p = R.REF_POSITION[g];
      if (p <= R.MORNING_DAYS) return g + ' ' + POS_NAMES[p - 1] + ' يوم صباحي';
      if (p <= R.MORNING_DAYS + R.EVENING_DAYS) return g + ' ' + POS_NAMES[p - R.MORNING_DAYS - 1] + ' يوم مسائي';
      return g + ' ' + POS_NAMES[p - R.MORNING_DAYS - R.EVENING_DAYS - 1] + ' يوم راحة';
    });
    const greg = R.REF_DATE.DAY + '/' + R.REF_DATE.MONTH + '/' + R.REF_DATE.YEAR;
    return 'المرجع المعتمد للحساب: يوم ' + weekday.format(new Date(ref)) + ' ' + greg + 'م الموافق ' + clean_(hijriNum.format(new Date(ref))) + 'هـ — وردية ' +
      where.join('، ') + '. دورة كل وردية ' + R.CYCLE_DAYS + ' أيام (يومان صباح، يومان مساء، ' + (rest === 4 ? 'أربعة' : rest) + ' أيام راحة)، والتقويم محسوب رياضياً من هذا التاريخ بدون أي بيانات مخزّنة، فهو صحيح لأي تاريخ ماضٍ أو مستقبلي.';
  }

  /**
   * mount(container, opts) — opts: { group (الافتراضية: أول وردية)، now() → Date (للاختبار) }
   * يُرجع { select(group)، group()، month() → {year, month}، go(delta)، render()، destroy() }
   */
  function mount(container, opts) {
    const o = opts || {}, now = o.now || function () { return new Date(); }, groups = ROT.groups();
    let group = ROT.isGroup(o.group) ? o.group : groups[0];
    const start = now();
    let viewYear = start.getFullYear(), viewMonth = start.getMonth();
    const doc = global.document;

    container.innerHTML =
      '<div class="page-title">دوام اليوم لكل وردية</div><div class="page-sub" data-role="today-line">—</div>' +
      '<div class="today-grid" data-role="today"></div>' +
      '<div class="group-tabs" role="tablist" data-role="tabs">' + groups.map(function (g) {
        return '<div class="group-tab" data-group="' + g + '" role="tab" tabindex="0" aria-selected="false"></div>';
      }).join('') + '</div>' +
      '<div class="cal-nav"><button type="button" class="cal-nav-btn" data-act="prev" aria-label="الشهر السابق">‹</button>' +
        '<div class="cal-month-label"><span data-role="month"></span><span class="hijri" data-role="month-hijri"></span></div>' +
        '<button type="button" class="cal-nav-btn" data-act="next" aria-label="الشهر التالي">›</button></div>' +
      '<div class="legend"><div class="legend-item"><span class="legend-dot" style="background:var(--morning)"></span>صباحي (' + ROT.hours.morning + ')</div>' +
        '<div class="legend-item"><span class="legend-dot" style="background:var(--evening)"></span>مسائي (' + ROT.hours.evening + ')</div>' +
        '<div class="legend-item"><span class="legend-dot" style="background:var(--rest)"></span>راحة</div></div>' +
      '<div class="cal-grid" data-role="grid"></div><div class="info-note" data-role="note"></div>';
    const q = function (r) { return container.querySelector('[data-role="' + r + '"]'); };
    q('note').textContent = referenceNote();

    function renderToday_() {
      const t = ROT.todayUTC(now());
      q('today-line').textContent = 'اليوم: ' + dayLong.format(new Date(t)) + ' — ' + clean_(hijriNum.format(new Date(t))) + ' هـ';
      const grid = q('today'); grid.textContent = '';
      groups.forEach(function (g) {
        const info = ROT.shiftFor(g, t);
        const card = doc.createElement('div');
        card.className = 'today-card ' + info.cls + (g === group ? ' active-group' : '');
        card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0'); card.setAttribute('aria-label', 'اختيار وردية ' + g);
        card.dataset.group = g;
        card.innerHTML = icon_(info.cls, 'card-icon ' + info.cls);
        const grp = doc.createElement('div'); grp.className = 'grp'; grp.textContent = 'وردية ' + g;
        const st = doc.createElement('div'); st.className = 'status ' + info.cls; st.textContent = info.label;
        card.appendChild(grp); card.appendChild(st);
        grid.appendChild(card);
      });
    }
    function renderTabs_() {
      const t = ROT.todayUTC(now());
      container.querySelectorAll('.group-tab').forEach(function (tab) {
        const g = tab.dataset.group, info = ROT.shiftFor(g, t), on = g === group;
        tab.className = 'group-tab ' + info.cls + (on ? ' active' : '');
        tab.setAttribute('aria-selected', String(on));
        tab.innerHTML = icon_(info.cls, 'tab-icon');
        const s = doc.createElement('span'); s.textContent = 'وردية ' + g; tab.appendChild(s);
      });
    }
    function renderCalendar_() {
      const first = ROT.dayUTC(viewYear, viewMonth, 1);
      q('month').textContent = MONTHS[viewMonth] + ' ' + viewYear;
      q('month-hijri').textContent = hijriMonth.format(new Date(first)) + (/هـ$/.test(hijriMonth.format(new Date(first))) ? '' : ' هـ');
      const days = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate(), firstDow = new Date(first).getUTCDay();
      const grid = q('grid'); grid.textContent = '';
      DOW.forEach(function (d) { const e = doc.createElement('div'); e.className = 'cal-dow'; e.textContent = d; grid.appendChild(e); });
      for (let i = 0; i < firstDow; i++) { const e = doc.createElement('div'); e.className = 'cal-day empty'; grid.appendChild(e); }
      const today = ROT.todayUTC(now());
      for (let d = 1; d <= days; d++) {
        const u = ROT.dayUTC(viewYear, viewMonth, d), info = ROT.shiftFor(group, u);
        const cell = doc.createElement('div');
        cell.className = 'cal-day ' + info.cls + (u === today ? ' today' : '');
        cell.title = info.label;
        cell.innerHTML = '<span class="day-num">' + d + '</span><span class="hijri-mid">' + clean_(hijriDay.format(new Date(u))) + '</span>' + icon_(info.cls, 'shift-icon');
        grid.appendChild(cell);
      }
    }
    function render() { renderToday_(); renderTabs_(); renderCalendar_(); }
    function select(g) { if (!ROT.isGroup(g)) return false; group = g; render(); return true; }
    function go(delta) {
      viewMonth += delta;
      while (viewMonth < 0) { viewMonth += 12; viewYear--; }
      while (viewMonth > 11) { viewMonth -= 12; viewYear++; }
      renderCalendar_();
    }

    function pick_(e) { const el = e.target.closest('[data-group]'); if (el && container.contains(el)) { select(el.dataset.group); return true; } return false; }
    function onClick_(e) {
      if (e.target.closest('[data-act="prev"]')) go(-1);
      else if (e.target.closest('[data-act="next"]')) go(1);
      else pick_(e);
    }
    function onKey_(e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-group]')) { e.preventDefault(); pick_(e); } }
    container.addEventListener('click', onClick_);
    container.addEventListener('keydown', onKey_);
    render();

    return {
      select: select, go: go, render: render,
      group: function () { return group; },
      month: function () { return { year: viewYear, month: viewMonth }; },
      destroy: function () { container.removeEventListener('click', onClick_); container.removeEventListener('keydown', onKey_); container.textContent = ''; }
    };
  }

  global.SecShiftsCalendar = { mount: mount, referenceNote: referenceNote };
})(typeof window !== 'undefined' ? window : globalThis);
