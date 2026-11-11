/* ============================================================
 * components/station-search-box.js — مربع البحث برقم المحطة + شريط التقدّم + بطاقة «غير موجودة» (واجهة فقط)
 * ============================================================
 * تصميم V1 وسلوكه بشكليه:
 * - «lens» (الرئيسية): عدسة دائرية تتسع عند الضغط لمربع بحث «مثال: 39070 أو ABN»، وتنغلق بالضغط خارجها وهي فارغة.
 * - «bar» (صفحة المحطة): «ابحث عن محطة أخرى...» بأيقونة البحث، ويصغر (compact) بأمر الصفحة.
 * - الحقل: أرقام وأحرف و«-» فقط بحد 24، والأرقام العربية تُحوَّل والأحرف كبيرة (V1)؛ Enter أو الأيقونة ← بحث.
 * - بلا دخول ← «سجّل دخول للحصول على النتيجة — تسجيل الدخول».
 * - أثناء البحث: شريط تقدّم «جاري البحث عن المحطة...» بنسبته (تقديري حتى 92٪ كما في V1)؛ وُجدت ← onFound(المحطة).
 * - غير موجودة ← البطاقة: «المحطة غير موجودة» (أو الصياغة غير القاطعة عند تعذّر التأكد)، رقم المحطة، «هل تريد إضافتها؟»،
 *   «+ إضافة محطة» (onAdd بالرقم) و«🔍 بحث آخر» (يمسح الحقل ويركّز عليه).
 * - التحقق بالخلفية غيّر الإحداثيات ← onUpdated (الصفحة تنقل العلامة/الوجهة).
 * - (11 نوفمبر، تصميم محمد) لوحة بصفّين فوق المربع بأوزان متساوية — العناوين «محطات توزيع | سكينة هوائية | محطات تحويل»
 *   تشرح الصف الثاني «محطة | DB | LBS | ABC» ويتلوّن عنوان الاختيار:
 *   محطة = لوحة الأرقام (الافتراضي دائمًا، بلا حفظ)، DB/LBS = الرقم فقط ← «DB-150»، ABC = لوحة الحروف لرموز التحويل.
 *   زر الحروف خرج من المربع فبقي للإدخال فقط. تظهر اللوحة أثناء البحث فقط، و× يعيدها لـ«محطة».
 * لا منطق تحميل ولا مزامنة هنا: البحث كله في services/station-search.js.
 * V2: كل نص من الاستعلام أو الخادم يُكتب نصًا؛ بحث واحد في أي لحظة لكل مربع؛ مستمعات تُزال بـ destroy.
 *
 * The station-number search box + progress bar + «not found» card (UI only), in V1's two shapes (home lens, station bar).
 * No loading or syncing here: the whole search is services/station-search.js. V2: query/server text set as text; one
 * search at a time per box; listeners removed by destroy.
 * ============================================================ */
