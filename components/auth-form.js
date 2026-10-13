/* ============================================================
 * components/auth-form.js — بطاقة الدخول والتسجيل: التبويبان، الدخول بالجوال، عضو جديد، الدخول بالبصمة
 * ============================================================
 * تصميم V1 وسلوكه ورسائله كما هي:
 * - تبويبا «تسجيل الدخول» و«عضو جديد» بمؤشر متحرك، ورابط التبديل أسفل البطاقة.
 * - الدخول برقم الجوال هو الطريقة الرسمية لكل الأعضاء (صلاحية عضو دائمًا، حتى لرقم المدير) — قرار محمد.
 * - «الدخول بالبصمة» خيار مساعد (نصه وأيقونته حسب الجهاز)؛ يمنح صلاحية المدير فقط لرقم المدير. عضو بلا بصمة ← تُفعَّل
 *   له الآن (V1). يظهر في تبويب الدخول فقط.
 * - عضو جديد: الاسم، الإيميل، نوع العضوية، الوردية، القسم («أخرى» ← اذكر القسم)، الجوال؛ بنفس ترتيب التحقق ورسائله.
 *   البصمة اختيارية بعد التسجيل.
 * - زر بشريط تقدّم يمنع الضغط المزدوج ويقفل الحقول؛ «الخادم بطيء حاليًا…» بعد 8 ث؛ «انتهت الجلسة…» عند ?expired=1.
 * - أزرار «اتصال بالمدير» و«مراسلة المدير» في البطاقة (contact-admin).
 * V2: قوائم التسجيل من شيت «الإعدادات» (لا قوائم في الكود)؛ الجوال 🇸🇦 +966 + 9 أرقام (phone-input)؛ الطلبات عبر
 *   api-client والبصمة عبر webauthn-client والجلسة عبر session.js فقط؛ إعادة التسجيل بنفس مفتاح العملية تُرجع نتيجة
 *   التنفيذ الأول من الخادم (فلا حاجة لحيلة V1 «مسجّل مسبقًا ← دخول»)؛ كل نص يُكتب نصًا.
 *
 * The login/registration card. V1's design, behavior and messages. Phone login is the official way for every member
 * (member rights always, even for the admin's number). Fingerprint is an optional helper; admin rights only for the
 * admin's number; a member without one gets it activated now (V1). V2: registration lists from the «الإعدادات» sheet;
 * the phone is 🇸🇦 +966 + 9 digits; requests via api-client, fingerprint via webauthn-client, session via session.js only.
 * ============================================================ */
