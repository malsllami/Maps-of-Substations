/* ============================================================
 * components/contact-admin.js — مراسلة المدير: نافذة النموذج (واتساب/إيميل) ورابط الاتصال المباشر
 * ============================================================
 * سلوك V1 وتصميمه كما هما (كانا مكررين في 4 صفحات):
 * - الحقول: الاسم، رقم الجوال (يبدأ بـ966)، الإيميل، نوع العضوية، الوردية، الرسالة — والاسم والجوال من الجلسة إن وُجدت.
 * - التحقق بنفس الرسائل وبنفس الترتيب، ثم رسالة موحّدة ← واتساب (wa.me) أو إيميل (mailto) لبيانات المدير من الخادم.
 * - «اتصال بالمدير»: رابط tel لرقم المدير من الخادم (getAdminContactInfo، يُجلب مرة لكل صفحة).
 * V2: قائمتا الورديات وأنواع العضوية من شيت «الإعدادات» (لا قوائم في الكود)؛ إن لم تصل بيانات المدير تُعاد محاولة جلبها
 *   مرة عند الإرسال قبل إظهار الخطأ؛ «?contact=1» يفتح النافذة فعلًا (كان لا يعمل في V1)؛ Esc يغلقها؛ كل نص يُكتب نصًا.
 *
 * Contact the admin: the form window (WhatsApp/email) and the direct call link. V1's behavior and design as is (it was
 * duplicated in 4 pages). V2: the shifts and member types lists come from the «الإعدادات» sheet; missing admin info is
 * fetched once more on send before showing the error; «?contact=1» really opens the window (broken in V1); Esc closes it.
 * ============================================================ */
