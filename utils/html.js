/* ============================================================
 * utils/html.js — تهريب النص لـHTML وتحويل الجداول إلى CSV (بلا حالة، بلا منطق صفحات)
 * ============================================================
 * - esc(value): أي قيمة من البيانات (الشيت، الخادم، المستخدم) تُهرَّب قبل وضعها في HTML فلا يُنفَّذ منها شيء.
 *   كانت مكررة في صفحات V1 (escapeHtml) — هنا مرة واحدة.
 * - csv(rows): مصفوفة صفوف ← نص CSV بصيغة V1: كل خلية بين علامتي تنصيص وتُضاعف علامات التنصيص داخلها، والأسطر
 *   بـ \n، ويبدأ بعلامة BOM ليفتحه Excel بالعربي صحيحًا. V2: خلية نصية تبدأ بـ = + - @ تُسبق بـ ' لمنع تنفيذها كمعادلة
 *   عند فتح الملف (حقن CSV) — والأرقام والجوالات (+9665…) تبقى كما هي.
 *
 * HTML escaping and table-to-CSV (stateless, no page logic). esc(value): escape any data value before it goes into HTML
 * (V1 duplicated escapeHtml per page — here once). csv(rows): V1's format — every cell quoted with doubled quotes, \n rows,
 * a leading BOM for Arabic in Excel. V2: a text cell starting with = + - @ gets a leading ' (CSV injection); numbers and
 * phones stay as they are.
 * ============================================================ */
(function (global) {
  'use strict';

  const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ENTITIES[c]; });
  }

  /* كل خلية بين علامتي تنصيص كما في V1 — Every cell quoted, as in V1 */
  function cell_(value) {
    let s = value == null ? '' : String(value);
    // الأرقام والجوالات (+9665…، -21.5) تبقى كما هي — numbers and phones stay as they are
    if (/^[=+\-@\t\r]/.test(s) && !/^[+\-]?[\d.\s]+$/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /* rows: [[...], [...]] — الصف الأول عادة العناوين؛ الأسطر بـ\n كما في V1 / the first row is usually the headers; \n rows as in V1 */
  function csv(rows) {
    return '﻿' + (rows || []).map(function (row) { return (row || []).map(cell_).join(','); }).join('\n');
  }

  global.SecHtml = { esc: esc, csv: csv };
})(typeof window !== 'undefined' ? window : globalThis);
