/* ============================================================
 * components/connection-status.js — شارة حالة الاتصال في رأس الصفحة: العرض فقط
 * ============================================================
 * الحالات الخمس من V1 كما هي:
 *   idle «جاري التحقق...» · checking 🟡 «جاري الاتصال...» · online 🟢 «متصل»
 *   saved 🟠 «بدون اتصال · البيانات محفوظة» · offline 🔴 «بدون اتصال · لا توجد بيانات محفوظة»
 * - لا منطق اتصال هنا: الفحص طلب ping عبر api-client، ويُتخطّى إن نجح أي طلب خلال 3 دقائق (connection.js). الجهاز بلا
 *   إنترنت فعلًا ← الحالة فورًا بلا طلب. الخادم لا يرد (أو لا رد سليم خلال 15 ث) ← بدون اتصال. عودة الإنترنت ← فحص بطلب فعلي.
 * - «آخر تحديث» بالزمن النسبي لوقت النسخة الذي تعطيه الصفحة (نجاح الفحص وحده لا يغيّره)، وتستطيع الصفحة عرض سطر بدله
 *   (تقدّم التحميل أو «اضغط للمتابعة») عبر setNote.
 * - سطر التاريخ ميلادي وهجري معًا (V2: كان ميلاديًا فقط في V1).
 *
 * The connection badge in the page header: display only. V1's five states as is. No connection logic here: the check is
 * a ping through api-client, skipped if any request succeeded in the last 3 minutes (connection.js). Truly offline ← the
 * state at once. No valid reply within 15 s ← offline. Back online ← a real check. «Last update» is relative to the copy
 * time the page gives (a check alone never changes it); the page can show a line instead (setNote). The date line shows
 * both calendars (V2: Gregorian only in V1).
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, D = global.SecDates;
  if (!CONFIG || !D) throw new Error('connection-status.js يحتاج الإعدادات وutils/dates.js قبله / needs config and utils/dates.js first');
  const T = CONFIG.TIMING;
  const STATES = {
    idle: { cls: '', text: 'جاري التحقق...', title: '' },
    checking: { cls: 'checking', text: 'جاري الاتصال...', title: '' },
    online: { cls: 'online', text: 'متصل', title: 'متصل بقاعدة البيانات' },
    saved: { cls: 'saved', text: 'بدون اتصال · البيانات محفوظة', title: 'بدون اتصال — البحث والأعطال تعمل من البيانات المحفوظة بالجهاز' },
    offline: { cls: 'offline', text: 'بدون اتصال · لا توجد بيانات محفوظة', title: 'تعذّر الوصول لقاعدة البيانات — تحميل البيانات يحتاج اتصالًا بالإنترنت' }
  };

  /**
   * mount(els, deps) — els: { bar, dot, label, lastLabel, dateLine } (dateLine اختياري)
   * deps: { hasLocalData() → هل توجد نسخة محطات في الجهاز، lastUpdateAt() → Date|null وقت النسخة }
   * يُرجع { check(force), refreshLastUpdate(), setNote(text, onClick), clearNote(), state(), destroy() }
   */
  function mount(els, deps) {
    let current = 'idle', note = null, checking = null;
    const timers = [];
    const listeners = [];

    function set_(name) {
      current = name;
      const s = STATES[name];
      els.dot.className = 'conn-dot' + (s.cls ? ' ' + s.cls : '');
      els.label.textContent = s.text;
      if (els.bar) els.bar.title = s.title;
    }

    /* بلا اتصال: 🟠 إن وُجدت نسخة محفوظة (البحث يعمل منها) وإلا 🔴 — Offline: 🟠 with a saved copy, else 🔴 */
    function showOffline_() {
      set_(deps.hasLocalData() ? 'saved' : 'offline');
      refreshLastUpdate();
    }

    async function check(force) {
      if (global.navigator.onLine === false) { showOffline_(); return current; }
      if (checking) return checking;
      set_('checking');
      const ping = function () { return global.SecApi.call('ping'); };
      checking = (async function () {
        let timer;
        try {
          const res = await Promise.race([
            force === true || !global.SecConnection ? ping() : global.SecConnection.pingUnlessRecent(ping, T.CONN_CHECK_INTERVAL_MS),
            new Promise(function (_, reject) { timer = global.setTimeout(function () { reject(new Error('timeout')); }, T.CONN_CHECK_TIMEOUT_MS); })
          ]);
          if (res && res.success) set_('online'); else showOffline_();
        } catch (e) {
          showOffline_(); // يشمل: الجهاز متصل والخادم لا يرد / includes: device online but the server doesn't reply
        } finally {
          global.clearTimeout(timer);
          checking = null;
        }
        return current;
      })();
      return checking;
    }

    function refreshLastUpdate() {
      if (note) return; // سطر الصفحة (تقدّم أو «اضغط للمتابعة») ظاهر / the page's line is shown
      const at = deps.lastUpdateAt();
      els.lastLabel.textContent = 'آخر تحديث: ' + (at ? D.relativeTime(at) : '—');
      els.lastLabel.classList.remove('resume-load');
    }

    /* سطر بدل «آخر تحديث» (مثل «توقف التحميل عند 5000/49000 — اضغط للمتابعة»)؛ onClick اختياري يجعله قابلًا للضغط
     * A line instead of «last update»; an optional onClick makes it tappable */
    function setNote(text, onClick) {
      note = { text: text, onClick: onClick || null };
      els.lastLabel.textContent = text;
      els.lastLabel.classList.toggle('resume-load', !!onClick);
    }
    function clearNote() { note = null; refreshLastUpdate(); }
    function onLastClick_() { if (note && note.onClick && global.navigator.onLine !== false) { const fn = note.onClick; clearNote(); fn(); } }

    function renderDate_() { if (els.dateLine) els.dateLine.textContent = D.dualDate(new Date()); }

    function on_(target, type, fn) { target.addEventListener(type, fn); listeners.push([target, type, fn]); }
    on_(global, 'offline', showOffline_);
    on_(global, 'online', function () { check(true); });
    on_(els.lastLabel, 'click', onLastClick_);
    timers.push(global.setInterval(function () { if (global.document.visibilityState === 'visible') check(); }, T.CONN_CHECK_INTERVAL_MS));
    timers.push(global.setInterval(refreshLastUpdate, 30 * 1000));
    timers.push(global.setInterval(renderDate_, 60 * 60 * 1000));
    set_('idle');
    refreshLastUpdate();
    renderDate_();

    return {
      check: check, refreshLastUpdate: refreshLastUpdate, setNote: setNote, clearNote: clearNote,
      state: function () { return current; },
      /* بيانات الجهاز تغيّرت وهو بلا اتصال (اكتمل تحميل كان جاريًا) ← يُعاد الحساب — device data changed while offline ← recomputed */
      refreshOffline: function () { if (current === 'offline' || current === 'saved') showOffline_(); },
      destroy: function () { timers.forEach(global.clearInterval); listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); }); }
    };
  }

  global.SecConnStatus = { mount: mount, STATES: STATES };
})(typeof window !== 'undefined' ? window : globalThis);
