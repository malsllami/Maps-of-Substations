/* ============================================================
 * services/load-guard.js — حارس خلط النسختين: إعادة تحميل واحدة حين تجتمع صفحة وملف من نسختين مختلفتين
 * ============================================================
 * - عامل الخدمة الجديد (21 أكتوبر) يقدّم كل ملفات التحميل من نسخة واحدة، لكن الأجهزة التي لم تحدّث بعد ما زالت تخلط الملفات
 *   مع شبكة متقطعة (سجل 22 أكتوبر: home.js جديد مع صفحة قديمة، والعكس)، فتتوقف الرئيسية.
 * - هذا الحارس في الصفحة الجديدة: إن لم يبدأ home.js بعد التحميل (ملف قديم معطوب) ← إعادة تحميل واحدة، وتطبيق التحديث
 *   المنتظر إن وُجد. وhome.js الجديد يتحقق بنفسه من عناصر الصفحة (recover أدناه، أو احتياطه إن كانت الصفحة قديمة بلا الحارس).
 * - مرة واحدة فقط في الجلسة (sessionStorage) فلا تكرار؛ ولا يمس أي بيانات.
 *
 * The mixed-versions guard: one reload when a page and a file from two versions meet. The new service worker (21 Oct)
 * serves every file of a load from one version, but devices that haven't updated still mix files on a flaky network (22 Oct
 * log: a new home.js with an old page, and the reverse), stopping the home page. This guard lives in the new page: if home.js
 * didn't start after the load (a broken old file) ← one reload, applying the waiting update if any. The new home.js checks the
 * page's elements itself. Once per session only (sessionStorage), so no loop; it touches no data.
 * ============================================================ */
