/* ============================================================
 * components/update-sheet.js — بطاقة التحديث الإجبارية (واجهة فقط؛ التحديث نفسه في services/pwa.js)
 * ============================================================
 * تصميم «4» المعتمد من محمد (8 نوفمبر 2026): تغطي الشاشة بخلفية شفافة متوهجة، وأيقونة التطبيق كبيرة، و«تحديث جديد متاح»،
 * ومسار «نسختك ← الجديدة» بتاريخيهما، و«ما الجديد» من شيت «الإعدادات»، وزر واحد «تحديث الآن» — بلا «لاحقًا» وبلا ✕.
 * السلوك:
 * - تظهر حين تكون نسخة جديدة جاهزة (pwa.js «update-ready»)، ولا تظهر أثناء الملاحة أو حفظ/تعديل/حذف محطة أو الجولة أو
 *   لوحة التثبيت أو «البداية النظيفة» — تنتظر حتى ينتهي ذلك ثم تظهر.
 * - تحديث يتطلب خروجًا: خانة «خروج إجباري مع تحديث» = رقم النسخة الجديدة ← تنبيه أحمر، وعند الضغط يُسجَّل الخروج مرة واحدة
 *   لكل جهاز لهذه النسخة فقط (العلامة تبقى بعد «مسح التخزين المؤقت»). بلا إنترنت أو بلا رد ← تحديث عادي بلا خروج.
 * - «تحديث الآن» ← SecPWA.applyUpdate() ثم تعيد pwa.js تحميل الصفحة مرة واحدة فقط.
 * - لا تلمس بيانات المحطات ولا أي شيء غير الجلسة عند الخروج الإجباري.
 *
 * The mandatory update card (UI only). Mohammed's approved design «4» (8 Nov 2026): full screen over a translucent glow, the app
 * icon, «new update available», «your version ← the new one» with both dates, «what's new» from the settings sheet, and one
 * «update now» button — no «later», no ✕. Waits for navigation, saves, the tour, the install sheet and the fresh start. An update
 * that needs a logout («forced logout with update» = the new version) shows a red notice and logs out once per device for that
 * version only (the marker survives a storage clear); offline or without a reply it's a normal update. Touches nothing else.
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document;
  const BUSY_RECHECK_MS = 3000, INFO_WAIT_MS = 4000;
  const MSG = {
    TITLE: 'تحديث جديد متاح',
    YOURS: 'نسختك',
    NEW: 'الجديدة',
    WHATS_NEW_DEFAULT: 'تحسينات وإصلاحات تجعل التطبيق أسرع وأكثر استقرارًا',
    LOGOUT: 'هذا التحديث يتطلب تسجيل خروجك مرة واحدة، ثم سجّل دخولك من جديد.',
    NOW: 'تحديث الآن',
    UPDATING: 'جارٍ التحديث…'
  };

  /* عملية لا يجوز قطعها: ملاحة، أو نموذج إضافة/تعديل مفتوح، أو نافذة حذف — an operation that must not be interrupted */
  function defaultBusy() {
    const g = global;
    return !!((g.SecNavView && g.SecNavView.isActive()) || (g.SecStationForm && g.SecStationForm.isOpen()) ||
      (g.SecDeleteStation && g.SecDeleteStation.isOpen()) || (doc.body && doc.body.classList.contains('nav-full')));
  }
  /* تنتظر أيضًا لوحة التثبيت والجولة، ولا تظهر في جلسة «البداية النظيفة» (التحديث يُطبَّق هناك بصمت)
     It also waits for the install sheet and the tour, and never shows in a fresh-start session (the update is applied quietly) */
  function updateBusy_() {
    return defaultBusy() || !!(global.SecInstallSheet && global.SecInstallSheet.isOpen()) ||
      !!(global.SecFeatureTour && global.SecFeatureTour.isOpen()) || !!(global.SecFreshStart && global.SecFreshStart.quietUpdates());
  }

  /* تاريخ النسخة من رقمها «YYYYMMDD-HHMMSS…» — the version's date from its number */
  function buildDate(build) {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(String(build || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : null;
  }
  /* رقم النسخة المختصر «YYYYMMDD-HHMM» — the short version number */
  function shortBuild(build) {
    const m = /^(\d{8})-(\d{4})/.exec(String(build || ''));
    return m ? m[1] + '-' + m[2] : '—';
  }
  function dateText_(build) {
    const d = buildDate(build), D = global.SecDates;
    if (!d) return '—';
    return D ? D.gregorian(d) : d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function hijriText_(build) {
    const d = buildDate(build), D = global.SecDates;
    return d && D ? D.hijri(d) : '';
  }
  const esc_ = function (s) { return global.SecHtml ? global.SecHtml.esc(s) : String(s).replace(/[&<>"']/g, ''); };

  /* «ما الجديد» ونسخة الخروج الإجباري من الخادم بمهلة؛ بلا رد ← عادي — what's new and the forced-logout version, with a timeout */
  function info_() {
    const api = global.SecApi;
    if (!api || global.navigator.onLine === false) return Promise.resolve({});
    return Promise.race([
      api.call('getUpdateInfo', {}).then(function (r) { return r && r.success ? r : {}; }, function () { return {}; }),
      new Promise(function (resolve) { global.setTimeout(function () { resolve({}); }, INFO_WAIT_MS); })
    ]);
  }

  function readKey_(key) { try { return global.localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function writeKey_(key, value) { try { global.localStorage.setItem(key, value); } catch (e) { /* تخزين محظور / storage blocked */ } }
  function removeKey_(key) { try { global.localStorage.removeItem(key); } catch (e) { /* تخزين محظور / storage blocked */ } }

  /**
   * mount(opts) — opts: { pwa (الافتراضي window.SecPWA)، isBusy() (الافتراضي: ملاحة/حفظ/حذف/جولة/تثبيت) }
   * يُرجع { show()، hide()، suspend()، resume()، isShown()، isDismissed()، destroy() } — returns the card's controls
   */
  function mount(opts) {
    const o = opts || {}, pwa = o.pwa || global.SecPWA;
    if (!pwa) return null;
    const isBusy = o.isBusy || updateBusy_;
    const K = global.SEC2_CONFIG && global.SEC2_CONFIG.STORAGE_KEYS;
    let el = null, suspended = false, waitTimer = 0, alive = true, building = false, logoutBuild = '';

    async function build_() {
      if (el || building) return el;
      building = true;
      const waiting = pwa.waitingBuild ? await pwa.waitingBuild() : null;
      const info = await info_();
      building = false;
      if (!alive || el) return el;
      const done = K ? readKey_(K.UPDATE_LOGOUT_DONE) : '';
      const loggedIn = !!(K && readKey_(K.SESSION));
      // خروج مرة واحدة لهذه النسخة فقط: النسخة المطلوبة = المنتظرة، ولم يُسجَّل معها خروج على هذا الجهاز، والعضو داخل
      // logout once for this version only: the required version = the waiting one, not done on this device, and logged in
      logoutBuild = waiting && info.logoutBuild && info.logoutBuild === waiting && done !== waiting && loggedIn ? waiting : '';
      const page = pwa.pageBuild ? pwa.pageBuild() : null;
      // كل سطر في خانة «ما الجديد» نقطة مستقلة — each line in the «what's new» cell is its own point
      const notes = String(info.whatsNew || MSG.WHATS_NEW_DEFAULT).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 6);
      doc.body.insertAdjacentHTML('beforeend',
        '<div class="upd-screen" data-role="upd-sheet" role="dialog" aria-modal="true" aria-labelledby="updTitle" hidden>' +
          '<div class="upd-body">' +
            '<img class="upd-hero" src="assets/icon-192.png" alt="D.S.Maps">' +
            '<h2 class="upd-title" id="updTitle">' + MSG.TITLE + '</h2>' +
            '<div class="upd-path">' +
              // رقم النسخة تحت تاريخها: نسختان من اليوم نفسه يظهر فرقهما (ملاحظة محمد 8 نوفمبر) — the version number under its date
              '<div class="upd-ver">' + MSG.YOURS + '<b>' + esc_(dateText_(page)) + '</b><small class="upd-num" dir="ltr">' + esc_(shortBuild(page)) + '</small></div><span class="upd-arrow" aria-hidden="true">←</span>' +
              '<div class="upd-ver is-new">' + MSG.NEW + '<b>' + esc_(dateText_(waiting)) + '</b><small class="upd-num" dir="ltr">' + esc_(shortBuild(waiting)) + '</small><small>' + esc_(hijriText_(waiting)) + '</small></div>' +
            '</div>' +
            '<ul class="upd-notes">' + notes.map(function (n) { return '<li><i aria-hidden="true">✓</i><span>' + esc_(n) + '</span></li>'; }).join('') + '</ul>' +
            (logoutBuild ? '<p class="upd-logout" role="alert">' + MSG.LOGOUT + '</p>' : '') +
          '</div>' +
          '<button type="button" class="upd-now" data-act="now">' + MSG.NOW + '</button>' +
        '</div>');
      el = doc.querySelector('[data-role="upd-sheet"]');
      el.addEventListener('click', onClick_);
      return el;
    }

    function onClick_(e) {
      const b = e.target.closest('[data-act="now"]');
      if (!b) return;
      b.disabled = true; b.textContent = MSG.UPDATING;
      if (logoutBuild && K) { writeKey_(K.UPDATE_LOGOUT_DONE, logoutBuild); removeKey_(K.SESSION); } // الخروج مرة واحدة / the one-time logout
      if (!pwa.applyUpdate()) global.location.reload(); // لا نسخة تنتظر فعلًا ← إعادة تحميل عادية / nothing waiting ← a normal reload
    }

    let showSeq = 0; // كل إخفاء يلغي أي ظهور معلّق / every hide cancels a pending show
    async function show() {
      if (!alive || suspended) return;
      if (isBusy()) { // انتظار انتهاء العملية الجارية / wait for the running operation to end
        global.clearTimeout(waitTimer);
        waitTimer = global.setTimeout(maybeShow_, BUSY_RECHECK_MS);
        return;
      }
      const my = ++showSeq;
      const card = await build_();
      if (!card || suspended || !alive || my !== showSeq) return;
      // التحضير يأخذ ثوانٍ (نسخة العامل و«ما الجديد»): عملية بدأت خلالها ← انتظار — preparing takes seconds: an operation started meanwhile ← wait
      if (isBusy()) { global.clearTimeout(waitTimer); waitTimer = global.setTimeout(maybeShow_, BUSY_RECHECK_MS); return; }
      card.hidden = false;
      void card.offsetHeight; // حساب التخطيط ثم الظهور / layout, then appear
      card.classList.add('show');
    }
    function hide() {
      showSeq++;
      global.clearTimeout(waitTimer);
      if (el) { el.classList.remove('show'); el.hidden = true; }
    }
    function maybeShow_() { if (pwa.state().status === 'update-ready') show(); }

    const off = pwa.onChange(function (s) { if (s.status === 'update-ready') show(); });
    maybeShow_();
    /* إخفاء مؤقت لصالح لوحة أخرى — ليس تأجيلًا ولا تفعيلًا — a temporary hide for another sheet: not a postpone, not an update */
    function suspend() { suspended = true; hide(); }
    /* العودة إن كانت النسخة ما زالت تنتظر — back if the version still waits */
    function resume() { suspended = false; maybeShow_(); }
    return {
      show: show, hide: hide, suspend: suspend, resume: resume, isShown: function () { return !!(el && !el.hidden); },
      isDismissed: function () { return false; }, // لا تأجيل في البطاقة الإجبارية / no postponing on the mandatory card
      destroy: function () { alive = false; off(); hide(); if (el) { el.removeEventListener('click', onClick_); el.remove(); el = null; } }
    };
  }

  let instance = null;
  function start_() { if (!instance) instance = mount(); }
  if (doc) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start_); else start_(); }

  global.SecUpdateSheet = { mount: mount, instance: function () { return instance; }, defaultBusy: defaultBusy, buildDate: buildDate, shortBuild: shortBuild, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
