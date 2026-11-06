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
    MAP_NONE: 'المحطات غير موجودة', HOME_NONE: 'ما لقيت أي محطة صالحة بالأرقام المدخلة',
    // (6 نوفمبر) الترتيب والملاحة وبطاقة غير الموجودة — order, navigation and the not-found card
    ORDER_NEAR: '↕ حسب الأقرب', ORDER_INPUT: '↕ نفس الترتيب', NAVIGATE: '🧭 ملاحة بالترتيب',
    GOOGLE: 'قوقل ماب بالترتيب', GOOGLE_PART: 'قوقل ماب', MISSING_TITLE: 'محطات غير موجودة'
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
  // (6 نوفمبر) صيغة المسار «dir//أ/ب/…» بدل waypoints: تطبيق قوقل ماب على الجوال كان يُسقط بعض النقاط (ظهرت A وC فقط)،
  // والخانة الأولى الفارغة = «موقعي». وتطبيق الجوال يقبل 5 محطات فقط في الرابط (تجربة محمد)، فالأكثر يُقسَّم روابط متصلة
  // The «dir//a/b/…» path form instead of waypoints: the mobile app dropped some points; the empty first slot = «my location».
  // The mobile app takes only 5 stations per link (Mohammed's trial), so more are split into connected links
  const GOOGLE_MAX_STOPS = 5;
  const pt_ = function (s) { return s.lat + ',' + s.lng; };
  /* origin اختياري: بدونه يبدأ قوقل من «موقعي» — optional origin: without it Google starts from «my location» */
  function googleUrl(found, origin) {
    return 'https://www.google.com/maps/dir/' + (origin ? pt_(origin) : '') + '/' + found.slice(0, GOOGLE_MAX_STOPS).map(pt_).join('/') + '/data=!4m2!4m1!3e0';
  }
  /* روابط كل 5 محطات؛ كل رابط بعد الأول يبدأ من آخر محطة قبله — a link per 5 stations; each after the first starts at the stop before it
   * ← [{ from, to, url }] بأرقام المحطات من 1 / with 1-based stop numbers */
  function googleLinks(stops) {
    const out = [];
    for (let i = 0; i < stops.length; i += GOOGLE_MAX_STOPS) {
      const part = stops.slice(i, i + GOOGLE_MAX_STOPS);
      out.push({ from: i + 1, to: i + part.length, url: googleUrl(part, i ? stops[i - 1] : null) });
    }
    return out;
  }

  /* المسافة بالأمتار بين نقطتين — the distance in metres between two points */
  function distM_(a, b) {
    const R = 6371000, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /* الترتيب حسب الأقرب (محمد 6 نوفمبر): أول محطة مُدخلة تبقى A، ثم الأقرب لآخر محطة في كل خطوة حتى الأبعد
   * Nearest-first order: the first entered station stays A, then the nearest to the last one each step, to the farthest */
  function orderNearest(found) {
    if (found.length < 3) return found.slice();
    const out = [found[0]], rest = found.slice(1);
    while (rest.length) {
      const last = out[out.length - 1];
      let best = 0;
      for (let i = 1; i < rest.length; i++) if (distM_(last, rest[i]) < distM_(last, rest[best])) best = i;
      out.push(rest.splice(best, 1)[0]);
    }
    return out;
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
   * mountMap(view, opts) — على الخريطة. opts: { onStart() (تمسح الصفحة أدوات أخرى)، isBlocked()، onNavigate(stops) (ملاحة بالترتيب) }
   * يُرجع { render(found, notFound)، clear()، search(raw)، destroy() }
   */
  function mountMap(view, opts) {
    const o = opts || {};
    const map = view.map, L = global.L;
    let markers = [], line = null, busy = false;
    view.tools.insertAdjacentHTML('beforeend', '<div class="tb-div" data-outage-div></div><button type="button" class="toolbar-btn" data-outage="toggle" title="محطات العطل (أكثر من محطة)"><span class="tb-icon">🚧</span><span class="tb-label">أعطال</span></button>');
    view.panels.insertAdjacentHTML('beforeend', '<div class="outage-panel" data-role="outage-panel">' + panelHtml_('محطات العطل — أدخل الأرقام بالترتيب') + '</div>');
    const panel = view.panels.querySelector('[data-role="outage-panel"]'), btn = view.tools.querySelector('[data-outage="toggle"]');
    const input = panel.querySelector('[data-role="input"]'), err = panel.querySelector('[data-role="error"]');
    TI.digits(input);

    // آخر نتيجة وترتيبها، لزر الترتيب والملاحة — the last result and its order, for the order button and navigation
    let last = null, nearest = true, shownStops = [];
    function clear() {
      markers.forEach(function (m) { map.removeLayer(m); }); markers = []; if (line) { map.removeLayer(line); line = null; }
      const card = view.panels.querySelector('[data-role="outage-missing"]'); if (card) card.remove();
    }

    /* بطاقة المحطات غير الموجودة (محمد 6 نوفمبر) — the card of stations not found */
    function missingCard_(notFound) {
      if (!notFound || !notFound.length) return;
      const doc = global.document, card = doc.createElement('div');
      card.className = 'outage-missing'; card.dataset.role = 'outage-missing'; card.setAttribute('role', 'alert');
      const x = doc.createElement('button'); x.type = 'button'; x.className = 'outage-missing-x'; x.setAttribute('aria-label', 'إغلاق'); x.textContent = '✕';
      x.addEventListener('click', function () { card.remove(); });
      const t = doc.createElement('b'); t.textContent = MSG.MISSING_TITLE + ' (' + notFound.length + ')';
      const list = doc.createElement('div'); list.className = 'outage-missing-list'; list.textContent = notFound.join('، ');
      card.append(x, t, list);
      view.panels.appendChild(card);
    }

    /* أزرار تحت سطر النتيجة: الترتيب، والملاحة، وقوقل ماب — buttons under the result line: order, navigation, Google Maps */
    function actions_(stops) {
      const doc = global.document, hint = view.panels.parentNode.querySelector('[data-role="hint"]');
      const row = doc.createElement('div'); row.className = 'outage-actions';
      const btn_ = function (text, cls, onClick) { const b = doc.createElement('button'); b.type = 'button'; b.className = 'outage-act ' + cls; b.textContent = text; b.addEventListener('click', onClick); return b; };
      if (last.found.length > 2) row.appendChild(btn_(nearest ? MSG.ORDER_INPUT : MSG.ORDER_NEAR, 'outage-order', function () { nearest = !nearest; render(last.found, last.notFound); }));
      if (o.onNavigate) row.appendChild(btn_(MSG.NAVIGATE, 'outage-nav', function () { o.onNavigate(stops.slice()); }));
      const links = googleLinks(stops);
      links.forEach(function (l) {
        const a = doc.createElement('a');
        a.className = 'outage-gmaps-link'; a.target = '_blank'; a.rel = 'noopener'; a.href = l.url;
        a.textContent = links.length > 1 ? MSG.GOOGLE_PART + ' ' + letter(l.from - 1) + '–' + letter(l.to - 1) : MSG.GOOGLE;
        row.appendChild(a);
      });
      hint.appendChild(row);
    }

    function icon_(l, color) {
      return L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="outage-letter" style="background:' + color + '">' + l + '</div>' });
    }
    function render(found, notFound) {
      clear();
      panel.classList.remove('show');
      if (!last || last.found !== found) { last = { found: found, notFound: notFound }; nearest = true; } // نتيجة جديدة ← حسب الأقرب / a new result ← nearest first
      const stops = nearest ? orderNearest(found) : found.slice();
      shownStops = stops;
      const teal = global.SecTheme && global.SecTheme.get() === 'light' ? '#1FAE8C' : '#4DD6B5';
      const bounds = [];
      stops.forEach(function (s, i) {
        const l = letter(i);
        const m = L.marker([s.lat, s.lng], { icon: icon_(l, s.type === 'تحويل' ? SUB_COLOR : teal) });
        m.bindPopup('<div class="outage-popup"><b>' + l + ') ' + H.esc(s.name || s.id) + '</b><br>رقم: ' + H.esc(s.id) + '</div>');
        m.addTo(map); markers.push(m); bounds.push([s.lat, s.lng]);
      });
      if (!bounds.length) return;
      if (bounds.length > 1) line = L.polyline(bounds, { color: LINE_COLOR, weight: 2, dashArray: '5,5' }).addTo(map);
      const order = stops.length > 1 ? (nearest && stops.length > 2 ? 'حسب الأقرب A→' : 'بالترتيب A→') + letter(stops.length - 1) : '';
      view.hint('محطات العطل (' + stops.length + ') ' + order + ' ');
      actions_(stops);
      missingCard_(notFound);
      // بعد ظهور التلميح: النقاط داخل المساحة المرئية تحته وفوق البطاقة — after the hint shows: the points in the visible area below it
      const fitOpts = Object.assign(view.fitPadding ? view.fitPadding(44) : { padding: [44, 44] }, { maxZoom: 17 }), fitPts = bounds.length > 1 ? bounds : [bounds[0], bounds[0]];
      if (view.fitSafe) view.fitSafe(fitPts, fitOpts); else map.fitBounds(fitPts, fitOpts); // بلا NaN إن ضاقت الخريطة (25 أكتوبر) / no NaN on a short map
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
        // (6 نوفمبر) محطة واحدة موجودة تكفي، والباقي في بطاقة «غير موجودة» — one found station is enough, the rest in the card
        if (r.found.length < 1) { err.textContent = MSG.MAP_NONE + ': ' + r.notFound.join('، '); view.hideHint(); return r; }
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
      stops: function () { return shownStops.slice(); }, // المحطات بترتيبها المعروض / the stations in their shown order
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

  global.SecOutageSearch = { mountMap: mountMap, mountHome: mountHome, parseIds: parseIds, letter: letter, googleUrl: googleUrl, googleLinks: googleLinks, orderNearest: orderNearest, resolve: resolve, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
