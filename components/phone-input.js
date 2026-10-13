/* ============================================================
 * components/phone-input.js — حقل الجوال السعودي: 🇸🇦 +966 ثابت + 9 أرقام بالضبط
 * ============================================================
 * تصميم V1 (مربع موحّد: مفتاح الدولة + خط فاصل + الرقم، وعنوان عائم) بقرار محمد: السعودية فقط بلا قائمة دول
 * (الموقع خاص بالسعودية وجدة تحديدًا).
 * - الأرقام العربية تُحوَّل لإنجليزية فورًا، وأي رمز غير رقم يُحذف، والصفر البادئ يُحذف (عادة كتابة 05…) — V1.
 * - المقبول 9 أرقام بالضبط بعد +966 (الخادم يطابق الجوال بآخر 9 أرقام، فـ8 أرقام كانت تُقبل في V1 ولا تطابق أحدًا —
 *   جزء من خطأ V1 رقم 11). الحقل لا يقبل أكثر من 9.
 * - آخر جوال مستخدم في هذا الجهاز يُقترح تلقائيًا (V1) إن كان سعوديًا.
 *
 * The Saudi phone field: 🇸🇦 +966 fixed + exactly 9 digits. V1's design (unified box, floating label) per Mohammed's
 * decision: Saudi Arabia only. Arabic digits converted, non-digits and a leading zero removed (V1). Exactly 9 digits
 * after +966 (the server matches the last 9 digits, so V1's 8-digit numbers matched no one — part of V1 bug 11). The
 * last phone used on this device is suggested (V1) if Saudi.
 * ============================================================ */
(function (global) {
  'use strict';

  const TI = global.SecTextInput;
  if (!TI) throw new Error('phone-input.js يحتاج utils/text-input.js قبله / needs utils/text-input.js first');
  const CODE = '+966', FLAG = '🇸🇦', DIGITS = 9;
  const MSG_INVALID = 'الرجاء إدخال رقم جوال صحيح (9 أرقام بعد +966)';

  /* الأرقام فقط بلا مفتاح الدولة ولا صفر بادئ وبحد 9 — لصق «+966 55…» أو «00966…» يحذف المفتاح أولًا (الرقم المحلي
   * يبدأ بـ5 لا بـ966) — Digits only, no country code nor leading zero, at most 9; a pasted «+966…» drops the code first */
  function clean(raw) {
    let d = TI.normalizeDigits(raw).replace(/\D/g, '').replace(/^00/, '');
    if (d.length > DIGITS && d.indexOf('966') === 0) d = d.slice(3);
    return d.replace(/^0+/, '').slice(0, DIGITS);
  }
  function isValidDigits(d) { return new RegExp('^\\d{' + DIGITS + '}$').test(d); }

  /**
   * mount(container, opts) — opts: { label ('رقم الجوال'), prefill (الافتراضي: آخر جوال محفوظ في الجهاز) }
   * يُرجع { value() ← '+966XXXXXXXXX' أو ''، digits()، isValid()، set(phone)، focus()، setDisabled(bool)، input }
   */
  function mount(container, opts) {
    const o = opts || {};
    container.classList.add('field', 'floating');
    container.innerHTML = '<div class="phone-unified"><div class="phone-prefix" aria-label="مفتاح الدولة: السعودية +966">' +
      '<span aria-hidden="true">' + FLAG + '</span><span class="country-code">' + CODE + '</span></div>' +
      '<div class="phone-divider"></div>' +
      '<input type="text" inputmode="numeric" class="phone-input-unified" placeholder=" " autocomplete="tel-national" maxlength="12" aria-describedby="">' +
      '<label class="phone-label"></label></div>';
    const box = container.querySelector('.phone-unified'), input = container.querySelector('input'), label = container.querySelector('label');
    const id = 'phone-' + Math.random().toString(36).slice(2, 8);
    input.id = id; label.htmlFor = id; label.textContent = o.label || 'رقم الجوال';

    function sync_() { box.classList.toggle('filled', input.value.length > 0); }
    input.addEventListener('input', function () {
      const v = clean(input.value);
      if (v !== input.value) input.value = v;
      sync_();
    });
    input.addEventListener('focus', function () { box.classList.add('focused'); });
    input.addEventListener('blur', function () { box.classList.remove('focused'); });

    function set(phone) {
      const s = String(phone || '');
      input.value = clean(s.indexOf(CODE) === 0 ? s.slice(CODE.length) : s);
      sync_();
    }
    // اقتراح آخر جوال مستخدم (V1) — suggest the last phone used (V1)
    const saved = o.prefill !== undefined ? o.prefill : (global.SecSession ? global.SecSession.getSavedPhone() : '');
    if (saved && String(saved).indexOf(CODE) === 0) set(saved);

    return {
      input: input,
      digits: function () { return clean(input.value); },
      isValid: function () { return isValidDigits(clean(input.value)); },
      value: function () { const d = clean(input.value); return isValidDigits(d) ? CODE + d : ''; },
      set: set,
      focus: function () { input.focus(); },
      setDisabled: function (on) { input.disabled = !!on; box.classList.toggle('field-disabled', !!on); }
    };
  }

  global.SecPhoneInput = { mount: mount, clean: clean, CODE: CODE, DIGITS: DIGITS, MSG_INVALID: MSG_INVALID };
})(typeof window !== 'undefined' ? window : globalThis);