(function (global) {
  'use strict';

  const API = global.SecApi, SESSION = global.SecSession, WA = global.SecWebAuthn, PHONE = global.SecPhoneInput, LISTS = global.SecSettingsLists, TI = global.SecTextInput;
  if (!API || !SESSION || !WA || !PHONE || !LISTS || !TI) throw new Error('auth-form.js يحتاج api-client وsession وwebauthn-client وphone-input وsettings-lists وtext-input قبله / missing dependencies');
  const doc = global.document;
  const SLOW_NOTICE_MS = 8000;
  const OTHER_DEPT = 'أخرى';
  const MSG = {
    NAME: 'الرجاء إدخال اسم صحيح (٣ أحرف على الأقل)', EMAIL: 'الرجاء إدخال بريد إلكتروني صحيح', SHIFT: 'الرجاء اختيار الوردية',
    DEPT: 'الرجاء اختيار القسم', DEPT_OTHER: 'الرجاء ذكر اسم القسم', LISTS: 'تعذّر جلب قوائم التسجيل — تحقق من الاتصال وحاول مرة أخرى',
    SLOW: 'الخادم بطيء حاليًا، يرجى الانتظار قليلًا…', EXPIRED: 'انتهت الجلسة، سجّل الدخول من جديد',
    LOGIN_FAIL: 'تعذّر تسجيل الدخول', REG_FAIL: 'تعذّر إنشاء الحساب', FP_FAIL: 'تعذّر الدخول بالبصمة', GENERIC: 'حدث خطأ، حاول مرة أخرى'
  };
  const TEXT = {
    login: { title: 'تسجيل الدخول', desc: 'أدخل رقم جوالك المسجل للدخول، أو استخدم البصمة إن كانت مفعّلة', btn: 'دخول برقم الجوال', hint: 'ما عندك حساب؟ ', link: 'سجّل كعضو جديد' },
    register: { title: 'إنشاء حساب جديد', desc: 'سجّل بياناتك — تفعيل البصمة اختياري ومتاح لك لاحقًا', btn: 'إنشاء حساب', hint: 'عندك حساب؟ ', link: 'سجّل الدخول' }
  };
  const S = function (inner) { return '<svg width="46" height="46" viewBox="0 0 100 100" fill="none" stroke-linecap="round">' + inner + '</svg>'; };
  const AUTH_ICONS = { // V1
    fingerprint: S('<path d="M50 28c-13 0-22 9-22 22v8" stroke-width="3.2"/><path d="M50 22c-17 0-29 12-29 28v9" stroke-width="3.2"/><path d="M50 35c-9 0-15 6-15 15v10c0 4 1 7 3 10" stroke-width="3.2"/><path d="M50 42c-5 0-8 3-8 8v9c0 6 2 11 6 15" stroke-width="3.2"/><path d="M50 49c-1.5 0-2 1-2 2v8c0 9 4 16 11 21" stroke-width="3.2"/><path d="M65 47v10c0 12-6 21-16 27" stroke-width="3.2"/><path d="M71 44v12c0 16-9 28-23 35" stroke-width="3.2"/>'),
    face: S('<path d="M20 30V22a6 6 0 016-6h8" stroke-width="3.2"/><path d="M80 30V22a6 6 0 00-6-6h-8" stroke-width="3.2"/><path d="M20 70v8a6 6 0 006 6h8" stroke-width="3.2"/><path d="M80 70v8a6 6 0 01-6 6h-8" stroke-width="3.2"/><circle cx="38" cy="46" r="3" fill="currentColor" stroke="none"/><circle cx="62" cy="46" r="3" fill="currentColor" stroke="none"/><path d="M40 62c4 3 16 3 20 0" stroke-width="3.2"/>'),
    windows: S('<rect x="18" y="18" width="28" height="28" rx="3" stroke-width="3.2"/><rect x="54" y="18" width="28" height="28" rx="3" stroke-width="3.2"/><rect x="18" y="54" width="28" height="28" rx="3" stroke-width="3.2"/><rect x="54" y="54" width="28" height="28" rx="3" stroke-width="3.2"/>')
  };
  const PHONE_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
  const CHAT_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

  function html_(logoSrc) {
    return '<div class="brand" data-act="home" role="button" tabindex="0" aria-label="الرجوع للصفحة الرئيسية"><img class="brand-mark" src="' + logoSrc + '" alt="شعار الشركة السعودية للطاقة"><div class="brand-text">محطات التوزيع — SEC</div></div>' +
      '<div class="contact-admin-row"><a href="#" class="contact-admin-btn" data-act="call" title="اتصال بالمدير">' + PHONE_SVG + ' اتصال بالمدير</a>' +
        '<button type="button" class="contact-admin-btn" data-act="message">' + CHAT_SVG + ' مراسلة المدير</button></div>' +
      '<div class="tabs" role="tablist"><div class="tab-indicator" data-role="indicator"></div>' +
        '<div class="tab active" data-tab="login" role="tab" tabindex="0" aria-selected="true">تسجيل الدخول</div>' +
        '<div class="tab" data-tab="register" role="tab" tabindex="0" aria-selected="false">عضو جديد</div></div>' +
      '<div class="error-banner" data-role="banner" role="alert"></div>' +
      '<div data-role="phone-step"><h2 data-role="title"></h2><p class="desc" data-role="desc"></p>' +
        '<div class="field floating" data-reg hidden><input type="text" class="input-base" data-f="name" placeholder=" " autocomplete="name"><label>الاسم الكامل</label></div>' +
        '<div class="field floating" data-reg hidden><input type="email" class="input-base" data-f="email" placeholder=" " dir="ltr" style="text-align:left" autocomplete="email"><label>الإيميل</label></div>' +
        '<div class="field" data-reg hidden><label>نوع العضوية</label><div class="member-types" data-role="types"></div></div>' +
        '<div class="field" data-reg hidden><label>الوردية</label><select class="input-base" data-f="shift"><option value="">اختر الوردية</option></select></div>' +
        '<div class="field" data-reg hidden><label>القسم</label><select class="input-base" data-f="department"><option value="">اختر القسم</option></select>' +
          '<input type="text" class="input-base" data-f="departmentOther" placeholder="اذكر القسم" hidden style="margin-top:8px"></div>' +
        '<div data-role="phone"></div>' +
        '<button type="button" class="btn-progress" data-act="main"><span class="label"><span class="default-label" data-role="btn-label"></span><span class="pct" data-role="pct" hidden></span><span class="check">✓</span></span><span class="fill" data-role="fill"></span></button>' +
        '<button type="button" class="biometric-btn" data-act="biometric"><span data-role="bio-icon"></span><span data-role="bio-label"></span></button>' +
      '</div>' +
      '<div class="fingerprint-step" data-role="fp-step"><div class="fp-wrap"><div class="fp-spinner" data-role="fp-spinner"></div><div class="fp-icon" data-role="fp-icon"></div></div>' +
        '<p class="fp-progress" data-role="fp-progress"></p><p class="fp-title" data-role="fp-title">تحقق من هويتك</p><p class="fp-sub" data-role="fp-sub">سيستخدم جهازك أفضل وسيلة تحقق متوفرة</p></div>' +
      '<div class="switch-link"><span data-role="hint"></span><a href="#" data-act="switch"></a></div>';
  }

  /**
   * mount(card, opts) — opts: { onSuccess(result) (الافتراضي: الرئيسية بعد 0.7 ث كما في V1)، logoSrc }
   * يُرجع { mode()، setMode(m)، phone، destroy() }
   */
  function mount(card, opts) {
    const o = Object.assign({ logoSrc: 'assets/logo-icon.png' }, opts || {});
    let mode = 'login', busy = false, memberType = '', lists = null;
    card.classList.add('auth-card');
    card.innerHTML = html_(o.logoSrc);
    const r = function (n) { return card.querySelector('[data-role="' + n + '"]'); };
    const f = function (n) { return card.querySelector('[data-f="' + n + '"]'); };
    const phone = PHONE.mount(r('phone'));
    ['name', 'email', 'departmentOther'].forEach(function (n) { TI.digits(f(n)); });
    const label = WA.deviceLabel();
    r('bio-icon').textContent = label.icon; r('bio-label').textContent = label.label;
    if (global.SecContactAdmin) global.SecContactAdmin.bindCallLink(card.querySelector('[data-act="call"]'));

    // ===== الرسائل — Messages =====
    function banner_(text, info) { const b = r('banner'); b.textContent = text || ''; b.classList.toggle('show', !!text); b.classList.toggle('info', !!info && !!text); }

    // ===== التبويبات — Tabs =====
    function moveIndicator_() {
      const t = card.querySelector('.tab[data-tab="' + mode + '"]'), ind = r('indicator');
      ind.style.width = t.offsetWidth + 'px'; ind.style.left = t.offsetLeft + 'px';
    }
    function setMode(m) {
      if (busy || (m !== 'login' && m !== 'register')) return;
      mode = m;
      card.querySelectorAll('.tab').forEach(function (t) { const on = t.dataset.tab === m; t.classList.toggle('active', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
      card.querySelectorAll('[data-reg]').forEach(function (el) { el.hidden = m !== 'register'; });
      const t = TEXT[m];
      r('title').textContent = t.title; r('desc').textContent = t.desc; r('btn-label').textContent = t.btn;
      r('hint').textContent = t.hint; card.querySelector('[data-act="switch"]').textContent = t.link;
      card.querySelector('[data-act="biometric"]').hidden = m !== 'login'; // البصمة لحساب موجود فقط (V1) / fingerprint for an existing account only
      banner_('');
      moveIndicator_();
      if (m === 'register') loadLists_();
    }

    // ===== قوائم التسجيل من الإعدادات — Registration lists from the settings =====
    async function loadLists_() {
      const got = await LISTS.get();
      if (!got) return false;
      lists = got;
      const types = r('types');
      if (!types.childElementCount || types.dataset.sig !== got.memberTypes.join('|')) {
        types.textContent = ''; types.dataset.sig = got.memberTypes.join('|');
        if (got.memberTypes.indexOf(memberType) === -1) memberType = got.memberTypes[0] || '';
        got.memberTypes.forEach(function (t) {
          const b = doc.createElement('button');
          b.type = 'button'; b.className = 'member-type-btn' + (t === memberType ? ' active' : ''); b.dataset.type = t; b.textContent = t;
          types.appendChild(b);
        });
      }
      fill_(f('shift'), got.shifts); fill_(f('department'), got.departments);
      return true;
    }
    function fill_(select, items) {
      const keep = select.value;
      select.length = 1;
      items.forEach(function (v) { const op = doc.createElement('option'); op.value = v; op.textContent = v; select.appendChild(op); });
      if (keep && items.indexOf(keep) !== -1) select.value = keep;
    }

    // ===== زر التقدّم (V1) — The progress button (V1) =====
    function lock_(on) {
      busy = on;
      card.querySelector('[data-act="main"]').disabled = on;
      card.querySelector('[data-act="biometric"]').disabled = on;
      phone.setDisabled(on);
      card.querySelectorAll('[data-reg] input, [data-reg] select, .member-type-btn').forEach(function (el) { el.disabled = on; });
    }
    async function runProgress_(task) {
      const btn = card.querySelector('[data-act="main"]'), pct = r('pct'), fill = r('fill'), lbl = r('btn-label');
      lock_(true); btn.classList.remove('error', 'success'); lbl.hidden = true; pct.hidden = false;
      let p = 0;
      const tick = global.setInterval(function () { p = Math.min(p + Math.random() * 14, 92); fill.style.width = p + '%'; pct.textContent = Math.round(p) + '%'; }, 120);
      const slow = global.setTimeout(function () { banner_(MSG.SLOW, true); }, SLOW_NOTICE_MS);
      try {
        const out = await task();
        global.clearInterval(tick); global.clearTimeout(slow); banner_('');
        fill.style.width = '100%'; pct.textContent = '100%';
        await delay_(250); btn.classList.add('success'); await delay_(500);
        return out;
      } catch (err) {
        global.clearInterval(tick); global.clearTimeout(slow);
        btn.classList.add('error'); fill.style.width = '0%';
        banner_((err && err.message) || MSG.GENERIC);
        throw err;
      } finally {
        lock_(false); btn.classList.remove('error', 'success'); lbl.hidden = false; pct.hidden = true; fill.style.width = '0%';
      }
    }
    function delay_(ms) { return new Promise(function (res) { global.setTimeout(res, ms); }); }

    // ===== التحقق (ترتيب V1) — Validation (V1's order) =====
    function validate_() {
      if (!phone.isValid()) return PHONE.MSG_INVALID;
      if (mode === 'login') return '';
      if (f('name').value.trim().length < 3) return MSG.NAME;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f('email').value.trim())) return MSG.EMAIL;
      if (!lists) return MSG.LISTS;
      if (!f('shift').value) return MSG.SHIFT;
      if (!f('department').value) return MSG.DEPT;
      if (f('department').value === OTHER_DEPT && !f('departmentOther').value.trim()) return MSG.DEPT_OTHER;
      return '';
    }

    function done_(result) { if (o.onSuccess) o.onSuccess(result); else delay_(700).then(function () { global.location.href = 'index.html'; }); }

    async function main_() {
      if (busy) return;
      banner_('');
      if (mode === 'register' && !lists) await loadLists_();
      const invalid = validate_();
      if (invalid) { banner_(invalid); return; }
      const ph = phone.value();
      try {
        const result = await runProgress_(async function () {
          if (mode === 'login') {
            const res = await API.call('loginByPhone', { phone: ph });
            if (!res || !res.success) throw new Error((res && res.error) || MSG.LOGIN_FAIL);
            SESSION.save({ phone: ph, name: res.name, role: res.role, identityToken: res.identityToken });
            return { success: true, role: res.role === 'admin' ? 'admin' : 'member', name: res.name, via: 'phone' };
          }
          const dept = f('department').value === OTHER_DEPT ? f('departmentOther').value.trim() : f('department').value;
          const name = f('name').value.trim();
          const res = await API.call('registerUser', { name: name, email: f('email').value.trim(), phone: ph, memberType: memberType, shift: f('shift').value, department: dept });
          if (!res || !res.success) throw new Error((res && res.error) || MSG.REG_FAIL);
          SESSION.save({ phone: ph, name: name, role: 'member', identityToken: res.identityToken });
          return { success: true, role: 'member', name: name, via: 'register' };
        });
        done_(result);
      } catch (e) { /* الرسالة ظاهرة في الشريط / the message is shown in the banner */ }
    }

    // ===== البصمة — Fingerprint =====
    function fpShow_(on, title) {
      r('phone-step').hidden = on;
      r('fp-step').classList.toggle('show', on);
      if (on) { r('fp-icon').innerHTML = AUTH_ICONS[label.iconType]; r('fp-title').textContent = title || 'تحقق من هويتك'; }
      else { r('fp-icon').classList.remove('verifying'); r('fp-spinner').classList.remove('verifying'); r('fp-progress').textContent = ''; }
    }
    function fpProgress_() {
      const el = r('fp-progress'); let p = 0; el.textContent = '0%';
      const t = global.setInterval(function () { p = Math.min(p + Math.random() * 9, 94); el.textContent = Math.round(p) + '%'; }, 180);
      return { finish: function () { global.clearInterval(t); el.textContent = '100%'; }, stop: function () { global.clearInterval(t); el.textContent = ''; } };
    }
    function onStage_(stage) {
      if (stage !== 'verify') return;
      r('fp-title').textContent = 'جاري التحقق من البصمة...';
      r('fp-icon').classList.add('verifying'); r('fp-spinner').classList.add('verifying');
    }
    async function biometric_() {
      if (busy) return;
      banner_('');
      if (!phone.isValid()) { banner_(PHONE.MSG_INVALID); return; }
      if (!WA.isSupported()) { banner_(WA.MSG.UNSUPPORTED); return; }
      const ph = phone.value();
      lock_(true);
      fpShow_(true, 'تحقق من هويتك');
      let prog = fpProgress_();
      try {
        let res = await WA.login(ph, { onStage: onStage_ });
        if (res.notRegistered) { // عضو بلا بصمة ← تفعيلها الآن (V1) / a member without a fingerprint ← activate now (V1)
          prog.stop();
          r('fp-title').textContent = 'لا توجد بصمة مسجّلة، سيتم تفعيلها الآن';
          prog = fpProgress_();
          res = await WA.register(ph, { displayName: res.name, onStage: onStage_ });
          r('fp-title').textContent = 'تم تسجيل البصمة بنجاح';
        }
        prog.finish();
        lock_(false);
        done_(Object.assign({ via: 'fingerprint' }, res));
      } catch (err) {
        prog.stop();
        lock_(false);
        fpShow_(false);
        banner_((err && err.message) || MSG.FP_FAIL);
      }
    }

    // ===== الأحداث — Events =====
    function onClick_(e) {
      const t = e.target.closest('[data-act], .tab, .member-type-btn');
      if (!t || !card.contains(t)) return;
      if (t.classList.contains('tab')) { setMode(t.dataset.tab); return; }
      if (t.classList.contains('member-type-btn')) {
        if (busy) return;
        card.querySelectorAll('.member-type-btn').forEach(function (b) { b.classList.toggle('active', b === t); });
        memberType = t.dataset.type; return;
      }
      const act = t.dataset.act;
      if (act === 'main') main_();
      else if (act === 'biometric') biometric_();
      else if (act === 'switch') { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login'); }
      else if (act === 'message' && global.SecContactAdmin) global.SecContactAdmin.open();
      else if (act === 'home') global.location.href = 'index.html';
    }
    function onKey_(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target;
      if (t.classList.contains('tab')) { e.preventDefault(); setMode(t.dataset.tab); }
      else if (t.dataset && t.dataset.act === 'home') { e.preventDefault(); global.location.href = 'index.html'; }
    }
    function onChange_(e) { if (e.target === f('department')) f('departmentOther').hidden = f('department').value !== OTHER_DEPT; }
    function onResize_() { moveIndicator_(); }

    card.addEventListener('click', onClick_);
    card.addEventListener('keydown', onKey_);
    card.addEventListener('change', onChange_);
    global.addEventListener('resize', onResize_);
    setMode('login');
    if (new URLSearchParams(global.location.search).get('expired') === '1') banner_(MSG.EXPIRED, true);

    return {
      mode: function () { return mode; }, setMode: setMode, phone: phone,
      destroy: function () {
        WA.abort();
        card.removeEventListener('click', onClick_); card.removeEventListener('keydown', onKey_); card.removeEventListener('change', onChange_);
        global.removeEventListener('resize', onResize_);
        card.innerHTML = '';
      }
    };
  }

  global.SecAuthForm = { mount: mount, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
