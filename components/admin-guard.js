/* ============================================================
 * components/admin-guard.js — شاشة «حماية لوحة المدير» لجهاز مدير جديد (النموذج 2 المعتمد — 8 نوفمبر 2026)
 * ============================================================
 * تظهر داخل لوحة المدير فقط، حين يرد الخادم أن هذا الجهاز لم يكتمل كجهاز مدير. الأعضاء لا يرونها أبدًا.
 * - مؤشر خطوتين: «1 كلمة المرور» ← «2 اعتماد الشيت»، ودرع ذهبي، واسم الجهاز وتاريخ تسجيله ليُعرف صفه في الشيت.
 * - كلمة المرور: حقل واحد يقبل الأرقام العربية والإنجليزية، والتحقق كله في الخادم ولا تُحفظ في المتصفح.
 * - القفل من الخادم: عدّاد انتظار حقيقي يصمد بعد إعادة التحميل (الوقت من الخادم)، والقفل النهائي برسالته.
 * - «بانتظار اعتمادك»: زر «تحقّق الآن» يعيد فحص الخادم بعد وضع ✓ في الشيت.
 *
 * The «admin panel protection» screen for a new admin device (approved model 2). Shown inside the admin panel only, when
 * the server says this device isn't a complete admin device yet; members never see it. Two steps, a gold shield, the
 * device name and date to find its sheet row; one password field (Arabic or English digits) checked by the server only;
 * the server's lockout with a real countdown surviving reloads; and «check now» after the ✓ is set in the sheet.
 * ============================================================ */
