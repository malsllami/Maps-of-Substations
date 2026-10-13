/* ============================================================
 * components/recent-stations.js — «🕐 آخر المحطات»: المحطات التي فتحها المستخدم في آخر ساعتين
 * ============================================================
 * سلوك V1 وتصميمه كما هما: لوحة «محطاتك الأخيرة» + «مسح السجل»، شرائح بأرقام المحطات الأحدث أولًا، الضغط يفتح المحطة،
 * ما مضى عليه ساعتان يختفي، وبلا محطات: «ما فيه محطات زرتها مؤخراً بعد». التخزين على الجهاز فقط (localStorage).
 * V2 (إصلاح بند V1 رقم 4): المفتاح = الرقم + النوع، فمحطتا توزيع وتحويل بنفس الرقم لا تُخلطان.
 * V2: عند الضغط تُؤخذ أحدث بيانات المحطة من النسخة المحلية (stations-sync) إن وُجدت — لا إحداثيات قديمة محفوظة
 *     منذ الزيارة؛ النصوص تُكتب نصًا.
 *
 * «Recent stations»: stations opened in the last two hours. V1's behavior and design; stored on the device only.
 * V2 fixes V1 bug 4 (key = id + type). On a tap the latest data comes from the local copy when present.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('recent-stations.js يحتاج config/الإعدادات.js قبله / needs the config first');
  const KEY = CONFIG.STORAGE_KEYS.RECENT_STATIONS, TTL_MS = CONFIG.TIMING.RECENT_STATIONS_MS;
  const MSG = { TITLE: 'محطاتك الأخيرة', CLEAR: 'مسح السجل', EMPTY: 'ما فيه محطات زرتها مؤخراً بعد' };

  function keyOf_(s) { return String(s.id).toUpperCase() + '\u0001' + (s.type || ''); }

  /* القائمة الصالحة (آخر ساعتين) الأحدث أولًا، وتُحذف المنتهية من التخزين — The valid list, newest first; expired ones dropped */
  function list(now) {
    const t = now || Date.now();
    let raw = {};
    try { raw = JSON.parse(global.localStorage.getItem(KEY) || '{}') || {}; } catch (e) { raw = {}; }
    const valid = {};
    Object.keys(raw).forEach(function (k) { const e = raw[k]; if (e && e.id != null && t - e.visitedAt < TTL_MS) valid[k] = e; });
    if (Object.keys(valid).length !== Object.keys(raw).length) save_(valid);
    return Object.keys(valid).map(function (k) { return valid[k]; }).sort(function (a, b) { return b.visitedAt - a.visitedAt; });
  }
  function save_(map) { try { global.localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) { /* تخزين ممتلئ أو محجوب — لا شيء / storage full or blocked */ } }

  /* تسجيل زيارة محطة (عند فتحها) — Record a station visit (when opened) */
  function add(station, now) {
    if (!station || station.id == null) return;
    const map = {};
    list(now).forEach(function (e) { map[keyOf_(e)] = e; });
    map[keyOf_(station)] = { id: station.id, name: station.name || '', type: station.type || '', lat: station.lat, lng: station.lng,
      region: station.region || '', feeder: station.feeder || '', visitedAt: now || Date.now() };
    save_(map);
    emit_();
  }
  function clear() { try { global.localStorage.removeItem(KEY); } catch (e) { /* لا شيء / nothing */ } emit_(); }

  /* أحدث بيانات المحطة من النسخة المحلية إن وُجدت (نفس الرقم والنوع) — The latest data from the local copy (same id and type) */
  function fresh_(entry) {
    const SYNC = global.SecStationsSync, all = SYNC && SYNC.stations();
    if (!all) return entry;
    const k = keyOf_(entry);
    for (let i = 0; i < all.length; i++) {
      if (keyOf_(all[i]) === k) {
        const s = all[i];
        return Object.assign({}, entry, { lat: s.lat, lng: s.lng, region: s.region || '', feeder: s.feeder || '',
          name: (s.type === 'تحويل' ? 'محطة تحويل ' : 'محطة توزيع ') + s.id + (s.region ? ' — ' + s.region : '') });
      }
    }
    return entry;
  }

  const listeners = [];
  function emit_() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { /* لا شيء / nothing */ } }); }

  /**
   * mount(container, opts) — opts: { onSelect(station) } — تُرسم اللوحة (مخفية) داخل container؛ الصفحة تربط زرها بـ toggle().
   * يُرجع { toggle(open?)، isOpen()، render()، destroy() }
   */
  function mount(container, opts) {
    const o = opts || {};
    container.insertAdjacentHTML('beforeend',
      '<div class="recent-panel" data-role="recent-panel"><div class="recent-panel-head"><span>' + MSG.TITLE + '</span>' +
      '<button type="button" class="recent-clear-btn" data-act="clear">' + MSG.CLEAR + '</button></div>' +
      '<div class="recent-chips" data-role="chips"></div></div>');
    const panel = container.querySelector('[data-role="recent-panel"]'), chips = panel.querySelector('[data-role="chips"]');
    let shown = [];

    function render() {
      shown = list();
      chips.textContent = '';
      if (!shown.length) {
        const empty = global.document.createElement('span'); empty.className = 'recent-empty'; empty.textContent = MSG.EMPTY;
        chips.appendChild(empty); return;
      }
      shown.forEach(function (s, i) {
        const chip = global.document.createElement('button');
        chip.type = 'button'; chip.className = 'recent-chip'; chip.dataset.i = String(i);
        chip.textContent = s.id; chip.title = s.name || '';
        chips.appendChild(chip);
      });
    }
    function toggle(open) {
      const willOpen = open === undefined ? !panel.classList.contains('show') : !!open;
      panel.classList.toggle('show', willOpen);
      if (willOpen) { render(); global.setTimeout(function () { if (panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50); }
      return willOpen;
    }
    function onClick_(e) {
      if (e.target.closest('[data-act="clear"]')) { clear(); return; }
      const chip = e.target.closest('.recent-chip');
      if (chip && shown[Number(chip.dataset.i)] && o.onSelect) o.onSelect(fresh_(shown[Number(chip.dataset.i)]));
    }
    function onStorage_(e) { if (e.key === KEY || e.key === null) render(); } // تبويب آخر / another tab

    panel.addEventListener('click', onClick_);
    listeners.push(render);
    global.addEventListener('storage', onStorage_);
    render();

    return {
      toggle: toggle, render: render,
      isOpen: function () { return panel.classList.contains('show'); },
      destroy: function () {
        panel.removeEventListener('click', onClick_);
        global.removeEventListener('storage', onStorage_);
        const i = listeners.indexOf(render); if (i >= 0) listeners.splice(i, 1);
        panel.remove();
      }
    };
  }

  global.SecRecentStations = { mount: mount, add: add, list: list, clear: clear, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
