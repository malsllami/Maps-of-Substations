/* ============================================================
 * components/reinstall-notice.js — بطاقة «إعادة تثبيت التطبيق» لمرة واحدة على الآيفون (قرار محمد — 31 أكتوبر 2026)
 * ============================================================
 * الآيفون يحفظ أيقونة التطبيق واسمه لحظة الإضافة إلى الشاشة الرئيسية، فلا تظهر الأيقونة الجديدة إلا بالحذف وإعادة الإضافة.
 * السلوك:
 * - تظهر مرة واحدة فقط، لعضو سجّل دخوله يفتح التطبيق المثبّت على الآيفون أو الآيباد. لا تظهر في Safari ولا أندرويد.
 * - تثبيت جديد (أو إعادة التثبيت بعد الحذف) يبدأ بـ«البداية النظيفة»: يُسجَّل أنها عُرضت بلا عرض، فلا تتكرر.
 * - تُسجَّل لحظة ظهورها لا عند إغلاقها: من حذف التطبيق والبطاقة مفتوحة لا تعود له إن بقي تخزينه.
 * - تنتظر انتهاء الملاحة والحفظ ولوحتي التحديث والتثبيت والجولة ونافذة إكمال البيانات. عرض فقط: لا تلمس البيانات.
 *
 * A one-time «reinstall the app» card on iPhone: iOS keeps an app's icon and name from when it was added, so the new icon
 * needs a delete and re-add. Shows once, to a logged-in member opening the installed app on iPhone/iPad; never in Safari or
 * on Android. A new install (or a re-install) starts with the fresh start, so it's marked as shown without showing. Marked
 * when shown, not when closed. Waits for navigation, saves, the other sheets, the tour and the profile gate. Display only.
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document;
  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('reinstall-notice.js يحتاج config/الإعدادات.js قبله / needs the config first');
  const K = CONFIG.STORAGE_KEYS;
  const FIRST_CHECK_MS = 1500, BUSY_RECHECK_MS = 3000;
  const MSG = {
    TITLE: 'أيقونة جديدة للتطبيق',
    TEXT: 'لتظهر الأيقونة الجديدة واسم D.S.Maps يجب حذف التطبيق الحالي ثم تثبيته من جديد:',
    STEP_1: 'اضغط مطولًا على أيقونة التطبيق في الشاشة الرئيسية واحذفه',
    STEP_2: 'افتح رابط الموقع في Safari',
    STEP_3: 'اضغط زر المشاركة ثم اختر «إضافة إلى الشاشة الرئيسية»',
    NOTE: 'ستحتاج إلى تسجيل الدخول وتحميل البيانات مرة أخرى، فالأفضل أن تكون على شبكة جيدة.',
    COPY: 'نسخ رابط الموقع',
    COPIED: '✓ تم نسخ الرابط',
    DONE: 'فهمت'
  };

  function read_(key) { try { return global.localStorage.getItem(key); } catch (e) { return null; } }
  function markShown_() { try { global.localStorage.setItem(K.REINSTALL_NOTICE, '1'); } catch (e) { /* تخزين محظور / storage blocked */ } }

  /* التطبيق المثبّت على الآيفون أو الآيباد — the installed app on iPhone or iPad */
  function isInstalledIos_() {
    return global.navigator.standalone === true && /iPhone|iPad/.test(global.navigator.userAgent || '');
  }

  /* نافذة أو عملية لا تظهر البطاقة فوقها — a window or operation the card never shows over */
  function busy_() {
    const g = global, upd = g.SecUpdateSheet && g.SecUpdateSheet.instance ? g.SecUpdateSheet.instance() : null;
    return !!((g.SecUpdateSheet && g.SecUpdateSheet.defaultBusy()) || (upd && upd.isShown()) ||
      (g.SecInstallSheet && g.SecInstallSheet.isOpen()) || (g.SecFeatureTour && g.SecFeatureTour.isOpen()) ||
      doc.querySelector('[data-role="profile-gate"].show'));
  }

  function step_(n, text) { return '<div class="ins-step"><span class="ins-n">' + n + '</span><span>' + text + '</span></div>'; }

  function show_() {
    const siteUrl = new URL('./', global.location.href).href;
    doc.body.insertAdjacentHTML('beforeend',
      '<div class="upd-sheet" data-role="reinstall-notice" role="dialog" aria-modal="false" aria-labelledby="reinstallTitle">' +
        '<div class="upd-grab"></div>' +
        '<b class="upd-title" id="reinstallTitle">' + MSG.TITLE + '</b>' +
        '<p class="upd-text">' + MSG.TEXT + '</p>' +
        '<div class="ins-steps">' + step_(1, MSG.STEP_1) + step_(2, MSG.STEP_2) + step_(3, MSG.STEP_3) + '</div>' +
        '<p class="ins-note">' + MSG.NOTE + '</p>' +
        '<button type="button" class="upd-now" data-act="copy">' + MSG.COPY + '</button>' +
        '<button type="button" class="upd-later" data-act="done">' + MSG.DONE + '</button>' +
      '</div>');
    const el = doc.querySelector('[data-role="reinstall-notice"]');
    el.addEventListener('click', function (e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'done') { el.remove(); return; }
      const clip = global.navigator.clipboard;
      (clip ? clip.writeText(siteUrl) : Promise.reject(new Error('no clipboard'))).then(function () { b.textContent = MSG.COPIED; },
        function () { b.textContent = siteUrl; }); // تعذّر النسخ ← يُعرض الرابط نفسه / copying failed ← the link itself is shown
    });
    void el.offsetHeight; // حساب التخطيط ثم الصعود / layout, then slide up
    el.classList.add('show');
    markShown_();
  }

  function tryShow_() {
    if (read_(K.REINSTALL_NOTICE)) return;
    if (busy_()) { global.setTimeout(tryShow_, BUSY_RECHECK_MS); return; }
    show_();
  }

  function start_() {
    if (read_(K.REINSTALL_NOTICE) || !isInstalledIos_()) return;
    // تثبيت جديد: أيقونته جديدة أصلًا، فلا تُعرض له أبدًا — a new install already has the new icon, so it never shows
    if (global.SecFreshStart && global.SecFreshStart.quietUpdates()) { markShown_(); return; }
    if (!read_(K.SESSION)) return; // غير مسجّل دخوله ← تنتظر دخوله / logged out ← waits for the login
    global.setTimeout(tryShow_, FIRST_CHECK_MS);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start_); else start_();

  global.SecReinstallNotice = { MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