(function (global) {
  'use strict';

  const MSG = {
    STEP1: 'كلمة المرور', STEP2: 'اعتماد الشيت',
    TITLE: 'حماية لوحة المدير', TEXT: 'هذا الجهاز لم يُعتمد بعد كجهاز مدير',
    DEVICE: 'هذا الجهاز:', PLACEHOLDER: 'كلمة مرور المدير', CONTINUE: 'متابعة', CHECKING: 'جارٍ التحقق…',
    PENDING_TITLE: 'بقي اعتمادك من الشيت', PENDING_TEXT: 'ضع ✓ في «اعتماد المدير» لصف هذا الجهاز في شيت «بصمات الأجهزة»:',
    CHECK_NOW: 'تحقّق الآن', WRONG: 'كلمة المرور غير صحيحة', LEFT: 'بقيت محاولات: ',
    WAIT: 'محاولات كثيرة — حاول بعد ', LOCKED: 'قُفلت كلمة مرور المدير بعد محاولات خاطئة كثيرة. اكتب كلمة مرور جديدة في شيت «الإعدادات» لفكّ القفل.',
    NO_PASSWORD: 'لم تُضبط «كلمة مرور المدير» في شيت «الإعدادات» بعد. اكتبها هناك ثم اضغط «تحقّق الآن».',
    RELOGIN: 'الدخول بالبصمة', EMPTY: 'اكتب كلمة المرور', FAILED: 'تعذّر الاتصال — حاول مرة أخرى'
  };
  const SHIELD = '<svg viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 1l10 4v7c0 6.5-4.3 11.2-10 13C6.3 23.2 2 18.5 2 12V5z"/><path d="M8 13l3 3 5-6"/></svg>';
  const GUARD_CODES = { ADMIN_PASSWORD_REQUIRED: 1, ADMIN_PENDING_APPROVAL: 1, ADMIN_RELOGIN: 1, ADMIN_NO_PASSWORD: 1, ADMIN_WAIT: 1, ADMIN_LOCKED: 1 };

  const esc_ = function (s) { return global.SecHtml ? global.SecHtml.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, ''); };
  const digits_ = function (s) { return global.SecTextInput ? global.SecTextInput.normalizeDigits(s) : String(s || ''); };

  /* هل رد الخادم حالة حماية المدير؟ — is this server reply an admin-protection state? */
  function isGuardReply(res) { return !!(res && GUARD_CODES[res.code]); }

  /**
   * render(container, reply, opts) — opts: { api (الافتراضي SecApi)، onRetry() إعادة تحميل اللوحة، onApproved() بعد اكتمال الاعتماد }
   * reply: رد الخادم { code, error, device: { name, registeredAt }, guard: { noPassword, locked, waitUntil, now, left } }
   * يُرجع { destroy() } — returns its controls
   */
  function render(container, reply, opts) {
    const o = opts || {}, api = o.api || global.SecApi;
    let timer = 0, device = (reply && reply.device) || {};
    const deviceLine_ = function () { return device.name || device.registeredAt ? '<b class="ag-device">' + esc_(device.name || 'جهاز') + (device.registeredAt ? ' — ' + esc_(device.registeredAt) : '') + '</b>' : ''; };
    const steps_ = function (stage) {
      return '<div class="ag-steps"><span class="ag-step' + (stage === 1 ? ' on' : ' ok') + '">' + (stage === 1 ? '1 ' : '✓ ') + MSG.STEP1 + '</span>' +
        '<span class="ag-arrow" aria-hidden="true">←</span><span class="ag-step' + (stage === 2 ? ' on' : '') + '">2 ' + MSG.STEP2 + '</span></div>';
    };

    function stop_() { global.clearInterval(timer); timer = 0; }

    // ===== الخطوة 1: كلمة المرور — step 1: the password =====
    function passwordStep_(guard, note) {
      stop_();
      const g = guard || {};
      container.innerHTML = '<div class="ag-screen" data-role="admin-guard" data-state="password">' + steps_(1) +
        '<div class="ag-shield">' + SHIELD + '</div><h2 class="ag-title">' + MSG.TITLE + '</h2><p class="ag-text">' + MSG.TEXT + '</p>' + deviceLine_() +
        '<form class="ag-form" autocomplete="off"><input class="ag-input" type="password" inputmode="text" autocomplete="off" aria-label="' + MSG.PLACEHOLDER + '" placeholder="' + MSG.PLACEHOLDER + '">' +
        '<button type="submit" class="ag-btn gold" data-act="continue">' + MSG.CONTINUE + '</button></form>' +
        '<p class="ag-msg" role="alert" data-role="msg"></p></div>';
      const input = container.querySelector('.ag-input'), btn = container.querySelector('[data-act="continue"]'), msg = container.querySelector('[data-role="msg"]');
      if (global.SecTextInput) global.SecTextInput.digits(input); // الأرقام العربية ← إنجليزية / Arabic digits ← English
      const lock_ = function (text) { input.disabled = true; btn.disabled = true; msg.textContent = text; };
      if (g.noPassword) lock_(MSG.NO_PASSWORD);
      else if (g.locked) lock_(MSG.LOCKED);
      else if (g.waitUntil && g.now && g.waitUntil > g.now) {
        // العدّاد من وقت الخادم: يصمد بعد إعادة التحميل — the countdown from the server's time: survives reloads
        const endsAt = Date.now() + (g.waitUntil - g.now);
        const tick = function () {
          const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
          if (!left) { stop_(); input.disabled = false; btn.disabled = false; msg.textContent = ''; return; }
          lock_(MSG.WAIT + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
        };
        tick(); timer = global.setInterval(tick, 1000);
      } else if (note) msg.textContent = note;
      if (g.noPassword) { container.querySelector('.ag-form').insertAdjacentHTML('afterend', '<button type="button" class="ag-btn" data-act="retry">' + MSG.CHECK_NOW + '</button>'); }

      container.querySelector('.ag-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const password = digits_(input.value);
        if (!password) { msg.textContent = MSG.EMPTY; input.focus(); return; }
        btn.disabled = true; btn.textContent = MSG.CHECKING; msg.textContent = '';
        let res = null;
        try { res = await api.call('verifyAdminPassword', { password: password }, { token: true }); } catch (err) { res = null; }
        input.value = ''; // لا تبقى الكلمة في الصفحة / the password never stays in the page
        if (!res) { btn.disabled = false; btn.textContent = MSG.CONTINUE; msg.textContent = MSG.FAILED; return; }
        if (res.success && res.state === 'approved') { stop_(); if (o.onApproved) o.onApproved(); return; }
        if (res.success) { pendingStep_(); return; }
        if (res.code === 'ADMIN_RELOGIN' || res.code === 'NOT_ADMIN') { relogin_(res.error); return; }
        const left = res.guard && res.guard.left > 0 && res.code === 'ADMIN_WRONG' ? ' — ' + MSG.LEFT + res.guard.left : '';
        passwordStep_(res.guard, (res.code === 'ADMIN_WRONG' ? MSG.WRONG : res.error || MSG.FAILED) + left);
      });
    }

    // ===== الخطوة 2: بانتظار ✓ من الشيت — step 2: waiting for the sheet ✓ =====
    function pendingStep_() {
      stop_();
      container.innerHTML = '<div class="ag-screen" data-role="admin-guard" data-state="pending">' + steps_(2) +
        '<div class="ag-shield ok">' + SHIELD + '</div><h2 class="ag-title">' + MSG.PENDING_TITLE + '</h2><p class="ag-text">' + MSG.PENDING_TEXT + '</p>' + deviceLine_() +
        '<button type="button" class="ag-btn" data-act="retry">' + MSG.CHECK_NOW + '</button></div>';
    }

    // ===== دخول بالبصمة مطلوب — a fingerprint login is needed =====
    function relogin_(text) {
      stop_();
      container.innerHTML = '<div class="ag-screen" data-role="admin-guard" data-state="relogin"><div class="ag-shield">' + SHIELD + '</div>' +
        '<h2 class="ag-title">' + MSG.TITLE + '</h2><p class="ag-text">' + esc_(text || '') + '</p><a class="ag-btn gold" href="auth.html">' + MSG.RELOGIN + '</a></div>';
    }

    function onClick_(e) {
      const b = e.target.closest('[data-act="retry"]');
      if (!b || b.disabled) return;
      b.disabled = true; b.textContent = MSG.CHECKING;
      if (o.onRetry) o.onRetry();
    }
    container.addEventListener('click', onClick_);

    const code = reply && reply.code;
    if (code === 'ADMIN_PENDING_APPROVAL') pendingStep_();
    else if (code === 'ADMIN_RELOGIN') relogin_(reply.error);
    else passwordStep_(reply && reply.guard);

    return { destroy: function () { stop_(); container.removeEventListener('click', onClick_); } };
  }

  global.SecAdminGuard = { render: render, isGuardReply: isGuardReply, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
