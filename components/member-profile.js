/* ============================================================
 * components/member-profile.js — «حسابي»: بطاقة العضو، المساهمات وجدولاها، ونموذج تعديل البيانات
 * ============================================================
 * سلوك V1 (member.html) ونصوصه كما هي:
 * - بطاقة العضو: الأيقونة، الاسم، الجوال، نوع العضوية، «آخر دخول ناجح» (أو «أول دخول»).
 * - «مساهماتك في قاعدة البيانات»: إجمالي/إضافات/تعديلات، ثم «📥 تفاصيل الإضافات» و«✏️ تفاصيل التعديلات» (الأحدث أولًا
 *   كما رتبها الخادم، 50 لكل منهما) و«ما فيه إضافات/تعديلات بعد».
 * - النموذج: الاسم، الجوال (للعرض)، الإيميل، الوردية، القسم («أخرى» ← اذكر القسم)؛ نفس ترتيب التحقق ورسائله؛ زر الحفظ
 *   بشريط تقدّم، و«تم حفظ التعديلات بنجاح»؛ الاسم الجديد يُحفظ في الجلسة.
 * تصميم محمد (15 أكتوبر): بطاقة العضو (الصورة والاسم والجوال والشارة و«آخر تسجيل دخول» في خانة مستقلة)، ثلاث خانات مساهمات
 *   متساوية بأيقونات وألوان ثابتة، والنموذج بعمودين تحت «بيانات الحساب» — نفس المنطق والرسائل.
 * V2: الطلبات من api-client بتذكرة الجلسة (session.js)؛ القوائم من شيت «الإعدادات» (settings-lists) لا من الكود؛
 *   «آخر دخول» ميلادي + هجري ويشمل الدخول بالجوال (إصلاح بند V1 رقم 6 في الخادم)؛ تاريخ كل مساهمة ميلادي + هجري؛
 *   الجداول بالقاعدة الموحّدة (صف أول ثابت ملوّن، توسيط، 12 عريض)؛ كل نص من البيانات يُكتب نصًا؛ بلا إنترنت لا حفظ.
 *
 * «My account»: the member card, contributions and their tables, the profile form. V1's behavior and texts. V2: requests
 * through api-client with the session ticket, lists from the settings sheet, Gregorian + Hijri dates, the unified table
 * style, data set as text, no save offline.
 * ============================================================ */
