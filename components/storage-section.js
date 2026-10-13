/* ============================================================
 * components/storage-section.js — قسم الذاكرة في الرئيسية: «🗑️ مسح التخزين المؤقت»، شريط «الذاكرة المستخدمة»،
 *   سطر «بيانات المحطات المحمّلة بالذاكرة المؤقتة»، وسطر «آخر تحديث لبيانات المحطات» (ميلادي + هجري)
 * ============================================================
 * تصميم V1 ونصوصه كما هي. حالة المحطات من services/stations-sync.js فقط (state/onChange/clear) — لا قراءة للمحطات هنا.
 * V2:
 * - إصلاح بند V1 رقم 5: المسح يُبقي الجلسة والجوال والثيم ونمط الخريطة ودوران الملاحة ومظهر لوحتها، وطابور الأخطاء
 *   غير المرسلة (حتى لا تضيع بلاغات الأعطال).
 * - المسح لا يمس إلا مفاتيح V2 (بادئة sec2-) — V1 على نفس النطاق لا يُلمس (V1 كان يمسح localStorage كله).
 * - خريطة جدة المحلية لا تُمسح هنا (كما في V1) — لها نافذة إدارتها.
 * - شريط الذاكرة من تقدير المتصفح الحقيقي (navigator.storage.estimate: المحطات وخريطة جدة وملفات الموقع) بدل عدّ
 *   localStorage وحده بسقف مفترض 50 MB؛ إن لم يتوفر التقدير ← طريقة V1 كما هي.
 * - التأكيد بنص V1 نفسه.
 *
 * The home page storage section. V1's design and texts. Station state from stations-sync only. V2: fixes V1 bug 5
 * (preferences kept), clears V2 keys only (V1 on the same origin is untouched), the usage bar from the browser's real
 * estimate (V1's way as the fallback).
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, D = global.SecDates;
  if (!CONFIG || !D) throw new Error('storage-section.js يحتاج الإعدادات وdates.js قبله / needs the config and dates.js first');
  const K = CONFIG.STORAGE_KEYS, PREFIX = CONFIG.STORAGE_PREFIX;
  const ASSUMED_CAP_MB = 50; // سقف V1 المفترض — للاحتياط فقط / V1's assumed cap — fallback only
  /* ما يبقى بعد المسح — What survives a clear */
  const KEEP = [K.SESSION, K.PHONE, K.THEME, K.MAP_MODE, K.NAV_GLASS, K.NAV_ROTATE, K.PENDING_ERRORS];
  const MSG = {
    CLEAR: '🗑️ مسح التخزين المؤقت',
    USED: 'الذاكرة المستخدمة',
    CONFIRM: 'مسح البيانات المؤقتة المحفوظة بجهازك (المحطات الأخيرة وغيرها)؟ لن يمسّ هذا جلستك الحالية ولا بيانات الشيت.',
    INFO: 'بيانات المحطات المحمّلة بالذاكرة المؤقتة: ',
    NOT_LOADED: 'لم تُحمَّل بعد',
    IN_DB: ' MB بقاعدة بيانات الجهاز)',
    IN_MEMORY: ' — بالذاكرة فقط، لم تُحفظ بالجهاز',
    LATEST: 'آخر تحديث لبيانات المحطات: ',
    VERSION: ' · النسخة '
  };

  function mb_(bytes) { return (bytes / (1024 * 1024)).toFixed(2); }
  function gb_(bytes) { return bytes >= 1024 * 1024 * 1024 ? (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : Math.round(bytes / (1024 * 1024)) + ' MB'; }

  /* تقدير V1: كل localStorage بالـUTF-16 — V1's estimate: all localStorage as UTF-16 */
  function localStorageBytes_() {
    let total = 0;
    try {
      for (let i = 0; i < global.localStorage.length; i++) {
        const key = global.localStorage.key(i), value = global.localStorage.getItem(key) || '';
        total += (key.length + value.length) * 2;
      }
    } catch (e) { /* محظور / blocked */ }
    return total;
  }
  async function usage_() {
    const st = global.navigator.storage;
    if (st && st.estimate) {
      try {
        const e = await st.estimate();
        if (e && e.quota > 0) return { used: e.usage || 0, cap: e.quota, real: true };
      } catch (err) { /* إلى طريقة V1 / to V1's way */ }
    }
    return { used: localStorageBytes_(), cap: ASSUMED_CAP_MB * 1024 * 1024, real: false };
  }

  /* مسح مفاتيح V2 المؤقتة فقط — Clear V2's temporary keys only */
  function clearKeys_() {
    const remove = [];
    try {
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0 && KEEP.indexOf(k) === -1) remove.push(k);
      }
      remove.forEach(function (k) { global.localStorage.removeItem(k); });
    } catch (e) { /* محظور / blocked */ }
    return remove;
  }
  function savedAt_() {
    try { const m = JSON.parse(global.localStorage.getItem(K.STATIONS_META) || 'null'); return m && m.savedAt ? Number(m.savedAt) || Date.parse(m.savedAt) || null : null; } catch (e) { return null; }
  }

  /**
   * mount(container, opts) — opts: { confirm(text) → bool (افتراضيًا confirm المتصفح)، onCleared() }
   * يُرجع { render() → Promise، clear() → Promise<bool>، destroy() }
   */
  function mount(container, opts) {
    const o = opts || {}, SYNC = global.SecStationsSync;
    container.insertAdjacentHTML('beforeend',
      '<div class="storage-row" data-role="storage-row">' +
      '<button type="button" class="storage-clear-btn" data-act="clear">' + MSG.CLEAR + '</button>' +
      '<div class="storage-bar-wrap"><span>' + MSG.USED + '</span>' +
      '<div class="storage-bar-track"><div class="storage-bar-fill" data-role="fill"></div></div><span data-role="usage">—</span></div>' +
      '<div class="stations-cache-info" data-role="info"></div>' +
      '<div class="stations-cache-info stations-latest-info" data-role="latest" hidden></div></div>');
    const row = container.querySelector('[data-role="storage-row"]');
    const fill = row.querySelector('[data-role="fill"]'), usage = row.querySelector('[data-role="usage"]');
    const info = row.querySelector('[data-role="info"]'), latest = row.querySelector('[data-role="latest"]');
    let alive = true, seq = 0, unsub = null;

    function renderStations_() {
      const s = SYNC ? SYNC.state() : { loaded: false };
      info.textContent = MSG.INFO;
      if (!s.loaded || !s.count) { info.appendChild(global.document.createTextNode(MSG.NOT_LOADED)); latest.hidden = true; return; }
      const b = global.document.createElement('b'); b.textContent = String(s.count);
      info.appendChild(b);
      info.appendChild(global.document.createTextNode(s.persisted
        ? ' محطة (' + mb_(s.sizeBytes || 0) + MSG.IN_DB
        : ' محطة' + MSG.IN_MEMORY));
      const at = s.syncedAt || savedAt_();
      if (!at) { latest.hidden = true; return; }
      latest.textContent = MSG.LATEST;
      const when = global.document.createElement('bdi'); when.textContent = D.dualDateTime(at);
      latest.appendChild(when);
      if (s.version != null) {
        latest.appendChild(global.document.createTextNode(MSG.VERSION));
        const v = global.document.createElement('b'), vb = global.document.createElement('bdi');
        vb.textContent = String(s.version); v.appendChild(vb); latest.appendChild(v);
      }
      latest.hidden = false;
    }
    async function render() {
      const my = ++seq;
      renderStations_();
      const u = await usage_();
      if (!alive || my !== seq) return;
      const percent = Math.min(100, Math.round(u.used / u.cap * 100));
      usage.textContent = mb_(u.used) + ' MB / ' + (u.real ? gb_(u.cap) : ASSUMED_CAP_MB + ' MB');
      fill.style.width = percent + '%';
    }
    async function clear() {
      const ask = o.confirm || function (t) { return global.confirm(t); };
      if (!ask(MSG.CONFIRM)) return false;
      clearKeys_();
      if (global.SecRecentStations) global.SecRecentStations.clear(); // لتحديث لوحتها المفتوحة / to refresh its open panel
      if (SYNC) { try { await SYNC.clear(); } catch (e) { /* تبقى الصفحة تعمل / the page keeps working */ } }
      await render();
      if (o.onCleared) { try { o.onCleared(); } catch (e) { /* لا شيء / nothing */ } }
      return true;
    }
    function onClick_(e) { if (e.target.closest('[data-act="clear"]')) clear(); }

    row.addEventListener('click', onClick_);
    if (SYNC) unsub = SYNC.onChange(function () { render(); });
    render();

    return {
      render: render, clear: clear,
      destroy: function () {
        alive = false;
        row.removeEventListener('click', onClick_);
        if (typeof unsub === 'function') unsub();
        row.remove();
      }
    };
  }

  global.SecStorageSection = { mount: mount, KEEP: KEEP, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
