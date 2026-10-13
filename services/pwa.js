/* ============================================================
 * services/pwa.js — تسجيل عامل خدمة V2 (sw.js) وإدارة تحديثه، وحالة يمكن للواجهة عرضها
 * ============================================================
 * - يُسجَّل تلقائيًا عند اكتمال تحميل الصفحة (load) كما في V1، فيكفي أن تحمّل الصفحة هذا الملف.
 * - التسجيل مرة واحدة فقط مهما استُدعي؛ فشله أو عدم دعم المتصفح لا يعطّل الموقع (يعمل من الشبكة كالمعتاد).
 * - نسخة جديدة من عامل الخدمة ← الحالة «update-ready» والصفحة الحالية تبقى تعمل؛ التطبيق بطلب صريح (applyUpdate)
 *   يرسل SKIP_WAITING، ثم عند controllerchange تعيد الصفحة تحميل نفسها مرة واحدة فقط.
 * - لا إعادة تحميل في أول تثبيت (لم يكن هناك عامل يتحكم بالصفحة)، ولا حلقة: إعادة تحميل ثانية خلال 10 ث تُمنع
 *   (sec2-sw-reload في sessionStorage).
 * - «حفظ الموقع كتطبيق» (اعتماد محمد 9 أكتوبر — الدمج «ج + د»): يُلتقط حدث التثبيت مبكرًا (الملف في رأس الصفحة) ويُحفظ؛
 *   installMode() تقرر بقدرة المتصفح الفعلية: 'installed' (يعمل كتطبيق) أو 'prompt' (تثبيت مباشر متاح) أو
 *   'ios' / 'manual' (تعليمات). التعرّف على الآيفون/الآيباد لاختيار نص التعليمات فقط، لا لتقرير إتاحة التثبيت.
 *
 * Registers the V2 service worker and manages its update, with a state the UI can show.
 * - Registers automatically once the page has loaded (as V1), so a page only needs to load this file.
 * - Registers once however often it's called; failure or no browser support never breaks the site (it works from the network).
 * - A new service worker version ← state "update-ready" while the current page keeps working; applying it (applyUpdate) sends
 *   SKIP_WAITING, then on controllerchange the page reloads itself exactly once.
 * - No reload on the first install (no worker controlled the page), and no loop: a second reload within 10 s is blocked.
 * - «Save the site as an app»: the install event is caught early and kept; installMode() decides by the browser's real
 *   ability: 'installed', 'prompt', or 'ios' / 'manual' (instructions). iPhone/iPad detection picks the instruction text only.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('pwa.js يحتاج config/الإعدادات.js قبله / needs config/الإعدادات.js loaded first');
  const RELOAD_KEY = CONFIG.STORAGE_KEYS.SW_RELOAD;
  const RELOAD_GUARD_MS = 10000;
  const SW_URL = 'sw.js';

  const sw = global.navigator && global.navigator.serviceWorker;
  const hadController = !!(sw && sw.controller); // هل كان عامل يتحكم بالصفحة عند فتحها؟ / was a worker controlling the page when it opened?
  let state = { supported: !!sw, status: sw ? 'idle' : 'unsupported', error: null, installable: false, installed: false };
  let deferredPrompt = null; // حدث التثبيت المؤجل — صالح لاستخدام واحد / the deferred install event — single use
  let registration = null, registering = null, reloading = false;
  const listeners = [];

  function set_(patch) {
    state = Object.assign({}, state, patch);
    listeners.slice().forEach(function (fn) { try { fn(state); } catch (e) { /* خطأ الواجهة لا يوقف الخدمة / a UI error never stops the service */ } });
  }
  function onChange(fn) {
    listeners.push(fn);
    return function () { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
  }

  /* نسخة تنتظر وصفحة يتحكم بها عامل ← تحديث جاهز — A waiting version and a controlled page ← an update is ready */
  function watch_(reg) {
    if (reg.waiting && sw.controller) set_({ status: 'update-ready' });
    reg.addEventListener('updatefound', function () {
      const worker = reg.installing;
      if (!worker) return;
      set_({ status: 'update-installing' });
      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed') set_({ status: sw.controller ? 'update-ready' : 'registered' }); // أول تثبيت ليس «تحديثًا» / a first install isn't an "update"
        else if (worker.state === 'redundant' && state.status === 'update-installing') set_({ status: 'registered' });
      });
    });
  }

  /* تسجيل واحد فقط — One registration only */
  function register() {
    if (!sw) return Promise.resolve(null);
    if (registering) return registering;
    set_({ status: 'registering', error: null });
    registering = sw.register(SW_URL, { updateViaCache: 'none' }).then(function (reg) {
      registration = reg;
      set_({ status: 'registered' });
      watch_(reg);
      return reg;
    }).catch(function (err) {
      registering = null; // يُسمح بمحاولة لاحقة / a later attempt is allowed
      set_({ status: 'failed', error: String(err && err.message || err) });
      try { global.console.warn('تعذّر تسجيل عامل الخدمة — الموقع يعمل من الشبكة / service worker registration failed:', err); } catch (e) { /* لا شيء / nothing */ }
      return null;
    });
    return registering;
  }

  /* فحص وجود نسخة أحدث على الموقع — Check the site for a newer version */
  function checkForUpdate() {
    if (!registration) return Promise.resolve(false);
    return registration.update().then(function () { return true; }, function () { return false; });
  }

  /* تطبيق التحديث المنتظر (بطلب المستخدم) — Apply the waiting update (on the user's request) */
  function applyUpdate() {
    if (!registration || !registration.waiting) return false;
    set_({ status: 'updating' });
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }

  function recentlyReloaded_() {
    try { return Date.now() - Number(global.sessionStorage.getItem(RELOAD_KEY) || 0) < RELOAD_GUARD_MS; } catch (e) { return false; }
  }

  if (sw) {
    sw.addEventListener('controllerchange', function () {
      // أول تثبيت (clients.claim) ليس تحديثًا — لا إعادة تحميل؛ ومرة واحدة فقط بلا حلقة
      // The first install (clients.claim) isn't an update — no reload; and only once, no loop
      if (!hadController || reloading || recentlyReloaded_()) return;
      reloading = true;
      try { global.sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch (e) { /* تخزين محظور / storage blocked */ }
      set_({ status: 'reloading' });
      global.location.reload();
    });
  }

  // تسجيل تلقائي بعد اكتمال الصفحة حتى لا ينافس تحميلها (V1) — auto-register after the page loads so it never competes with it (V1)
  if (sw && global.document && typeof global.addEventListener === 'function') {
    if (global.document.readyState === 'complete') register(); else global.addEventListener('load', function () { register(); });
  }

  // ===== «حفظ الموقع كتطبيق» — «save the site as an app» =====
  /* يعمل الآن كتطبيق مثبت (شاشة مستقلة)؟ — running now as an installed app (standalone)? */
  function isStandalone() {
    try { if (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) return true; } catch (e) { /* لا شيء / nothing */ }
    return !!(global.navigator && global.navigator.standalone === true); // Safari على الآيفون / Safari on iPhone
  }
  /* آيفون أو آيباد (الآيباد الحديث يعرّف نفسه كماك) — لاختيار نص التعليمات فقط / iPhone or iPad — for the instruction text only */
  function isIOS() {
    const n = global.navigator || {};
    return /iPad|iPhone|iPod/.test(n.userAgent || '') || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
  }
  /* طريقة التثبيت المتاحة الآن — the install path available now */
  function installMode() {
    if (isStandalone() || state.installed) return 'installed';
    if (deferredPrompt) return 'prompt';
    return isIOS() ? 'ios' : 'manual';
  }
  /* نافذة التثبيت الرسمية للمتصفح (مرة واحدة لكل حدث) ← 'accepted' | 'dismissed' | 'unavailable'
     The browser's own install dialog (once per event) */
  function promptInstall() {
    const ev = deferredPrompt;
    if (!ev) return Promise.resolve('unavailable');
    deferredPrompt = null; set_({ installable: false });
    try { ev.prompt(); } catch (e) { return Promise.resolve('unavailable'); }
    return Promise.resolve(ev.userChoice).then(function (choice) { return choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed'; }, function () { return 'dismissed'; });
  }
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('beforeinstallprompt', function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault(); // لا لافتة تلقائية — من القائمة فقط / no automatic banner — from the menu only
      deferredPrompt = e;
      set_({ installable: true });
    });
    global.addEventListener('appinstalled', function () { deferredPrompt = null; set_({ installable: false, installed: true }); });
  }

  global.SecPWA = {
    register: register, checkForUpdate: checkForUpdate, applyUpdate: applyUpdate, onChange: onChange,
    state: function () { return state; },
    installMode: installMode, promptInstall: promptInstall, isStandalone: isStandalone, isIOS: isIOS
  };
})(typeof window !== 'undefined' ? window : globalThis);
