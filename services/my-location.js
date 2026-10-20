/* ============================================================
 * services/my-location.js — قراءة موقع المستخدم مرة واحدة عند الطلب فقط
 * ============================================================
 * قرار محمد (20 أكتوبر): لا يُطلب الموقع عند دخول الموقع؛ يُستخدم فقط حين يطلبه المستخدم (زر «موقعي» على الخريطة).
 * القريبة في «المحطات» والملاحة لهما قراءتهما الخاصة كما هي.
 * read() ← وعد بـ { lat, lng, accuracy }، أو رفض بـ { code: 'denied' | 'failed' | 'nogeo' }.
 *
 * Reads the user's location once, on request only (Mohammed, 20 Oct: no location request on entry; used only when the
 * user asks — the map's «my location» button). Nearby in «Stations» and navigation keep their own readings.
 * ============================================================ */
(function (global) {
  'use strict';

  const GEO_OPTS = { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 };

  function read() {
    return new Promise(function (resolve, reject) {
      const g = global.navigator.geolocation;
      if (!g) { reject({ code: 'nogeo' }); return; }
      g.getCurrentPosition(function (p) {
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      }, function (err) { reject({ code: err && err.code === 1 ? 'denied' : 'failed' }); }, GEO_OPTS);
    });
  }

  global.SecMyLocation = { read: read };
})(typeof window !== 'undefined' ? window : globalThis);
