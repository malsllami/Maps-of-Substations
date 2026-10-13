/* ============================================================
 * services/shift-rotation.js — حساب دوام الورديات (منطق خالص بلا واجهة)
 * ============================================================
 * من V1 (shifts.html) كما هو: يوم الدورة = (موضع الوردية يوم المرجع − 1 + الأيام منذ المرجع) mod 8 + 1؛ 1–2 صباحي،
 * 3–4 مسائي، 5–8 راحة. الأيام تُحسب بتواريخ UTC كاملة (بلا كسور ولا توقيت صيفي)، و«اليوم» من تقويم جهاز المستخدم المحلي
 * (لا UTC) حتى لا يظهر اليوم على الأمس بين منتصف الليل و3 فجرًا بتوقيت السعودية (V1).
 * الثوابت من config/الإعدادات.js (SHIFT_ROTATION) — لا أرقام أعمال هنا.
 *
 * The shift rotation (pure logic, no UI), from V1 as is. Whole UTC days; «today» from the device's local calendar.
 * The constants come from the config (SHIFT_ROTATION).
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG || !CONFIG.SHIFT_ROTATION) throw new Error('shift-rotation.js يحتاج config/الإعدادات.js قبله / needs the config first');
  const R = CONFIG.SHIFT_ROTATION, DAY_MS = 86400000;
  const REF_UTC = Date.UTC(R.REF_DATE.YEAR, R.REF_DATE.MONTH - 1, R.REF_DATE.DAY);
  const KINDS = {
    morning: { cls: 'morning', label: 'صباحي' },
    evening: { cls: 'evening', label: 'مسائي' },
    rest: { cls: 'rest', label: 'راحة' }
  };

  /* يوم ميلادي كامل بتوقيت UTC (الشهر من 0) — A whole Gregorian day in UTC (month from 0) */
  function dayUTC(y, m, d) { return Date.UTC(y, m, d); }
  /* «اليوم» من تقويم الجهاز المحلي — «today» from the device's local calendar */
  function todayUTC(now) { const n = now || new Date(); return dayUTC(n.getFullYear(), n.getMonth(), n.getDate()); }

  function isGroup(g) { return R.GROUPS.indexOf(g) !== -1; }
  /* يوم الدورة 1..8 — The cycle day 1..8 */
  function cycleDay(group, dateUTC) {
    if (!isGroup(group)) throw new Error('وردية غير معروفة: ' + group);
    const days = Math.round((dateUTC - REF_UTC) / DAY_MS);
    return ((R.REF_POSITION[group] - 1 + days) % R.CYCLE_DAYS + R.CYCLE_DAYS) % R.CYCLE_DAYS + 1;
  }
  /* نوع الدوام ← { cls, label } — The duty kind */
  function shiftFor(group, dateUTC) {
    const c = cycleDay(group, dateUTC);
    if (c <= R.MORNING_DAYS) return KINDS.morning;
    if (c <= R.MORNING_DAYS + R.EVENING_DAYS) return KINDS.evening;
    return KINDS.rest;
  }

  global.SecShiftRotation = {
    groups: function () { return R.GROUPS.slice(); }, isGroup: isGroup, cycleDay: cycleDay, shiftFor: shiftFor,
    dayUTC: dayUTC, todayUTC: todayUTC, REF_UTC: REF_UTC, hours: { morning: R.MORNING_HOURS, evening: R.EVENING_HOURS }
  };
})(typeof window !== 'undefined' ? window : globalThis);
