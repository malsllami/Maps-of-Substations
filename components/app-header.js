/* ============================================================
 * components/app-header.js — رأس الصفحة المشترك: الشعار، أزرار الزائر، قائمة العضو، وصف شريط الاتصال
 * ============================================================
 * تصميم V1 وسلوكه (كان مكررًا في 4 صفحات بفروق صغيرة):
 * - الشعار: الرئيسية «الشركة السعودية للطاقة / نظام الإحداثيات الجغرافية»؛ بقية الصفحات اسم الصفحة ويعود للرئيسية.
 * - الزائر: «تسجيل الدخول» + (الرئيسية: أيقونة الورديات) + زر الوضع الداكن الدائري.
 * - العضو: زر القائمة باسمه الأول؛ القائمة: مفتاح الوضع الداكن، الرئيسية، حسابي، الورديات، لوحة المدير (للمدير فقط)،
 *   اتصال بالمدير ومراسلة المدير (contact-admin)، تسجيل الخروج. الصفحة الحالية مميزة. تُغلق بالضغط خارجها.
 * - شريط الحالة (حالة الاتصال، آخر تحديث، التاريخ، زر التحديث) — يرسمه هنا ويملؤه connection-status.
 * - الثيم من services/theme.js والجلسة من services/session.js فقط — لا منطق ثيم ولا قراءة localStorage هنا.
 * V2: الخروج موحّد في كل الصفحات بتأكيد داخل القائمة (ضغطة ثانية) بدل نافذة المتصفح، ثم صفحة الدخول (في V1 أربع
 *   طرق مختلفة)؛ الزائر في الورديات له زر الوضع الداكن (كان بلا أي زر)؛ Esc واختيار عنصر يغلقان القائمة؛ الاسم نصًا.
 *
 * The shared page header: logo, guest buttons, member menu, and the connection bar's markup. V1's design and behavior
 * (duplicated in 4 pages with small differences). Theme from theme.js and session from session.js only. V2: one logout
 * for every page with an in-menu confirmation (second tap) instead of the browser dialog, then the login page; a guest
 * on shifts gets the theme button (had none); Esc and choosing an item close the menu; the name is set as text.
 * ============================================================ */
