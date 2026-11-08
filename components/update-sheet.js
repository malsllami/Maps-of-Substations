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
    YOURS: 'نسختك الحالية',
    NEW: 'النسخة الجديدة',
    WHATS_NEW: 'ما الجديد في هذا الإصدار؟',
    WHATS_NEW_DEFAULT: 'تحسينات وإصلاحات تجعل التطبيق أسرع وأكثر استقرارًا',
    LOGOUT: 'هذا التحديث يتطلب تسجيل خروجك مرة واحدة، ثم سجّل دخولك من جديد.',
    NOW: 'تحديث الآن',
    PREPARING: 'جارٍ تجهيز النسخة الجديدة…',
    ACTIVATING: 'جارٍ تفعيل النسخة الجديدة…',
    OPENING: 'اكتمل التفعيل، جارٍ الفتح…',
    RETRY: 'لم يكتمل التفعيل، أعد المحاولة',
    READY: 'معتمدة',
    RELEASE: 'الإصدار'
  };
  const ACTIVATE_WAIT_MS = 20000; // مهلة تفعيل النسخة الجديدة قبل عرض إعادة المحاولة / activation limit before offering a retry

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
  /* رقم النسخة للعرض «2026.11.08 – 0241» — the version number for display */
  function pillBuild(build) {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{4})/.exec(String(build || ''));
    return m ? m[1] + '.' + m[2] + '.' + m[3] + ' – ' + m[4] : '—';
  }
  const SVG = function (body) { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>'; };
  const ICON = {
    layers: SVG('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
    check: SVG('<circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>'),
    sparkle: SVG('<path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'),
    tick: SVG('<polyline points="6 12 10 16 18 8"/>'),
    download: SVG('<path d="M12 4v11"/><polyline points="7 10 12 15 17 10"/><path d="M5 19h14"/>')
  };
  /* آيفون يضيف فاصلة («8 نوفمبر، 2026») ولا يضيفها Chrome — تُحذف ليتطابق الشكل على كل الأجهزة
   * iPhone adds a comma that Chrome doesn't — removed so it looks the same on every device */
  const noComma_ = function (s) { return String(s).replace(/\s*[،,]\s*/g, ' '); };
  function dateText_(build) {
    const d = buildDate(build), D = global.SecDates;
    if (!d) return '—';
    return noComma_(D ? D.gregorian(d) : d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }));
  }
  function hijriText_(build) {
    const d = buildDate(build), D = global.SecDates;
    return d && D ? noComma_(D.hijri(d)) : '';
  }
  /* «8 نوفمبر 2026 · 4:19 م» — التاريخ والوقت تحت رقم الإصدار مرة واحدة — the date and time under the release number, once */
  function whenText_(build) {
    const d = buildDate(build), D = global.SecDates;
    return d ? dateText_(build) + (D && D.time ? ' · ' + D.time(d) : '') : '—';
  }
  /* (8 نوفمبر، قرار محمد) «الإصدار N» برقم متسلسل؛ نسخة بلا رقم ← الختم كما كان — «release N»; a version without one ← its stamp */
  function releaseText_(release, build) {
    return release ? MSG.RELEASE + ' ' + release : pillBuild(build);
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
      const waitingRelease = pwa.waitingRelease ? await pwa.waitingRelease() : null;
      const info = await info_();
      building = false;
      if (!alive || el) return el;
      const done = K ? readKey_(K.UPDATE_LOGOUT_DONE) : '';
      const loggedIn = !!(K && readKey_(K.SESSION));
      // خروج مرة واحدة لهذه النسخة فقط: النسخة المطلوبة = المنتظرة، ولم يُسجَّل معها خروج على هذا الجهاز، والعضو داخل
      // logout once for this version only: the required version = the waiting one, not done on this device, and logged in
      // الخانة تقبل رقم الإصدار (2) أو الختم (8 نوفمبر) — the cell accepts the release number (2) or the stamp
      const logoutMatch = !!info.logoutBuild && (info.logoutBuild === waiting || (!!waitingRelease && info.logoutBuild === String(waitingRelease)));
      logoutBuild = waiting && logoutMatch && done !== waiting && loggedIn ? waiting : '';
      const page = pwa.pageBuild ? pwa.pageBuild() : null;
      const pageRelease = pwa.pageRelease ? pwa.pageRelease() : null;
      // عمود كل نسخة: «الإصدار N» ثم تاريخه ووقته، ثم الهجري — each version's column: «release N», its date and time, the Hijri date
      const col_ = function (release, build, isNew) {
        const pill = '<b class="upd-pill upd-num' + (isNew ? ' is-new' : '') + '">' + esc_(releaseText_(release, build)) + '</b>';
        return '<div class="upd-ver-col">' + (isNew ? '<span class="upd-pill-box">' + pill + '<i class="upd-tag">' + MSG.READY + '</i></span>' : pill) +
          '<small class="upd-when">' + esc_(whenText_(build)) + '</small><small class="upd-when-h">' + esc_(hijriText_(build)) + '</small></div>';
      };
      // كل سطر في خانة «ما الجديد» نقطة مستقلة — each line in the «what's new» cell is its own point
      const notes = String(info.whatsNew || MSG.WHATS_NEW_DEFAULT).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 6);
      doc.body.insertAdjacentHTML('beforeend',
        '<div class="upd-screen" data-role="upd-sheet" role="dialog" aria-modal="true" aria-labelledby="updTitle" hidden>' +
          '<div class="upd-body">' +
            '<div class="upd-hero-ring"><img class="upd-hero" src="assets/icon-192.png" alt="D.S.Maps"></div>' +
            '<h2 class="upd-title" id="updTitle">' + MSG.TITLE + '</h2><div class="upd-glow-line" aria-hidden="true"></div>' +
            // مقارنة النسختين في بطاقة واحدة: «الإصدار N» وتحته تاريخه ووقته مرة واحدة (قرار محمد 8 نوفمبر)، وشارة «معتمدة» على الجديدة
            // both versions in one card: «release N» with its date and time once beneath, and the «approved» badge on the new one
            '<div class="upd-vers">' +
              '<div class="upd-vers-head"><span class="upd-vh">' + ICON.layers + MSG.YOURS + '</span><span class="upd-vh is-new">' + ICON.check + MSG.NEW + '</span></div>' +
              '<div class="upd-vers-row">' + col_(pageRelease, page, false) + '<span class="upd-arrow" aria-hidden="true">←</span>' + col_(waitingRelease, waiting, true) + '</div>' +
            '</div>' +
            '<section class="upd-new"><div class="upd-new-tab">' + ICON.sparkle + MSG.WHATS_NEW + '</div>' +
              '<ul class="upd-notes">' + notes.map(function (n) { return '<li><i aria-hidden="true">' + ICON.tick + '</i><span>' + esc_(n) + '</span></li>'; }).join('') + '</ul></section>' +
            (logoutBuild ? '<p class="upd-logout" role="alert">' + MSG.LOGOUT + '</p>' : '') +
          '</div>' +
          '<button type="button" class="upd-now" data-act="now">' + ICON.download + '<span>' + MSG.NOW + '</span></button>' +
        '</div>');
      el = doc.querySelector('[data-role="upd-sheet"]');
      el.addEventListener('click', onClick_);
      return el;
    }

    /* حالة الزر: نص حقيقي لكل مرحلة، ولا «نجاح» قبل اكتمال التفعيل — the button state: real text per phase, no success before activation */
    function phase_(b, name, text, enabled) {
      b.dataset.phase = name; b.disabled = !enabled;
      b.querySelector('span').textContent = text;
    }

    let applying = false;
    async function onClick_(e) {
      const b = e.target.closest('[data-act="now"]');
      if (!b || b.disabled) return;
      if (b.dataset.phase === 'retry') { global.location.reload(); return; } // إعادة المحاولة ← تحميل كامل / retry ← a full reload
      if (applying) return;
      applying = true;
      // 1) تجهيز: سؤال النسخة المنتظرة نفسها أنها جاهزة (نزلت كاملة قبل ظهور البطاقة) — preparing: ask the waiting version itself
      phase_(b, 'preparing', MSG.PREPARING, false);
      const ready = pwa.waitingBuild ? await pwa.waitingBuild() : null;
      if (logoutBuild && K) { writeKey_(K.UPDATE_LOGOUT_DONE, logoutBuild); removeKey_(K.SESSION); } // الخروج مرة واحدة / the one-time logout
      // 2) تفعيل: حتى يتسلّم العامل الجديد الصفحة — activating: until the new worker takes over the page
      if (!ready || !pwa.applyUpdate()) { phase_(b, 'opening', MSG.OPENING, false); global.location.reload(); return; } // لا نسخة تنتظر ← تحميل عادي
      phase_(b, 'activating', MSG.ACTIVATING, false);
      // 3) اكتمل التفعيل (controllerchange ← «reloading») ← فتح النسخة الجديدة؛ وبلا اكتمال خلال المهلة ← إعادة المحاولة
      // activation done ← opening the new version; not done within the limit ← retry
      const stop = pwa.onChange(function (s) { if (s && s.status === 'reloading') { stop(); global.clearTimeout(t); phase_(b, 'opening', MSG.OPENING, false); } });
      const t = global.setTimeout(function () { stop(); applying = false; phase_(b, 'retry', MSG.RETRY, true); }, ACTIVATE_WAIT_MS);
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
