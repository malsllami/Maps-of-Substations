/* ============================================================
 * components/more-menu.js — شاشة «المزيد» (إعادة التصميم — المرحلة ز)
 * ============================================================
 * تجمع ما في القائمة المنسدلة نفسها، كل عنصر بإجرائه الحالي (لا منطق جديد):
 * - الحساب: حسابي، الورديات، لوحة المدير (للمدير فقط).
 * - البيانات: خريطة جدة بدون إنترنت (offline-map-ui). البيانات المؤقتة صارت أسفل شاشة «البيانات» (22 أكتوبر).
 * - التطبيق: الوضع الداكن (theme.js)، حفظ الموقع كتطبيق (install-sheet؛ يختفي إن كان مثبّتًا)، الجولة التعريفية.
 * - الخروج: بتأكيد بضغطة ثانية خلال 4 ث، كالقائمة المنسدلة (session.logout).
 * كل عنصر يظهر فقط إن كان مكوّنه محمّلًا في الصفحة. النصوص ثابتة من الواجهة، والاسم من الجلسة يُكتب نصًا.
 *
 * The «More» screen: the same items as the dropdown menu, each with its current action (no new logic) — account pages,
 * the Jeddah offline map (the cached data moved to the data screen), theme, install, the tour, and logout with a second-tap confirmation.
 * Each item shows only when its component is loaded. The session name is set as text.
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document, THEME = global.SecTheme, SESSION = global.SecSession;
  if (!THEME || !SESSION) throw new Error('more-menu.js يحتاج theme.js وsession.js قبله / needs theme.js and session.js first');
  const CONFIRM_MS = 4000, LOGOUT = 'تسجيل الخروج', LOGOUT_CONFIRM = 'اضغط مرة أخرى لتأكيد الخروج';
  const S = function (inner) { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'; };
  const ICON = {
    user: S('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    cal: S('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    shield: S('<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/><polyline points="9 12 11 14 15 10"/>'),
    map: S('<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>'),
    db: S('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
    moon: S('<path d="M21 12.5A8.5 8.5 0 1 1 11.5 3 6.8 6.8 0 0 0 21 12.5z"/>'),
    install: S('<rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>'),
    tour: S('<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>'),
    phone: S('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'),
    chat: S('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
    out: S('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>'
  };

  /**
   * mount(container, deps) ← { render(), destroy() }
   * deps: { onLogout (افتراضيًا SecSession.logout) }
   */
  function mount(container, deps) {
    const d = deps || {};
    let confirmTimer = null;
    container.classList.add('more-menu');

    function item_(act, cls, icon, label, extra) {
      return '<button type="button" class="mm-item ' + cls + '" data-act="' + act + '">' +
        '<span class="mm-ic">' + ICON[icon] + '</span><span class="mm-lbl">' + label + '</span>' + (extra || ICON.chev) + '</button>';
    }
    function link_(href, cls, icon, label) {
      return '<a class="mm-item ' + cls + '" href="' + href + '"><span class="mm-ic">' + ICON[icon] + '</span><span class="mm-lbl">' + label + '</span>' + ICON.chev + '</a>';
    }
    function group_(title, items) { return items ? '<div class="mm-group"><div class="mm-gt">' + title + '</div><div class="mm-box">' + items + '</div></div>' : ''; }

    function render() {
      global.clearTimeout(confirmTimer);
      const g = global, P = g.SecPWA;
      const install = g.SecInstallSheet && P && P.installMode() !== 'installed';
      container.innerHTML =
        '<div class="mm-head"><img class="mm-avatar" src="assets/member-avatar.webp" alt="" aria-hidden="true"><div class="mm-who"><span class="mm-name" data-role="name"></span>' +
          '<span class="mm-role"><bdi class="mm-phone" data-role="phone" dir="ltr"></bdi> · ' + (SESSION.isAdmin() ? 'مدير' : 'عضو') + '</span></div></div>' +
        group_('الحساب', link_('member.html', 'k-sub', 'user', 'حسابي') + link_('shifts.html', 'k-total', 'cal', 'تقويم دوام الورديات') +
          (SESSION.isAdmin() ? link_('admin.html', 'k-ops', 'shield', 'لوحة المدير') : '')) +
        group_('البيانات', (g.SecOfflineMapUI ? item_('offline-map', 'k-dist', 'map', 'خريطة جدة بدون إنترنت') : '')) +
        // التواصل مع المدير (كان في القائمة المنسدلة للصفحات الأخرى) — contacting the admin (was in the other pages' dropdown)
        (g.SecContactAdmin ? group_('التواصل', '<a class="mm-item k-dist" href="#" data-act="call"><span class="mm-ic">' + ICON.phone + '</span><span class="mm-lbl">اتصال بالمدير</span>' + ICON.chev + '</a>' +
          item_('message', 'k-sub', 'chat', 'مراسلة المدير')) : '') +
        group_('التطبيق', item_('theme', 'k-info', 'moon', 'الوضع الداكن', '<span class="mm-switch" data-role="switch" role="switch"><span></span></span>') +
          (install ? item_('install', 'k-dist', 'install', 'حفظ الموقع كتطبيق') : '') +
          (g.SecFeatureTour ? item_('tour', 'k-sub', 'tour', 'الجولة التعريفية') : '')) +
        '<button type="button" class="mm-logout" data-act="logout"><span class="mm-ic">' + ICON.out + '</span><span data-role="logout-label">' + LOGOUT + '</span></button>';
      const first = (SESSION.getName() || '').trim().split(/\s+/)[0] || '';
      container.querySelector('[data-role="name"]').textContent = first || 'حسابي';
      const ph = String(SESSION.getPhone() || '');
      container.querySelector('[data-role="phone"]').textContent = /^\+966\d{9}$/.test(ph) ? '0' + ph.slice(4) : ph; // الصيغة المحلية / the local form
      syncTheme_();
      const call = container.querySelector('[data-act="call"]');
      if (call && global.SecContactAdmin) global.SecContactAdmin.bindCallLink(call);
    }
    function syncTheme_() {
      const sw = container.querySelector('[data-role="switch"]'); if (!sw) return;
      const dark = THEME.get() === 'dark'; sw.classList.toggle('on', dark); sw.setAttribute('aria-checked', dark ? 'true' : 'false');
    }
    function resetLogout_() {
      global.clearTimeout(confirmTimer);
      const b = container.querySelector('[data-act="logout"]');
      if (b) { b.dataset.confirm = ''; b.querySelector('[data-role="logout-label"]').textContent = LOGOUT; }
    }

    function onClick_(e) {
      const t = e.target.closest('[data-act]');
      if (!t || !container.contains(t)) return;
      const act = t.dataset.act, g = global;
      if (act === 'theme') THEME.toggle();
      else if (act === 'offline-map') { if (g.SecOfflineMapUI) g.SecOfflineMapUI.open(); }
      else if (act === 'install') { if (g.SecInstallSheet) g.SecInstallSheet.open(); }
      else if (act === 'tour') { if (g.SecFeatureTour) g.SecFeatureTour.open(); }
      else if (act === 'message') { e.preventDefault(); if (g.SecContactAdmin) g.SecContactAdmin.open(); }
      else if (act === 'logout') {
        if (t.dataset.confirm === '1') { resetLogout_(); (d.onLogout || SESSION.logout)(); return; }
        t.dataset.confirm = '1';
        t.querySelector('[data-role="logout-label"]').textContent = LOGOUT_CONFIRM;
        confirmTimer = global.setTimeout(resetLogout_, CONFIRM_MS);
      }
    }
    container.addEventListener('click', onClick_);
    const offTheme = THEME.onChange(syncTheme_);
    render();

    return {
      render: render,
      destroy: function () { global.clearTimeout(confirmTimer); container.removeEventListener('click', onClick_); if (typeof offTheme === 'function') offTheme(); container.innerHTML = ''; }
    };
  }

  global.SecMoreMenu = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
