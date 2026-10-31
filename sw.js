/* ============================================================
 * sw.js — عامل خدمة V2: يُبقي الموقع يفتح عند انقطاع الإنترنت، بلا أي بيانات ديناميكية
 * ============================================================
 * - ملفات V2 داخل نطاقه فقط: من النسخة المحفوظة المكتملة أولًا (كل ملفات التحميل الواحد من نسخة واحدة)، والشبكة لملف غير
 *   محفوظ فقط؛ التصفح لا يكتب في ذاكرة النسخة، والنسخة الجديدة تصل كاملة بالتثبيت ثم «تحديث الآن».
 * - مكتبات CDN بإصدارات ثابتة والخطوط: المحفوظة أولًا (الرابط الثابت لا يتغيّر محتواه).
 * - لا يتدخل إطلاقًا في: خادم Apps Script (وأي طلب غير GET)، OSRM، صور الخريطة والأقمار، ملف خريطة جدة (maps/ — يُدار في
 *   IndexedDB)، ولا أي ملف خارج نطاق V2 على نفس النطاق (ملفات V1). فلا تُعاد بيانات قديمة كأنها حديثة أبدًا.
 * - ذاكرته sec2-shell-…؛ عند التحديث يحذف ذاكرات sec2- القديمة فقط، ولا يمس ذاكرة V1 (sec-) ولا IndexedDB (المحطات والخريطة).
 * - سلامة التحديث: النسخة الجديدة تُثبَّت في ذاكرة منفصلة (…-next) ولا تلمس ذاكرة النسخة العاملة. ملفات الموقع كلها أساسية:
 *   فشل أو تعليق أي ملف منها (مهلة لكل ملف) ← يفشل التثبيت وتُحذف المنفصلة، وتبقى النسخة العاملة وذاكرتها كما هي ويعيد
 *   المتصفح المحاولة لاحقًا. المكتبات الخارجية اختيارية (تُجلب عند أول استخدام). عند التفعيل فقط تحل المنفصلة محل القديمة.
 * - التحديث لا يفرض نفسه: النسخة الجديدة تنتظر حتى تطلب الصفحة التحديث (SKIP_WAITING)، ثم تتولى وتعيد الصفحة تحميل نفسها مرة واحدة.
 *
 * The V2 service worker: keeps the site opening offline, with no dynamic data.
 * - V2 files inside its scope only: from the complete stored version first (every file of one load from one version), the
 *   network only for a file not stored; browsing never writes to the version cache, a new version arrives whole by install.
 * - Pinned-version CDN libraries and fonts: stored copy first.
 * - Never touches: the Apps Script server (or any non-GET), OSRM, map/satellite tiles, the Jeddah map file (maps/ — managed in
 *   IndexedDB), nor any file outside the V2 scope on the same origin (V1's files). So stale data is never served as fresh.
 * - Its cache is sec2-shell-…; on update it deletes old sec2- caches only, never V1's (sec-) nor IndexedDB (stations, map).
 * - Update safety: a new version installs into a separate cache (…-next), never touching the working version's. All site
 *   files are essential: any failed or stalled one (per-file timeout) ← the install fails, the separate cache is deleted, the
 *   working version and its cache stay as they are, and the browser retries later. CDN libraries are optional (fetched on
 *   first use). Only on activation does the separate cache replace the old one.
 * - An update never forces itself: the new version waits until the page asks (SKIP_WAITING), then takes over and the page
 *   reloads itself once.
 * ============================================================ */
importScripts('config/الإعدادات.js');
// ختم النسخة (30 أكتوبر): المتصفح لا يكتشف نسخة جديدة إلا بتغيّر هذا الملف أو ملف الإعدادات، وتغيير أي ملف موقع آخر وحده لا
// يصل للأجهزة. لا يُعدَّل يدويًا: خطاف pre-commit يحدّثه مع كل commit فيه ملف موقع، واختبار البوابة test_sw_build.js يتحقق.
// The build stamp: a browser detects a new version only when this file or the config changes; any other site file alone never
// reaches devices. Not edited by hand: the pre-commit hook updates it on every commit with a site file; the gate verifies.
const SW_BUILD = '20261031-050237-971985900';
const CONFIG = self.SEC2_CONFIG;
const CACHE_NAME = CONFIG.SHELL_CACHE_NAME;
const NEXT_CACHE = CACHE_NAME + '-next'; // تثبيت نسخة جديدة دون لمس العاملة / installing a new version without touching the working one
const PREFIX = CONFIG.STORAGE_PREFIX;