(function (global) {
  'use strict';

  const THEME = global.SecTheme, SESSION = global.SecSession;
  if (!THEME || !SESSION) throw new Error('app-header.js يحتاج theme.js وsession.js قبله / needs theme.js and session.js first');
  const doc = global.document;
  const CONFIRM_MS = 4000;
  const S = function (inner, w) { return '<svg width="' + (w || 16) + '" height="' + (w || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'; };
  const ICON = {
    sun: S('<path d="M12 3v1M12 20v1M4.2 4.2l.7.7M18.4 18.4l.7.7M3 12h1M20 12h1M4.2 19.8l.7-.7M18.4 5.6l.7-.7"/><circle cx="12" cy="12" r="4"/>'),
    home: S('<path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/>'),
    user: S('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    cal: S('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    shield: S('<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/><polyline points="9 12 11 14 15 10"/>'),
    phone: S('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>'),
    chat: S('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
    install: S('<rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>'),
    tour: S('<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>'),
    out: S('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
    chev: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    toggle: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"></line><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"></line><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"></line></svg>',
    calSmall: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    clock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    refresh: '<svg data-role="refresh-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>'
  };
  // صفحات القائمة بترتيب V1 وألوان أيقوناتها — the menu pages in V1's order and icon colors
  const PAGES = [
    { key: 'index', href: 'index.html', label: 'الصفحة الرئيسية', icon: 'home', color: '#2ECC71' },
    { key: 'member', href: 'member.html', label: 'حسابي', icon: 'user', color: '#4A86E8' },
    { key: 'shifts', href: 'shifts.html', label: 'تقويم دوام الورديات', icon: 'cal', color: '#A479E2' },
    { key: 'admin', href: 'admin.html', label: 'لوحة المدير', icon: 'shield', color: '#F0B429', adminOnly: true }
  ];
  const LOGOUT = 'تسجيل الخروج', LOGOUT_CONFIRM = 'اضغط مرة أخرى لتأكيد الخروج';

  /**
   * mount(headerEl, opts) — opts: { page: 'index'|'member'|'shifts'|'admin', title, subtitle, contact (عناصر المدير في القائمة),
   *   identity + onIdentity() (إعادة التصميم: هوية العضو — الصورة والاسم والجوال — بدل القائمة المنسدلة؛ عناصرها في «المزيد»),
   *   refreshTitle (زر التحديث في شريط الحالة، اختياري), logoSrc, onLogout (افتراضيًا SecSession.logout) }
   * يُرجع { status: { bar, dot, label, lastLabel, dateLine }، refreshButton، openMenu()، closeMenu()، isMenuOpen()، render()، destroy() }
   */
  function mount(headerEl, opts) {
    const o = Object.assign({ page: 'index', logoSrc: 'assets/logo-icon.png' }, opts || {});
    const home = o.page === 'index';
    const subs = [];
    let confirmTimer = null;

    function brand_() {
      if (home) {
        return '<div class="logo"><img class="logo-mark" src="' + o.logoSrc + '" alt="شعار الشركة السعودية للطاقة"><div>' +
          '<div class="logo-text" data-role="title"></div><div class="logo-sub" data-role="subtitle"></div></div></div>';
      }
      return '<div class="brand" data-act="home" role="button" tabindex="0" aria-label="الرجوع للصفحة الرئيسية"><img class="brand-mark" src="' + o.logoSrc + '" alt="شعار الشركة السعودية للطاقة"><div>' +
        '<div class="brand-text" data-role="title"></div><div class="brand-sub" data-role="subtitle"></div></div></div>';
    }
    function menu_() {
      const admin = SESSION.isAdmin();
      return '<div class="mobile-user-menu" data-role="menu"><button type="button" class="mobile-menu-trigger" data-act="menu" aria-haspopup="true" aria-expanded="false" aria-label="القائمة"><span class="avatar-initial" data-role="initial" aria-hidden="true"></span><span class="menu-name" data-role="name"></span>' + ICON.chev + '</button>' +
        '<div class="mobile-menu-panel" role="menu">' +
          '<div class="mobile-menu-row"><span class="menu-icon" style="color:#8B6DD6">' + ICON.sun + '</span><span style="flex:1">الوضع الداكن</span>' +
            '<button type="button" class="theme-switch" data-act="theme" role="switch" aria-label="تبديل الوضع الداكن"><span class="theme-switch-knob"></span></button></div>' +
          PAGES.filter(function (p) { return !p.adminOnly || admin; }).map(function (p) {
            return '<a href="' + p.href + '" class="mobile-menu-link' + (p.key === o.page ? ' current-page' : '') + '" data-page="' + p.key + '"' + (p.key === o.page ? ' aria-current="page"' : '') + '>' +
              '<span class="menu-icon" style="color:' + p.color + '">' + ICON[p.icon] + '</span>' + p.label + '</a>' + (p.key === 'index' ? install_() : '');
          }).join('') +
          (o.contact ? '<a href="#" class="mobile-menu-link" data-act="call"><span class="menu-icon" style="color:var(--teal)">' + ICON.phone + '</span>اتصال بالمدير</a>' +
            '<button type="button" class="mobile-menu-link mobile-menu-btn" data-act="message"><span class="menu-icon" style="color:#6C5CE7">' + ICON.chat + '</span>مراسلة المدير</button>' : '') +
          tour_() +
          '<button type="button" class="mobile-menu-logout" data-act="logout"><span class="menu-icon" style="color:#E0654F">' + ICON.out + '</span><span data-role="logout-label">' + LOGOUT + '</span></button>' +
        '</div></div>';
    }
    /* هوية العضو بدل القائمة (طلب محمد 19 أكتوبر): الصورة الرمزية بالحرف الأول، والاسم، ورقم الجوال بالصيغة المحلية؛
       الضغط يفتح «المزيد» — The member identity instead of the menu: avatar initial, name, local phone; a tap opens «More» */
    function identity_() {
      return '<button type="button" class="hdr-id" data-act="identity" aria-label="حسابي والمزيد"><span class="hdr-id-text"><span class="hdr-id-name" data-role="name"></span>' +
        '<bdi class="hdr-id-phone" data-role="phone" dir="ltr"></bdi></span><span class="avatar-initial hdr-id-av" data-role="initial" aria-hidden="true"></span></button>';
    }
    /* «حفظ الموقع كتطبيق» تحت «الصفحة الرئيسية» — يختفي إن كان يعمل كتطبيق مثبت (اعتماد محمد 9 أكتوبر)
       «Save the site as an app» under «home» — hidden when running as an installed app */
    function install_() {
      const P = global.SecPWA;
      if (!global.SecInstallSheet || !P || P.installMode() === 'installed') return '';
      return '<button type="button" class="mobile-menu-link mobile-menu-btn" data-act="install"><span class="menu-icon" style="color:var(--teal-light)">' + ICON.install + '</span>حفظ الموقع كتطبيق</button>';
    }
    /* «الجولة التعريفية» في أسفل القائمة قبل الخروج (اعتماد محمد 16 أكتوبر) — تظهر فقط إن حُمّلت الجولة في الصفحة
       «Feature tour» at the bottom of the menu, before logout — only when the page loaded the tour */
    function tour_() {
      if (!global.SecFeatureTour) return '';
      return '<button type="button" class="mobile-menu-link mobile-menu-btn" data-act="tour"><span class="menu-icon" style="color:#1FB8C9">' + ICON.tour + '</span>الجولة التعريفية</button>';
    }
    function guest_() {
      return '<a href="auth.html" class="login-btn" data-role="login">تسجيل الدخول</a>' +
        (home ? '<a href="shifts.html" class="theme-toggle" title="تقويم دوام الورديات" aria-label="تقويم دوام الورديات">' + ICON.calSmall + '</a>' : '') +
        '<button type="button" class="theme-toggle" data-act="theme" aria-label="تبديل الوضع الداكن والفاتح">' + ICON.toggle + '</button>';
    }
    function status_() {
      return '<div class="header-row-status" data-role="status-bar"><div class="conn-status-pill">' +
        '<div class="status-bar-item"><span class="conn-dot" data-role="dot"></span><span data-role="conn-label">جاري التحقق...</span></div>' +
        '<div class="status-bar-item">' + ICON.clock + '<span data-role="last-label">آخر تحديث: —</span></div>' +
        '<div class="status-bar-item" data-role="date-line"></div>' +
        (o.refreshTitle ? '<div class="conn-refresh-group"><div class="conn-pill-div"></div><button type="button" class="status-refresh-btn" data-role="refresh" title="' + o.refreshTitle + '" aria-label="' + o.refreshTitle + '">' + ICON.refresh + '</button></div>' : '') +
        '</div></div>';
    }

    function syncTheme_() {
      const dark = THEME.get() === 'dark';
      headerEl.querySelectorAll('.theme-switch').forEach(function (sw) { sw.classList.toggle('on', dark); sw.setAttribute('aria-checked', dark ? 'true' : 'false'); });
    }

    /* رسم الصف الأول حسب الجلسة (الشريط لا يُعاد رسمه فتبقى حالته) — Draw the first row from the session (the bar isn't redrawn, keeping its state) */
    function render() {
      const loggedIn = SESSION.isLoggedIn();
      const row = headerEl.querySelector('[data-role="main"]');
      row.innerHTML = brand_() + '<div class="header-actions' + (loggedIn ? ' logged-in' : '') + '">' + (loggedIn ? (o.identity ? identity_() : menu_()) : guest_()) + '</div>';
      row.querySelector('[data-role="title"]').textContent = o.title || (home ? 'الشركة السعودية للطاقة' : '');
      row.querySelector('[data-role="subtitle"]').textContent = o.subtitle || (home ? 'نظام الإحداثيات الجغرافية' : '');
      if (loggedIn) {
        const first = (SESSION.getName() || '').trim().split(/\s+/)[0] || 'القائمة';
        row.querySelector('[data-role="name"]').textContent = first;
        row.querySelector('[data-role="initial"]').textContent = first === 'القائمة' ? '☰' : Array.from(first)[0].toUpperCase();
        if (o.identity) {
          if (first === 'القائمة') row.querySelector('[data-role="name"]').textContent = 'حسابي';
          const ph = String(SESSION.getPhone() || '');
          row.querySelector('[data-role="phone"]').textContent = /^\+966\d{9}$/.test(ph) ? '0' + ph.slice(4) : ph; // الصيغة المحلية / the local form
        }
        const call = row.querySelector('[data-act="call"]');
        if (call && global.SecContactAdmin) global.SecContactAdmin.bindCallLink(call);
      }
      syncTheme_();
    }

    headerEl.classList.add('app-header');
    headerEl.innerHTML = '<div class="header-row-main" data-role="main"></div>' + status_();
    render();

    const menuEl = function () { return headerEl.querySelector('[data-role="menu"]'); };
    function isMenuOpen() { const m = menuEl(); return !!(m && m.classList.contains('open')); }
    function setMenu_(open) {
      const m = menuEl(); if (!m) return;
      m.classList.toggle('open', open);
      m.querySelector('[data-act="menu"]').setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) resetLogout_();
    }
    function resetLogout_() {
      global.clearTimeout(confirmTimer);
      const btn = headerEl.querySelector('[data-act="logout"]');
      if (btn) { btn.dataset.confirm = ''; btn.querySelector('[data-role="logout-label"]').textContent = LOGOUT; }
    }

    function onClick_(e) {
      const t = e.target.closest('[data-act]');
      if (!t || !headerEl.contains(t)) return;
      const act = t.dataset.act;
      if (act === 'menu') { e.stopPropagation(); setMenu_(!isMenuOpen()); }
      else if (act === 'theme') THEME.toggle();
      else if (act === 'home') global.location.href = 'index.html';
      else if (act === 'identity') { if (o.onIdentity) o.onIdentity(); }
      else if (act === 'message') { e.preventDefault(); setMenu_(false); if (global.SecContactAdmin) global.SecContactAdmin.open(); }
      else if (act === 'install') { setMenu_(false); if (global.SecInstallSheet) global.SecInstallSheet.open(); }
      else if (act === 'tour') { setMenu_(false); if (global.SecFeatureTour) global.SecFeatureTour.open(); }
      else if (act === 'logout') {
        if (t.dataset.confirm === '1') { resetLogout_(); (o.onLogout || SESSION.logout)(); return; }
        t.dataset.confirm = '1';
        t.querySelector('[data-role="logout-label"]').textContent = LOGOUT_CONFIRM;
        confirmTimer = global.setTimeout(resetLogout_, CONFIRM_MS);
      }
    }
    function onDocClick_(e) { const m = menuEl(); if (m && !m.contains(e.target)) setMenu_(false); }
    function onMenuNav_(e) { const a = e.target.closest('.mobile-menu-link[href]'); if (a && a.dataset.act !== 'call') setMenu_(false); }
    function onKey_(e) {
      if (e.key === 'Escape' && isMenuOpen()) { setMenu_(false); const tr = headerEl.querySelector('[data-act="menu"]'); if (tr) tr.focus(); }
      else if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.act === 'home') { e.preventDefault(); global.location.href = 'index.html'; }
    }

    headerEl.addEventListener('click', onClick_);
    headerEl.addEventListener('click', onMenuNav_);
    headerEl.addEventListener('keydown', onKey_);
    doc.addEventListener('click', onDocClick_);
    subs.push(THEME.onChange(syncTheme_));
    // تغيّر حالة التثبيت (أُتيح التثبيت أو تمّ) ← يُعاد رسم الصف فيظهر الخيار أو يختفي — install state changed ← redraw the row
    if (global.SecPWA) {
      let lastMode = global.SecPWA.installMode();
      subs.push(global.SecPWA.onChange(function () { const m = global.SecPWA.installMode(); if (m !== lastMode) { lastMode = m; if (!isMenuOpen()) render(); } }));
    }
    const q = function (r) { return headerEl.querySelector('[data-role="' + r + '"]'); };

    return {
      status: { bar: q('status-bar'), dot: q('dot'), label: q('conn-label'), lastLabel: q('last-label'), dateLine: q('date-line') },
      refreshButton: q('refresh'),
      openMenu: function () { setMenu_(true); }, closeMenu: function () { setMenu_(false); }, isMenuOpen: isMenuOpen,
      render: render,
      destroy: function () {
        global.clearTimeout(confirmTimer);
        headerEl.removeEventListener('click', onClick_); headerEl.removeEventListener('click', onMenuNav_); headerEl.removeEventListener('keydown', onKey_);
        doc.removeEventListener('click', onDocClick_);
        subs.forEach(function (off) { off(); });
        headerEl.innerHTML = ''; headerEl.classList.remove('app-header');
      }
    };
  }

  global.SecAppHeader = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
