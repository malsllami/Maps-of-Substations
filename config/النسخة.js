/* ============================================================
 * config/النسخة.js — رقم نسخة ملفات الصفحة (8 نوفمبر 2026)
 * ============================================================
 * نفس قيمة SW_BUILD في sw.js، ويحدّثهما خطاف pre-commit معًا مع كل commit فيه ملف موقع — لا يُعدَّل يدويًا.
 * الصفحة تعرف منه نسختها، فتُقارن بنسخة عامل الخدمة النشط (إثبات أن التحديث اشتغل فعلًا)، وتُرسل مع كل طلب للخادم.
 *
 * The page files' version: the same value as SW_BUILD in sw.js, both updated by the pre-commit hook — never edited by hand.
 * The page knows its version from it, compares it with the active service worker's (proof the update really runs), and
 * sends it with every server request.
 *
 * (8 نوفمبر — قرار محمد) SEC2_RELEASE: رقم الإصدار المتسلسل الذي يراه الناس («الإصدار 2»). يُرفع يدويًا بواحد قبل كل نشر على الحي
 * فقط (لا مع كل commit)، ونفس القيمة في SW_RELEASE داخل sw.js. الحي قبل الترقيم = 1. اختبار test_release يرفض النشر إن لم يزد.
 * SEC2_RELEASE: the sequential release number people see. Raised by hand by one before each live release only (not every
 * commit), the same value as SW_RELEASE in sw.js. Live before numbering = 1. test_release refuses a release that didn't grow.
 * ============================================================ */
(function (global) {
  'use strict';
  global.SEC2_RELEASE = 4;
  global.SEC2_BUILD = '20261110-212602';
})(typeof window !== 'undefined' ? window : globalThis);