// كل ملفات واجهة V2 محفوظة مسبقًا ليفتح التطبيق كاملًا بدون إنترنت (عدا gas/ — كود الخادم لا يُخدم). اختبار البوابة
// test_svc_pwa.js يقارن هذه القائمة بملفات المجلد فعلًا، فأي ملف جديد بلا إضافة هنا يُسقط البوابة.
// Every V2 front-end file stored up front so the app opens fully offline (except gas/). The gate compares this list to the
// folder's real files, so a new file not added here fails the gate.
const APP_SHELL = [
  './', 'index.html', 'auth.html', 'member.html', 'shifts.html', 'admin.html', 'perf.html', 'manifest.json',
  'config/الإعدادات.js',
  'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png', 'assets/logo-icon.png', 'assets/logo-light.png', 'assets/member-avatar.webp', 'assets/auth-bg.webp',
  'assets/tour/01-home-map.webp', 'assets/tour/02-state-ready.webp', 'assets/tour/03-state-none.webp', 'assets/tour/04-state-partial.webp', 'assets/tour/05-state-pending.webp',
  'assets/tour/06-state-offline.webp', 'assets/tour/07-search-mode.webp', 'assets/tour/08-search-server.webp', 'assets/tour/09-search-local.webp', 'assets/tour/10-station-sheet.webp',
  'assets/tour/11-nearby-map.webp', 'assets/tour/12-feeder-map.webp', 'assets/tour/13-details-info.webp', 'assets/tour/14-details-loc.webp', 'assets/tour/15-details-near.webp',
  'assets/tour/16-nearby-list.webp', 'assets/tour/17-outages-input.webp', 'assets/tour/18-outages-map.webp', 'assets/tour/19-ruler.webp', 'assets/tour/20-nav-online.webp',
  'assets/tour/21-nav-offline.webp', 'assets/tour/22-more-offline-map.webp', 'assets/tour/23-shifts.webp', 'assets/tour/24-dashboard.webp', 'assets/tour/25-bottom-nav.webp',
  'utils/dates.js', 'utils/html.js', 'utils/station-query.js', 'utils/text-input.js',
  'services/api-client.js', 'services/connection.js', 'services/direction-tracker.js', 'services/fresh-start.js', 'services/nav-camera.js', 'services/navigation.js',
  'services/offline-map.js', 'services/osrm.js', 'services/pwa.js', 'services/session.js', 'services/settings-lists.js',
  'services/shift-rotation.js', 'services/station-search.js', 'services/stations-db.js', 'services/stations-sync.js', 'services/my-location.js', 'services/theme.js', 'services/load-guard.js', 'services/usage-log.js',
  'services/timing.js', 'services/webauthn-client.js',
  'components/add-edit-station.js', 'components/admin-dashboard.js', 'components/admin-detail.js', 'components/app-header.js', 'components/bottom-nav.js', 'components/station-details.js', 'components/stations-list.js', 'components/district-labels.js', 'components/more-menu.js',
  'components/auth-form.js', 'components/connection-status.js', 'components/contact-admin.js', 'components/delete-station.js',
  'components/device-copies.js', 'components/globe.js', 'components/map-tools.js', 'components/map-view.js', 'components/member-profile.js',
  'components/navigation-view.js', 'components/nearby-layer.js', 'components/offline-map-ui.js', 'components/outage-search.js',
  'components/perf-viewer.js', 'components/phone-input.js', 'components/profile-gate.js', 'components/recent-stations.js',
  'components/shifts-calendar.js', 'components/station-card.js', 'components/station-search-box.js', 'components/stats-cards.js',
  'components/install-sheet.js', 'components/storage-section.js', 'components/update-sheet.js', 'components/reinstall-notice.js', 'components/feature-tour.js', 'config/جولة_تعريفية.js',
  'pages/home.js',
  'styles/add-edit-station.css', 'styles/admin.css', 'styles/app-header.css', 'styles/auth.css', 'styles/base.css', 'styles/bottom-nav.css', 'styles/station-details.css', 'styles/stations-list.css', 'styles/more-menu.css',
  'styles/connection-status.css', 'styles/contact-admin.css', 'styles/delete-station.css', 'styles/globe.css', 'styles/home.css',
  'styles/map-tools.css', 'styles/map-view.css', 'styles/map.css', 'styles/member.css', 'styles/navigation.css', 'styles/offline-map.css',
  'styles/perf-viewer.css', 'styles/profile-gate.css', 'styles/recent-stations.css', 'styles/shifts.css', 'styles/station-card.css',
  'styles/station-search.css', 'styles/stats-cards.css', 'styles/storage-section.css', 'styles/tables.css', 'styles/update-sheet.css', 'styles/reinstall-notice.css', 'styles/install-sheet.css', 'styles/feature-tour.css'
];
const CDN_ASSETS = Object.keys(CONFIG.LIBRARIES).map((k) => CONFIG.LIBRARIES[k]);
const CACHE_FIRST_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

