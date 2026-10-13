/* ============================================================
 * utils/dates.js — تنسيق الأوقات والتواريخ للعرض فقط (بلا حالة) — المصدر الوحيد لصيغ التاريخ في V2
 * ============================================================
 * - relativeTime(date): «الآن»، «قبل 20 ثانية»، «قبل دقيقة»، «قبل 3 دقائق»… حتى «قبل يومين» و«قبل 5 أيام» — نفس صيغ V1.
 * - gregorian(date) / hijri(date): التاريخ بالشهر مكتوبًا («7 أكتوبر 2026» / «26 ربيع الآخر 1448 هـ»).
 * - dualDate(date): التقويمان معًا بالشهر مكتوبًا («7 أكتوبر 2026 م · 26 ربيع الآخر 1448 هـ»).
 * - dualDateTime(date): التقويمان بالأرقام ثم الوقت — «6/10/2026 م — 25/4/1448 هـ، الساعة 12:30 م» (صيغة محمد المعتمدة).
 * - time(date): الوقت وحده («9:05 م»).
 * كلها بأرقام إنجليزية كما في V1، وتقبل Date أو رقم وقت (ms). قاعدة محمد: كل تاريخ في الموقع بالتقويمين.
 *
 * Time and date formatting for display only (stateless) — the single source of date formats in V2. relativeTime (V1's
 * wording), gregorian/hijri (month names), dualDate (both, month names), dualDateTime (both numeric, then the time —
 * Mohammed's approved format), time (the time alone). Latin digits as in V1; each accepts a Date or a ms timestamp.
 * ============================================================ */
(function (global) {
  'use strict';

  const LONG = { day: 'numeric', month: 'long', year: 'numeric' };
  const NUMERIC = { day: 'numeric', month: 'numeric', year: 'numeric' };
  const GREGORY = 'ar-SA-u-ca-gregory-nu-latn', HIJRI = 'ar-SA-u-ca-islamic-umalqura-nu-latn', CLOCK = 'ar-SA-u-nu-latn';

  function toDate_(v) { return v instanceof Date ? v : new Date(v); }

  function relativeTime(date) {
    const diffSec = Math.floor((Date.now() - toDate_(date).getTime()) / 1000);
    if (diffSec < 15) return 'الآن';
    if (diffSec < 60) return 'قبل ' + diffSec + ' ثانية';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin === 1 ? 'قبل دقيقة' : 'قبل ' + diffMin + ' دقائق';
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return diffHour === 1 ? 'قبل ساعة' : 'قبل ' + diffHour + ' ساعات';
    const diffDay = Math.floor(diffHour / 24);
    return diffDay === 1 ? 'قبل يوم' : diffDay === 2 ? 'قبل يومين' : 'قبل ' + diffDay + ' أيام';
  }

  function gregorian(date) { return toDate_(date).toLocaleDateString(GREGORY, LONG); }
  function hijri(date) { return toDate_(date).toLocaleDateString(HIJRI, LONG); }
  function dualDate(date) { return gregorian(date) + ' م · ' + hijri(date); }

  /* الوقت وحده بلا صفر بادئ («9:05 م») — The time alone, no leading zero */
  function time(date) { return toDate_(date).toLocaleTimeString(CLOCK, { hour: 'numeric', minute: '2-digit' }); }

  /* «6/10/2026 م — 25/4/1448 هـ، الساعة 12:30 م» — المتصفح يضيف «هـ» للهجري بنفسه فتُزال ثم تُكتب مرة واحدة (تكرارها كان خطأ V1)
   * The browser appends «هـ» to the Hijri date itself, so it's stripped and written once (V1 doubled it) */
  function dualDateTime(date) {
    const d = toDate_(date);
    if (isNaN(d.getTime())) return '—';
    const g = d.toLocaleDateString(GREGORY, NUMERIC);
    const h = d.toLocaleDateString(HIJRI, NUMERIC).replace(/\s*هـ\s*$/, '');
    const t = d.toLocaleTimeString(CLOCK, { hour: '2-digit', minute: '2-digit' });
    return g + ' م — ' + h + ' هـ، الساعة ' + t;
  }

  global.SecDates = { relativeTime: relativeTime, gregorian: gregorian, hijri: hijri, dualDate: dualDate, dualDateTime: dualDateTime, time: time };
})(typeof window !== 'undefined' ? window : globalThis);
