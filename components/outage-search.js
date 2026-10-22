/* ============================================================
 * components/outage-search.js — بحث الأعطال: عدة محطات بالترتيب على الخريطة (A، B، C…) ورابط قوقل ماب بالترتيب
 * ============================================================
 * سلوك V1 وتصميمه بشكليه:
 * - من الخريطة: زر «⚠️ أعطال» ولوحة «محطات العطل — أدخل الأرقام بالترتيب»؛ من 2 إلى 15 محطة.
 * - من الرئيسية: «⚠️ بحث عن حالة عطل (أكثر من محطة)» تحت البحث؛ من 1 إلى 15، ويتطلب الدخول؛ النتيجة تفتح الخريطة على
 *   أول محطة ثم يُرسم الخط (الصفحة تنسّق ذلك عبر onResult).
 * - الرسم: حرف لكل محطة بالترتيب (A…Z ثم AA…) بلون الثيم للتوزيع وبنفسجي للتحويل، خط متقطع ذهبي بينها، والخريطة تتسع
 *   لها (تكبير حتى 17)؛ السطر: «محطات العطل (العدد) بالترتيب A→…» + الأرقام غير الموجودة + «الانتقال بالترتيب على قوقل ماب».
 * - البحث: طلب تأكيد واحد للنسخة قبل كل الأرقام (قرار ح٢)، ثم station-search لكل رقم — لا تحميل ولا مزامنة هنا.
 * V2: الفصل بالمسافة أو الفاصلة (، ,) أو / أو & أو سطر جديد أو أي شرطة («IC2-11995» = محطتان) مع «الفصل الذكي» للأرقام
 *   الحقيقية التي فيها شرطة أو مسافة (انظر parseIds)؛ محطة بلا إحداثيات صالحة تُعدّ «تعذّر إيجادها» بدل كسر الرسم؛ كل نص
 *   يُهرَّب؛ الرابط يُبنى عنصرًا لا HTML من البيانات.
 *
 * Outage search: several stations in order on the map (A, B, C…) and an ordered Google Maps link, in V1's two shapes (map
 * toolbar 2–15, home page 1–15). One copy check for all numbers, then station-search per number — no loading here.
 * V2: split on spaces, commas, /, &, new lines or any dash («IC2-11995» = two stations), with the «smart split» for real ids
 * containing a dash or a space (see parseIds); a station without valid coordinates counts
 * as not found; all text escaped; the link built as an element.
 * ============================================================ */
