/* خدمة عامل بسيطة تُمكّن تثبيت الموقع كتطبيق (PWA) — لا تخزّن أي بيانات محطات أو نتائج بحث،
 * فقط هيكل الصفحات الثابت (Shell)، حتى تبقى كل البيانات المعروضة حقيقية من الخادم دائمًا.
 * A minimal service worker that enables installing the site as an app (PWA) — it never caches
 * station data or search results, only the static page shell, so displayed data always stays
 * live from the server. */
const CACHE_NAME = 'sec-shell-v2';
const APP_SHELL = [
  'index.html', 'auth.html', 'member.html', 'shifts.html', 'admin.html', 'services/session.js',
  'assets/logo-icon.png', 'assets/icon-192.png', 'assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
