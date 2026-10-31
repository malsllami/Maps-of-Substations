/* ============================================================
 * config/الإعدادات.js — المصدر الوحيد لإعدادات الواجهة في V2
 * ============================================================
 * كل الخدمات والصفحات تقرأ من هنا، فلا يتكرر عنوان الخادم أو مفتاح تخزين أو مهلة في أي ملف آخر.
 * إعدادات تقنية فقط (عنوان، مفاتيح، مهل، مكتبات) — لا بيانات أعمال: القوائم (الورديات، الأقسام، الدول،
 * أنواع العضوية) وأرقام المدير تأتي من شيت «الإعدادات» عبر الخادم.
 * كل التخزين المحلي لـ V2 يبدأ بـ «sec2-» فلا يتداخل مع V1 (sec-) على نفس النطاق.
 *
 * The single source of the V2 front end's settings. Every service and page reads from here, so no server
 * address, storage key or timeout is repeated anywhere else. Technical settings only — no business data:
 * the lists and admin numbers come from the «الإعدادات» sheet through the server.
 * All V2 local storage starts with "sec2-" so it never collides with V1 ("sec-") on the same origin.
 * ============================================================ */
(function (global) {
  'use strict';

  const PREFIX = 'sec2-';

  const config = {
    /* عنوان خادم V2 (Apps Script — تطبيق ويب) — The V2 server address (Apps Script web app) */
    API_BASE_URL: 'https://script.google.com/macros/s/AKfycbyd7VFBzQQn7-mH4yh604eMdTFmmxLHD1ovPbjSPvsCmVGJySHD7FbgmoCcTidvXxVv5A/exec',

    /* بادئة كل التخزين المحلي — The prefix of all local storage */
    STORAGE_PREFIX: PREFIX,

    /* مفاتيح localStorage — localStorage keys */
    STORAGE_KEYS: {
      SESSION: PREFIX + 'session',                       // الجلسة (التذكرة والدور والاسم) / the session
      PHONE: PREFIX + 'phone',                           // آخر جوال أُدخل في الدخول / the last phone entered at login
      REMEMBER_PHONE: PREFIX + 'remember-phone',         // «تذكرني»: حفظ الجوال في حقل الدخول ('0' = لا) / «remember me»: keep the phone in the login field
      THEME: PREFIX + 'theme',                           // الوضع الداكن/الفاتح / dark or light theme
      MAP_MODE: PREFIX + 'map-mode',                     // نمط الخريطة (تلقائي/نهاري/ليلي/أقمار) / map style
      NAV_GLASS: PREFIX + 'nav-glass',                   // مظهر لوحة الملاحة / navigation sheet look
      NAV_ROTATE: PREFIX + 'nav-rotate',                 // دوران الخريطة مع السير أو الشمال لأعلى / map rotation mode
      MAP_STATUS_HIDDEN: PREFIX + 'map-status-hidden',   // أخفى المستخدم بطاقة حالة النسخة في الرئيسية ('1') / the user hid the home status card
      MAP_TOOLS_FOLDED: PREFIX + 'map-tools-folded',     // طوى المستخدم صف الأدوات بأيقونة الضبط ('1') — مفتاح 22 أكتوبر / the user folded the tools row
      SEARCH_KEYBOARD: PREFIX + 'search-keyboard',       // لوحة مفاتيح البحث: 'abc' للحروف، والافتراضي الأرقام — 22 أكتوبر / the search keyboard: 'abc' letters, numbers by default
      MAP_TOOLS_HIDDEN: PREFIX + 'map-tools-hidden',     // أخفى المستخدم صف أدوات الخريطة ('1') / the user hid the map tools row
      LAST_BACKEND_OK: PREFIX + 'last-backend-ok',       // وقت آخر رد سليم من الخادم / the last valid server reply time
      PENDING_ERRORS: PREFIX + 'pending-errors',         // طابور أخطاء المتصفح قبل إرسالها / the browser error queue
      PERF_LOG: PREFIX + 'perf-log',                     // سجل قياس زمن الطلبات / request timing log
      PERF_TAB: PREFIX + 'perf-tab',                     // التبويب المفتوح في صفحة القياس / the open tab on the perf page
      SETTINGS_LISTS: PREFIX + 'settings-lists',         // آخر نسخة من قوائم الإعدادات للعمل بلا إنترنت / last settings lists for offline use
      STATIONS_META: PREFIX + 'stations-meta',           // وصف النسخة المحلية (الإصدار، العدد، وقت المزامنة) / the local copy's description
      STATIONS_LOAD_LOG: PREFIX + 'stations-load-log',   // سجل التحميل والمزامنة / load and sync log
      STATIONS_ISSUES_LOG: PREFIX + 'stations-issues-log', // سجل الإخفاقات / failures log
      RECENT_STATIONS: PREFIX + 'recent-stations',       // «آخر المحطات» (ساعتان) / «recent stations» (two hours)
      SW_RELOAD: PREFIX + 'sw-reload',                   // وقت آخر إعادة تحميل بعد تحديث عامل الخدمة (sessionStorage) — منع الحلقة / last reload after a SW update — loop guard
      FRESH_START: PREFIX + 'fresh-start',               // رقم «البداية النظيفة» المنفّذة على هذا الجهاز / the fresh start id already run on this device
      USAGE_LOG: PREFIX + 'usage-log',                   // عدّادات الاستخدام اليومية قبل إرسالها (22 أكتوبر) / the daily usage counters before sending
      REINSTALL_NOTICE: PREFIX + 'reinstall-notice',     // عُرضت بطاقة إعادة التثبيت على هذا الجهاز (31 أكتوبر) / the reinstall card was shown on this device
      DEVICE_ID: PREFIX + 'device-id'                    // معرّف جهاز مجهول لعدّ المتأثرين بالأخطاء (16 أكتوبر) / an anonymous device id for counting affected people
    },

    /* «البداية النظيفة» يوم الانتقال من V1 (خطة محمد): مرة واحدة لكل جهاز — تُفعَّل يوم الانتقال فقط (ENABLED: true)
       The migration-day «fresh start» (Mohammed's plan): once per device — enabled on migration day only */
    FRESH_START: {
      ENABLED: true,                                     // فُعِّلت يوم الانتقال (16 أكتوبر) / enabled on migration day
      ID: 'v2-launch',                                   // تغييره يعيد التنفيذ على كل الأجهزة / changing it reruns on every device
      V1_PREFIX: 'sec-',                                 // مفاتيح V1 وذاكراته (لا يمس sec2- ولا مشاريع النطاق الأخرى) / V1 keys and caches only
      V1_DATABASES: ['sec-stations', 'sec-offline-map'], // قواعد V1 بالاسم فقط / V1 databases by name only
      V1_PHONE_KEY: 'sec-phone', V1_SESSION_KEY: 'sec-session'
    },

    /* قواعد IndexedDB وذاكرة ملفات الموقع — IndexedDB databases and the site file cache */
    DB_NAMES: { STATIONS: PREFIX + 'stations', OFFLINE_MAP: PREFIX + 'offline-map' },
    SHELL_CACHE_NAME: PREFIX + 'shell-v1',

    /* المهل والحدود (بالميلي ثانية ما لم يُذكر) — Timeouts and limits (ms unless stated) */
    TIMING: {
      HEDGE_AFTER_MS: 8000,                    // طلب قراءة احتياطي بعد 8 ث بلا رد / a backup read after 8 s without a reply
      HEDGE_RETRY_AFTER_FAIL_MS: 1500,         // أو بعد 1.5 ث من فشل صريح / or 1.5 s after an explicit failure
      SAVE_RETRY_DELAYS_MS: [5000, 8000],      // إعادة الحفظ بنفس مفتاح العملية / save retries with the same operation key
      // قواعد سجل الأخطاء (محمد 22 أكتوبر): المشاكل الحقيقية فقط — تأخير طلب دقيقتين فأكثر ثم نجح، أو خادم لا يرد دقيقتين
      // فأكثر والجهاز متصل والصفحة ظاهرة («تعطّل الموقع»). ما دونهما عابر لا يُسجَّل. Error-log rules: real problems only —
      // a request delayed two minutes or more, or the server not answering for two minutes or more; anything less isn't logged.
      LOG_DELAY_MS: 120000,
      LOG_DOWN_MS: 120000,
      BATCH_RETRY_DELAYS_MS: [2000, 5000],     // إعادة دفعة تحميل المحطات / station batch retries
      CONN_CHECK_INTERVAL_MS: 3 * 60 * 1000,   // فحص الاتصال كل 3 دقائق / connection check every 3 minutes
      CONN_CHECK_TIMEOUT_MS: 15 * 1000,
      SW_FETCH_TIMEOUT_MS: 15 * 1000,          // مهلة كل ملف أثناء تثبيت عامل الخدمة؛ الملف المعلق لا يوقف التثبيت / per-file timeout while installing the SW; a stalled file never blocks the install
      STATIONS_CONFIRM_MAX_AGE_MS: 2 * 60 * 1000, // الثقة بالبحث المحلي دقيقتين بعد آخر تأكيد للإصدار (اختيار محمد 16 أكتوبر) / trust local search 2 min after the last version check
      NOT_FOUND_VERIFY_WAIT_MS: 10000,         // انتظار التأكد من الخادم لمحطة غير موجودة محليًا / wait for server confirmation of a station missing locally
      STATS_STALE_MS: 3 * 60 * 1000,
      RECENT_STATIONS_MS: 2 * 60 * 60 * 1000,  // «آخر المحطات»: ساعتان / «recent stations»: two hours
      TOKEN_RENEW_AFTER_MS: 24 * 60 * 60 * 1000 // تجديد التذكرة بعد يوم / renew the ticket after a day
    },

    /* نظام الورديات 4×4 (من V1، معتمد): المرجع الخميس 2/7/2026م (17/1/1448هـ)؛ دورة 8 أيام (يومان صباح، يومان مساء، أربعة
     * راحة)؛ موضع كل وردية في الدورة يوم المرجع. محسوب رياضيًا — لا بيانات مخزّنة.
     * The 4×4 shift system (from V1, approved): reference Thursday 2 Jul 2026; an 8-day cycle; each group's position on the
     * reference day. Computed — nothing stored. */
    SHIFT_ROTATION: {
      REF_DATE: { YEAR: 2026, MONTH: 7, DAY: 2 },
      CYCLE_DAYS: 8, MORNING_DAYS: 2, EVENING_DAYS: 2,
      GROUPS: ['أ', 'ب', 'ج', 'د'],
      REF_POSITION: { 'أ': 1, 'د': 3, 'ج': 5, 'ب': 7 },
      MORNING_HOURS: '7ص - 7م', EVENING_HOURS: '7م - 7ص'
    },

    /* مصادر مربعات الخريطة (من V1) — Map tile sources (from V1) */
    MAP_TILES: {
      STREET: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      SATELLITE: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      MAX_ZOOM: 19
    },

    /* المكتبات الخارجية بإصدارات ثابتة (تُحفظ في ذاكرة الموقع للعمل بلا إنترنت) — Pinned external libraries (cached for offline use) */
    LIBRARIES: {
      LEAFLET_JS: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
      LEAFLET_CSS: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
      CHART_JS: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
      THREE_JS: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', // قديمة — قرار التحديث في مرحلة المكتبات / old — update decision in the libraries step
      PMTILES: 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/dist/pmtiles.js',
      PROTOMAPS_LEAFLET: 'https://cdn.jsdelivr.net/npm/protomaps-leaflet@5.1.0/dist/protomaps-leaflet.js'
    }
  };

  /* تجميد عميق: لا يغيّر أي ملف إعدادًا أثناء التشغيل — Deep freeze: no file changes a setting at runtime */
  (function freeze(o) { Object.values(o).forEach(function (v) { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(o); })(config);

  global.SEC2_CONFIG = config;
})(typeof window !== 'undefined' ? window : globalThis);
