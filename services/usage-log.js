/* ============================================================
 * services/usage-log.js — سجل الاستخدام اليومي في الجهاز: عدّادات تُجمع طوال اليوم وتُرسل بطلب واحد (محمد 22 أكتوبر)
 * ============================================================
 * - أعداد فقط (لا إحداثيات ولا أرقام محطات): مرات الفتح ودقائق الاستخدام، والبحث ونتيجته، والملاحة ودقائقها، وقوقل ماب
 *   والمشاركة، والشاشات والأدوات، والاستخدام بدون إنترنت، والجهاز والمتصفح وطريقة الفتح.
 * - تُحفظ في الجهاز (تعمل بدون إنترنت)، وتُرسل للخادم (logUsage) عند تصغير الموقع أو إغلاقه، وعند الفتح إن بقي شيء.
 *   كل إرسال برقم فريد فلا يتضاعف العدّ إن أُعيد بعد ضياع الرد؛ وبعد النجاح يُطرح المُرسَل وحده (ما زاد أثناء الإرسال يبقى).
 * - للعضو المسجّل فقط. فشل الإرسال لا يُظهر شيئًا للمستخدم ويُعاد لاحقًا.
 * - النقرات تُعدّ من مكان واحد هنا (أزرار البطاقة والأدوات والشريط السفلي)؛ البحث والملاحة يُبلغان count() من مكوّنيهما.
 *
 * The daily usage log on the device: counters gathered all day and sent in one request (Mohammed, 22 Oct). Counts only.
 * Kept on the device (works offline), sent (logUsage) when the site is minimized or closed, and on open if anything is
 * left. Each send has a unique key so a resend never doubles a count; after success only what was sent is subtracted.
 * Signed-in members only. A failed send shows nothing and is retried later. Clicks are counted here in one place;
 * search and navigation report count() from their components.
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document, CONFIG = global.SEC2_CONFIG;
  const KEY = CONFIG.STORAGE_KEYS.USAGE_LOG;
  const COUNTERS = ['opens', 'minutes', 'offline', 'search', 'foundLocal', 'foundServer', 'notFound', 'outage', 'nav', 'navMinutes',
    'google', 'share', 'viewData', 'viewStations', 'viewMore', 'details', 'nearby', 'feeder', 'ruler'];
  // نقرات تُعدّ من مكان واحد: المحدد ← العدّاد — clicks counted in one place: selector ← counter
  const CLICKS = [['[data-act="google"]', 'google'], ['[data-act="share"]', 'share'], ['[data-act="details"]', 'details'],
    ['[data-nearby="nearby"]', 'nearby'], ['[data-nearby="feeder"],[data-act="feeder"]', 'feeder'], ['[data-tool="measure"]', 'ruler'],
    ['[data-tab="data"]', 'viewData'], ['[data-tab="stations"]', 'viewStations'], ['[data-tab="more"]', 'viewMore']];

  function riyadhDay_() {
    // اليوم بتوقيت الرياض (+3 بلا توقيت صيفي) كما في الخادم — the Riyadh day (+3, no DST), as on the server
    return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  }
  function empty_() { const c = {}; COUNTERS.forEach(function (k) { c[k] = 0; }); return c; }
  function load_() {
    try { const s = JSON.parse(global.localStorage.getItem(KEY) || 'null'); if (s && s.days && typeof s.days === 'object') return s; } catch (e) { /* تالف ← جديد / corrupt ← new */ }
    return { days: {}, sec: 0, navSec: 0 };
  }
  function save_(s) { try { global.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* تخزين محظور ← العدّ للجلسة فقط / storage blocked */ } }
  function loggedIn_() { return !!(global.SecSession && global.SecSession.getPhone && global.SecSession.getPhone()); }

  /** count(name, n) — يزيد عدّادًا لليوم — adds to a counter for today */
  function count(name, n) {
    if (COUNTERS.indexOf(name) === -1 || !loggedIn_()) return;
    const s = load_(), day = riyadhDay_();
    s.days[day] = s.days[day] || empty_();
    s.days[day][name] = (s.days[day][name] || 0) + (n == null ? 1 : n);
    save_(s);
  }

  // ===== الوقت: دقائق الاستخدام (الصفحة ظاهرة) ودقائق الملاحة — time: usage minutes (page visible) and navigation minutes =====
  let visibleSince = doc.visibilityState === 'visible' ? Date.now() : 0, navSince = 0;
  function addTime_(field, counter, ms) {
    if (!(ms > 0) || !loggedIn_()) return;
    const s = load_();
    s[field] = (s[field] || 0) + ms / 1000;
    const whole = Math.floor(s[field] / 60);
    if (whole > 0) {
      const day = riyadhDay_();
      s.days[day] = s.days[day] || empty_();
      s.days[day][counter] = (s.days[day][counter] || 0) + whole;
      s[field] -= whole * 60;
    }
    save_(s);
  }
  function settleTime_() {
    const now = Date.now();
    if (visibleSince) { addTime_('sec', 'minutes', now - visibleSince); visibleSince = doc.visibilityState === 'visible' ? now : 0; }
    if (navSince) { addTime_('navSec', 'navMinutes', now - navSince); navSince = now; }
  }
  /** navStart() / navEnd() — من مكوّن الملاحة — from the navigation component */
  function navStart() { count('nav'); navSince = Date.now(); }
  function navEnd() { if (navSince) { addTime_('navSec', 'navMinutes', Date.now() - navSince); navSince = 0; } }

  // ===== الجهاز وطريقة الفتح — the device and how it was opened =====
  function meta_() {
    const ua = global.navigator.userAgent || '';
    const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'آخر';
    const os = (/OS (\d+)[_.](\d+)/.exec(ua) || /Android (\d+)/.exec(ua) || []).slice(1).filter(Boolean).join('.');
    const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'آخر';
    const standalone = global.navigator.standalone === true || (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches);
    return { device: device + (os ? ' ' + os : ''), browser: browser, standalone: standalone ? 'نعم' : 'لا' };
  }

  // ===== الإرسال — sending =====
  let sending = false;
  function newKey_() { return 'usage_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8); }
  /** flush() — يرسل كل الأيام المعلّقة، يومًا يومًا؛ يُرجع Promise — sends every pending day, one by one */
  async function flush() {
    if (sending || !loggedIn_() || global.navigator.onLine === false || !global.SecApi) return false;
    sending = true;
    try {
      settleTime_();
      const days = Object.keys(load_().days).sort();
      for (let i = 0; i < days.length; i++) {
        const day = days[i], sent = Object.assign({}, load_().days[day]);
        if (!COUNTERS.some(function (k) { return sent[k] > 0; })) { const s0 = load_(); delete s0.days[day]; save_(s0); continue; }
        let res = null;
        try { res = await global.SecApi.call('logUsage', { day: day, counts: sent, meta: meta_(), opKey: newKey_() }, { phone: true }); } catch (e) { res = null; }
        if (!res || !res.success) return false; // يُعاد لاحقًا / retried later
        const s = load_(), cur = s.days[day] || empty_();
        COUNTERS.forEach(function (k) { cur[k] = Math.max(0, (cur[k] || 0) - (sent[k] || 0)); }); // ما زاد أثناء الإرسال يبقى / what grew meanwhile stays
        if (COUNTERS.some(function (k) { return cur[k] > 0; })) s.days[day] = cur; else delete s.days[day];
        save_(s);
      }
      return true;
    } finally {
      sending = false;
    }
  }

  // ===== الربط — wiring =====
  doc.addEventListener('click', function (e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    for (let i = 0; i < CLICKS.length; i++) if (t.closest(CLICKS[i][0])) { count(CLICKS[i][1]); return; }
  }, true);
  doc.addEventListener('visibilitychange', function () {
    if (doc.visibilityState === 'hidden') { settleTime_(); visibleSince = 0; flush(); }
    else visibleSince = Date.now();
  });
  global.addEventListener('pagehide', function () { settleTime_(); flush(); });
  let offlineCounted = false; // مرة واحدة في الجلسة / once per session
  global.addEventListener('offline', function () { if (!offlineCounted) { offlineCounted = true; count('offline'); } });

  function start_() {
    count('opens');
    if (global.navigator.onLine === false) { offlineCounted = true; count('offline'); }
    global.setTimeout(flush, 5000); // ما بقي من جلسة سابقة / what's left from an earlier session
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start_); else start_();

  global.SecUsageLog = { count: count, navStart: navStart, navEnd: navEnd, flush: flush, _state: load_ };
})(typeof window !== 'undefined' ? window : globalThis);