const FETCH_TIMEOUT_MS = CONFIG.TIMING.SW_FETCH_TIMEOUT_MS;

/* جلب ملف بمهلة؛ رد غير ناجح = فشل — Fetch one file with a timeout; a non-ok reply = failure */
async function fetchOk_(url, init) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({}, init, { signal: ctl.signal }));
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res;
  } finally { clearTimeout(timer); }
}

/* التثبيت: ملفات الموقع كلها أو لا شيء، في ذاكرة منفصلة؛ المكتبات بأفضل جهد
   Install: all site files or nothing, into a separate cache; libraries best effort */
async function install_() {
  await caches.delete(NEXT_CACHE); // بقايا تثبيت سابق فشل / leftovers of an earlier failed install
  try {
    const shell = await Promise.all(APP_SHELL.map((url) => fetchOk_(url, { cache: 'reload' }).then((res) => [url, res])));
    const next = await caches.open(NEXT_CACHE);
    await Promise.all(shell.map(([url, res]) => next.put(url, res)));
    await Promise.allSettled(CDN_ASSETS.map((url) => fetchOk_(url, { mode: 'cors' }).then((res) => next.put(url, res))));
  } catch (err) {
    await caches.delete(NEXT_CACHE).catch(() => {});
    console.warn('فشل تثبيت النسخة ' + SW_BUILD + ' / install failed:', err);
    throw err; // التثبيت يفشل والنسخة العاملة تبقى / the install fails, the working version stays
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(install_());
  // لا skipWaiting هنا: التحديث بطلب من الصفحة فقط / no skipWaiting here: the update only on the page's request
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* التفعيل المتين: في كل لحظة توجد نسخة مكتملة صالحة حتى لو توقف المتصفح في المنتصف
   1) علامة «تفعيل جارٍ» في الذاكرة المنفصلة ← من هنا تصبح هي المرجع عند الانقطاع (فهي المكتملة)
   2) نقل ملفاتها فوق ذاكرة النسخة دون حذفها أولًا (الكتابة تستبدل الملف)، ثم إزالة ملفات قديمة لم تعد في النسخة
   3) حذف المنفصلة بعد اكتمال النقل فقط؛ ولو انقطع النقل يُستكمل في أول طلب بعد عودة عامل الخدمة
   Robust activation: a complete, usable version exists at every moment even if the browser stops midway.
   1) an «activating» mark in the separate cache ← from here it is the offline reference (it's the complete one)
   2) its files are written over the version cache without deleting it first, then old files no longer in the version go
   3) the separate cache is deleted only after the move; an interrupted move resumes on the first request after a restart */
const ACTIVATING_MARK = new URL('__sec2-activating__', self.registration.scope).href;
const urlOf_ = (req) => String(req && req.url ? req.url : req);

