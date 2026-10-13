/* ============================================================
 * components/device-copies.js — «حسابي»: آخر نسخة بالذاكرة المؤقتة، وسجل نسخ الجهاز، وحالة عمليات التنزيل
 * ============================================================
 * سلوك V1 (member.html) ونصوصه كما هي:
 * - «آخر نسخة بالذاكرة المؤقتة»: 🟢 النسخة، عدد المحطات والحجم، التاريخ ميلادي + هجري، و«آخر مزامنة ناجحة»؛
 *   أو «⚪ لم تُحمَّل بعد على هذا الجهاز».
 * - «سجل نسخ الذاكرة المؤقتة على هذا الجهاز»: جدول (النسخة، العملية، المحطات، الحجم، التاريخ) + «حالة عمليات التنزيل»
 *   (🟢 مكتمل من سجل النسخ، 🔴 فشل من سجل الإخفاقات «لم تنتج نسخة، وبقيت السابقة كما هي») — أحدث 20.
 * - يُقرأ من الجهاز فقط (لا خادم ولا إنترنت، ولا تحميل لنسخة المحطات نفسها 5 ميجابايت): الوصف والسجلان يكتبها
 *   services/stations-sync.js وحده — هنا قراءة فقط.
 * V2: النسخة غير المحفوظة بالجهاز تُقال صراحة؛ الجدول بالقاعدة الموحّدة؛ التواريخ من utils/dates؛ كل نص يُكتب نصًا.
 *
 * «My account»: the last cached copy, this device's copies log and the load operations. V1's behavior and texts. Read
 * from the device only (the descriptor and both logs are written by stations-sync alone — read-only here).
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, D = global.SecDates;
  if (!CONFIG || !D) throw new Error('device-copies.js يحتاج الإعدادات وdates.js قبله / needs the config and dates.js first');
  const K = CONFIG.STORAGE_KEYS, OPS_MAX = 20;
  const MSG = {
    NOT_LOADED: '⚪ لم تُحمَّل بعد على هذا الجهاز', NOT_SAVED: 'بالذاكرة فقط — لم تُحفظ بالجهاز',
    NO_COPIES: 'لا توجد نسخ ناجحة بعد', KEPT: ' — لم تنتج نسخة، وبقيت السابقة كما هي'
  };

  function read_(key, fallback) { try { const v = JSON.parse(global.localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function size(b) { return (Number(b || 0) / (1024 * 1024)).toFixed(2) + ' MB'; }
  function count_(n) { return Number(n || 0).toLocaleString('en'); }
  function typeName(e) { return e.type === 'full' ? 'تحميل كامل' : e.type === 'sync' ? 'مزامنة' + (e.changes != null ? ' (' + e.changes + ' تغيير)' : '') : 'نقل لقاعدة الجهاز'; }
  function el_(tag, cls, text) { const e = global.document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function when_(ms) { return D.gregorian(ms) + ' · ' + D.hijri(ms) + ' · ' + D.time(ms); }

  /**
   * mount(slots) — slots: { copy (سطر آخر نسخة)، log (بطاقة السجل، تظهر فقط إن وُجد سجل) }
   * يُرجع { render()، destroy() }
   */
  function mount(slots) {
    slots.log.innerHTML =
      '<div class="card-title">سجل نسخ الذاكرة المؤقتة على هذا الجهاز</div>' +
      '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>النسخة</th><th>العملية</th><th>المحطات</th><th>الحجم</th><th>التاريخ</th></tr></thead><tbody></tbody></table></div>' +
      '<div class="card-title" style="margin:16px 0 8px">حالة عمليات التنزيل</div><div class="cache-ops" data-role="ops"></div>';

    function renderCopy_() {
      const meta = read_(K.STATIONS_META, null), box = slots.copy;
      box.textContent = '';
      if (!meta || !meta.count) { box.appendChild(el_('span', '', MSG.NOT_LOADED)); return; }
      box.appendChild(el_('span', 'v', '🟢 النسخة ' + (meta.version == null ? '—' : meta.version)));
      const line = el_('span');
      line.appendChild(el_('span', 'n', count_(meta.count))); line.appendChild(global.document.createTextNode(' محطة · '));
      line.appendChild(el_('span', 'n', size(meta.bytes)));
      box.appendChild(line);
      if (meta.persisted === false) box.appendChild(el_('span', 'warn', MSG.NOT_SAVED));
      const at = Number(meta.syncedAt) || Number(meta.savedAt) || Date.parse(meta.savedAt) || 0;
      if (at) {
        box.appendChild(el_('span', '', D.gregorian(at) + ' · ' + D.hijri(at)));
        const s = el_('span', '', 'آخر مزامنة ناجحة: '); s.appendChild(el_('b', '', D.time(at))); box.appendChild(s);
      }
    }
    function renderLog_() {
      const copies = read_(K.STATIONS_LOAD_LOG, []), issues = read_(K.STATIONS_ISSUES_LOG, []);
      const list = Array.isArray(copies) ? copies : [], fails = Array.isArray(issues) ? issues : [];
      if (!list.length && !fails.length) { slots.log.hidden = true; return; }
      const body = slots.log.querySelector('tbody');
      body.textContent = '';
      if (!list.length) { const tr = el_('tr'), td = el_('td', '', MSG.NO_COPIES); td.colSpan = 5; tr.appendChild(td); body.appendChild(tr); }
      list.forEach(function (e) {
        const tr = el_('tr');
        tr.appendChild(el_('td', 'mono', String(e.version == null ? '—' : e.version)));
        const t = el_('td'); t.appendChild(el_('span', 'cache-type ' + (e.type === 'sync' || e.type === 'full' ? e.type : 'migrate'), typeName(e))); tr.appendChild(t);
        tr.appendChild(el_('td', 'mono', count_(e.count)));
        tr.appendChild(el_('td', 'mono', size(e.bytes)));
        const d = el_('td'); d.appendChild(el_('span', '', D.gregorian(e.at))); d.appendChild(el_('span', 'sub', D.hijri(e.at) + ' · ' + D.time(e.at))); tr.appendChild(d);
        body.appendChild(tr);
      });
      // 🟢 من سجل النسخ و🔴 من سجل الإخفاقات معًا بالوقت — complete and failed together by time
      const ops = list.map(function (e) { return { at: e.at, icon: '🟢', title: 'مكتمل · ' + typeName(e) + ' · النسخة ' + e.version, sub: count_(e.count) + ' محطة · ' + size(e.bytes) }; })
        .concat(fails.map(function (i) { return { at: i.at, icon: '🔴', title: 'فشل · ' + (i.type === 'full' ? 'تحميل كامل' : 'مزامنة'), sub: String(i.reason || '') + MSG.KEPT }; }))
        .sort(function (a, b) { return b.at - a.at; }).slice(0, OPS_MAX);
      const box = slots.log.querySelector('[data-role="ops"]');
      box.textContent = '';
      ops.forEach(function (op) {
        const row = el_('div', 'cache-op'), txt = el_('div');
        row.appendChild(el_('span', '', op.icon));
        txt.appendChild(el_('div', 't', op.title)); txt.appendChild(el_('div', 's', op.sub)); txt.appendChild(el_('div', 's', when_(op.at)));
        row.appendChild(txt); box.appendChild(row);
      });
      slots.log.hidden = false;
    }
    function render() { renderCopy_(); renderLog_(); }
    // تغيّر من تبويب آخر (الرئيسية تحمّل/تزامن) — a change from another tab (home loading/syncing)
    function onStorage_(e) { if (!e.key || e.key === K.STATIONS_META || e.key === K.STATIONS_LOAD_LOG || e.key === K.STATIONS_ISSUES_LOG) render(); }
    global.addEventListener('storage', onStorage_);
    render();
    return { render: render, destroy: function () { global.removeEventListener('storage', onStorage_); } };
  }

  global.SecDeviceCopies = { mount: mount, typeName: typeName, size: size, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