(function (global) {
  'use strict';

  const SEARCH = global.SecStationSearch, SYNC = global.SecStationsSync, Q = global.SecStationQuery, TI = global.SecTextInput, H = global.SecHtml;
  if (!SEARCH || !SYNC || !Q || !TI || !H) throw new Error('outage-search.js يحتاج station-search وstations-sync وstation-query وtext-input وhtml قبله / missing dependencies');
  const MAX = 15;
  const LINE_COLOR = '#C8A24E', SUB_COLOR = '#8B6DD6';
  const PLACEHOLDER = 'افصل بينها بمسافة أو فاصلة أو / أو & أو - أو سطر جديد';
  const MSG = {
    MAP_MIN: 'أدخل محطتين على الأقل', HOME_MIN: 'أدخل رقم محطة واحدة على الأقل', MAX: 'الحد الأقصى 15 محطة بالمرة الواحدة',
    LOGIN: 'سجّل دخول للاستخدام', SEARCHING: 'جاري البحث عن المحطات...', HOME_SEARCHING: 'جاري البحث...',
    MAP_NONE: 'ما لقيت محطتين صالحتين على الأقل بالأرقام المدخلة', HOME_NONE: 'ما لقيت أي محطة صالحة بالأرقام المدخلة'
  };

  /* الأرقام بالترتيب (قرار محمد، 8 أكتوبر): بحث الأعطال قائمة محطات — الفواصل: «,» «،» «/» «&» والسطر الجديد، وكل شرطة
   * (- ‐ ‑ ‒ – — ―) ملتصقة أو بمسافة، والمسافة. «IC2-11995» = IC2 (تحويل) + 11995 (توزيع)، و«IC2-11995-IC5-12001» = 4 محطات.
   * «الفصل الذكي» (اختيار محمد): مقطع متجاور بشرطة أو مسافة هو نفسه رقم محطة موجود فعلًا في النسخة المحلية ← محطة واحدة،
   * والأطول يفوز — أرقام حقيقية في الشيت: «9550-A»، «ICY-15»، و69 تحويل بمسافة مثل «ICY 1» و«KM 14». بلا نسخة محلية: الشرطة
   * تفصل دائمًا، وكلمة أحرف تليها (بمسافة) كلمة من حرف أو حرفين تُدمجان. البحث العادي عن محطة لا يتغير (قيمة واحدة).
   * The numbers in order (Mohammed's decision): an outage search is a station list — separators are «,» «،» «/» «&», new lines,
   * every dash (glued or spaced) and spaces. «Smart split»: a dash/space-joined span that is itself an existing id in the local
   * copy stays one station, longest first. Without a copy dashes always split. The normal station search is unchanged. */
  const WORD = /[^\s\-‐-―−]+/g, MAX_WORDS = 3;
  let known = null, knownFor = null;
  function knownKeys_() {
    const list = SYNC.stations();
    if (!list) return null;
    if (knownFor !== list) { known = new Set(list.map(function (s) { return TI.stationKey(s.id); })); knownFor = list; }
    return known;
  }
  /* النص الأصلي بين كلمتين بعد التوحيد: الشرطات «-» والمسافات مسافة واحدة — The original span, dashes and spaces unified */
  function span_(chunk, a, b) { return chunk.slice(a.at, b.at + b.w.length).replace(/[‐-―−]/g, '-').replace(/\s+/g, ' '); }
  function mergeWords_(chunk, keys) {
    const words = [];
    let m;
    WORD.lastIndex = 0;
    while ((m = WORD.exec(chunk))) words.push({ w: m[0], at: m.index });
    const out = [];
    for (let i = 0; i < words.length;) {
      let take = 1;
      if (keys) {
        // المقطع المتجاور (بشرطة أو مسافة) رقم محطة موجود فعلًا ← محطة واحدة، والأطول يفوز / an existing id ← one station, longest wins
        for (let n = Math.min(MAX_WORDS, words.length - i); n > 1; n--) {
          if (keys.has(TI.stationKey(span_(chunk, words[i], words[i + n - 1])))) { take = n; break; }
        }
      } else if (i + 1 < words.length && /^\s+$/.test(chunk.slice(words[i].at + words[i].w.length, words[i + 1].at)) &&
                 /^[A-Z]+$/.test(words[i].w) && /^[A-Z0-9]{1,2}$/.test(words[i + 1].w)) take = 2; // بلا نسخة: شكل رموز التحويل / no copy: the substation shape
      out.push(take === 1 ? words[i].w : span_(chunk, words[i], words[i + take - 1]));
      i += take;
    }
    return out;
  }
  function parseIds(raw) {
    const keys = knownKeys_();
    return TI.normalizeCode(String(raw || '')).split(/[,\n\r،\/&]+/)
      .reduce(function (acc, chunk) { return acc.concat(mergeWords_(chunk, keys)); }, []);
  }
  /* حرف الترتيب: A…Z ثم AA… (V1) — The order letter: A…Z then AA… (V1) */
  function letter(i) {
    let s = ''; i++;
    while (i > 0) { i--; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); }
    return s;
  }
  /* رابط قوقل ماب بالترتيب (V1) — The ordered Google Maps link (V1) */
  /* رابط مسار قوقل ماب بلا نقطة بداية ← قوقل يبدأ من «موقعي» أولًا ويُظهر زر الملاحة، ثم المحطات بالترتيب (قرار محمد:
   * حتى المحطة الواحدة — V1 كان يفتحها عرضًا فقط بلا زر ملاحة)
   * A Google Maps directions link without an origin ← Google starts from «my location» and shows the navigation button,
   * then the stations in order (Mohammed's decision: even a single station — V1 opened it view-only) */
  function googleUrl(found) {
    const dest = found[found.length - 1];
    const wps = found.slice(0, -1).map(function (s) { return s.lat + ',' + s.lng; }).join('|');
    return 'https://www.google.com/maps/dir/?api=1&destination=' + dest.lat + ',' + dest.lng + (wps ? '&waypoints=' + encodeURIComponent(wps) : '') + '&travelmode=driving';
  }

  /* تأكيد واحد ثم البحث عن كل رقم ← { found، notFound } — One check, then each number */
  async function resolve(ids) {
    if (SYNC.state().loaded) await SYNC.ensureFreshBounded();
    const results = await Promise.all(ids.map(function (id) { return SEARCH.find(id).catch(function () { return { found: false }; }); }));
    const found = [], notFound = [];
    results.forEach(function (r, i) {
      if (r.found && Q.hasCoordinates(r)) found.push(Object.assign({}, r, { lat: Number(r.lat), lng: Number(r.lng), inputId: ids[i] }));
      else notFound.push(ids[i]);
    });
    return { found: found, notFound: notFound };
  }

  function panelHtml_(title) {
    return (title ? '<div class="outage-panel-title">' + title + '</div>' : '') +
      '<textarea data-role="input" placeholder="' + (title ? '' : 'مثال: 11995 - IC2&#10;') + PLACEHOLDER + '" autocomplete="new-password" data-lpignore="true" data-form-type="other" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>' +
      '<div class="outage-error" data-role="error" role="alert"></div><button type="button" class="outage-submit-btn" data-act="submit">عرض على الخريطة</button>';
  }

  /**
   * mountMap(view, opts) — على الخريطة. opts: { onStart() (تمسح الصفحة أدوات أخرى)، isBlocked() }
   * يُرجع { render(found, notFound)، clear()، search(raw)، destroy() }
   */
  function mountMap(view, opts) {
    const o = opts || {};
    const map = view.map, L = global.L;
    let markers = [], line = null, busy = false;
    view.tools.insertAdjacentHTML('beforeend', '<div class="tb-div" data-outage-div></div><button type="button" class="toolbar-btn" data-outage="toggle" title="محطات العطل (أكثر من محطة)"><span class="tb-icon">⚠️</span><span class="tb-label">أعطال</span></button>');
    view.panels.insertAdjacentHTML('beforeend', '<div class="outage-panel" data-role="outage-panel">' + panelHtml_('محطات العطل — أدخل الأرقام بالترتيب') + '</div>');
    const panel = view.panels.querySelector('[data-role="outage-panel"]'), btn = view.tools.querySelector('[data-outage="toggle"]');
    const input = panel.querySelector('[data-role="input"]'), err = panel.querySelector('[data-role="error"]');
    TI.digits(input);

    function clear() { markers.forEach(function (m) { map.removeLayer(m); }); markers = []; if (line) { map.removeLayer(line); line = null; } }

    function icon_(l, color) {
      return L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="outage-letter" style="background:' + color + '">' + l + '</div>' });
    }
    function render(found, notFound) {
      clear();
      panel.classList.remove('show');
      const teal = global.SecTheme && global.SecTheme.get() === 'light' ? '#1FAE8C' : '#4DD6B5';
      const bounds = [];
      found.forEach(function (s, i) {
        const l = letter(i);
        const m = L.marker([s.lat, s.lng], { icon: icon_(l, s.type === 'تحويل' ? SUB_COLOR : teal) });
        m.bindPopup('<div class="outage-popup"><b>' + l + ') ' + H.esc(s.name || s.id) + '</b><br>رقم: ' + H.esc(s.id) + '</div>');
        m.addTo(map); markers.push(m); bounds.push([s.lat, s.lng]);
      });
      if (!bounds.length) return;
      if (bounds.length > 1) line = L.polyline(bounds, { color: LINE_COLOR, weight: 2, dashArray: '5,5' }).addTo(map);
      const note = notFound && notFound.length ? ' — تعذّر إيجاد: ' + notFound.join('، ') : '';
      const order = found.length > 1 ? 'بالترتيب A→' + letter(found.length - 1) : '';
      view.hint('محطات العطل (' + found.length + ') ' + order + note + ' ');
      const hint = view.panels.parentNode.querySelector('[data-role="hint"]');
      const a = global.document.createElement('a');
      a.className = 'outage-gmaps-link'; a.target = '_blank'; a.rel = 'noopener'; a.href = googleUrl(found); a.textContent = 'الانتقال بالترتيب على قوقل ماب';
      hint.appendChild(a);
      // بعد ظهور التلميح: النقاط داخل المساحة المرئية تحته وفوق البطاقة — after the hint shows: the points in the visible area below it
      map.fitBounds(bounds.length > 1 ? bounds : [bounds[0], bounds[0]], Object.assign(view.fitPadding ? view.fitPadding(44) : { padding: [44, 44] }, { maxZoom: 17 }));
    }

    async function search(raw) {
      if (busy) return null;
      const ids = parseIds(raw !== undefined ? raw : input.value);
      err.textContent = '';
      if (ids.length < 2) { err.textContent = MSG.MAP_MIN; return null; }
      if (ids.length > MAX) { err.textContent = MSG.MAX; return null; }
      if (o.isBlocked && o.isBlocked()) return null;
      if (global.SecUsageLog) global.SecUsageLog.count('outage'); // سجل الاستخدام (22 أكتوبر) / the usage log
      busy = true;
      clear();
      if (o.onStart) { try { o.onStart(); } catch (e) { /* لا شيء / nothing */ } }
      view.hint(MSG.SEARCHING);
      try {
        const r = await resolve(ids);
        if (r.found.length < 2) { err.textContent = MSG.MAP_NONE; view.hideHint(); return r; }
        render(r.found, r.notFound);
        return r;
      } finally { busy = false; }
    }

    function onToolsClick_(e) { if (e.target.closest('[data-outage="toggle"]')) { e.stopPropagation(); panel.classList.toggle('show'); } }
    function onPanelClick_(e) { if (e.target.closest('[data-act="submit"]')) search(); }
    function onDocClick_(e) { if (!btn.contains(e.target) && !panel.contains(e.target)) panel.classList.remove('show'); }
    view.tools.addEventListener('click', onToolsClick_);
    panel.addEventListener('click', onPanelClick_);
    global.document.addEventListener('click', onDocClick_);

    return {
      render: render, clear: clear, search: search,
      destroy: function () {
        clear();
        view.tools.removeEventListener('click', onToolsClick_); panel.removeEventListener('click', onPanelClick_);
        global.document.removeEventListener('click', onDocClick_);
        btn.remove(); panel.remove();
        const div = view.tools.querySelector('[data-outage-div]'); if (div) div.remove();
      }
    };
  }

  /**
   * mountHome(container, opts) — في الرئيسية. opts: { toggle: زر الفتح (بطاقة «بحث عن حالة عطل» في صف الإجراءات)، isLoggedIn()، onResult(found, notFound) }
   * يُرجع { search(raw)، toggle(open?)، isOpen()، destroy() }
   * On the home page. opts.toggle is the opening button (the outage tile in the actions row, Mohammed's design 15 Oct).
   */
  function mountHome(container, opts) {
    const o = opts || {};
    let busy = false;
    container.innerHTML = '<div class="homepage-outage-panel" data-role="panel">' + panelHtml_('') + '</div>';
    const panel = container.querySelector('[data-role="panel"]'), input = container.querySelector('[data-role="input"]'), err = container.querySelector('[data-role="error"]');
    TI.digits(input);

    async function search(raw) {
      if (busy) return null;
      const ids = parseIds(raw !== undefined ? raw : input.value);
      err.textContent = '';
      if (ids.length < 1) { err.textContent = MSG.HOME_MIN; return null; }
      if (ids.length > MAX) { err.textContent = MSG.MAX; return null; }
      const loggedIn = o.isLoggedIn ? o.isLoggedIn() : !!(global.SecSession && global.SecSession.isLoggedIn());
      if (!loggedIn) { err.textContent = MSG.LOGIN; return null; }
      if (global.SecUsageLog) global.SecUsageLog.count('outage'); // سجل الاستخدام (22 أكتوبر) / the usage log
      busy = true;
      err.textContent = MSG.HOME_SEARCHING;
      try {
        const r = await resolve(ids);
        if (r.found.length < 1) { err.textContent = MSG.HOME_NONE; return r; }
        err.textContent = '';
        panel.classList.remove('show');
        if (o.onResult) { try { o.onResult(r.found, r.notFound); } catch (e) { /* الصفحة لا تكسر البحث / never breaks search */ } }
        return r;
      } finally { busy = false; }
    }
    function toggle(open) {
      const willOpen = open === undefined ? !panel.classList.contains('show') : !!open;
      panel.classList.toggle('show', willOpen);
      if (o.toggle) o.toggle.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) global.setTimeout(function () { if (panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50);
      return willOpen;
    }
    function onClick_(e) { if (e.target.closest('[data-act="submit"]')) search(); }
    function onToggle_() { toggle(); }
    container.addEventListener('click', onClick_);
    if (o.toggle) o.toggle.addEventListener('click', onToggle_);
    return {
      search: search, toggle: toggle, isOpen: function () { return panel.classList.contains('show'); },
      destroy: function () { container.removeEventListener('click', onClick_); if (o.toggle) o.toggle.removeEventListener('click', onToggle_); container.innerHTML = ''; }
    };
  }

  global.SecOutageSearch = { mountMap: mountMap, mountHome: mountHome, parseIds: parseIds, letter: letter, googleUrl: googleUrl, resolve: resolve, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