async function activatingNext_() {
  if ((await caches.keys()).indexOf(NEXT_CACHE) === -1) return null;
  const next = await caches.open(NEXT_CACHE);
  return (await next.match(ACTIVATING_MARK)) ? next : null;
}
async function moveNext_() {
  const next = await activatingNext_();
  if (!next) return;
  const reqs = (await next.keys()).filter((r) => urlOf_(r) !== ACTIVATING_MARK), urls = reqs.map(urlOf_);
  const cur = await caches.open(CACHE_NAME);
  await Promise.all(reqs.map(async (req) => { const res = await next.match(req); if (res) await cur.put(req, res); }));
  await Promise.all((await cur.keys()).filter((r) => urls.indexOf(urlOf_(r)) === -1).map((r) => cur.delete(r))); // ملفات لم تعد في النسخة / files no longer in the version
  await caches.delete(NEXT_CACHE); // بعد اكتمال النقل فقط / only after the move completed
}
async function activate_() {
  if ((await caches.keys()).indexOf(NEXT_CACHE) !== -1) await (await caches.open(NEXT_CACHE)).put(ACTIVATING_MARK, new Response('1'));
  await moveNext_();
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.indexOf(PREFIX) === 0 && k !== CACHE_NAME && k !== NEXT_CACHE).map((k) => caches.delete(k)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(activate_().catch(() => {}).then(() => self.clients.claim()));
});

/* استكمال نقل انقطع (مرة واحدة لكل تشغيل لعامل الخدمة) — resume an interrupted move (once per service worker run) */
let resumeChecked = false;
function resumeOnce_(event) {
  if (resumeChecked) return;
  resumeChecked = true;
  event.waitUntil(moveNext_().catch(() => { resumeChecked = false; }));
}

/* البحث في المحفوظ: المنفصلة أولًا إن كان تفعيلها جاريًا (فهي المكتملة)، ثم ذاكرة النسخة
   Stored lookup: the separate cache first while its activation is in progress (it's the complete one), then the version cache */
async function stored_(request, opts) {
  try {
    const next = await activatingNext_();
    const hit = next ? await next.match(request, opts) : null;
    return hit || await caches.match(request, Object.assign({ cacheName: CACHE_NAME }, opts));
  } catch (e) { return null; } // الذاكرة غير متاحة / cache unavailable
}

/* ملفات V2 من نسخة واحدة مكتملة (21 أكتوبر): المحفوظة في ذاكرة النسخة أولًا، والشبكة فقط لملف غير محفوظ — ولا يُكتب
   شيء في ذاكرة النسخة أثناء التصفح؛ فلا يجتمع ملف جديد وآخر قديم في تحميل واحد (كان يكسر الصفحة مع شبكة متقطعة).
   النسخة الجديدة تصل كاملة بالتثبيت ثم «تحديث الآن».
   V2's files from one complete version: the version cache first, the network only for a file not stored — and nothing is
   written to the version cache while browsing; so a new file never meets an old one in one load (it broke the page on a
   flaky network). A new version arrives whole through the install, then «update now». */
async function versionFirst_(request) {
  const stored = await stored_(request, { ignoreSearch: true });
  if (stored) return stored;
  return fetch(request);
}

/* المحفوظة أولًا للمكتبات والخطوط — Stored copy first for libraries and fonts */
async function cacheFirst_(request) {
  const stored = await stored_(request, { ignoreVary: true });
  if (stored) return stored;
  const res = await fetch(request);
  if (res.ok) { // الردود المعتمة لا تُحفظ / opaque replies aren't stored
    const copy = res.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // طلبات الخادم POST لا تُعترض أبدًا / server POSTs are never intercepted
  const url = new URL(request.url);
  const scope = self.registration.scope;
  if (url.origin === self.location.origin) {
    if (request.url.indexOf(scope) !== 0) return;             // خارج نطاق V2 (ملفات V1) / outside the V2 scope (V1's files)
    if (url.pathname.indexOf('/maps/') !== -1) return;        // ملف خريطة جدة يُدار في IndexedDB / the Jeddah map file lives in IndexedDB
    resumeOnce_(event);
    event.respondWith(versionFirst_(request));
  } else if (CACHE_FIRST_HOSTS.indexOf(url.hostname) !== -1) {
    resumeOnce_(event);
    event.respondWith(cacheFirst_(request));
  }
  // غير ذلك (Apps Script، OSRM، صور الخريطة): لا تدخّل — كأن عامل الخدمة غير موجود / otherwise: untouched
});
