/* ============================================================
 * services/load-guard.js — حارس خلط النسختين: إعادة تحميل واحدة حين تجتمع صفحة وملف من نسختين مختلفتين
 * ============================================================
 * - عامل الخدمة الجديد (21 أكتوبر) يقدّم كل ملفات التحميل من نسخة واحدة، لكن الأجهزة التي لم تحدّث بعد ما زالت تخلط الملفات
 *   مع شبكة متقطعة (سجل 22 أكتوبر: home.js جديد مع صفحة قديمة، والعكس)، فتتوقف الرئيسية.
 * - هذا الحارس في الصفحة الجديدة: إن لم يبدأ home.js بعد التحميل (ملف قديم معطوب) ← إعادة تحميل واحدة، وتطبيق التحديث
 *   المنتظر إن وُجد. وhome.js الجديد يتحقق بنفسه من عناصر الصفحة (recover أدناه، أو احتياطه إن كانت الصفحة قديمة بلا الحارس).
 * - مرة واحدة فقط في الجلسة (sessionStorage) فلا تكرار؛ ولا يمس أي بيانات.
 *
 * The mixed-versions guard: one reload when a page and a file from two versions meet. The new service worker (21 Oct)
 * serves every file of a load from one version, but devices that haven't updated still mix files on a flaky network (22 Oct
 * log: a new home.js with an old page, and the reverse), stopping the home page. This guard lives in the new page: if home.js
 * didn't start after the load (a broken old file) ← one reload, applying the waiting update if any. The new home.js checks the
 * page's elements itself. Once per session only (sessionStorage), so no loop; it touches no data.
 * ============================================================ */
(function (global) {
  'use strict';

  const KEY = ((global.SEC2_CONFIG && global.SEC2_CONFIG.STORAGE_PREFIX) || 'sec2-') + 'load-guard';
  const START_WAIT_MS = 2500; // مهلة بدء home.js بعد اكتمال التحميل / time for home.js to start after the load

  /**
   * recover(reason) — إعادة تحميل واحدة في الجلسة (أو تطبيق التحديث المنتظر)؛ يُرجع true إن بدأها
   * one reload per session (or applying the waiting update); returns true if it started one
   */
  function recover(reason) {
    try {
      if (global.sessionStorage.getItem(KEY)) return false; // حدث مرة في هذه الجلسة ← لا تكرار / already once this session
      global.sessionStorage.setItem(KEY, String(reason || '1'));
    } catch (e) { return false; } // تخزين محظور ← لا إعادة (حتى لا تتكرر بلا حد) / storage blocked ← no reload (never loops)
    const pwa = global.SecPWA;
    if (pwa && pwa.state && pwa.state().status === 'update-ready' && pwa.applyUpdate && pwa.applyUpdate()) return true;
    global.location.reload();
    return true;
  }

  // الرئيسية: home.js لم يبدأ بعد اكتمال التحميل ← ملف قديم أو معطوب — home: home.js didn't start after the load
  global.addEventListener('load', function () {
    global.setTimeout(function () {
      const d = global.document;
      if (d.body && d.body.classList.contains('home-page') && !global.SecHome) recover('home-not-started');
    }, START_WAIT_MS);
  });

  global.SecLoadGuard = { recover: recover, KEY: KEY };
})(typeof window !== 'undefined' ? window : globalThis);