(function (global) {
  'use strict';

  const API = global.SecApi, S = global.SecSession, D = global.SecDates, TI = global.SecTextInput, LISTS = global.SecSettingsLists;
  if (!API || !S || !D || !TI || !LISTS) throw new Error('member-profile.js يحتاج api-client وsession وdates وtext-input وsettings-lists قبله / missing dependencies');
  const OTHER_DEPT = 'أخرى';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MSG = {
    LOAD_FAIL: 'تعذّر تحميل البيانات', NAME: 'الرجاء إدخال اسم صحيح (٣ أحرف على الأقل)', EMAIL: 'الرجاء إدخال بريد إلكتروني صحيح',
    SHIFT: 'الرجاء اختيار الوردية', DEPT: 'الرجاء اختيار القسم', SAVED: 'تم حفظ التعديلات بنجاح', SAVE_FAIL: 'فشل الحفظ',
    OFFLINE: 'هذه العملية تحتاج إلى اتصال بالإنترنت', LISTS: 'تعذّر جلب قوائم الورديات والأقسام — تحقق من الاتصال',
    FIRST_LOGIN: 'أول دخول', NO_ADDS: 'ما فيه إضافات بعد', NO_EDITS: 'ما فيه تعديلات بعد'
  };

  /* «dd/MM/yyyy» + «HH:mm:ss» من الخادم ← Date (بتوقيت الجهاز) — The server's date + time ← Date */
  function parseDayTime(date, time) {
    const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(date || '').trim());
    if (!d) return null;
    const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(time || '').trim()) || [0, 0, 0, 0];
    const out = new Date(+d[3], +d[2] - 1, +d[1], +t[1], +t[2], +(t[3] || 0));
    return isNaN(out) ? null : out;
  }

  // أيقونات خطية (تصميم محمد، 15 أكتوبر) — line icons (Mohammed's design)
  const SVG = function (body) { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>'; };
  const ICONS = {
    phone: SVG('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'),
    badge: SVG('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>'),
    clock: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    bars: SVG('<path d="M6 20V12M12 20V5M18 20v-9"/>'),
    sigma: SVG('<path d="M18 5H7l6 7-6 7h11"/>'),
    plus: SVG('<path d="M12 5v14M5 12h14"/>'),
    pencil: SVG('<path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>'),
    user: SVG('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>')
  };

  function el_(tag, cls, text) { const e = global.document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /**
   * mount(slots, opts) — slots: { profile, contributions, form } (عناصر). opts: { onNameChange(name) (لتحديث اسم الرأس)،
   *   onLoaded(res)، avatarSrc }
   * يُرجع { load() → Promise<res|null>، save() → Promise<bool>، destroy() }
   */
  function mount(slots, opts) {
    const o = Object.assign({ avatarSrc: 'assets/member-avatar.webp' }, opts || {});

    // ===== بطاقة العضو — The member card =====
    // تصميم محمد (15 أكتوبر): الصورة والاسم والجوال والشارة، و«آخر تسجيل دخول» في خانة مستقلة
    // Mohammed's design (15 Oct): avatar, name, phone and badge, with «last login» in its own box
    slots.profile.innerHTML =
      '<div class="mp-id"><div class="avatar"><img src="' + o.avatarSrc + '" alt="أيقونة العضو"></div>' +
        '<div class="mp-id-text"><h2 data-role="name">...</h2><div class="mp-phone"><span class="mp-ic">' + ICONS.phone + '</span><span data-role="phone">-</span></div>' +
        '<span class="role-badge"><span class="mp-ic">' + ICONS.badge + '</span><span data-role="type"></span></span></div></div>' +
      '<div class="mp-login"><span class="mp-ic">' + ICONS.clock + '</span><div><div class="mp-login-label">آخر تسجيل دخول</div><div class="mp-login-value" data-role="last-login">—</div></div></div>';
    const q = function (root, r) { return root.querySelector('[data-role="' + r + '"]'); };

    // ===== المساهمات — Contributions =====
    slots.contributions.innerHTML =
      '<div class="card" data-role="stats-card" hidden><div class="card-title mp-section-title"><span class="mp-ic">' + ICONS.bars + '</span>مساهماتك في قاعدة البيانات</div><div class="mp-stats">' +
        '<div class="mp-stat mp-stat-total"><span class="mp-stat-ic">' + ICONS.sigma + '</span><div><div class="mp-stat-n" data-role="total">0</div><div class="mp-stat-l">إجمالي</div></div></div>' +
        '<div class="mp-stat mp-stat-adds"><span class="mp-stat-ic">' + ICONS.plus + '</span><div><div class="mp-stat-n" data-role="adds">0</div><div class="mp-stat-l">إضافات</div></div></div>' +
        '<div class="mp-stat mp-stat-edits"><span class="mp-stat-ic">' + ICONS.pencil + '</span><div><div class="mp-stat-n" data-role="edits">0</div><div class="mp-stat-l">تعديلات</div></div></div></div></div>' +
      table_('adds-card', '📥 تفاصيل الإضافات', 'mp-adds') + table_('edits-card', '✏️ تفاصيل التعديلات', 'mp-edits');
    function table_(role, title, cls) {
      return '<div class="card ' + cls + '" data-role="' + role + '" hidden><div class="card-title">' + title + '</div><div class="sec-table-wrap"><table class="sec-table">' +
        '<thead><tr><th>رقم المحطة</th><th>المنطقة</th><th>التاريخ</th><th>الوقت</th></tr></thead><tbody></tbody></table></div></div>';
    }
    function fillTable_(role, list, empty) {
      const card = q(slots.contributions, role), body = card.querySelector('tbody');
      body.textContent = '';
      if (!list || !list.length) {
        const tr = el_('tr'), td = el_('td', 'mp-empty', empty); td.colSpan = 4; tr.appendChild(td); body.appendChild(tr);
      } else {
        list.forEach(function (e) {
          const tr = el_('tr'), when = parseDayTime(e.date, e.time);
          const id = el_('td', 'mono', e.stationId); id.dir = 'ltr';
          const date = el_('td');
          if (when) { date.appendChild(el_('span', '', D.gregorian(when))); date.appendChild(el_('span', 'sub', D.hijri(when))); } else date.textContent = e.date || '—';
          const time = el_('td', 'mono', when ? D.time(when) : (e.time || '—'));
          tr.appendChild(id); tr.appendChild(el_('td', '', e.region || '—')); tr.appendChild(date); tr.appendChild(time);
          body.appendChild(tr);
        });
      }
      card.hidden = false;
    }

    // ===== النموذج — The form =====
    // نموذج بعمودين: الاسم | الجوال، الوردية | الإيميل، ثم القسم (تصميم محمد) — a two-column form (Mohammed's design)
    slots.form.innerHTML =
      '<div class="card-title mp-section-title"><span class="mp-ic">' + ICONS.user + '</span>بيانات الحساب</div>' +
      '<div class="error-banner" data-role="error"></div><div class="success-banner" data-role="success">' + MSG.SAVED + '</div>' +
      '<div class="mp-form-grid">' +
      '<div class="field"><label for="mpName">الاسم الكامل</label><input type="text" class="input-base" id="mpName" data-f="name" dir="auto" autocomplete="name"></div>' +
      '<div class="field"><label for="mpPhone">رقم الجوال</label><input type="text" class="input-base" id="mpPhone" data-f="phone" disabled dir="ltr"></div>' +
      '<div class="field"><label for="mpShift">الوردية</label><select class="input-base" id="mpShift" data-f="shift"><option value="">اختر الوردية</option></select></div>' +
      '<div class="field"><label for="mpEmail">الإيميل</label><input type="email" class="input-base" id="mpEmail" data-f="email" dir="ltr" autocomplete="email"></div>' +
      '<div class="field mp-span"><label for="mpDept">القسم</label><select class="input-base" id="mpDept" data-f="department"><option value="">اختر القسم</option></select>' +
        '<input type="text" class="input-base" data-f="departmentOther" placeholder="اذكر القسم" hidden style="margin-top:8px"></div>' +
      '</div>' +
      '<button type="button" class="btn-progress" data-act="save"><span class="label"><span data-role="save-label">حفظ التعديلات</span><span class="pct" data-role="pct"></span></span><span class="fill" data-role="fill"></span></button>';
    const f = function (n) { return slots.form.querySelector('[data-f="' + n + '"]'); };
    const errEl = q(slots.form, 'error'), okEl = q(slots.form, 'success'), saveBtn = slots.form.querySelector('[data-act="save"]');
    // الأرقام العربية تتحول فورًا (V1) — Arabic digits convert at once (V1)
    ['name', 'email', 'departmentOther'].forEach(function (n) { TI.digits(f(n)); });

    function showError_(m) { errEl.textContent = m; errEl.classList.add('show'); okEl.classList.remove('show'); }
    function hideMsgs_() { errEl.classList.remove('show'); okEl.classList.remove('show'); }

    let lists = null, profile = null, saving = false, alive = true;
    function fillSelect_(sel, items, keep) {
      const first = sel.options[0];
      sel.textContent = ''; sel.appendChild(first);
      items.forEach(function (v) { const op = el_('option', '', v); op.value = v; sel.appendChild(op); });
      if (keep && items.indexOf(keep) !== -1) sel.value = keep;
    }
    async function loadLists_() {
      lists = await LISTS.get();
      if (!lists) { showError_(MSG.LISTS); return; }
      fillSelect_(f('shift'), lists.shifts);
      fillSelect_(f('department'), lists.departments.filter(function (d) { return d !== OTHER_DEPT; }).concat([OTHER_DEPT]));
      if (profile) applyForm_(profile);
    }
    function applyForm_(res) {
      f('name').value = res.name || ''; f('phone').value = res.phone || ''; f('email').value = res.email || '';
      f('shift').value = res.shift || '';
      const known = lists ? lists.departments : [];
      if (res.department && known.indexOf(res.department) === -1) {
        f('department').value = OTHER_DEPT; f('departmentOther').hidden = false; f('departmentOther').value = res.department;
      } else { f('department').value = res.department || ''; f('departmentOther').hidden = true; }
    }

    async function load() {
      let res;
      try { res = await API.call('getMemberProfile', {}, { token: true }); }
      catch (e) { if (alive) showError_(e && e.message ? e.message : MSG.LOAD_FAIL); return null; }
      if (!alive) return null;
      if (S.isTokenInvalid(res)) { S.handleExpired({ action: 'getMemberProfile', message: res.error }); return null; }
      if (!res || !res.success) { showError_((res && res.error) || MSG.LOAD_FAIL); return null; }
      profile = res;
      q(slots.profile, 'name').textContent = res.name || '';
      q(slots.profile, 'phone').textContent = res.phone || '';
      q(slots.profile, 'type').textContent = res.memberType || 'عضو';
      q(slots.profile, 'last-login').textContent = res.lastLogin ? D.dualDateTime(new Date(res.lastLogin)) : MSG.FIRST_LOGIN;
      if (res.stats) {
        q(slots.contributions, 'total').textContent = String(res.stats.total);
        q(slots.contributions, 'adds').textContent = String(res.stats.additions);
        q(slots.contributions, 'edits').textContent = String(res.stats.edits);
        q(slots.contributions, 'stats-card').hidden = false;
      }
      fillTable_('adds-card', res.additionsList, MSG.NO_ADDS);
      fillTable_('edits-card', res.editsList, MSG.NO_EDITS);
      applyForm_(res);
      if (o.onLoaded) { try { o.onLoaded(res); } catch (e) { /* لا شيء / nothing */ } }
      return res;
    }

    function validate_() {
      const name = f('name').value.trim(), email = f('email').value.trim(), shift = f('shift').value;
      const department = f('department').value === OTHER_DEPT ? f('departmentOther').value.trim() : f('department').value;
      if (name.length < 3) return { error: MSG.NAME };
      if (!EMAIL_RE.test(email)) return { error: MSG.EMAIL };
      if (!shift) return { error: MSG.SHIFT };
      if (!department) return { error: MSG.DEPT };
      return { name: name, email: email, shift: shift, department: department };
    }

    async function save() {
      if (saving) return false;
      hideMsgs_();
      const v = validate_();
      if (v.error) { showError_(v.error); return false; }
      if (global.navigator.onLine === false) { showError_(MSG.OFFLINE); return false; }
      saving = true; saveBtn.disabled = true;
      const label = q(saveBtn, 'save-label'), pct = q(saveBtn, 'pct'), fill = q(saveBtn, 'fill');
      label.style.display = 'none'; pct.style.display = 'inline';
      let p = 0;
      const tick = global.setInterval(function () { p = Math.min(p + Math.random() * 15, 92); fill.style.width = p + '%'; pct.textContent = Math.round(p) + '%'; }, 120);
      let ok = false;
      try {
        const res = await API.call('updateMemberProfile', { name: v.name, email: v.email, shift: v.shift, department: v.department }, { token: true });
        if (S.isTokenInvalid(res)) { global.clearInterval(tick); S.handleExpired({ action: 'updateMemberProfile', message: res.error }); return false; }
        global.clearInterval(tick);
        fill.style.width = '100%'; pct.textContent = '100%';
        if (!res || !res.success) throw new Error((res && res.error) || MSG.SAVE_FAIL);
        okEl.classList.add('show');
        S.update({ name: v.name }); // دمج بالجلسة الأحدث (session.js) / merged into the latest session
        q(slots.profile, 'name').textContent = v.name;
        if (profile) Object.assign(profile, v);
        if (o.onNameChange) { try { o.onNameChange(v.name); } catch (e) { /* لا شيء / nothing */ } }
        ok = true;
      } catch (err) {
        global.clearInterval(tick);
        saveBtn.classList.add('error');
        showError_(err && err.message ? err.message : MSG.SAVE_FAIL);
      } finally {
        global.setTimeout(function () {
          saving = false; saveBtn.disabled = false; saveBtn.classList.remove('error');
          label.style.display = 'inline'; pct.style.display = 'none'; fill.style.width = '0%';
        }, 500);
      }
      return ok;
    }

    function onChange_(e) { if (e.target === f('department')) f('departmentOther').hidden = f('department').value !== OTHER_DEPT; }
    function onClick_(e) { if (e.target.closest('[data-act="save"]')) save(); }
    slots.form.addEventListener('change', onChange_);
    slots.form.addEventListener('click', onClick_);
    loadLists_();

    return {
      load: load, save: save,
      destroy: function () { alive = false; slots.form.removeEventListener('change', onChange_); slots.form.removeEventListener('click', onClick_); }
    };
  }

  global.SecMemberProfile = { mount: mount, parseDayTime: parseDayTime, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
