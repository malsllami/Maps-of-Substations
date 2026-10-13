/* ============================================================
 * components/install-sheet.js — لوحة «حفظ الموقع كتطبيق» السفلية (واجهة فقط؛ التثبيت نفسه في services/pwa.js)
 * ============================================================
 * اعتماد محمد (9 أكتوبر 2026): الدمج «ج + د» — ذكاء النموذج «ج» بشكل اللوحة السفلية للنموذج «د» بلون الموقع الأخضر.
 * تُفتح من خيار «حفظ الموقع كتطبيق» في القائمة المنسدلة. محتواها حسب SecPWA.installMode() — قدرة المتصفح الفعلية:
 * - 'prompt': أيقونة وعنوان وسطر وزر «تثبيت التطبيق» (نافذة التثبيت الرسمية للمتصفح) و«لاحقًا» و✕.
 * - 'ios': «ثبّته في خطوتين» — المشاركة ← «إضافة إلى الشاشة الرئيسية»، وسهم لأسفل نحو شريط Safari، و«فهمت» و✕.
 * - 'manual': خطوتان من قائمة المتصفح، وتنبيه إن لم يظهر الخيار.
 * - 'installed': لا تُفتح (والخيار مخفي من القائمة أصلًا).
 * لا زر تثبيت إلا حين يعمل فعلًا. لا تُفتح أثناء الملاحة أو نموذج إضافة/تعديل أو نافذة حذف. لا تلمس جلسة ولا بيانات.
 * التنسيق مع لوحة التحديث (قواعد محمد، 10 أكتوبر): فتحها يخفي لوحة التحديث مؤقتًا (suspend)، وإغلاقها يعيدها (resume).
 *
 * The bottom «save the site as an app» sheet (UI only; installing itself is in services/pwa.js). Mohammed's «C + D» blend.
 * Content by SecPWA.installMode(): a real install button only where it works, otherwise instructions; never opens during
 * navigation, an add/edit form or a delete window; touches no session or data.
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document;
  const DONE_CLOSE_MS = 2500;
  const MSG = {
    TITLE: 'حفظ الموقع كتطبيق',
    TEXT: 'افتحه من شاشتك الرئيسية بضغطة، بشاشة كاملة، ويعمل حتى بدون إنترنت',
    INSTALL: 'تثبيت التطبيق',
    LATER: 'لاحقًا',
    GOT_IT: 'فهمت',
    DONE: '✓ تم — ستجد التطبيق في شاشتك الرئيسية',
    IOS_TITLE: 'ثبّته في خطوتين',
    IOS_1: 'اضغط زر المشاركة',
    IOS_1B: 'أسفل الشاشة',
    IOS_2: 'اختر',
    ADD_HOME: 'إضافة إلى الشاشة الرئيسية',
    IOS_ARROW: 'زر المشاركة في شريط Safari بالأسفل',
    MANUAL_TITLE: 'التثبيت من قائمة المتصفح',
    MANUAL_1: 'افتح قائمة المتصفح',
    MANUAL_2: 'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»',
    MANUAL_NOTE: 'إن لم يظهر الخيار فمتصفحك لا يدعم التثبيت — جرّب Chrome أو Edge'
  };
  const S = function (inner) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'; };
  const SHARE = S('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>');
  const PLUS = S('<rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>');
  const DOTS = S('<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>');
  const ARROW = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="4" x2="12" y2="20"/><polyline points="6 14 12 20 18 14"/></svg>';

  let el = null, mode = null, doneTimer = 0, suspendedUpdate = null;
  const updateSheet_ = function () { return global.SecUpdateSheet && global.SecUpdateSheet.instance ? global.SecUpdateSheet.instance() : null; };

  /* عملية لا يجوز قطعها: نفس قاعدة لوحة التحديث — an operation that must not be interrupted: the update sheet's rule */
  function busy_() {
    if (global.SecUpdateSheet && global.SecUpdateSheet.defaultBusy) return global.SecUpdateSheet.defaultBusy();
    const g = global;
    return !!((g.SecNavView && g.SecNavView.isActive()) || (g.SecStationForm && g.SecStationForm.isOpen()) ||
      (g.SecDeleteStation && g.SecDeleteStation.isOpen()) || (doc.body && doc.body.classList.contains('nav-full')));
  }
  const step_ = function (n, html) { return '<div class="ins-step"><span class="ins-n">' + n + '</span><span>' + html + '</span></div>'; };
  const key_ = function (icon, text) { return '<span class="ins-k">' + icon + (text ? ' ' + text : '') + '</span>'; };

  function body_(m) {
    const head = '<button type="button" class="ins-x" data-act="close" aria-label="إغلاق">✕</button><div class="ins-grab"></div>' +
      '<div class="ins-ic"><img src="assets/icon-192.png" alt=""></div>';
    if (m === 'prompt') {
      return head + '<b class="ins-title" id="insTitle">' + MSG.TITLE + '</b><p class="ins-text">' + MSG.TEXT + '</p>' +
        '<button type="button" class="ins-go" data-act="do-install">' + MSG.INSTALL + '</button><div class="ins-done" data-role="done" hidden>' + MSG.DONE + '</div>' +
        '<button type="button" class="ins-later" data-act="close">' + MSG.LATER + '</button>';
    }
    if (m === 'ios') {
      return head + '<b class="ins-title" id="insTitle">' + MSG.IOS_TITLE + '</b>' +
        '<div class="ins-steps">' + step_(1, MSG.IOS_1 + ' ' + key_(SHARE) + ' ' + MSG.IOS_1B) + step_(2, MSG.IOS_2 + ' ' + key_(PLUS, MSG.ADD_HOME)) + '</div>' +
        '<div class="ins-arrow" aria-hidden="true">' + MSG.IOS_ARROW + ARROW + '</div>' +
        '<button type="button" class="ins-go" data-act="close">' + MSG.GOT_IT + '</button>';
    }
    return head + '<b class="ins-title" id="insTitle">' + MSG.MANUAL_TITLE + '</b>' +
      '<div class="ins-steps">' + step_(1, MSG.MANUAL_1 + ' ' + key_(DOTS)) + step_(2, MSG.MANUAL_2) + '</div>' +
      '<p class="ins-note">' + MSG.MANUAL_NOTE + '</p>' +
      '<button type="button" class="ins-go" data-act="close">' + MSG.GOT_IT + '</button>';
  }

  function onClick_(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'close') { close(); return; }
    if (b.dataset.act === 'do-install') {
      b.disabled = true;
      global.SecPWA.promptInstall().then(function (outcome) {
        if (!el) return;
        if (outcome === 'accepted') {
          b.hidden = true; el.querySelector('[data-role="done"]').hidden = false;
          global.clearTimeout(doneTimer); doneTimer = global.setTimeout(close, DONE_CLOSE_MS);
        } else if (outcome === 'unavailable') { render_(global.SecPWA.installMode()); } // لم يعد متاحًا ← التعليمات / no longer available ← instructions
        else close(); // رفض المستخدم ← تُغلق بلا شيء / the user declined ← closes, nothing else
      });
    }
  }
  function render_(m) {
    mode = m;
    el.innerHTML = body_(m);
    el.setAttribute('data-mode', m);
  }

  /** فتح اللوحة ← true إن فُتحت — open the sheet ← true if opened */
  function open() {
    const P = global.SecPWA;
    if (!P || busy_()) return false;
    const m = P.installMode();
    if (m === 'installed') return false;
    if (!el) {
      doc.body.insertAdjacentHTML('beforeend', '<div class="ins-sheet" data-role="install-sheet" role="dialog" aria-modal="false" aria-labelledby="insTitle" hidden></div>');
      el = doc.querySelector('[data-role="install-sheet"]');
      el.addEventListener('click', onClick_);
    }
    global.clearTimeout(doneTimer);
    const U = updateSheet_(); // لا لوحتان معًا: لوحة التحديث تُخفى مؤقتًا / never two sheets: the update sheet is suspended
    if (U && U.suspend && !suspendedUpdate) { U.suspend(); suspendedUpdate = U; }
    render_(m);
    el.hidden = false;
    void el.offsetHeight; // حساب التخطيط ثم الصعود — مضمون حتى لو أُوقف requestAnimationFrame في الخلفية / layout, then slide up — works even if rAF is paused
    el.classList.add('show');
    return true;
  }
  function close() {
    global.clearTimeout(doneTimer);
    if (el) { el.classList.remove('show'); el.hidden = true; }
    if (suspendedUpdate) { const U = suspendedUpdate; suspendedUpdate = null; U.resume(); } // تعود لوحة التحديث إن لزم / the update sheet returns if needed
  }
  function isOpen() { return !!(el && !el.hidden); }

  global.SecInstallSheet = { open: open, close: close, isOpen: isOpen, mode: function () { return mode; }, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