(function (global) {
  'use strict';

  const SEARCH = global.SecStationSearch, TI = global.SecTextInput, H = global.SecHtml, Q = global.SecStationQuery;
  if (!SEARCH || !TI || !H || !Q) throw new Error('station-search-box.js يحتاج station-search.js وtext-input.js وhtml.js وstation-query.js قبله / missing dependencies');
  const doc = global.document;
  const MAX_LEN = 24;
  const LENS_SVG = '<svg data-act="search" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
  const BAR_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
  const WARN_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  const NOFILL = ' type="text" inputmode="text" autocomplete="new-password" data-lpignore="true" data-form-type="other" autocorrect="off" autocapitalize="off" spellcheck="false"';
  // أيقونة الضبط في طرف الشريط تفتح أدوات الخريطة (opts.onTools) — the sliders icon at the bar's end opens the map tools
  const TOOLS_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="7" r="2.5" fill="currentColor"/><circle cx="9" cy="17" r="2.5" fill="currentColor"/></svg>';
  // أيقونات لوحة النوع (11 نوفمبر) — the kind panel icons
  const KIND_SVG = {
    dist: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.5 5.2M12 11.5l5.5 5.2"/></svg>',
    sw: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 17h3M19 17h3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M8.5 15.5 17 7"/></svg>',
    sub: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></svg>',
    pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    kb: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>'
  };
  const CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
  const PROGRESS = '<div class="search-progress-track"><div class="search-progress-fill" data-role="fill"></div></div><div class="search-progress-label"><span>جاري البحث عن المحطة...</span><span data-role="pct">0%</span></div>';

  /**
   * mount(container, opts) — opts: { variant: 'lens'|'bar', placeholder (للشريط، اختياري)، isLoggedIn() (افتراضيًا session.js), onFound(station),
   *   onAdd(query), onUpdated(station), closeOnOutside() → bool (للعدسة: الافتراضي true)، onTools() → bool (للشريط: زر الأدوات،
   *   يُرجع هل صارت مفتوحة / the bar's tools button, returns whether they are now open)، onFocus() (لمس المربع / the box touched)،
   *   onClose() (زر × للخروج من وضع البحث / the × to leave search mode) }
   * يُرجع { search(text)، setCompact(on)، clear()، focus()، isOpen()، isSearching()، destroy() }
   */
  function mount(container, opts) {
    const o = Object.assign({ variant: 'lens' }, opts || {});
    const lens = o.variant === 'lens';
    let busy = false, progressTimer = null, mode = 'station'; // station | DB | LBS | abc
    const PANEL = '<div class="ssb-panel" data-role="kinds" role="radiogroup" aria-label="نوع البحث">' +
      '<span class="ssb-head" data-head="station">' + KIND_SVG.dist + '<span>محطات توزيع</span></span>' +
      '<span class="ssb-head ssb-head-sw" data-head="sw">' + KIND_SVG.sw + '<span>سكينة هوائية</span></span>' +
      '<span class="ssb-head" data-head="abc">' + KIND_SVG.sub + '<span>محطات تحويل</span></span>' +
      '<button type="button" class="ssb-mode" data-mode="station" role="radio">' + KIND_SVG.pin + '<span>محطة</span></button>' +
      Q.SWITCH_PREFIXES.map(function (x) { return '<button type="button" class="ssb-mode ssb-sw" data-mode="' + x + '" role="radio" dir="ltr">' + x + '</button>'; }).join('') +
      '<button type="button" class="ssb-mode" data-mode="abc" role="radio" dir="ltr">' + KIND_SVG.kb + '<span>ABC</span></button></div>';
    container.innerHTML = PANEL + (lens
      ? '<div class="search-lens" data-role="box">' + LENS_SVG + '<input data-role="input" placeholder="مثال: 39070 أو ABN" aria-label="رقم المحطة"' + NOFILL + '></div>' +
        '<div class="search-hint" data-role="hint" role="status"></div><div class="search-progress" data-role="progress">' + PROGRESS + '</div>'
      : '<div class="search-and-back-row show"><div class="station-search-bar" data-role="box"><span class="ssb-icon" data-act="search" role="button" aria-label="بحث">' + BAR_SVG + '</span>' +
        '<input data-role="input" placeholder="ابحث عن محطة أخرى..." aria-label="رقم المحطة"' + NOFILL + '>' +
        (o.onClose ? '<button type="button" class="ssb-close" data-act="close" title="إغلاق البحث والرجوع للوضع العادي" aria-label="إغلاق البحث">' + CLOSE_SVG + '</button>' : '') +
        (o.onTools ? '<button type="button" class="ssb-tools" data-act="tools" title="أدوات الخريطة: قريب، مغذي، أعطال، القياس" aria-label="أدوات الخريطة" aria-expanded="false">' + TOOLS_SVG + '</button>' : '') +
        '</div></div>' +
        '<div class="station-search-progress" data-role="progress">' + PROGRESS + '</div><div class="station-search-hint" data-role="hint" role="status"></div>');
    const r = function (n) { return container.querySelector('[data-role="' + n + '"]'); };
    const input = r('input'), box = r('box'), hint = r('hint');
    if (o.placeholder) input.placeholder = String(o.placeholder);
    TI.code(input, MAX_LEN);
    const hintCls = lens ? 'search-hint' : 'station-search-hint';

    // ===== نوع البحث ولوحة المفاتيح (11 نوفمبر): «محطة» بالأرقام افتراضيًا دائمًا (قرار محمد — لا يُحفظ اختيار) =====
    // The search kind and keyboard: «station» on the number pad by default, always (no choice is kept)
    const kinds = r('kinds'), basePlaceholder = input.placeholder;
    const PLACEHOLDER = { abc: 'رمز محطة التحويل — مثال: ABN', sw: 'رقم السكينة فقط — مثال: 150' };
    function prefix_() { return mode === 'station' || mode === 'abc' ? '' : mode; }
    /* اللوحة تظهر أثناء البحث فقط (التركيز، أو نص مكتوب، أو اختيار غير الافتراضي) — the panel shows while searching only */
    function showKinds_() { kinds.classList.toggle('show', doc.activeElement === input || input.value !== '' || mode !== 'station'); }
    function setKind_(m) {
      mode = m || 'station';
      const head = prefix_() ? 'sw' : mode;
      kinds.querySelectorAll('.ssb-mode').forEach(function (b) { const on = b.dataset.mode === mode; b.classList.toggle('active', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      kinds.querySelectorAll('.ssb-head').forEach(function (h) { h.classList.toggle('active', h.dataset.head === head); });
      input.placeholder = prefix_() ? PLACEHOLDER.sw : mode === 'abc' ? PLACEHOLDER.abc : basePlaceholder;
      input.inputMode = mode === 'abc' ? 'text' : 'numeric';
      if (prefix_()) input.value = input.value.replace(/[^0-9]/g, ''); // السكينة: الرقم فقط / a switch: the number only
      setHint_('');
      if (doc.activeElement === input) { input.blur(); input.focus(); } // الآيفون يبدّل اللوحة بإعادة التركيز / the iPhone swaps the pad on refocus
      showKinds_();
    }
    kinds.addEventListener('pointerdown', function (e) { e.preventDefault(); }); // لا يُغلق لوحة المفاتيح / keeps the keyboard open
    input.addEventListener('focus', showKinds_);
    input.addEventListener('blur', function () { global.setTimeout(showKinds_, 0); });
    input.addEventListener('input', function () { if (prefix_()) { const d = input.value.replace(/[^0-9]/g, ''); if (d !== input.value) input.value = d; } });

    function setHint_(text, err) { hint.className = hintCls + (err ? ' err' : ''); hint.textContent = text || ''; }
    setKind_('station');

    // ===== شريط التقدّم (V1) — The progress bar (V1) =====
    function progress_(on) {
      const p = r('progress'), fill = r('fill'), pct = r('pct');
      global.clearInterval(progressTimer);
      if (!p) return null; // أُزيل المربع (destroy) أثناء بحث جارٍ — the box was destroyed during a running search
      if (!on) { p.classList.remove('show'); fill.style.width = '0%'; pct.textContent = '0%'; return null; }
      p.classList.add('show');
      let v = 0; fill.style.width = '0%'; pct.textContent = '0%';
      progressTimer = global.setInterval(function () { v = Math.min(v + Math.random() * 10, 92); fill.style.width = v + '%'; pct.textContent = Math.round(v) + '%'; }, 150);
      return {
        finish: function () { global.clearInterval(progressTimer); fill.style.width = '100%'; pct.textContent = '100%'; global.setTimeout(function () { if (!busy) progress_(false); }, 250); },
        stop: function () { progress_(false); }
      };
    }

    // ===== بطاقة «غير موجودة» (V1) — The «not found» card (V1) =====
    function notFound_(query, unverified) {
      const sw = !!Q.switchParts(query), what = sw ? 'السكينة' : 'المحطة';
      hint.className = hintCls;
      hint.innerHTML = '<div class="not-found-card"><div class="nfc-head">' + WARN_SVG + '<span>' + H.esc(unverified ? SEARCH.unverifiedNote() : what + ' غير موجودة') + '</span></div>' +
        '<div class="nfc-id">رقم ' + what + ': <b>' + H.esc(query) + '</b></div><div class="nfc-question">هل تريد إضافتها؟</div>' +
        '<div class="nfc-actions"><button type="button" class="nfc-btn primary" data-act="add">+ إضافة ' + (sw ? 'سكينة' : 'محطة') + '</button><button type="button" class="nfc-btn" data-act="retry">🔍 بحث آخر</button></div></div>';
      hint.dataset.query = query;
    }

    async function search(text) {
      if (busy) return null;
      const typed = TI.normalizeCode(TI.stripInvisible(text !== undefined ? String(text) : input.value).trim());
      // رمز مختار ← «الرمز-الرقم» بالأرقام فقط؛ وإلا ما كُتب (والسكينة المكتوبة يدويًا تُوحَّد) — a chosen prefix ← «prefix-number»
      const prefix = text === undefined ? prefix_() : '';
      const digits = prefix ? typed.replace(/[^0-9]/g, '') : '';
      const raw = prefix ? (digits ? Q.switchId(prefix, digits) : '') : Q.canonicalId(typed);
      if (!raw) return null;
      const loggedIn = o.isLoggedIn ? o.isLoggedIn() : !!(global.SecSession && global.SecSession.isLoggedIn());
      if (!loggedIn) {
        hint.className = hintCls + ' err';
        hint.innerHTML = 'سجّل دخول للحصول على النتيجة — <a href="auth.html" class="search-login-link">تسجيل الدخول</a>';
        return { needsLogin: true };
      }
      busy = true; box.classList.add('busy'); setHint_('');
      const bar = progress_(true);
      const t0 = global.performance.now(); // مدة البحث تُعرض في بطاقة المحطة (طلب محمد، 16 أكتوبر) / the search time, shown on the station card
      try {
        const res = await SEARCH.find(raw, {
          onChecking: function () { setHint_(SEARCH.MSG.CHECKING); },
          onUpdated: function (st) { if (o.onUpdated) o.onUpdated(st); }
        });
        if (res.found) res.searchMs = Math.max(0, Math.round((global.performance.now() - t0) * 10) / 10);
        // سجل الاستخدام اليومي (22 أكتوبر): البحث ونتيجته، أعداد فقط — the daily usage log: the search and its result, counts only
        const U = global.SecUsageLog;
        if (U) { U.count('search'); U.count(res.found ? (res.source === 'server' ? 'foundServer' : 'foundLocal') : 'notFound'); }
        if (res.found) {
          bar.finish(); setHint_('');
          if (!lens) input.value = '';
          if (o.onFound) { try { o.onFound(res); } catch (e) { /* الصفحة لا تكسر البحث / the page never breaks search */ } }
        } else { bar.stop(); notFound_(raw, !!res.unverified); }
        return res;
      } catch (err) {
        bar.stop(); setHint_(SEARCH.MSG.CONNECTION, true);
        return { error: true };
      } finally { busy = false; box.classList.remove('busy'); }
    }

    function clear() { input.value = ''; setHint_(''); delete hint.dataset.query; showKinds_(); }
    function focus() { if (lens) open_(); input.focus(); }
    function open_() { if (!lens || box.classList.contains('open')) return; box.classList.add('open'); global.setTimeout(function () { box.classList.add('blur-ready'); }, 460); }
    function closeLens_() { box.classList.remove('open', 'blur-ready'); }

    function onClick_(e) {
      const t = e.target.closest('[data-act], [data-role="box"], .ssb-mode');
      if (!t || !container.contains(t)) return;
      const act = t.dataset.act;
      if (act === 'add') { if (o.onAdd) o.onAdd(hint.dataset.query || ''); return; }
      if (act === 'retry') { clear(); input.focus(); return; }
      if (act === 'tools') { t.setAttribute('aria-expanded', o.onTools() ? 'true' : 'false'); return; }
      if (act === 'close') { input.blur(); setKind_('station'); o.onClose(); return; }
      const kind = e.target.closest('.ssb-mode');
      if (kind && kinds.contains(kind)) { setKind_(kind.dataset.mode); input.focus(); return; }
      if (lens && !box.classList.contains('open')) { open_(); input.focus(); return; }
      if (act === 'search') search();
    }
    function onKey_(e) { if (e.key === 'Enter' && e.target === input) { e.preventDefault(); search(); } }
    function onDocClick_(e) {
      if (!lens || box.contains(e.target) || input.value !== '') return;
      if (o.closeOnOutside && !o.closeOnOutside()) return;
      closeLens_();
    }

    container.addEventListener('click', onClick_);
    container.addEventListener('keydown', onKey_);
    // لمس المربع (أو التركيز عليه بلوحة المفاتيح) يُبلغ الصفحة — touching the box (or keyboard focus) tells the page
    // بعد التركيز فقط لا عند اللمس (22 أكتوبر): تغيّر الصفحة قبل رفع الإصبع (زر × يظهر فيضيق الحقل) جعل الآيفون لا يركّز الحقل
    // ولا يُظهر لوحة المفاتيح إلا بلمسة ثانية — only after focus, not on touch: the layout changing before the finger lifts
    // (the × appears and the field narrows) made the iPhone skip focusing the field, so the keyboard needed a second tap
    if (o.onFocus) ['focus', 'click'].forEach(function (t) { input.addEventListener(t, function () { o.onFocus(); }); });
    doc.addEventListener('click', onDocClick_);

    return {
      search: search, clear: clear, focus: focus, input: input,
      setCompact: function (on) { if (!lens) box.classList.toggle('compact', !!on); },
      isOpen: function () { return !lens || box.classList.contains('open'); },
      isSearching: function () { return busy; },
      destroy: function () {
        global.clearInterval(progressTimer);
        container.removeEventListener('click', onClick_); container.removeEventListener('keydown', onKey_);
        doc.removeEventListener('click', onDocClick_);
        container.innerHTML = '';
      }
    };
  }

  global.SecStationSearchBox = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
