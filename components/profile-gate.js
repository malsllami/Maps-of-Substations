/* ============================================================
 * components/profile-gate.js — بوابة اكتمال الملف: عضو بلا وردية أو قسم ← نافذة «قبل ما نكمل رحلتك معنا...»
 * ============================================================
 * سلوك V1 وتصميمه ونصوصه كما هي: بعد تجديد الجلسة يُطلب الملف المختصر (getMemberProfileLite)؛ إن نقصت الوردية أو القسم
 * تظهر النافذة فوق الصفحة (تحت الرأس) وزرها يفتح القائمة للانتقال إلى «حسابي». الزائر لا يُفحص. تعذّر الطلب ← لا بوابة
 * (لا تُغلق الصفحة على المستخدم بسبب الشبكة). التذكرة المرفوضة صراحة ← SecSession.handleExpired كما في V1.
 * لا منطق دخول هنا: الجلسة من services/session.js والطلب من services/api-client.js.
 *
 * The profile completeness gate. V1's behavior, design and texts. A member missing a shift or department sees the gate;
 * its button opens the menu to «My account». Guests aren't checked; a failed request shows no gate. No auth logic here.
 * ============================================================ */
(function (global) {
  'use strict';

  const MSG = {
    TITLE: 'قبل ما نكمل رحلتك معنا...',
    TEXT: 'نحتاج نعرف وردية وقسم عملك عشان نقدر نخدمك بشكل أفضل. اضغط الزر بالأسفل، افتح "حسابي" من القائمة، واستكمل بياناتك من هناك',
    BUTTON: 'فتح القائمة والانتقال لحسابي'
  };
  const ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

  /**
   * mount(parent, opts) — opts: { onOpenMenu() } (الصفحة تفتح قائمة الرأس: header.openMenu)
   * يُرجع { check() → Promise<'guest'|'complete'|'incomplete'|'expired'|'unknown'>، isShown()، hide()، destroy() }
   */
  function mount(parent, opts) {
    const o = opts || {}, S = global.SecSession, API = global.SecApi;
    if (!S || !API) throw new Error('profile-gate.js يحتاج session.js وapi-client.js قبله / needs session.js and api-client.js first');
    parent.insertAdjacentHTML('beforeend',
      '<div class="profile-gate-overlay" data-role="profile-gate" role="dialog" aria-modal="true" aria-labelledby="profileGateTitle">' +
      '<div class="profile-gate-card"><div class="profile-gate-icon">' + ICON + '</div>' +
      '<h2 id="profileGateTitle">' + MSG.TITLE + '</h2><p>' + MSG.TEXT + '</p>' +
      '<button type="button" class="add-station-submit profile-gate-btn" data-act="open-menu">' + MSG.BUTTON + '</button></div></div>');
    const overlay = parent.querySelector('[data-role="profile-gate"]');
    let seq = 0;

    function onClick_(e) { if (e.target.closest('[data-act="open-menu"]') && o.onOpenMenu) o.onOpenMenu(); }
    overlay.addEventListener('click', onClick_);

    async function check() {
      const my = ++seq;
      if (!S.isLoggedIn()) { overlay.classList.remove('show'); return 'guest'; }
      let res;
      try { res = await API.call('getMemberProfileLite', {}, { token: true }); } catch (e) { return 'unknown'; }
      if (my !== seq) return 'unknown'; // فحص أحدث بدأ / a newer check started
      if (S.isTokenInvalid(res)) { S.handleExpired(); return 'expired'; }
      if (!res || !res.success) return 'unknown';
      const incomplete = !String(res.shift || '').trim() || !String(res.department || '').trim();
      overlay.classList.toggle('show', incomplete);
      return incomplete ? 'incomplete' : 'complete';
    }

    return {
      check: check,
      isShown: function () { return overlay.classList.contains('show'); },
      hide: function () { seq++; overlay.classList.remove('show'); },
      destroy: function () { seq++; overlay.removeEventListener('click', onClick_); overlay.remove(); }
    };
  }

  global.SecProfileGate = { mount: mount, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
