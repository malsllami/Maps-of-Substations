/* ============================================================
 * config/النسخة.js — رقم نسخة ملفات الصفحة (8 نوفمبر 2026)
 * ============================================================
 * نفس قيمة SW_BUILD في sw.js، ويحدّثهما خطاف pre-commit معًا مع كل commit فيه ملف موقع — لا يُعدَّل يدويًا.
 * الصفحة تعرف منه نسختها، فتُقارن بنسخة عامل الخدمة النشط (إثبات أن التحديث اشتغل فعلًا)، وتُرسل مع كل طلب للخادم.
 *
 * The page files' version: the same value as SW_BUILD in sw.js, both updated by the pre-commit hook — never edited by hand.
 * The page knows its version from it, compares it with the active service worker's (proof the update really runs), and
 * sends it with every server request.
 * ============================================================ */
(function (global) {
  'use strict';
  global.SEC2_BUILD = '20261108-024142-810885400';
})(typeof window !== 'undefined' ? window : globalThis);
