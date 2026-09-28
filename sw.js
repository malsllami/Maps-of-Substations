/* عامل الخدمة: يُبقي الموقع يفتح عند انقطاع الإنترنت — لا يخزّن أي بيانات محطات أو نتائج بحث أو ردود الخادم،
 * فقط ملفات الموقع الثابتة ومكتباته، حتى تبقى كل البيانات المعروضة حقيقية من الخادم (أو من نسخة الجهاز المعلنة).
 * - صفحات الموقع وملفاته: الشبكة أولًا (كما كان)، وتُحدَّث النسخة المحفوظة مع كل جلب ناجح؛ عند الانقطاع ← المحفوظة.
 * - مكتبات CDN بإصدارات ثابتة والخطوط: المحفوظة أولًا (لا تتغيّر أبدًا بنفس الرابط).
 * - غير ذلك (خادم Apps Script، صور الخريطة، OSRM، الأقمار الصناعية): لا يتدخل فيها إطلاقًا.
 *
 * Service worker: keeps the site opening when the internet is down — never caches station data, search results
 * or server replies; only the site's static files and libraries, so displayed data stays real.
 * - Site pages/files: network first (as before), refreshing the stored copy on each success; offline ← stored copy.
 * - Pinned-version CDN libraries and fonts: stored copy first (a pinned URL never changes).
 * - Everything else (Apps Script, map tiles, OSRM, satellite): not intercepted at all. */
const CACHE_NAME = 'sec-shell-v6';
const APP_SHELL = [
  'index.html', 'auth.html', 'member.html', 'shifts.html', 'admin.html', 'manifest.json',
  'services/session.js', 'services/timing.js', 'services/connection.js', 'services/pwa.js', 'services/stations-db.js',
  'assets/logo-icon.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png', 'assets/member-icon.png'
];
// نفس الروابط المستخدمة بالصفحات حرفيًا — The exact URLs the pages use
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.5.0/lz-string.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap'
];
const CACHE_FIRST_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

/* كل ملف يُحفظ منفردًا: فشل ملف واحد لا يُسقط البقية (addAll كانت تُسقط الكل بصمت)
 * Each file is stored on its own: one failure doesn't drop the rest (addAll silently dropped everything) */
async function storeEach_(cache, urls, init) {
  await Promise.allSettled(urls.map(async (url) => {
    const res = await fetch(url, init);
    if (res.ok) await cache.put(url, res);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all([
    storeEach_(cache, APP_SHELL, { cache: 'reload' }),
    storeEach_(cache, CDN_ASSETS, { mode: 'cors' }) // رد CORS قابل للقراءة ولا يُضخّم حصة التخزين / a readable CORS reply that doesn't inflate storage quota
  ])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* الشبكة أولًا لملفات الموقع — Network first for the site's own files */
async function networkFirst_(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    // ignoreSearch: auth.html?expired=1 تُخدم من auth.html المحفوظة / served from the stored auth.html
    const stored = await caches.match(request, { ignoreSearch: true });
    if (stored) return stored;
    throw err;
  }
}

/* المحفوظة أولًا للمكتبات والخطوط — Stored copy first for libraries and fonts */
async function cacheFirst_(request) {
  const stored = await caches.match(request, { ignoreVary: true });
  if (stored) return stored;
  const res = await fetch(request);
  if (res.ok) { // لا تُحفظ الردود المعتمة (opaque) — تُضخّم الحصة / opaque replies aren't stored — they inflate the quota
    const copy = res.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst_(request));
  } else if (CACHE_FIRST_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst_(request));
  }
  // غير ذلك: لا تدخّل — يذهب الطلب للشبكة مباشرة كأن عامل الخدمة غير موجود / otherwise: untouched, as if no service worker
});
