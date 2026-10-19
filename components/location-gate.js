/* ============================================================
 * components/location-gate.js — شاشة «تحديد موقعك الحالي» قبل البحث في الرئيسية، وقراءة الموقع (طلب محمد 20 أكتوبر)
 * ============================================================
 * - تُعرض عند دخول الموقع فوق الخريطة وتُخفي البحث حتى يُحدَّد الموقع ("إجباري مع مخرج آمن").
 * - «السماح بتحديد الموقع» يطلب الصلاحية بضغطة المستخدم؛ وإن كانت الصلاحية ممنوحة سابقًا يبدأ التحديد تلقائيًا.
 * - مرفوضة أو تعذّر الموقع (داخل مبنى، بلا GPS، انتهاء المهلة) ← رسالة بطريقة التفعيل و«إعادة المحاولة»، مع
 *   «متابعة بدون موقع» دائمًا حتى لا يُحرم أحد من البحث في الميدان.
 * - read() قراءة واحدة تستعملها الصفحة لزر «موقعي» أيضًا.
 * كل النصوص ثابتة من هذا الملف (لا بيانات مستخدم فيها).
 *
 * The «locate yourself» screen before search on home, and the location reading (Mohammed, 20 Oct). Shown on entry over
 * the map, hiding the search until located ("mandatory with a safe exit"). «Allow» asks on the user's tap; an earlier
 * grant starts at once. Denied or failed ← how to enable + «retry», with «continue without location» always available.
 * read() is one reading, also used by the page's «my location» button.
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document;
  const GEO_OPTS = { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 };
  const ICON = '<svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 3 3 10.5l7.5 2.9L13.4 21z"/></svg>';
  const PIN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  const TEXT = {
    title: 'تحديد موقعك الحالي',
    body: 'يحتاج التطبيق إلى معرفة موقعك الحالي لعرض الخريطة حولك والبحث عن المحطات وتوفير المسار من موقعك إلى المحطة.',
    allow: 'السماح بتحديد الموقع',
    retry: 'إعادة المحاولة',
    skip: 'متابعة بدون موقع',
    locating: 'جارٍ تحديد موقعك…',
    denied: 'صلاحية الموقع مرفوضة لهذا الموقع. فعّلها من إعدادات المتصفح (رمز القفل بجانب العنوان ← الموقع ← السماح)، أو من إعدادات الجوال للتطبيق المثبّت، ثم اضغط «إعادة المحاولة».',
    failed: 'تعذّر تحديد موقعك الآن (قد تكون داخل مبنى أو الإشارة ضعيفة). حاول مرة أخرى في مكان مكشوف.',
    noGeo: 'هذا الجهاز لا يدعم تحديد الموقع — تابع بدون موقع.'
  };

  /* قراءة واحدة ← { lat, lng, accuracy } أو رفض بـ { code: 'denied'|'failed'|'nogeo' } — one reading */
  function read() {
    return new Promise(function (resolve, reject) {
      const g = global.navigator.geolocation;
      if (!g) { reject({ code: 'nogeo' }); return; }
      g.getCurrentPosition(function (p) {
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      }, function (err) { reject({ code: err && err.code === 1 ? 'denied' : 'failed' }); }, GEO_OPTS);
    });
  }
  /* هل الصلاحية ممنوحة سابقًا؟ (لا يطلبها) — was it granted before? (never asks) */
  function granted_() {
    const p = global.navigator.permissions;
    if (!p || !p.query) return Promise.resolve(false);
    return p.query({ name: 'geolocation' }).then(function (r) { return r.state === 'granted'; }, function () { return false; });
  }

  /**
   * mount(container, deps) ← { open(), close(), isOpen(), state() }
   * deps: { onLocated(pos), onSkip() }
   */
  function mount(container, deps) {
    const d = deps || {};
    let state = 'closed';
    container.classList.add('location-gate');
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-label', TEXT.title);
    container.hidden = true;
    container.innerHTML =
      '<div class="lg-card">' +
        '<div class="lg-icon">' + ICON + '</div>' +
        '<div class="lg-title">' + TEXT.title + '</div>' +
        '<div class="lg-body">' + TEXT.body + '</div>' +
        '<div class="lg-msg" data-role="msg" role="status" hidden></div>' +
        '<button type="button" class="lg-allow" data-act="allow">' + PIN + '<span data-role="allow-label">' + TEXT.allow + '</span></button>' +
        '<button type="button" class="lg-skip" data-act="skip">' + TEXT.skip + '</button>' +
      '</div>';
    const msg = container.querySelector('[data-role="msg"]'), allow = container.querySelector('[data-act="allow"]');

    function paint_(s) {
      state = s;
      container.dataset.state = s;
      const text = s === 'locating' ? TEXT.locating : s === 'denied' ? TEXT.denied : s === 'failed' ? TEXT.failed : s === 'nogeo' ? TEXT.noGeo : '';
      msg.textContent = text; msg.hidden = !text;
      allow.disabled = s === 'locating';
      allow.hidden = s === 'nogeo';
      allow.querySelector('[data-role="allow-label"]').textContent = s === 'denied' || s === 'failed' ? TEXT.retry : TEXT.allow;
    }
    function locate_() {
      paint_('locating');
      read().then(function (pos) {
        if (state !== 'locating') return; // أُغلقت أثناء الانتظار / closed meanwhile
        close(); if (d.onLocated) d.onLocated(pos);
      }, function (e) { if (state === 'locating') paint_(e.code); });
    }
    function open() {
      container.hidden = false; paint_('ask');
      if (!global.navigator.geolocation) { paint_('nogeo'); return; }
      granted_().then(function (yes) { if (yes && state === 'ask') locate_(); });
    }
    function close() { container.hidden = true; state = 'closed'; container.dataset.state = 'closed'; }

    container.addEventListener('click', function (e) {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      if (t.dataset.act === 'allow') locate_();
      else if (t.dataset.act === 'skip') { close(); if (d.onSkip) d.onSkip(); }
    });

    return { open: open, close: close, isOpen: function () { return state !== 'closed'; }, state: function () { return state; } };
  }

  global.SecLocationGate = { mount: mount, read: read, TEXT: TEXT };
})(typeof window !== 'undefined' ? window : globalThis);
