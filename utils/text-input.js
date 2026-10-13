/* ============================================================
 * utils/text-input.js — تنظيف حقول الإدخال أثناء الكتابة (بلا حالة): الأرقام العربية، الرموز الخفية، الأكواد، التصفية
 * ============================================================
 * من V1 بنفس السلوك:
 * - الحقول تقبل الأرقام العربية والإنجليزية معًا، وتتحول العربية فورًا لإنجليزية بنفس الطول (المؤشر يبقى مكانه).
 * - الرموز غير المرئية (علامات الاتجاه، المسافات صفرية العرض) التي تلتصق عند اللصق من واتساب تُزال.
 * - حقول الأكواد (رقم المحطة، المغذي، البحث): أرقام + أحرف كبيرة. الحقول النصية الحرة: الأرقام فقط.
 * - تصفية فورية: أي رمز خارج المسموح يُحذف فور ظهوره، مع حد للطول.
 * - لصق الإحداثية بصيغة «خط العرض,خط الطول».
 *
 * Input cleaning while typing (stateless), from V1 with the same behavior: fields accept Arabic and Latin digits (Arabic
 * converted at once, same length so the caret stays); invisible marks pasted from WhatsApp are removed; code fields get
 * digits + upper case, free-text fields digits only; instant filtering of disallowed characters with a length cap; and
 * parsing a pasted «lat,lng».
 * ============================================================ */
(function (global) {
  'use strict';

  const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const CHARS = {
    CODE: /[^0-9٠-٩A-Za-z\-]/g,        // رقم المحطة والبحث / station id and search
    COORD: /[^0-9٠-٩.\-]/g,            // خط عرض أو طول / one coordinate
    COORD_PAIR: /[^0-9٠-٩.,\-\s]/g     // «عرض,طول» / «lat,lng»
  };

  function stripInvisible(str) { return String(str == null ? '' : str).replace(/[​-‏‪-‮⁠-⁩﻿]/g, ''); }
  function normalizeDigits(str) { return stripInvisible(str).replace(/[٠-٩]/g, function (d) { return String(ARABIC_DIGITS.indexOf(d)); }); }
  function normalizeCode(str) { return normalizeDigits(str).toUpperCase(); }
  /* مفتاح مطابقة رقم المحطة: أحرف كبيرة وأرقام إنجليزية، بلا مسافات ولا شرطة في الطرفين — «mdn 2» = «MDN2»، «ANS1» = «ANS 1»،
   * «2283» = «2283-» (أشكال موجودة فعلًا في الشيت). الشرطة الداخلية تبقى: «9550-A» غير «9550A».
   * The station id match key: upper case, Latin digits, no spaces, no edge dashes — forms that really exist in the sheet. */
  function stationKey(str) {
    return normalizeCode(str).replace(/[‐-―−]/g, '-').replace(/\s+/g, '').replace(/^-+|-+$/g, '');
  }

  /* تطبيق تحويل على الحقل مع إبقاء المؤشر — Apply a transform to the field keeping the caret */
  function bind_(input, transform) {
    if (!input) return;
    input.addEventListener('input', function () {
      const start = input.selectionStart, end = input.selectionEnd;
      const next = transform(input.value);
      if (next === input.value) return;
      input.value = next;
      if (start !== null && end !== null) { try { input.setSelectionRange(Math.min(start, next.length), Math.min(end, next.length)); } catch (e) { /* بعض الأنواع لا تدعمه / some types don't support it */ } }
    });
  }

  /* حقل كود: تصفية + أرقام إنجليزية + أحرف كبيرة — A code field: filter + Latin digits + upper case */
  function code(input, maxLen) { bind_(input, function (v) { return normalizeCode(stripInvisible(v).replace(CHARS.CODE, '').slice(0, maxLen || 24)); }); }
  /* حقل نص حر: أرقام إنجليزية فقط — A free-text field: Latin digits only */
  function digits(input) { bind_(input, normalizeDigits); }
  /* حقل كود بلا تصفية (المغذي كما في V1) — A code field without filtering (the feeder, as in V1) */
  function upper(input) { bind_(input, normalizeCode); }
  /* حقل إحداثية واحدة أو زوج — One coordinate field, or a pair */
  function coord(input) { bind_(input, function (v) { return normalizeDigits(stripInvisible(v).replace(CHARS.COORD, '')).slice(0, 20); }); }
  function coordPair(input) { bind_(input, function (v) { return normalizeDigits(stripInvisible(v).replace(CHARS.COORD_PAIR, '')).slice(0, 40); }); }

  /* «خط العرض,خط الطول» ← { lat, lng } أو null (من V1) — «lat,lng» ← { lat, lng } or null (from V1) */
  function parseCoordPair(raw) {
    const parts = normalizeDigits(raw).trim().split(/\s*,\s*/);
    if (parts.length !== 2) return null;
    const lat = Number(parts[0]), lng = Number(parts[1]);
    if (parts[0] === '' || parts[1] === '' || !isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  global.SecTextInput = {
    stripInvisible: stripInvisible, normalizeDigits: normalizeDigits, normalizeCode: normalizeCode, stationKey: stationKey,
    code: code, digits: digits, upper: upper, coord: coord, coordPair: coordPair, parseCoordPair: parseCoordPair
  };
})(typeof window !== 'undefined' ? window : globalThis);
