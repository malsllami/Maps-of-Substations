/* ============================================================
 * components/update-sheet.js — لوحة «نسخة جديدة متاحة» السفلية (واجهة فقط؛ التحديث نفسه في services/pwa.js)
 * ============================================================
 * تصميم «د» المعتمد من محمد (9 أكتوبر 2026): لوحة سفلية بلون تنبيه كهرماني، أيقونة تحديث بارزة مع علامة تنبيه،
 * العنوان «نسخة جديدة متاحة»، الوصف، زر «تحديث الآن» بارز، و«لاحقًا» + ✕ للتأجيل.
 * السلوك:
 * - تظهر فقط حين تكون نسخة جديدة جاهزة (حالة pwa.js «update-ready»).
 * - لا تظهر أثناء الملاحة أو حفظ/تعديل/حذف محطة؛ تنتظر حتى ينتهي ذلك ثم تظهر.
 * - «لاحقًا» أو ✕ يخفيانها لهذه الصفحة فقط بلا أي تحديث (تعود عند فتح صفحة جديدة ما دامت النسخة تنتظر).
 * - «تحديث الآن» ← SecPWA.applyUpdate() (SKIP_WAITING) ثم تعيد pwa.js تحميل الصفحة مرة واحدة فقط.
 * - التنسيق مع لوحة التثبيت (قواعد محمد، 10 أكتوبر): لا تظهر اللوحتان معًا أبدًا. فتح لوحة التثبيت ← suspend() تخفي هذه
 *   مؤقتًا بلا «لاحقًا» وبلا تفعيل؛ إغلاقها ← resume() تعيدها إن كانت النسخة ما زالت تنتظر ولم يرفضها المستخدم؛ ونسخة تجهز
 *   ولوحة التثبيت مفتوحة ← تنتظر إغلاقها (كما تنتظر الملاحة والحفظ).
 * - لا تلمس بيانات المحطات ولا الجلسة ولا أي شيء من V1 — عرض فقط.
 * تُركَّب نفسها تلقائيًا في أي صفحة تحمّل هذا الملف بعد pwa.js.
 *
 * The bottom «new version available» sheet (UI only; the update itself is in services/pwa.js). Mohammed's approved design
 * «D» (9 Oct 2026). Shows only when an update is ready; never during navigation or a station save/edit/delete (waits);
 * «later»/✕ hide it for this page only with no update; «update now» ← SecPWA.applyUpdate(), then pwa.js reloads once.
 * Touches no stations data, session or V1. Mounts itself on any page loading this file after pwa.js.
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document;
  const BUSY_RECHECK_MS = 3000;
  const MSG = {
    TITLE: 'نسخة جديدة متاحة',
    TEXT: 'يتوفر تحديث جديد للتطبيق، حدّث نسختك للاستفادة من أحدث التحسينات',
    NOW: 'تحديث الآن',
    LATER: 'لاحقًا',
    UPDATING: 'جارٍ التحديث…'
  };
  const ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

  /* عملية لا يجوز قطعها: ملاحة، أو نموذج إضافة/تعديل مفتوح، أو نافذة حذف — an operation that must not be interrupted */
  function defaultBusy() {
    const g = global;
    return !!((g.SecNavView && g.SecNavView.isActive()) || (g.SecStationForm && g.SecStationForm.isOpen()) ||
      (g.SecDeleteStation && g.SecDeleteStation.isOpen()) || (doc.body && doc.body.classList.contains('nav-full')));
  }
  /* لوحة التحديث تنتظر أيضًا لوحة التثبيت المفتوحة (لا لوحتان معًا) — the update sheet also waits for an open install sheet */
  // وتنتظر الجولة/بطاقة الترحيب، ولا تظهر في جلسة «البداية النظيفة» (التحديث يُطبَّق هناك بصمت) — لا طبقتان معًا (16 أكتوبر)
  // It also waits for the tour/welcome card, and never shows in a fresh-start session (the update is applied quietly there)
  function updateBusy_() {
    return defaultBusy() || !!(global.SecInstallSheet && global.SecInstallSheet.isOpen()) ||
      !!(global.SecFeatureTour && global.SecFeatureTour.isOpen()) || !!(global.SecFreshStart && global.SecFreshStart.quietUpdates());
  }

  /**
   * mount(opts) — opts: { pwa (الافتراضي window.SecPWA)، isBusy() (الافتراضي: ملاحة/حفظ/حذف) }
   * يُرجع { show()، hide()، isShown()، destroy() } — returns the sheet's controls
   */
  function mount(opts) {
    const o = opts || {}, pwa = o.pwa || global.SecPWA;
    if (!pwa) return null;
    const isBusy = o.isBusy || updateBusy_;
    let el = null, dismissed = false, suspended = false, waitTimer = 0, alive = true;

    function build_() {
      if (el) return el;
      doc.body.insertAdjacentHTML('beforeend',
        '<div class="upd-sheet" data-role="upd-sheet" role="dialog" aria-modal="false" aria-labelledby="updTitle" aria-describedby="updText" hidden>' +
          '<button type="button" class="upd-x" data-act="later" aria-label="إغلاق">✕</button>' +
          '<div class="upd-grab"></div>' +
          '<div class="upd-badge">' + ICON + '<span class="upd-alert" aria-hidden="true">!</span></div>' +
          '<b class="upd-title" id="updTitle">' + MSG.TITLE + '</b>' +
          '<p class="upd-text" id="updText">' + MSG.TEXT + '</p>' +
          '<button type="button" class="upd-now" data-act="now">' + MSG.NOW + '</button>' +
          '<button type="button" class="upd-later" data-act="later">' + MSG.LATER + '</button>' +
        '</div>');
      el = doc.querySelector('[data-role="upd-sheet"]');
      el.addEventListener('click', onClick_);
      return el;
    }
    function onClick_(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'later') { dismissed = true; hide(); return; } // تأجيل بلا تحديث / postpone, no update
      if (b.dataset.act === 'now') {
        const btn = el.querySelector('[data-act="now"]');
        btn.disabled = true; btn.textContent = MSG.UPDATING;
        if (!pwa.applyUpdate()) { btn.disabled = false; btn.textContent = MSG.NOW; hide(); } // لا نسخة تنتظر فعلًا / nothing actually waiting
      }
    }
    function show() {
      if (!alive || dismissed || suspended) return;
      if (isBusy()) { // انتظار انتهاء العملية الجارية / wait for the running operation to end
        global.clearTimeout(waitTimer);
        waitTimer = global.setTimeout(maybeShow_, BUSY_RECHECK_MS);
        return;
      }
      build_().hidden = false;
      void el.offsetHeight; // حساب التخطيط ثم الصعود — مضمون حتى لو أُوقف requestAnimationFrame في الخلفية / layout, then slide up — works even if rAF is paused
      el.classList.add('show');
    }
    function hide() {
      global.clearTimeout(waitTimer);
      if (el) { el.classList.remove('show'); el.hidden = true; }
    }
    function maybeShow_() { if (pwa.state().status === 'update-ready') show(); }

    const off = pwa.onChange(function (s) { if (s.status === 'update-ready') show(); });
    maybeShow_();
    /* إخفاء مؤقت لصالح لوحة أخرى — ليس «لاحقًا» ولا تفعيلًا — a temporary hide for another sheet: not «later», not an update */
    function suspend() { suspended = true; hide(); }
    /* العودة إن كانت النسخة ما زالت تنتظر ولم يرفضها المستخدم — back if the version still waits and wasn't declined */
    function resume() { suspended = false; maybeShow_(); }
    return {
      show: show, hide: hide, suspend: suspend, resume: resume, isShown: function () { return !!(el && !el.hidden); },
      isDismissed: function () { return dismissed; },
      destroy: function () { alive = false; off(); hide(); if (el) { el.removeEventListener('click', onClick_); el.remove(); el = null; } }
    };
  }

  let instance = null;
  function start_() { if (!instance) instance = mount(); }
  if (doc) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start_); else start_(); }

  global.SecUpdateSheet = { mount: mount, instance: function () { return instance; }, defaultBusy: defaultBusy, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
