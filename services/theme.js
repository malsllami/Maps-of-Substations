/* ============================================================
 * services/theme.js — الوضع الداكن/الفاتح: الحالة والحفظ والتطبيق فقط (لا يرسم أي زر)
 * ============================================================
 * - يُحمَّل في <head> قبل الأنماط ويطبّق الوضع المحفوظ فورًا على <html data-theme> — قبل أول رسم، فلا وميض.
 *   (V1 كان يطبّقه على <body> بسكربت بعد فتحه؛ متغيرات الألوان معرّفة على [data-theme] فتعمل على <html> كما هي.)
 * - الافتراضي «داكن» كما في V1، والاختيار يُحفظ في هذا الجهاز (sec2-theme) لكل الصفحات.
 * - get() / set(mode) / toggle() / onChange(fn): المكوّنات (مفتاح القائمة، زر الرأس، الكرة، الرسوم) تقرأ وتستمع من هنا
 *   بدل قراءة document.body كما في V1.
 * - V2: تغيير الوضع في تبويب يصل للتبويبات الأخرى المفتوحة فورًا (حدث storage).
 *
 * Dark/light theme: state, saving and applying only (draws no button). Loaded in <head> before the styles and applies
 * the saved theme to <html data-theme> at once — before the first paint, so no flash (V1 applied it to <body>; the color
 * variables are defined on [data-theme], so they work on <html> as is). Default dark as in V1; the choice is saved on this
 * device for every page. Components read and listen here instead of reading document.body. V2: a change in one tab
 * reaches the other open tabs at once.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('theme.js يحتاج config/الإعدادات.js قبله / needs config/الإعدادات.js first');
  const KEY = CONFIG.STORAGE_KEYS.THEME;
  const MODES = ['dark', 'light'];
  const DEFAULT = 'dark';
  const listeners = [];
  const root = global.document.documentElement;

  function saved_() {
    try { const v = global.localStorage.getItem(KEY); return MODES.indexOf(v) !== -1 ? v : null; } catch (e) { return null; }
  }
  function apply_(mode) {
    if (root.getAttribute('data-theme') === mode) return false;
    root.setAttribute('data-theme', mode);
    return true;
  }
  function notify_(mode) {
    listeners.slice().forEach(function (fn) { try { fn(mode); } catch (e) { /* مستمع فاشل لا يوقف الباقي / a failing listener never stops the rest */ } });
  }

  function get() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }

  function set(mode) {
    if (MODES.indexOf(mode) === -1) return get();
    try { global.localStorage.setItem(KEY, mode); } catch (e) { /* تخزين محظور: يُطبَّق لهذه الصفحة فقط / storage blocked: applies to this page only */ }
    if (apply_(mode)) notify_(mode);
    return mode;
  }

  function toggle() { return set(get() === 'dark' ? 'light' : 'dark'); }

  /* يُرجع دالة لإلغاء الاستماع — returns an unsubscribe function */
  function onChange(fn) {
    listeners.push(fn);
    return function () { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
  }

  // التطبيق المبكر — early apply
  apply_(saved_() || DEFAULT);

  // تبويب آخر غيّر الوضع — another tab changed the theme
  global.addEventListener('storage', function (ev) {
    if (ev.key !== KEY && ev.key !== null) return;
    if (apply_(saved_() || DEFAULT)) notify_(get());
  });

  global.SecTheme = { get: get, set: set, toggle: toggle, onChange: onChange, MODES: MODES.slice() };
})(typeof window !== 'undefined' ? window : globalThis);
