/* ============================================================
 * components/reinstall-notice.js — شاشة «إعادة تثبيت التطبيق» على الآيفون (قرار محمد — 31 أكتوبر 2026)
 * ============================================================
 * الآيفون يحفظ أيقونة التطبيق واسمه لحظة الإضافة إلى الشاشة الرئيسية، فلا تظهر الأيقونة الجديدة إلا بالحذف وإعادة الإضافة.
 * السلوك:
 * - شاشة كاملة لعضو حالي يفتح التطبيق المثبّت على الآيفون أو الآيباد؛ لا تظهر في Safari ولا أندرويد ولا بلا إنترنت.
 * - بعد تحديث الصفحة: رسالة «سيتم تسجيل خروجك آليًا» ثم خروج آلي، ثم فوق صفحة الدخول رسالة حمراء وزر نسخ الرابط والخطوات.
 * - لا تظهر فوق الجولة أو الملاحة أو الحفظ أو لوحة التحديث، فلا يقطع الخروج عملًا جاريًا.
 * - «متابعة من هذا التطبيق الآن» تكشف صفحة الدخول حتى الفتح التالي، لمن كان في مهمة. وتتوقف بعد 5 فتحات: الموقع لا يعرف
 *   هل حُذف التطبيق، فلا يُحبس عضو فيها إلى الأبد.
 * - تثبيت جديد (أو إعادة التثبيت بعد الحذف) يبدأ بـ«البداية النظيفة»: لا تظهر له أبدًا.
 *
 * A full-screen «reinstall the app» flow on iPhone: iOS keeps an app's icon and name from when it was added. Shows to a current
 * member opening the installed app on iPhone/iPad; never in Safari, on Android or offline. After the page updates: a message,
 * an automatic logout, then a red message, the copy-link button and steps over the login page. Never over the tour, navigation,
 * a save or the update sheet. «Continue here» reveals the login until the next open; it stops after 5 opens, since the site
 * can't tell whether the app was deleted. A new install or re-install never sees it.
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document;
  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('reinstall-notice.js يحتاج config/الإعدادات.js قبله / needs the config first');
  const K = CONFIG.STORAGE_KEYS, KEY = K.REINSTALL_NOTICE;
  const OPENED_KEY = KEY + '-opened', CLOSED_KEY = KEY + '-closed'; // خاصان بفتحة التطبيق الحالية / this app open only
  const MAX_OPENS = 5, FIRST_CHECK_MS = 300, BUSY_RECHECK_MS = 3000, LOGOUT_DELAY_MS = 4000;
  const MSG = {
    TITLE: 'تحديث جديد للتطبيق',
    TEXT: 'سيتم تسجيل خروجك آليًا لتنفيذ خطوات التحديث الجديد...',
    OUT_TITLE: 'تم تسجيل خروجك',
    ALERT: 'يجب عليك حذف التطبيق الحالي، ثم فتح الرابط في Safari أو Chrome',
    STEP_COPY: 'اضغط الزر الأصفر بالأعلى لنسخ رابط الموقع',
    STEP_DELETE: 'اضغط مطولًا على أيقونة التطبيق في الشاشة الرئيسية واختر حذف',
    STEP_INSTALL: 'افتح Safari أو Chrome والصق الرابط، وسجّل دخولك، ثم احفظ الموقع كتطبيق من زر المشاركة: «إضافة إلى الشاشة الرئيسية»',
    COPY: 'نسخ رابط الموقع',
    COPIED: '✓ تم نسخ الرابط',
    STAY: 'متابعة من هذا التطبيق الآن'
  };

  function readState_() {
    try { const s = JSON.parse(global.localStorage.getItem(KEY) || 'null'); return s && typeof s === 'object' ? s : null; } catch (e) { return null; }
  }
  function writeState_(s) { try { global.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* تخزين محظور / storage blocked */ } }
  function hasSession_() { try { return !!global.localStorage.getItem(K.SESSION); } catch (e) { return false; } }
  function sessionFlag_(key) { try { return global.sessionStorage.getItem(key) === '1'; } catch (e) { return false; } }
  function setSessionFlag_(key) { try { global.sessionStorage.setItem(key, '1'); } catch (e) { /* تخزين محظور / storage blocked */ } }

  /* التطبيق المثبّت على الآيفون أو الآيباد — the installed app on iPhone or iPad */
  function isInstalledIos_() {
    const nav = global.navigator, ua = nav.userAgent || '';
    // «طلب موقع سطح المكتب» يجعل الآيفون يعرّف نفسه Macintosh، واللمس يميّزه عن Mac الحقيقي (تجربة محمد 31 أكتوبر)
    // «Request desktop website» makes an iPhone report Macintosh; touch tells it apart from a real Mac
    return nav.standalone === true && (/iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1));
  }

  /* نافذة أو عملية لا تظهر الشاشة فوقها — a window or operation the screen never shows over */
  function busy_() {
    const g = global, upd = g.SecUpdateSheet && g.SecUpdateSheet.instance ? g.SecUpdateSheet.instance() : null;
    return !!((g.SecUpdateSheet && g.SecUpdateSheet.defaultBusy()) || (upd && upd.isShown()) ||
      (g.SecInstallSheet && g.SecInstallSheet.isOpen()) || (g.SecFeatureTour && g.SecFeatureTour.isOpen()));
  }

  const siteUrl_ = function () { return new URL('./', global.location.href).href; };
  function copy_() {
    const clip = global.navigator.clipboard;
    return clip ? clip.writeText(siteUrl_()).then(function () { return true; }, function () { return false; }) : Promise.resolve(false);
  }
  const step_ = function (n, text) { return '<li class="rn-step"><span class="rn-n">' + n + '</span><span>' + text + '</span></li>'; };

  /* قبل الخروج: رسالة قصيرة ثم خروج آلي — before logging out: a short message, then an automatic logout */
  function mainHtml_() {
    return '<h2 class="rn-title" id="rnTitle">' + MSG.TITLE + '</h2><p class="rn-alert">' + MSG.TEXT + '</p>';
  }
  /* بعد الخروج، فوق صفحة الدخول: الرسالة الحمراء وزر النسخ والخطوات، والرابط ظاهر إن تعذّر النسخ
     After logout, over the login page: the red message, the copy button and steps, with the link visible if copying fails */
  function outHtml_() {
    return '<h2 class="rn-title" id="rnTitle">' + MSG.OUT_TITLE + '</h2><p class="rn-alert">' + MSG.ALERT + '</p>' +
      '<button type="button" class="rn-primary" data-act="copy">' + MSG.COPY + '</button>' +
      '<p class="rn-link" dir="ltr">' + siteUrl_() + '</p>' +
      '<ol class="rn-steps">' + step_(1, MSG.STEP_COPY) + step_(2, MSG.STEP_DELETE) + step_(3, MSG.STEP_INSTALL) + '</ol>' +
      '<button type="button" class="rn-secondary" data-act="close">' + MSG.STAY + '</button>';
  }

  function show_(html) {
    doc.body.insertAdjacentHTML('beforeend', '<div class="rn-screen" data-role="reinstall-notice" role="dialog" aria-modal="true" aria-labelledby="rnTitle"><div class="rn-card">' + html + '</div></div>');
    const el = doc.querySelector('[data-role="reinstall-notice"]');
    el.addEventListener('click', function (e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') { setSessionFlag_(CLOSED_KEY); el.remove(); return; }
      copy_().then(function (ok) { if (ok) b.textContent = MSG.COPIED; });
    });
  }

  /* الخروج الآلي بعد مهلة قراءة الرسالة — the automatic logout, after time to read the message */
  function logoutSoon_() {
    global.setTimeout(function () {
      writeState_(Object.assign({}, readState_(), { loggedOut: true }));
      global.SecSession.logout();
    }, LOGOUT_DELAY_MS);
  }

  function tryShow_() {
    if (sessionFlag_(CLOSED_KEY) || doc.querySelector('[data-role="reinstall-notice"]')) return;
    if (busy_()) { global.setTimeout(tryShow_, BUSY_RECHECK_MS); return; }
    const state = readState_() || {}, session = hasSession_();
    if (!sessionFlag_(OPENED_KEY)) {
      if ((state.opens || 0) >= MAX_OPENS) { writeState_({ done: true }); return; }
      setSessionFlag_(OPENED_KEY);
      state.opens = (state.opens || 0) + 1;
    }
    if (session) state.loggedOut = false; // دخل من جديد من التطبيق القديم / logged in again from the old app
    writeState_(state);
    if (state.loggedOut) { show_(outHtml_()); return; }
    show_(mainHtml_());
    logoutSoon_();
  }

  function start_() {
    if (!isInstalledIos_()) return;
    const state = readState_();
    if (state && state.done) return;
    // تثبيت جديد: أيقونته جديدة أصلًا، فلا تظهر له أبدًا — a new install already has the new icon, so it never shows
    if (global.SecFreshStart && global.SecFreshStart.quietUpdates() && !(state && state.opens)) { writeState_({ done: true }); return; }
    if (!hasSession_() && !(state && state.loggedOut)) return; // غير مسجّل دخوله ← تنتظر دخوله / logged out ← waits for the login
    if (global.navigator.onLine === false) return; // إعادة التثبيت تحتاج إنترنت / reinstalling needs the internet
    global.setTimeout(tryShow_, FIRST_CHECK_MS);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start_); else start_();

  global.SecReinstallNotice = { MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
