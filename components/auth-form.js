/* ============================================================
 * components/auth-form.js — بطاقة الدخول والتسجيل: شاشتا الدخول وإنشاء الحساب، الدخول بالجوال، الدخول بالبصمة
 * ============================================================
 * تصميم محمد (15 أكتوبر): شاشتان منفصلتان على صورة الخلفية ببطاقة زجاجية — «تسجيل الدخول» (الجوال، «تذكرني»، «دخول»،
 *   «أو» ثم دائرة البصمة، «إنشاء حساب جديد») و«إنشاء حساب جديد» (سهم رجوع، الحقول بأيقونات، نوع العضوية والوردية أزرارًا
 *   من الإعدادات، القسم، «إنشاء الحساب»، «تسجيل دخول»، و«اتصال بالمدير» + «مراسلة المدير» في هذه الشاشة فقط).
 *   «تذكرني» = حفظ الجوال في الحقل للمرة القادمة فقط (الجلسة كما هي)؛ مفعّل افتراضيًا. لا كلمة مرور (الدخول بالجوال).
 * سلوك V1 ورسائله كما هي:
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
    login: { title: 'إحداثيات المحطات', desc: 'نظام إدارة واستعراض مواقع محطات الكهرباء', btn: 'دخول', hint: 'ليس لديك حساب؟', link: 'إنشاء حساب جديد' },
    register: { title: 'إنشاء حساب جديد', desc: 'سجّل بياناتك لتفعيل البصمة اختياريًا لاحقًا', btn: 'إنشاء الحساب', hint: 'يوجد لديك حساب؟', link: 'تسجيل دخول' }
  };
  const REMEMBER_KEY = global.SEC2_CONFIG.STORAGE_KEYS.REMEMBER_PHONE;
  /* «تذكرني»: مفعّل افتراضيًا (سلوك V1)؛ '0' = لا يُحفظ الجوال — «remember me»: on by default (V1); '0' = the phone isn't kept */
  function rememberOn_() { try { return global.localStorage.getItem(REMEMBER_KEY) !== '0'; } catch (e) { return true; } }
  function setRemember_(on) { try { global.localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'); } catch (e) { /* تخزين محظور / storage blocked */ } }
  const S = function (inner) { return '<svg width="46" height="46" viewBox="0 0 100 100" fill="none" stroke-linecap="round">' + inner + '</svg>'; };
  const AUTH_ICONS = { // V1
    fingerprint: S('<path d="M50 28c-13 0-22 9-22 22v8" stroke-width="3.2"/><path d="M50 22c-17 0-29 12-29 28v9" stroke-width="3.2"/><path d="M50 35c-9 0-15 6-15 15v10c0 4 1 7 3 10" stroke-width="3.2"/><path d="M50 42c-5 0-8 3-8 8v9c0 6 2 11 6 15" stroke-width="3.2"/><path d="M50 49c-1.5 0-2 1-2 2v8c0 9 4 16 11 21" stroke-width="3.2"/><path d="M65 47v10c0 12-6 21-16 27" stroke-width="3.2"/><path d="M71 44v12c0 16-9 28-23 35" stroke-width="3.2"/>'),
    face: S('<path d="M20 30V22a6 6 0 016-6h8" stroke-width="3.2"/><path d="M80 30V22a6 6 0 00-6-6h-8" stroke-width="3.2"/><path d="M20 70v8a6 6 0 006 6h8" stroke-width="3.2"/><path d="M80 70v8a6 6 0 01-6 6h-8" stroke-width="3.2"/><circle cx="38" cy="46" r="3" fill="currentColor" stroke="none"/><circle cx="62" cy="46" r="3" fill="currentColor" stroke="none"/><path d="M40 62c4 3 16 3 20 0" stroke-width="3.2"/>'),
    windows: S('<rect x="18" y="18" width="28" height="28" rx="3" stroke-width="3.2"/><rect x="54" y="18" width="28" height="28" rx="3" stroke-width="3.2"/><rect x="18" y="54" width="28" height="28" rx="3" stroke-width="3.2"/><rect x="54" y="54" width="28" height="28" rx="3" stroke-width="3.2"/>')
  };

  // أيقونات خطية للحقول والأزرار (تصميم محمد، 15 أكتوبر) — line icons for the fields and buttons (Mohammed's design)
  const I = function (body, size) { return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>'; };
  const ICON = {
    user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    mail: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
    phone: I('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'),
    building: I('<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>'),
    chevDown: I('<path d="M6 9l6 6 6-6"/>', 20),
    chevLeft: I('<path d="M15 6l-6 6 6 6"/>', 24),
    userPlus: I('<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>', 24),
    login: I('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l-5-5 5-5M5 12h11"/>', 20),
    employee: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/></svg>',
    helmet: I('<path d="M4 15a8 8 0 0 1 16 0"/><path d="M2 15h20v3H2zM12 7v4M9 8v3M15 8v3"/><path d="M8 18v2h8v-2"/>')
  };
  const WA_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3z"/><path d="M12 2a10 10 0 0 0-8.6 15.2L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.1c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-3 .8.8-3-.2-.3A8.1 8.1 0 1 1 12 20.1z"/></svg>';
  const LOGIN_SUB = { fingerprint: 'ضع إصبعك على المستشعر', face: 'انظر إلى الكاميرا أو ضع إصبعك على المستشعر', windows: 'استخدم Windows Hello في جهازك' };

  // تصميم محمد (15 أكتوبر): شاشتان منفصلتان على خلفية الصورة — [data-login] للدخول فقط، و[data-reg] للتسجيل فقط
  // Mohammed's design (15 Oct): two separate screens over the photo — [data-login] login only, [data-reg] registration only
  function html_(logoSrc) {
    return '<button type="button" class="auth-back" data-act="back" data-reg hidden aria-label="الرجوع لتسجيل الدخول">' + ICON.chevLeft + '</button>' +
      '<div class="brand" data-act="home" role="button" tabindex="0" aria-label="الرجوع للصفحة الرئيسية"><img class="brand-mark" src="' + logoSrc + '" alt="شعار الشركة السعودية للطاقة — استعراض محطات الكهرباء"></div>' +
      '<div data-role="phone-step"><h1 class="auth-title" data-role="title"></h1><p class="desc" data-role="desc"></p>' +
        '<div class="error-banner" data-role="banner" role="alert"></div>' +
        '<label class="auth-input" data-reg hidden><input type="text" data-f="name" placeholder="الاسم الكامل" aria-label="الاسم الكامل" autocomplete="name"><span class="auth-input-ic">' + ICON.user + '</span></label>' +
        '<label class="auth-input" data-reg hidden><input type="email" data-f="email" placeholder="الإيميل" aria-label="الإيميل" autocomplete="email"><span class="auth-input-ic">' + ICON.mail + '</span></label>' +
        '<div data-role="phone"></div>' +
        '<div class="field" data-reg hidden><div class="auth-label">نوع العضوية</div><div class="member-types" data-role="types"></div></div>' +
        '<div class="field" data-reg hidden><div class="auth-label">الوردية</div><div class="shift-chips" data-role="shifts"></div><input type="hidden" data-f="shift" value=""></div>' +
        '<div class="field" data-reg hidden><div class="auth-label">القسم</div><label class="auth-input auth-select"><span class="auth-input-ic auth-select-ic">' + ICON.building + '</span>' +
          '<select data-f="department" aria-label="القسم"><option value="">اختر القسم</option></select><span class="auth-input-ic">' + ICON.chevDown + '</span></label>' +
          '<label class="auth-input" data-role="dept-other" hidden><input type="text" data-f="departmentOther" placeholder="اذكر القسم" aria-label="اذكر القسم"></label></div>' +
        '<label class="auth-remember" data-login><input type="checkbox" data-f="remember"><span>تذكرني</span></label>' +
        '<button type="button" class="btn-progress" data-act="main"><span class="label"><span class="btn-ic" data-role="btn-ic"></span><span class="default-label" data-role="btn-label"></span><span class="pct" data-role="pct" hidden></span><span class="check">✓</span></span><span class="fill" data-role="fill"></span></button>' +
        '<div class="auth-divider" data-login><span>أو</span></div>' +
        '<button type="button" class="biometric-btn" data-act="biometric" data-login><span class="bio-ring" data-role="bio-icon"></span><b data-role="bio-label"></b><small data-role="bio-sub"></small></button>' +
        '<div class="auth-divider"><span data-role="hint"></span></div>' +
        '<button type="button" class="auth-switch" data-act="switch"><span data-role="switch-ic"></span><span data-role="switch-label"></span></button>' +
        '<div class="contact-admin-row" data-reg hidden><a href="#" class="contact-admin-btn contact-call" data-act="call" title="اتصال بالمدير">' + ICON.phone + ' اتصال بالمدير</a>' +
          '<button type="button" class="contact-admin-btn contact-message" data-act="message">' + WA_ICON + ' مراسلة المدير</button></div>' +
      '</div>' +
      '<div class="fingerprint-step" data-role="fp-step"><div class="fp-wrap"><div class="fp-spinner" data-role="fp-spinner"></div><div class="fp-icon" data-role="fp-icon"></div></div>' +
        '<p class="fp-progress" data-role="fp-progress"></p><p class="fp-title" data-role="fp-title">تحقق من هويتك</p><p class="fp-sub" data-role="fp-sub">سيستخدم جهازك أفضل وسيلة تحقق متوفرة</p></div>';
  }

  /**
   * mount(card, opts) — opts: { onSuccess(result) (الافتراضي: الرئيسية بعد 0.7 ث كما في V1)، logoSrc }
   * يُرجع { mode()، setMode(m)، phone، destroy() }
   */
  function mount(card, opts) {
    const o = Object.assign({ logoSrc: 'assets/logo-light.png' }, opts || {});
    let mode = 'login', busy = false, memberType = '', lists = null;
    card.classList.add('auth-card');
    card.innerHTML = html_(o.logoSrc);
    const r = function (n) { return card.querySelector('[data-role="' + n + '"]'); };
    const f = function (n) { return card.querySelector('[data-f="' + n + '"]'); };
    // «تذكرني» غير مفعّل ← لا يُقترح الجوال المحفوظ — «remember me» off ← no suggested phone
    const remember = rememberOn_();
    f('remember').checked = remember;
    const phone = PHONE.mount(r('phone'), remember ? {} : { prefill: '' });
    r('phone').querySelector('.phone-unified').insertAdjacentHTML('beforeend', '<span class="auth-input-ic phone-ic">' + ICON.phone + '</span>');
    ['name', 'email', 'departmentOther'].forEach(function (n) { TI.digits(f(n)); });
    const label = WA.deviceLabel();
    r('bio-icon').innerHTML = AUTH_ICONS[label.iconType] || AUTH_ICONS.fingerprint;
    r('bio-label').textContent = label.label;
    r('bio-sub').textContent = LOGIN_SUB[label.iconType] || LOGIN_SUB.fingerprint;
    if (global.SecContactAdmin) global.SecContactAdmin.bindCallLink(card.querySelector('[data-act="call"]'));

    // ===== الرسائل — Messages =====
    function banner_(text, info) { const b = r('banner'); b.textContent = text || ''; b.classList.toggle('show', !!text); b.classList.toggle('info', !!info && !!text); }

    // ===== الشاشتان: الدخول والتسجيل — The two screens: login and registration =====
    function setMode(m) {
      if (busy || (m !== 'login' && m !== 'register')) return;
      mode = m;
      card.classList.toggle('mode-register', m === 'register');
      card.querySelectorAll('[data-reg]').forEach(function (el) { el.hidden = m !== 'register'; });
      // البصمة و«تذكرني» لحساب موجود فقط (V1) — fingerprint and «remember me» for an existing account only (V1)
      card.querySelectorAll('[data-login]').forEach(function (el) { el.hidden = m !== 'login'; });
      const t = TEXT[m];
      r('title').textContent = t.title; r('desc').textContent = t.desc; r('btn-label').textContent = t.btn;
      r('btn-ic').innerHTML = m === 'login' ? '' : ICON.userPlus;
      r('hint').textContent = t.hint; r('switch-label').textContent = t.link;
      r('switch-ic').innerHTML = m === 'login' ? ICON.userPlus : ICON.login;
      if (m === 'register') r('dept-other').hidden = f('department').value !== OTHER_DEPT;
      banner_('');
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
        got.memberTypes.forEach(function (t, i) {
          const b = doc.createElement('button');
          b.type = 'button'; b.className = 'member-type-btn' + (t === memberType ? ' active' : ''); b.dataset.type = t;
          b.appendChild(doc.createTextNode(t));
          // أيقونة: الأول (موظف) شخص، وغيره خوذة — أيقونة عرض فقط، والقيمة من الإعدادات / an icon for display only
          b.insertAdjacentHTML('beforeend', '<span class="member-type-ic">' + (i === 0 ? ICON.employee : ICON.helmet) + '</span>');
          types.appendChild(b);
        });
      }
      chips_(got.shifts); fill_(f('department'), got.departments);
      return true;
    }
    /* أزرار الوردية من الإعدادات؛ القيمة في الحقل المخفي data-f="shift" — shift buttons from the settings */
    function chips_(items) {
      const box = r('shifts'), keep = f('shift').value;
      if (box.dataset.sig === items.join('|')) return;
      box.dataset.sig = items.join('|'); box.textContent = '';
      if (items.indexOf(keep) === -1) f('shift').value = '';
      items.forEach(function (s) {
        const b = doc.createElement('button');
        b.type = 'button'; b.className = 'shift-btn' + (s === f('shift').value ? ' active' : ''); b.dataset.shift = s; b.textContent = s;
        box.appendChild(b);
      });
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
      card.querySelectorAll('[data-reg] input, [data-reg] select, .member-type-btn, .shift-btn, [data-act="switch"], [data-f="remember"]').forEach(function (el) { el.disabled = on; });
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

    function done_(result) {
      // «تذكرني» غير مفعّل ← لا يبقى الجوال للمرة القادمة (الجلسة كما هي) — «remember me» off ← the phone isn't kept (the session stays)
      if (!f('remember').checked && SESSION.forgetSavedPhone) SESSION.forgetSavedPhone();
      if (o.onSuccess) o.onSuccess(result); else delay_(700).then(function () { global.location.href = 'index.html'; });
    }

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
      const t = e.target.closest('[data-act], .member-type-btn, .shift-btn');
      if (!t || !card.contains(t)) return;
      if (t.classList.contains('member-type-btn')) {
        if (busy) return;
        card.querySelectorAll('.member-type-btn').forEach(function (b) { b.classList.toggle('active', b === t); });
        memberType = t.dataset.type; return;
      }
      if (t.classList.contains('shift-btn')) {
        if (busy) return;
        card.querySelectorAll('.shift-btn').forEach(function (b) { b.classList.toggle('active', b === t); });
        f('shift').value = t.dataset.shift; return;
      }
      const act = t.dataset.act;
      if (act === 'main') main_();
      else if (act === 'biometric') biometric_();
      else if (act === 'switch') { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login'); }
      else if (act === 'back') setMode('login');
      else if (act === 'message' && global.SecContactAdmin) global.SecContactAdmin.open();
      else if (act === 'home') global.location.href = 'index.html';
    }
    function onKey_(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target;
      if (t.dataset && t.dataset.act === 'home') { e.preventDefault(); global.location.href = 'index.html'; }
    }
    function onChange_(e) {
      if (e.target === f('department')) { r('dept-other').hidden = f('department').value !== OTHER_DEPT; f('departmentOther').hidden = false; }
      else if (e.target === f('remember')) setRemember_(e.target.checked);
    }

    card.addEventListener('click', onClick_);
    card.addEventListener('keydown', onKey_);
    card.addEventListener('change', onChange_);
    setMode('login');
    if (new URLSearchParams(global.location.search).get('expired') === '1') banner_(MSG.EXPIRED, true);

    return {
      mode: function () { return mode; }, setMode: setMode, phone: phone,
      destroy: function () {
        WA.abort();
        card.removeEventListener('click', onClick_); card.removeEventListener('keydown', onKey_); card.removeEventListener('change', onChange_);
        card.innerHTML = '';
      }
    };
  }

  global.SecAuthForm = { mount: mount, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