(function (global) {
  'use strict';

  const KEY = ((global.SEC2_CONFIG && global.SEC2_CONFIG.STORAGE_PREFIX) || 'sec2-') + 'load-guard';
  const START_WAIT_MS = 2500; // مهلة بدء home.js بعد اكتمال التحميل / time for home.js to start after the load

  /**
   * recover(reason) — إعادة تحميل واحدة في الجلسة (أو تطبيق التحديث المنتظر)؛ يُرجع true إن بدأها
   * one reload per session (or applying the waiting update); returns true if it started one
   */
  function recover(reason) {
    try {
      if (global.sessionStorage.getItem(KEY)) return false; // حدث مرة في هذه الجلسة ← لا تكرار / already once this session
      global.sessionStorage.setItem(KEY, String(reason || '1'));
    } catch (e) { return false; } // تخزين محظور ← لا إعادة (حتى لا تتكرر بلا حد) / storage blocked ← no reload (never loops)
    const pwa = global.SecPWA;
    if (pwa && pwa.state && pwa.state().status === 'update-ready' && pwa.applyUpdate && pwa.applyUpdate()) return true;
    global.location.reload();
    return true;
  }

  /* ===== (10 نوفمبر، خطة محمد) حقائق تحميل كل ملف — Per-file loading facts =====
   * سجل 9 نوفمبر: «SecMoreMenu is not defined» على Android بتطبيق مثبّت وشبكة 3g — المكوّن غاب عند استعماله. هذا الملف أول ما
   * يُحمَّل، فيلتقط من البداية (مرحلة الالتقاط) لكل ملف: هل فشل وصوله (حدث error على عنصر <script>)، أو وصل ورمى أثناء التنفيذ.
   * ولا يستنتج «شبكة»: يسجّل الحقائق فقط (رمز الرد، وهل جاء عبر عامل الخدمة أو الذاكرة، والحجم المنقول) من «توقيت الموارد».
   * Captured from the start for every file: did it fail to arrive (an error event on the <script>), or arrive and throw while
   * running. No «network» conclusion: only the facts (status, via the service worker or cache, bytes) from resource timing. */
  const failedScripts = {}, execErrors = {};
  function pathOf_(url) {
    try { const u = new URL(url, global.location.href), base = new URL('.', global.location.href).pathname; return decodeURIComponent(u.pathname.indexOf(base) === 0 ? u.pathname.slice(base.length) : u.pathname); } catch (e) { return String(url || ''); }
  }
  global.addEventListener('error', function (ev) {
    const t = ev && ev.target;
    if (t && t.tagName === 'SCRIPT' && t.src) { failedScripts[pathOf_(t.src)] = true; return; } // لم يصل / didn't arrive
    if (ev && ev.message && ev.filename) execErrors[pathOf_(ev.filename)] = String(ev.message).slice(0, 160); // وصل ورمى / arrived and threw
  }, true);

  /* حقائق ملف من «توقيت الموارد» إن توفرت — a file's facts from resource timing, when available */
  function timingOf_(file) {
    try {
      const url = new URL(file, global.location.href).href;
      const e = (global.performance.getEntriesByName(url) || []).slice(-1)[0];
      if (!e) return null;
      return {
        status: e.responseStatus || 0,                                    // 0 = غير متاح في هذا المتصفح / unavailable in this browser
        via: e.workerStart > 0 ? 'عبر عامل الخدمة' : (e.deliveryType === 'cache' ? 'ذاكرة المتصفح' : 'الشبكة مباشرة'),
        bytes: e.transferSize
      };
    } catch (e) { return null; }
  }

  /* ما ينقص من مكوّنات الصفحة: [اسم المكوّن، ملفه] ← [{ name, file, state, facts }]
   * state: 'لم يصل الملف' | 'وصل ورمى خطأ' | 'وصل بلا خطأ ولم يعرّف المكوّن' | 'لم يُعرف مصير الملف' */
  function missingModules(required) {
    return required.filter(function (r) { return !global[r[0]]; }).map(function (r) {
      const file = r[1], tm = timingOf_(file);
      let state = 'لم يُعرف مصير الملف';
      if (failedScripts[file]) state = 'لم يصل الملف';
      else if (execErrors[file]) state = 'وصل ورمى خطأ';
      else if (tm && (!tm.status || tm.status < 400)) state = 'وصل بلا خطأ ولم يعرّف المكوّن';
      return { name: r[0], file: file, state: state, timing: tm, execError: execErrors[file] || '' };
    });
  }

  /* تسجيل سطر لكل ناقص: عبر SecConnection إن وُجد، وإلا مباشرة في طابور الأخطاء (يُرسل في التحميل التالي)
   * One row per missing module: via SecConnection if present, else straight into the error queue (sent on the next load) */
  function reportMissing_(list, attempt) {
    const controlled = !!(global.navigator.serviceWorker && global.navigator.serviceWorker.controller);
    list.forEach(function (m) {
      const t = m.timing;
      const details = 'المكوّن: ' + m.name + ' | الملف: ' + m.file + ' | الحالة: ' + m.state +
        ' | حدث فشل التحميل: ' + (failedScripts[m.file] ? 'نعم' : 'لا') + (m.execError ? ' | خطأ التنفيذ: ' + m.execError : '') +
        ' | عامل الخدمة يتحكم بالصفحة: ' + (controlled ? 'نعم' : 'لا') +
        (t ? ' | رمز الرد: ' + (t.status || 'غير متاح') + ' | المصدر: ' + t.via + ' | المنقول: ' + t.bytes + ' بايت' : ' | توقيت الموارد: لا سجل للملف') +
        ' | المحاولة: ' + attempt;
      const message = m.state + ': ' + m.file;
      const meta = { action: 'تحميل الصفحة', failKind: m.state, file: m.file, outcome: attempt === 'الأولى' ? 'إعادة تحميل واحدة' : 'رسالة للمستخدم' };
      if (global.SecConnection && global.SecConnection.reportEvent) { global.SecConnection.reportEvent('client/load', message, details, meta); return; }
      try { // ملف الاتصال نفسه ناقص ← نفس شكل الطابور / the connection file itself is missing ← the same queue shape
        const qKey = (global.SEC2_CONFIG && global.SEC2_CONFIG.STORAGE_KEYS.PENDING_ERRORS) || 'sec2-pending-errors';
        const q = JSON.parse(global.localStorage.getItem(qKey) || '[]');
        q.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), source: 'client/load', message: message,
          details: details + ' | الصفحة: ' + (global.location.pathname.split('/').pop() || 'index.html'), meta: meta });
        global.localStorage.setItem(qKey, JSON.stringify(q.slice(-50)));
      } catch (e) { /* تخزين محظور / storage blocked */ }
    });
  }

  /* رسالة «تحقق من الاتصال» بعد فشل الإعادة الواحدة — بلا إعادة أخرى تلقائية، وزر يدوي فقط
   * The «check your connection» message after the one reload failed — no further automatic reload, a manual button only */
  function showLoadFailure_() {
    const d = global.document;
    if (!d.body || d.getElementById('loadFailNote')) return;
    const box = d.createElement('div');
    box.id = 'loadFailNote'; box.setAttribute('role', 'alert'); box.dir = 'rtl';
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;' +
      'background:var(--bg,#07111F);color:var(--text-primary,#EEF4FA);font-family:inherit;text-align:center';
    const card = d.createElement('div');
    card.style.cssText = 'max-width:360px;width:100%;padding:22px 18px;border-radius:var(--radius-lg,18px);background:var(--bg-card,#0C1B30);border:1px solid var(--border-strong,rgba(150,185,225,0.32))';
    const title = d.createElement('div'); title.textContent = 'تعذّر تحميل جزء من التطبيق';
    title.style.cssText = 'font-weight:700;font-size:17px;margin-bottom:8px';
    const text = d.createElement('div'); text.textContent = 'تحقق من الاتصال بالإنترنت، ثم أعد فتح التطبيق.';
    text.style.cssText = 'font-size:14px;color:var(--text-secondary,#C3D2E2);margin-bottom:16px;line-height:1.7';
    const btn = d.createElement('button'); btn.type = 'button'; btn.textContent = 'إعادة المحاولة';
    btn.style.cssText = 'border:0;border-radius:var(--radius,14px);padding:11px 22px;font:inherit;font-weight:700;background:var(--teal,#1FAE8C);color:#fff;cursor:pointer';
    btn.addEventListener('click', function () { global.location.reload(); }); // بطلب المستخدم فقط / on the user's request only
    card.appendChild(title); card.appendChild(text); card.appendChild(btn); box.appendChild(card); d.body.appendChild(box);
  }

  /* التسلسل المعتمد: ناقص ← تسجيل ← إعادة واحدة؛ بعدها ما زال ناقصًا ← تسجيل ← رسالة (بلا إعادة أخرى)
   * The approved flow: missing ← log ← one reload; still missing afterwards ← log ← a message (no further reload) */
  function handleMissing(list) {
    let first = true;
    try { first = !global.sessionStorage.getItem(KEY); } catch (e) { first = false; } // تخزين محظور ← لا إعادة / storage blocked ← no reload
    reportMissing_(list, first ? 'الأولى' : 'بعد الإعادة');
    if (first && recover('missing:' + list.map(function (m) { return m.name; }).join(','))) return;
    showLoadFailure_();
  }

  // الرئيسية: home.js لم يبدأ بعد اكتمال التحميل ← ملف قديم أو معطوب — home: home.js didn't start after the load
  // صفحة الدخول (سجل 2 نوفمبر): نموذج الدخول لم يُركَّب ← ملف قديم أوقفه — the login page: the form wasn't mounted ← an old file stopped it
  global.addEventListener('load', function () {
    global.setTimeout(function () {
      const d = global.document, body = d.body;
      if (!body) return;
      if (body.classList.contains('home-page') && !global.SecHome) recover('home-not-started');
      else if (body.classList.contains('auth-page') && !global.authForm) recover('auth-not-started');
    }, START_WAIT_MS);
  });

  global.SecLoadGuard = { recover: recover, missingModules: missingModules, handleMissing: handleMissing, KEY: KEY };
})(typeof window !== 'undefined' ? window : globalThis);
