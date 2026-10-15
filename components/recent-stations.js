/* ============================================================
 * components/recent-stations.js — «🕐 آخر المحطات»: المحطات التي فتحها المستخدم في آخر ساعتين
 * ============================================================
 * سلوك V1 وتصميمه كما هما: لوحة «محطاتك الأخيرة» + «مسح السجل»، شرائح بأرقام المحطات الأحدث أولًا، الضغط يفتح المحطة،
 * ما مضى عليه ساعتان يختفي، وبلا محطات: «ما فيه محطات زرتها مؤخراً بعد». التخزين على الجهاز فقط (localStorage).
 * V2 (إصلاح بند V1 رقم 4): المفتاح = الرقم + النوع، فمحطتا توزيع وتحويل بنفس الرقم لا تُخلطان.
 * V2: عند الضغط تُؤخذ أحدث بيانات المحطة من النسخة المحلية (stations-sync) إن وُجدت — لا إحداثيات قديمة محفوظة
 *     منذ الزيارة؛ النصوص تُكتب نصًا.
 * V2 (ملاحظة محمد، 15 أكتوبر): المحطة المحذوفة لا تبقى في القائمة ولا تُفتح ببيانات قديمة. غيابها عن النسخة لا يكفي وحده
 *     (قد تكون مضافة حديثًا لم تُزامَن بعد)، لذلك:
 *     - النسخة مؤكدة من الخادم (خلال 5 دقائق) ← الغائبة محذوفة: تُزال من القائمة.
 *     - غير مؤكدة ← عند الضغط يُسأل الخادم (بحد 10 ث كالبحث): وُجدت ← تُفتح بأحدث بياناتها؛ تأكد غيابها ← تُزال
 *       مع «المحطة لم تعد موجودة»؛ تعذّر التأكد (بلا إنترنت) ← تُفتح ببياناتها المحفوظة كما كانت.
 *     - تُعاد الرسم بعد كل مزامنة (onChange).
 *
 * «Recent stations»: stations opened in the last two hours. V1's behavior and design; stored on the device only.
 * V2 fixes V1 bug 4 (key = id + type). On a tap the latest data comes from the local copy when present.
 * V2 (Mohammed, 15 Oct): a deleted station neither stays in the list nor opens with stale data. Absence alone isn't
 * enough (it may be newly added, not synced yet): a server-confirmed copy ← the absent one is deleted and removed;
 * unconfirmed ← a tap asks the server (bounded): found ← opened fresh; confirmed absent ← removed with a message;
 * unverifiable (offline) ← opened with its saved data as before. Re-rendered after every sync.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('recent-stations.js يحتاج config/الإعدادات.js قبله / needs the config first');
  const KEY = CONFIG.STORAGE_KEYS.RECENT_STATIONS, TTL_MS = CONFIG.TIMING.RECENT_STATIONS_MS;
  const MSG = { TITLE: 'محطاتك الأخيرة', CLEAR: 'مسح السجل', EMPTY: 'ما فيه محطات زرتها مؤخراً بعد',
    GONE: function (id) { return 'المحطة ' + id + ' لم تعد موجودة'; } };
  const GONE_NOTE_MS = 5000;

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

  /* إزالة محطة واحدة من السجل — Remove one station from the log */
  function remove_(entry) {
    const map = {};
    list().forEach(function (e) { if (keyOf_(e) !== keyOf_(entry)) map[keyOf_(e)] = e; });
    save_(map);
  }

  /* المحطة في النسخة المحلية (نفس الرقم والنوع) أو null — The station in the local copy (same id and type), or null */
  function inCopy_(entry) {
    const SYNC = global.SecStationsSync, all = SYNC && SYNC.stations();
    if (!all) return null;
    const k = keyOf_(entry);
    for (let i = 0; i < all.length; i++) if (keyOf_(all[i]) === k) return all[i];
    return null;
  }
  /* هل غيابها عن النسخة دليل حذف؟ فقط إن كانت النسخة مؤكدة من الخادم — Is absence proof of deletion? Only with a server-confirmed copy */
  function confirmedCopy_() { const SYNC = global.SecStationsSync; return !!(SYNC && SYNC.stations() && SYNC.isConfirmed && SYNC.isConfirmed()); }

  /* أحدث بيانات المحطة من النسخة المحلية إن وُجدت — The latest data from the local copy when present */
  function fresh_(entry) {
    const s = inCopy_(entry);
    if (!s) return entry;
    return Object.assign({}, entry, { lat: s.lat, lng: s.lng, region: s.region || '', feeder: s.feeder || '',
      name: (s.type === 'تحويل' ? 'محطة تحويل ' : 'محطة توزيع ') + s.id + (s.region ? ' — ' + s.region : '') });
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
      '<div class="recent-note" data-role="note" role="status" hidden></div>' +
      '<div class="recent-chips" data-role="chips"></div></div>');
    const panel = container.querySelector('[data-role="recent-panel"]'), chips = panel.querySelector('[data-role="chips"]'), note = panel.querySelector('[data-role="note"]');
    let shown = [], noteTimer = 0;

    function showGone_(entry) {
      note.textContent = MSG.GONE(entry.id); note.hidden = false;
      global.clearTimeout(noteTimer); noteTimer = global.setTimeout(function () { note.hidden = true; }, GONE_NOTE_MS);
    }

    function render() {
      // النسخة مؤكدة ← المحطات الغائبة عنها محذوفة فتُزال — a confirmed copy ← stations absent from it are deleted and removed
      if (confirmedCopy_()) list().forEach(function (e) { if (!inCopy_(e)) remove_(e); });
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
    async function open_(entry) {
      if (inCopy_(entry)) { if (o.onSelect) o.onSelect(fresh_(entry)); return; }
      const SYNC = global.SecStationsSync;
      if (!confirmedCopy_() && SYNC && SYNC.stations() && SYNC.ensureFreshBounded) {
        const r = await SYNC.ensureFreshBounded(); // يسأل الخادم مرة (مشتركة مع البحث) / asks the server once (shared with search)
        if (r === 'unverified') { if (o.onSelect) o.onSelect(entry); return; } // تعذّر التأكد: كما كانت / unverifiable: as before
        if (inCopy_(entry)) { if (o.onSelect) o.onSelect(fresh_(entry)); return; }
      } else if (!confirmedCopy_()) { if (o.onSelect) o.onSelect(entry); return; } // لا نسخة محلية بعد / no local copy yet
      remove_(entry); showGone_(entry); render(); // تأكد غيابها ← حُذفت / confirmed absent ← deleted
    }
    function onClick_(e) {
      if (e.target.closest('[data-act="clear"]')) { clear(); return; }
      const chip = e.target.closest('.recent-chip');
      if (chip && shown[Number(chip.dataset.i)]) open_(shown[Number(chip.dataset.i)]);
    }
    function onStorage_(e) { if (e.key === KEY || e.key === null) render(); } // تبويب آخر / another tab

    panel.addEventListener('click', onClick_);
    listeners.push(render);
    global.addEventListener('storage', onStorage_);
    // بعد كل مزامنة تُراجَع القائمة على النسخة الجديدة — after every sync the list is checked against the new copy
    const offSync = global.SecStationsSync && global.SecStationsSync.onChange ? global.SecStationsSync.onChange(render) : null;
    render();

    return {
      toggle: toggle, render: render,
      isOpen: function () { return panel.classList.contains('show'); },
      destroy: function () {
        panel.removeEventListener('click', onClick_);
        global.removeEventListener('storage', onStorage_);
        if (offSync) offSync();
        global.clearTimeout(noteTimer);
        const i = listeners.indexOf(render); if (i >= 0) listeners.splice(i, 1);
        panel.remove();
      }
    };
  }

  global.SecRecentStations = { mount: mount, add: add, list: list, clear: clear, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
