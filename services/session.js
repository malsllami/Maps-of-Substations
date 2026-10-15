/* ============================================================
 * services/session.js — الجلسة في المتصفح: حفظها وقراءتها وتحديثها والخروج، وتجديد تذكرة الهوية
 * ============================================================
 * - الجلسة الوحيدة في V2 (sec2-session): { phone, name, role, identityToken, ts }. كل الصفحات تقرأ وتكتب عبر
 *   هذا الملف فقط (في V1 كانت كل صفحة تقرأ localStorage بنفسها وتخرج بطريقة مختلفة).
 * - الجلسة دائمة حتى خروج يدوي أو رفض صريح من الخادم. تذكرة الخادم صلاحيتها 30 يومًا، فتُجدَّد بعد مرور يوم
 *   على إصدارها، وتُجرَّب المنتهية أيضًا (الخادم يقبلها حتى 180 يومًا إن صح توقيعها).
 * - أخطاء الشبكة لا تُخرج المستخدم أبدًا؛ فقط رفض الخادم الصريح (TOKEN_INVALID).
 * - الدور (role) يأتي من الخادم: «admin» فقط للمدير الداخل بالبصمة. إظهار لوحة المدير يعتمد عليه، والخادم
 *   يتحقق من التذكرة نفسها في كل طلب إداري (الجلسة المحلية للعرض لا للصلاحية).
 * - الخروج موحّد: يحذف الجلسة، والجوال فقط إن ألغى المستخدم «تذكرني» (15 أكتوبر). انتهاء الجلسة يحذف الجلسة ويُبقي الجوال لاقتراحه في صفحة الدخول.
 *
 * The browser session: save, read, update, logout, and identity-ticket renewal.
 * - The only V2 session (sec2-session). Every page reads and writes through this file only (in V1 each page read
 *   localStorage itself and logged out differently).
 * - The session is permanent until a manual logout or an explicit server refusal. The server ticket lasts 30 days,
 *   so it's renewed once a day has passed since issue, and an expired one is still tried (accepted up to 180 days).
 * - Network errors never log the user out; only an explicit server refusal (TOKEN_INVALID) does.
 * - The role comes from the server: "admin" only for the admin logged in by fingerprint. Showing the admin panel
 *   depends on it, and the server checks the ticket itself on every admin request (local session = display, not rights).
 * - Logout is unified: removes the session, and the phone only when «remember me» is off (15 Oct). Expiry removes the session and keeps the phone to suggest it.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('session.js يحتاج config/الإعدادات.js قبله / needs config/الإعدادات.js loaded first');
  const SESSION_KEY = CONFIG.STORAGE_KEYS.SESSION;
  const PHONE_KEY = CONFIG.STORAGE_KEYS.PHONE;
  const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // يطابق صلاحية التذكرة في الخادم (02_Auth) / matches the server ticket lifetime
  const RENEW_AFTER_MS = CONFIG.TIMING.TOKEN_RENEW_AFTER_MS;
  const REQUEST_TIMEOUT_MS = 20000;
  const LOGIN_PAGE = 'auth.html';

  // ===== القراءة والكتابة — Reading and writing =====

  function read() {
    try {
      const s = JSON.parse(global.localStorage.getItem(SESSION_KEY) || 'null');
      return s && typeof s === 'object' ? s : null;
    } catch (e) { return null; }
  }

  function write_(session) {
    try { global.localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* تخزين محظور / storage blocked */ }
  }

  /* بعد دخول ناجح (بالجوال أو بالبصمة أو بعد التسجيل) — After a successful login (phone, fingerprint, or registration) */
  function save(data) {
    const session = { phone: data.phone, name: data.name || '', role: data.role === 'admin' ? 'admin' : 'member', identityToken: data.identityToken, ts: Date.now() };
    write_(session);
    try { global.localStorage.setItem(PHONE_KEY, data.phone); } catch (e) { /* تخزين محظور / storage blocked */ }
    return session;
  }

  /* دمج حقول في الجلسة الحالية (مثل الاسم بعد تعديل البيانات) — Merge fields into the current session (e.g. the name after a profile edit) */
  function update(fields) {
    const session = read();
    if (!session) return null;
    Object.keys(fields || {}).forEach(function (k) { if (k !== 'identityToken' && k !== 'phone') session[k] = fields[k]; });
    write_(session);
    return session;
  }

  /* وقت آخر نشاط — The last activity time */
  function touch() {
    const session = read();
    if (session) { session.ts = Date.now(); write_(session); }
  }

  function isLoggedIn() { const s = read(); return !!(s && s.identityToken); }
  function isAdmin() { const s = read(); return !!(s && s.identityToken && s.role === 'admin'); }
  function getToken() { const s = read(); return (s && s.identityToken) || ''; }
  function getPhone() { const s = read(); return (s && s.phone) || ''; }
  function getName() { const s = read(); return (s && s.name) || ''; }
  function getSavedPhone() { try { return global.localStorage.getItem(PHONE_KEY) || ''; } catch (e) { return ''; } }
  /* «تذكرني» غير مفعّل: مسح الجوال المقترح فقط — الجلسة كما هي — «remember me» off: forget the suggested phone only, the session stays */
  function forgetSavedPhone() { try { global.localStorage.removeItem(PHONE_KEY); } catch (e) { /* تخزين محظور / storage blocked */ } }

  // ===== الخروج والانتهاء — Logout and expiry =====

  function go_(url) {
    if (global.location.pathname.indexOf(LOGIN_PAGE) === -1) global.location.href = url;
  }

  /* خروج يدوي موحّد لكل الصفحات: الجلسة والجوال، ثم صفحة الدخول — Unified manual logout: session and phone, then the login page */
  function logout() {
    try {
      global.localStorage.removeItem(SESSION_KEY);
      // «تذكرني» مفعّل (الافتراضي) ← يبقى الجوال مقترحًا في حقل الدخول (طلب محمد، 15 أكتوبر)؛ غير مفعّل ← يُمسح
      // «remember me» on (default) ← the phone stays suggested in the login field (Mohammed, 15 Oct); off ← removed
      if (global.localStorage.getItem(CONFIG.STORAGE_KEYS.REMEMBER_PHONE) === '0') global.localStorage.removeItem(PHONE_KEY);
    } catch (e) { /* تخزين محظور / storage blocked */ }
    go_(LOGIN_PAGE);
  }

  /* انتهت الجلسة (رفض الخادم): الجلسة فقط، ويبقى الجوال لاقتراحه — Session expired (server refusal): session only, the phone stays */
  function handleExpired() {
    try { global.localStorage.removeItem(SESSION_KEY); } catch (e) { /* تخزين محظور / storage blocked */ }
    go_(LOGIN_PAGE + '?expired=1');
  }

  function isTokenInvalid(res) {
    return !!res && res.code === 'TOKEN_INVALID';
  }

  // ===== التجديد — Renewal =====

  /* وقت انتهاء التذكرة من محتواها (غير سري — التوقيع هو الحماية) — The ticket expiry from its payload (not secret — the signature protects it) */
  function tokenExpiry_(token) {
    try {
      let b64 = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return Number(JSON.parse(global.atob(b64)).exp) || 0;
    } catch (e) { return 0; }
  }

  /**
   * يجدد التذكرة عند الحاجة (حتى المنتهية). يُرجع true إن كانت الجلسة صالحة للاستخدام.
   * options.redirectOnExpired=false للصفحات التي تعمل كضيف أيضًا (الورديات).
   * Renews the ticket when due (even an expired one). Returns true if the session is usable.
   * options.redirectOnExpired=false for pages that also work as guest (shifts).
   */
  async function ensureFresh(options) {
    const redirect = !(options && options.redirectOnExpired === false);
    const expire = function () { if (redirect) handleExpired(); return false; }; // بلا توجيه تبقى الجلسة كما في V1 / without redirect the session stays, as in V1
    const session = read();
    if (!session) return false;
    if (!session.identityToken) return expire();
    const exp = tokenExpiry_(session.identityToken), expired = exp <= Date.now();
    if (!expired && Date.now() - (exp - TOKEN_TTL_MS) < RENEW_AFTER_MS) return true;

    const controller = new global.AbortController();
    const timer = global.setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const res = await global.fetch(CONFIG.API_BASE_URL, {
        method: 'POST', body: JSON.stringify({ action: 'refreshIdentityToken', identityToken: session.identityToken }), signal: controller.signal
      });
      const json = await res.json();
      if (json && json.success && json.identityToken) {
        const latest = read() || session; // قد تكون صفحة أخرى حدّثت الجلسة أثناء الطلب / another page may have updated it meanwhile
        latest.identityToken = json.identityToken;
        if (json.role) latest.role = json.role === 'admin' ? 'admin' : 'member';
        write_(latest);
        return true;
      }
      if (isTokenInvalid(json)) return expire();
      return !expired;
    } catch (e) {
      // خطأ شبكة أو رد غير صالح: لا خروج أبدًا. صالحة ← تابع؛ منتهية ← لا طلبات تحتاجها، وتُعاد المحاولة بالفتح القادم
      // Network error or invalid reply: never log out. Valid ← continue; expired ← skip ticket calls, retry on next open
      return !expired;
    } finally {
      global.clearTimeout(timer);
    }
  }

  global.SecSession = {
    read: read, save: save, update: update, touch: touch, isLoggedIn: isLoggedIn, isAdmin: isAdmin,
    getToken: getToken, getPhone: getPhone, getName: getName, getSavedPhone: getSavedPhone, forgetSavedPhone: forgetSavedPhone,
    logout: logout, handleExpired: handleExpired, isTokenInvalid: isTokenInvalid, ensureFresh: ensureFresh
  };
})(typeof window !== 'undefined' ? window : globalThis);
