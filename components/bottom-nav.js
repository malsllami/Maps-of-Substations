/* ============================================================
 * components/bottom-nav.js — الشريط السفلي الثابت: الرئيسية، الخريطة، ＋ إضافة، المحطات، المزيد (إعادة التصميم، 19 أكتوبر)
 * ============================================================
 * يرسم الأزرار ويُبلغ الصفحة بالاختيار فقط — لا منطق تنقل هنا (الصفحة تقرر ماذا تعرض).
 * - زر ＋ في الوسط بارز (كهرماني) ويستدعي onAdd.
 * - setActive(name) يميّز التبويب الحالي (aria-current).
 * - يختفي تلقائيًا أثناء الملاحة بشاشة كاملة (body.nav-full) ونماذج الشاشة الكاملة — بالأنماط فقط.
 *
 * The fixed bottom bar: home, map, ＋ add, stations, more (redesign, 19 Oct). Draws the buttons and reports the choice
 * only — no navigation logic here (the page decides what to show). The centre ＋ calls onAdd; setActive marks the
 * current tab; hidden during full-screen navigation by the styles alone.
 * ============================================================ */
(function (global) {
  'use strict';

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    map: '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
    stations: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.5"/><circle cx="4.5" cy="12" r="1.5"/><circle cx="4.5" cy="18" r="1.5"/>',
    more: '<circle cx="5" cy="5" r="1.6"/><circle cx="12" cy="5" r="1.6"/><circle cx="19" cy="5" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/><circle cx="5" cy="19" r="1.6"/><circle cx="12" cy="19" r="1.6"/><circle cx="19" cy="19" r="1.6"/>'
  };
  const TABS = [
    { name: 'home', label: 'الرئيسية' },
    { name: 'map', label: 'الخريطة' },
    { name: 'add' },
    { name: 'stations', label: 'المحطات' },
    { name: 'more', label: 'المزيد' }
  ];

  function icon_(name) {
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  /**
   * mount(el, opts) — opts: { active, onSelect(name), onAdd() } ← { setActive(name), active(), element }
   */
  function mount(el, opts) {
    const o = opts || {};
    let current = o.active || 'home';
    el.classList.add('bottom-nav');
    el.setAttribute('aria-label', 'التنقل الرئيسي');
    el.innerHTML = '<div class="bn-inner">' + TABS.map(function (t) {
      if (t.name === 'add') return '<button type="button" class="bn-add" data-tab="add" aria-label="إضافة محطة" title="إضافة محطة"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>';
      return '<button type="button" class="bn-tab" data-tab="' + t.name + '">' + icon_(t.name) + '<span class="bn-label">' + t.label + '</span></button>';
    }).join('') + '</div>';

    function setActive(name) {
      current = name;
      el.querySelectorAll('.bn-tab').forEach(function (b) {
        const on = b.dataset.tab === name;
        b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
    }
    el.addEventListener('click', function (e) {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      if (b.dataset.tab === 'add') { if (o.onAdd) o.onAdd(); return; }
      if (o.onSelect) o.onSelect(b.dataset.tab);
    });
    setActive(current);
    return { setActive: setActive, active: function () { return current; }, element: el };
  }

  global.SecBottomNav = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
