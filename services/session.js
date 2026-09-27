/* ============================================================
 * services/session.js — مسؤول عن تذكرة الهوية بالمتصفح فقط: تجديدها
 * تلقائيًا قبل انتهائها، والتوجيه لإعادة الدخول عند انتهائها فعليًا.
 * الجلسة بالمتصفح دائمة، لكن تذكرة الخادم لها صلاحية (30 يومًا) —
 * هذا الملف يُبقيهما متطابقتين حتى لا يُرفض طلب بتذكرة منتهية.
 *
 * Owns the browser-side identity ticket only: renews it before it
 * expires and redirects to login once it truly has. The browser session
 * is permanent but the server ticket has a lifetime (30 days) — this
 * file keeps both in sync so no request is refused with a stale ticket.
 * ============================================================ */
(function (global) {
  'use strict';

  const SESSION_KEY = 'sec-session';
  // تجديد عند مرور يوم على إصدار التذكرة (لا مع كل تحميل) — Renew once a day has passed since issue (not on every load)
  const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // يطابق IDENTITY_TOKEN_TTL_MS بـ Code.gs / matches IDENTITY_TOKEN_TTL_MS in Code.gs
  const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 20000;

  function readSession_() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }

  /* قراءة وقت انتهاء التذكرة من محتواها (غير سري — التوقيع هو الحماية) — Reads the ticket expiry from its payload (not secret — the signature is the protection) */
  function getTokenExpiry_(token) {
    try {
      let b64 = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return Number(JSON.parse(atob(b64)).exp) || 0;
    } catch (e) { return 0; }
  }

  /* الخروج لإعادة الدخول مع إبقاء رقم الجوال لاقتراحه تلقائيًا — Sends the user to log in again, keeping the phone for auto-suggest */
  function handleExpired() {
    localStorage.removeItem(SESSION_KEY);
    if (location.pathname.indexOf('auth.html') === -1) location.href = 'auth.html?expired=1';
  }

  function isTokenInvalid(res) {
    return !!res && res.code === 'TOKEN_INVALID';
  }

  /**
   * يتحقق من التذكرة ويجددها عند الحاجة (حتى لو انتهت). يُرجع true إن كانت الجلسة صالحة للاستخدام.
   * أخطاء الشبكة لا تُخرج المستخدم أبدًا — فقط الرفض الصريح من الخادم (TOKEN_INVALID).
   * Validates and renews the ticket when due (even if expired). Returns true if the session is usable.
   * Network errors never log the user out — only an explicit server refusal (TOKEN_INVALID) does.
   */
  async function ensureFresh(apiUrl, options) {
    // redirectOnExpired=false لصفحات تعمل كضيف أيضًا (مثل جدول الورديات) — for pages that also work as guest (e.g. shifts)
    const redirect = !(options && options.redirectOnExpired === false);
    const expire = function () { if (redirect) handleExpired(); return false; };
    const session = readSession_();
    if (!session) return false;
    if (!session.identityToken) return expire(); // جلسة قديمة جدًا بلا تذكرة أصلًا — لا شيء يمكن تجديده / very old session with no ticket at all — nothing to renew
    const exp = getTokenExpiry_(session.identityToken);
    // التذكرة المنتهية لا تُخرج المستخدم مباشرة: يُحاوَل تجديدها أولًا، والخادم وحده يقرر الرفض (فترة سماح بتوقيع صحيح)
    // An expired ticket doesn't log the user out directly: renewal is tried first, and only the server decides to refuse (signed grace period)
    const expired = exp <= Date.now();

    const issuedAt = exp - TOKEN_TTL_MS; // التذاكر القديمة (12 ساعة) تظهر كأنها قديمة جدًا فتُجدَّد فورًا / legacy 12h tickets look very old, so they renew immediately
    if (!expired && Date.now() - issuedAt < RENEW_AFTER_MS) return true;

    const controller = new AbortController();
    const timeoutId = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'refreshIdentityToken', identityToken: session.identityToken }),
        signal: controller.signal
      });
      const json = await res.json();
      if (json && json.success && json.identityToken) {
        const latest = readSession_() || session; // قد تكون صفحة أخرى حدّثت الجلسة أثناء الطلب / another page may have updated it meanwhile
        latest.identityToken = json.identityToken;
        if (json.role) latest.role = json.role;
        localStorage.setItem(SESSION_KEY, JSON.stringify(latest));
        return true;
      }
      if (isTokenInvalid(json)) return expire();
      return !expired;
    } catch (e) {
      // خطأ شبكة: لا خروج أبدًا. تذكرة صالحة ← تابع؛ منتهية ← لا ترسل طلبات تحتاجها (ستُرفض)، وتُعاد المحاولة بالفتح القادم
      // Network error: never log out. Valid ticket → continue; expired → skip ticket-dependent calls (they'd be refused), retry on next open
      return !expired;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /* التذكرة الحالية (تُقرأ لحظيًا حتى تلتقط أي تجديد) — Current ticket (read live so it picks up any renewal) */
  function getToken() {
    const s = readSession_();
    return (s && s.identityToken) || '';
  }

  global.SecSession = { ensureFresh: ensureFresh, handleExpired: handleExpired, isTokenInvalid: isTokenInvalid, getToken: getToken };
})(window);