(function (global) {
  'use strict';

  const TI = global.SecTextInput, LISTS = global.SecSettingsLists;
  if (!TI || !LISTS) throw new Error('contact-admin.js يحتاج text-input.js وsettings-lists.js قبله / needs text-input.js and settings-lists.js first');
  const doc = global.document;
  const MSG = {
    NAME: 'الرجاء إدخال الاسم', PHONE: 'الرجاء إدخال رقم جوال صحيح', SHIFT: 'الرجاء اختيار الوردية', TEXT: 'الرجاء كتابة الرسالة',
    NO_PHONE: 'تعذّر جلب رقم المدير من الخادم — تأكد من نشر آخر نسخة', NO_EMAIL: 'تعذّر جلب إيميل المدير من الخادم — تأكد من نشر آخر نسخة',
    NO_LISTS: 'تعذّر جلب قائمة الورديات — تحقق من الاتصال وحاول مرة أخرى'
  };
  const SUBJECT = 'رسالة من نظام إحداثيات محطات SEC';
  const CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const WA_SVG = '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.876.508 3.649 1.395 5.163L2 22l4.973-1.372A9.943 9.943 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18.062a8.048 8.048 0 0 1-4.106-1.13l-.294-.176-3.048.84.822-2.99-.192-.306A8.05 8.05 0 0 1 3.938 12c0-4.446 3.616-8.062 8.062-8.062S20.062 7.554 20.062 12 16.446 20.062 12 20.062z"/></svg>';
  const MAIL_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M2 6c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6z" fill="#fff"/><path d="M2 6.5l10 7 10-7" stroke="#EA4335" stroke-width="1.6" fill="none"/><path d="M2 6l8.5 6L2 17.5V6z" fill="#4285F4"/><path d="M22 6l-8.5 6L22 17.5V6z" fill="#34A853"/><path d="M2 6c0-1.1.9-2 2-2h1l7 5.2L19 4h1c1.1 0 2 .9 2 2l-10 7.2L2 6z" fill="#EA4335"/><path d="M2 17.5V6l8.5 6-7 5.5A2 2 0 0 1 2 17.5z" fill="#FBBC05"/></svg>';

  let info = null, infoLoad = null, overlay = null, memberType = '';
  const callLinks = [];

  /* بيانات المدير: مرة لكل صفحة (وتُعاد إن فشلت) — The admin info: once per page (retried if it failed) */
  function loadInfo(force) {
    if (info && !force) return Promise.resolve(info);
    if (infoLoad) return infoLoad;
    infoLoad = global.SecApi.call('getAdminContactInfo').then(function (res) {
      if (res && res.success && (res.phone || res.email)) info = { phone: String(res.phone || ''), email: String(res.email || '') };
      callLinks.forEach(applyCallHref_);
      return info;
    }, function () { return info; }).finally(function () { infoLoad = null; });
    return infoLoad;
  }
  function telHref_() { return info && info.phone ? 'tel:+' + info.phone.replace(/^\+/, '') : '#'; }
  function applyCallHref_(a) { a.setAttribute('href', telHref_()); }

  /* ربط رابط «اتصال بالمدير» (tel) — Bind a «call the admin» link */
  function bindCallLink(a) {
    if (!a) return;
    callLinks.push(a);
    applyCallHref_(a);
    a.addEventListener('click', function (e) {
      if (info && info.phone) return; // الرابط جاهز / the link is ready
      e.preventDefault();
      loadInfo(true).then(function (i) { if (i && i.phone) global.location.href = telHref_(); });
    });
  }

  // ===== النافذة — The window =====
  function field_(label, html) { return '<div class="field"><label>' + label + '</label>' + html + '</div>'; }
  function build_() {
    overlay = doc.createElement('div');
    overlay.className = 'contact-modal-overlay';
    overlay.innerHTML = '<div class="contact-modal-card" role="dialog" aria-modal="true" aria-label="مراسلة المدير">' +
      '<div class="contact-modal-header"><h2>مراسلة المدير</h2><div class="contact-modal-close" data-act="close" role="button" tabindex="0" aria-label="إغلاق نافذة مراسلة المدير">' + CLOSE_SVG + '</div></div>' +
      field_('الاسم', '<input type="text" class="input-base" data-f="name">') +
      field_('رقم الجوال', '<input type="tel" class="input-base" data-f="phone" dir="ltr" style="text-align:left" value="966">') +
      field_('الإيميل', '<input type="email" class="input-base" data-f="email" dir="ltr" style="text-align:left">') +
      field_('نوع العضوية', '<div class="contact-types" data-role="types"></div>') +
      field_('الوردية', '<select class="input-base" data-f="shift" style="cursor:pointer"><option value="">اختر الوردية</option></select>') +
      field_('الرسالة', '<textarea class="input-base contact-textarea" data-f="message"></textarea>') +
      '<div class="error-banner" data-role="error" role="alert"></div>' +
      '<div class="contact-send-row"><button type="button" class="contact-send-btn contact-send-whatsapp" data-act="whatsapp">' + WA_SVG + ' واتساب</button>' +
      '<button type="button" class="contact-send-btn contact-send-email" data-act="email">' + MAIL_SVG + ' إيميل</button></div></div>';
    doc.body.appendChild(overlay);
    ['name', 'phone', 'email', 'message'].forEach(function (n) { TI.digits(f_(n)); });
    overlay.addEventListener('click', onClick_);
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
      else if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.act === 'close') { e.preventDefault(); close(); }
    });
  }
  function f_(n) { return overlay.querySelector('[data-f="' + n + '"]'); }
  function error_(text) { const e = overlay.querySelector('[data-role="error"]'); e.textContent = text || ''; e.classList.toggle('show', !!text); }

  /* القوائم من الإعدادات — The lists from the settings */
  async function fillLists_() {
    const lists = await LISTS.get();
    const types = overlay.querySelector('[data-role="types"]'), select = f_('shift');
    const chosen = select.value;
    types.textContent = ''; select.length = 1;
    if (!lists) return false;
    if (memberType && lists.memberTypes.indexOf(memberType) === -1) memberType = '';
    lists.memberTypes.forEach(function (t, i) {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'contact-type-btn'; b.dataset.type = t; b.textContent = t;
      if ((memberType || lists.memberTypes[0]) === t) { b.classList.add('active'); memberType = t; }
      types.appendChild(b);
    });
    lists.shifts.forEach(function (s) { const o = doc.createElement('option'); o.value = s; o.textContent = s; select.appendChild(o); });
    if (chosen && lists.shifts.indexOf(chosen) !== -1) select.value = chosen;
    return true;
  }

  /* نص الرسالة الموحّد أو null مع رسالة الخطأ (ترتيب V1) — The unified message, or null with the error (V1's order) */
  function message_() {
    const name = f_('name').value.trim(), phone = f_('phone').value.trim(), email = f_('email').value.trim();
    const shift = f_('shift').value, text = f_('message').value.trim();
    error_('');
    if (!name) { error_(MSG.NAME); return null; }
    if (!phone || phone.length < 9) { error_(MSG.PHONE); return null; }
    if (!shift) { error_(f_('shift').length > 1 ? MSG.SHIFT : MSG.NO_LISTS); return null; }
    if (!text) { error_(MSG.TEXT); return null; }
    return SUBJECT + '\n\nالاسم: ' + name + '\nرقم الجوال: ' + phone + '\nالإيميل: ' + (email || '—') + '\nنوع العضوية: ' + memberType + '\nالوردية: ' + shift + '\n\nالرسالة:\n' + text;
  }

  async function send_(kind) {
    const text = message_();
    if (!text) return;
    if (!info || !(kind === 'whatsapp' ? info.phone : info.email)) await loadInfo(true); // محاولة أخرى قبل الخطأ / one more try first
    if (kind === 'whatsapp') {
      if (!info || !info.phone) { error_(MSG.NO_PHONE); return; }
      global.open('https://wa.me/' + info.phone.replace(/^\+/, '').replace(/\D/g, '') + '?text=' + encodeURIComponent(text), '_blank');
    } else {
      if (!info || !info.email) { error_(MSG.NO_EMAIL); return; }
      global.location.href = 'mailto:' + info.email + '?subject=' + encodeURIComponent(SUBJECT) + '&body=' + encodeURIComponent(text);
    }
  }

  function onClick_(e) {
    const t = e.target.closest('[data-act], .contact-type-btn');
    if (!t) return;
    if (t.classList.contains('contact-type-btn')) {
      overlay.querySelectorAll('.contact-type-btn').forEach(function (b) { b.classList.remove('active'); });
      t.classList.add('active'); memberType = t.dataset.type;
    } else if (t.dataset.act === 'close') close();
    else if (t.dataset.act === 'whatsapp' || t.dataset.act === 'email') send_(t.dataset.act);
  }

  /* فتح النافذة (الاسم والجوال من الجلسة إن وُجدت) — Open the window (name and phone from the session if any) */
  function open() {
    if (!overlay) build_();
    const s = global.SecSession ? global.SecSession.read() : null;
    if (s && s.name && !f_('name').value) f_('name').value = s.name;
    if (s && s.phone && (f_('phone').value === '966' || !f_('phone').value)) f_('phone').value = String(s.phone).replace(/^\+/, '');
    error_('');
    overlay.classList.add('show');
    fillLists_();
    loadInfo();
    global.setTimeout(function () { const first = f_(f_('name').value ? 'message' : 'name'); try { first.focus(); } catch (e) { /* لا شيء / nothing */ } }, 0);
  }
  function close() { if (overlay) overlay.classList.remove('show'); }

  /* «?contact=1» في الرابط ← فتح النافذة (إصلاح V1) — «?contact=1» in the link ← open the window (V1 fix) */
  function openFromQuery() {
    if (new URLSearchParams(global.location.search).get('contact') === '1') { open(); return true; }
    return false;
  }

  global.SecContactAdmin = {
    open: open, close: close, isOpen: function () { return !!(overlay && overlay.classList.contains('show')); },
    bindCallLink: bindCallLink, loadInfo: loadInfo, openFromQuery: openFromQuery, MSG: MSG
  };
})(typeof window !== 'undefined' ? window : globalThis);
