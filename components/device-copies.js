/* ============================================================
 * components/device-copies.js — «حسابي»: «سجل نسخ الذاكرة المؤقتة» على هذا الجهاز (تصميم محمد — 15 أكتوبر)
 * ============================================================
 * - قائمة بطاقات صفّية بدل الجدول العريض: النسخ الناجحة (🟢 من سجل النسخ) والإخفاقات (🔴 من سجل الإخفاقات «لم تنتج
 *   نسخة، وبقيت السابقة كما هي») مدمجة بالترتيب الزمني، الأحدث أولًا. لكل صف: رقم النسخة، العملية («تحميل كامل» /
 *   «مزامنة (N تغيير)»)، عدد المحطات، الحجم، والتاريخ ميلادي + هجري مع الوقت.
 * - آخر 4 ظاهرة، وزر «عرض جميع النسخ» يُظهر البقية (حتى 20)، ويطويها مرة أخرى.
 * - سطر حالة عند الحاجة فقط: «⚪ لم تُحمَّل بعد على هذا الجهاز» أو «بالذاكرة فقط — لم تُحفظ بالجهاز».
 * - يُقرأ من الجهاز فقط (لا خادم ولا إنترنت، ولا تحميل لنسخة المحطات نفسها): الوصف والسجلان يكتبها
 *   services/stations-sync.js وحده — هنا قراءة فقط. كل نص يُكتب نصًا.
 *
 * «My account»: this device's cached copies log (Mohammed's design — 15 Oct). A list of row cards instead of the wide
 * table: successful copies (🟢) and failures (🔴) merged by time, newest first; the last 4 shown with «show all copies»
 * (up to 20); a status line only when needed. Read from the device only (written by stations-sync alone).
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, D = global.SecDates;
  if (!CONFIG || !D) throw new Error('device-copies.js يحتاج الإعدادات وdates.js قبله / needs the config and dates.js first');
  const K = CONFIG.STORAGE_KEYS, OPS_MAX = 20, SHOWN = 4;
  const GREGORY_NUMERIC = 'ar-SA-u-ca-gregory-nu-latn';
  const MSG = {
    TITLE: 'سجل نسخ الذاكرة المؤقتة',
    NOT_LOADED: '⚪ لم تُحمَّل بعد على هذا الجهاز', NOT_SAVED: 'بالذاكرة فقط — لم تُحفظ بالجهاز',
    NO_COPIES: 'لا توجد نسخ ناجحة بعد', KEPT: ' — لم تنتج نسخة، وبقيت السابقة كما هي',
    SHOW_ALL: 'عرض جميع النسخ', SHOW_LESS: 'عرض أقل'
  };
  const DB_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>';
  const HISTORY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>';

  function read_(key, fallback) { try { const v = JSON.parse(global.localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function size(b) { return (Number(b || 0) / (1024 * 1024)).toFixed(2) + ' MB'; }
  function count_(n) { return Number(n || 0).toLocaleString('en'); }
  function typeName(e) { return e.type === 'full' ? 'تحميل كامل' : e.type === 'sync' ? 'مزامنة' + (e.changes != null ? ' (' + e.changes + ' تغيير)' : '') : 'نقل لقاعدة الجهاز'; }
  function el_(tag, cls, text) { const e = global.document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  /* «15/10/2026 م · 3:50 م» وتحته الهجري — the Gregorian date and time, the Hijri below */
  function whenMain_(ms) { return new Date(ms).toLocaleDateString(GREGORY_NUMERIC, { day: 'numeric', month: 'numeric', year: 'numeric' }) + ' م · ' + D.time(ms); }

  /**
   * mount(slots) — slots: { log (بطاقة السجل) }
   * يُرجع { render()، destroy() }
   */
  function mount(slots) {
    const card = slots.log;
    card.innerHTML =
      '<div class="copies-head"><span class="copies-icon">' + DB_ICON + '</span><span class="copies-title">' + MSG.TITLE + '</span></div>' +
      '<div class="copy-status" data-role="status" hidden></div>' +
      '<div class="copy-list" data-role="list"></div>' +
      '<button type="button" class="copies-more" data-act="more" hidden></button>';
    const statusEl = card.querySelector('[data-role="status"]'), listEl = card.querySelector('[data-role="list"]'), moreBtn = card.querySelector('[data-act="more"]');
    let expanded = false;

    function renderStatus_() {
      const meta = read_(K.STATIONS_META, null);
      statusEl.className = 'copy-status';
      if (!meta || !meta.count) { statusEl.textContent = MSG.NOT_LOADED; statusEl.hidden = false; return; }
      if (meta.persisted === false) { statusEl.textContent = MSG.NOT_SAVED; statusEl.classList.add('warn'); statusEl.hidden = false; return; }
      statusEl.textContent = ''; statusEl.hidden = true;
    }
    function row_(op) {
      const row = el_('div', 'copy-row' + (op.ok ? '' : ' failed'));
      const top = el_('div', 'copy-top');
      top.appendChild(el_('span', 'copy-dot' + (op.ok ? ' ok' : ' fail')));
      if (op.ok) top.appendChild(el_('span', 'copy-ver', String(op.version == null ? '—' : op.version)));
      top.appendChild(el_('span', 'copy-type', op.title));
      row.appendChild(top);
      const sub = el_('div', 'copy-sub');
      if (op.ok) { sub.appendChild(el_('span', 'copy-n', count_(op.count) + ' محطة')); sub.appendChild(el_('span', 'copy-n', size(op.bytes))); }
      else sub.appendChild(el_('span', 'copy-reason', String(op.reason || '') + MSG.KEPT));
      const when = el_('span', 'copy-when'); when.appendChild(el_('span', '', whenMain_(op.at))); when.appendChild(el_('small', '', D.hijri(op.at)));
      sub.appendChild(when);
      row.appendChild(sub);
      return row;
    }
    function renderList_() {
      const copies = read_(K.STATIONS_LOAD_LOG, []), issues = read_(K.STATIONS_ISSUES_LOG, []);
      const list = Array.isArray(copies) ? copies : [], fails = Array.isArray(issues) ? issues : [];
      // 🟢 من سجل النسخ و🔴 من سجل الإخفاقات معًا بالوقت — complete and failed together by time
      const ops = list.map(function (e) { return { ok: true, at: e.at, version: e.version, title: typeName(e), count: e.count, bytes: e.bytes }; })
        .concat(fails.map(function (i) { return { ok: false, at: i.at, title: 'فشل · ' + (i.type === 'full' ? 'تحميل كامل' : 'مزامنة'), reason: i.reason }; }))
        .filter(function (op) { return Number(op.at) > 0; })
        .sort(function (a, b) { return b.at - a.at; }).slice(0, OPS_MAX);
      listEl.textContent = '';
      // بلا نسخ ناجحة: يقال صراحة إن وُجدت إخفاقات أو نسخة محمّلة بلا سجل — no successful copy: said when there are failures or a copy without a log
      if (!list.length && (fails.length || statusEl.hidden)) listEl.appendChild(el_('div', 'copy-empty', MSG.NO_COPIES));
      (expanded ? ops : ops.slice(0, SHOWN)).forEach(function (op) { listEl.appendChild(row_(op)); });
      moreBtn.hidden = ops.length <= SHOWN;
      moreBtn.innerHTML = HISTORY_ICON + '<span></span>';
      moreBtn.querySelector('span').textContent = expanded ? MSG.SHOW_LESS : MSG.SHOW_ALL + ' (' + ops.length + ')';
    }
    function render() { renderStatus_(); renderList_(); }
    function onClick_(e) { if (e.target.closest('[data-act="more"]')) { expanded = !expanded; renderList_(); } }
    // تغيّر من تبويب آخر (الرئيسية تحمّل/تزامن) — a change from another tab (home loading/syncing)
    function onStorage_(e) { if (!e.key || e.key === K.STATIONS_META || e.key === K.STATIONS_LOAD_LOG || e.key === K.STATIONS_ISSUES_LOG) render(); }
    card.addEventListener('click', onClick_);
    global.addEventListener('storage', onStorage_);
    render();
    return { render: render, destroy: function () { card.removeEventListener('click', onClick_); global.removeEventListener('storage', onStorage_); } };
  }

  global.SecDeviceCopies = { mount: mount, typeName: typeName, size: size, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
