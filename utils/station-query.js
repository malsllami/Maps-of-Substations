/* ============================================================
 * utils/station-query.js — استعلامات المحطات المحلية: القريبة والمغذي والمسافة والتحقق من الإحداثيات (بلا حالة)
 * ============================================================
 * - من نسخة الجهاز أولًا بلا أي طلب للخادم؛ الخادم (getNearbyStations / getFeederStations) فقط إن لم توجد نسخة محلية.
 * - القريبة: 2 كم من المحطة (نفس قيمة الخادم)، الأقرب أولًا، بلا المحطة نفسها، وبلا محطة إحداثياتها غير صالحة.
 * - المغذي: تطابق تام بعد إزالة المسافات الطرفية (نفس قاعدة الخادم).
 *
 * Local station queries: nearby, feeder, distance and coordinate validity (stateless). From the device copy first, with
 * no server request; the server only when there's no local copy. Nearby: 2 km (the server's value), nearest first,
 * excluding the station itself and invalid coordinates. Feeder: exact match after trimming (the server's rule).
 * ============================================================ */
(function (global) {
  'use strict';

  const NEARBY_KM = 2; // القريبة في القوائم (المحطات، التفاصيل) — nearby in the lists (stations, details)
  // نطاق القرب على الخريطة من المحطة المبحوث عنها (قرار محمد 20 أكتوبر، بعد تجربة 5 كم): 1.5 كم حدًا أقصى، و1 كم حد «القريبة»
  // The map's nearby range from the searched station (Mohammed, 20 Oct, after trying 5 km): 1.5 km at most, 1 km the «close» limit
  const MAP_NEARBY_KM = 1.5, MAP_CLOSE_KM = 1;

  function hasCoordinates(s) {
    const empty = function (v) { return v === null || v === undefined || v === ''; };
    if (!s || empty(s.lat) || empty(s.lng)) return false;
    const lat = Number(s.lat), lng = Number(s.lng);
    return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  }

  function distanceKm(a, b) {
    const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function sameStation_(a, b) { return String(a.id).toUpperCase() === String(b.id).toUpperCase() && a.type === b.type; }

  /* محطة بالشكل الموحّد مع المسافة من المرجع — A station in the uniform shape with its distance from the reference */
  function shape_(s, from) {
    const dist = from && hasCoordinates(s) ? distanceKm(from, { lat: Number(s.lat), lng: Number(s.lng) }) : null;
    return { id: s.id, type: s.type, region: s.region || '', feeder: s.feeder || '', lat: Number(s.lat), lng: Number(s.lng), distanceKm: dist == null ? null : Math.round(dist * 100) / 100 };
  }

  /* القريبة محليًا (2 كم) الأقرب أولًا — Nearby locally (2 km), nearest first */
  function nearbyLocal(stations, center, radiusKm) {
    const r = radiusKm || NEARBY_KM;
    return stations.filter(function (s) { return hasCoordinates(s) && !sameStation_(s, center); })
      .map(function (s) { return shape_(s, center); })
      .filter(function (s) { return s.distanceKm <= r; })
      .sort(function (a, b) { return a.distanceKm - b.distanceKm; });
  }

  /* محطات المغذي محليًا — The feeder's stations locally */
  function feederLocal(stations, station) {
    const feeder = String(station.feeder || '').trim();
    if (!feeder) return [];
    return stations.filter(function (s) { return hasCoordinates(s) && !sameStation_(s, station) && String(s.feeder || '').trim() === feeder; })
      .map(function (s) { return shape_(s, hasCoordinates(station) ? { lat: Number(station.lat), lng: Number(station.lng) } : null); });
  }

  /**
   * القريبة أو المغذي: من النسخة المحلية إن وُجدت، وإلا من الخادم عبر api-client. يُرجع { source: 'local'|'server', stations }
   * Nearby or feeder: from the local copy if any, else the server through api-client.
   */
  async function query(mode, station, localStations, radiusKm) {
    const r = radiusKm || NEARBY_KM; // نصف القطر للقريبة (الخريطة تمرّر 5 كم) — the nearby radius (the map passes 5 km)
    if (Array.isArray(localStations) && localStations.length) {
      return { source: 'local', stations: mode === 'feeder' ? feederLocal(localStations, station) : nearbyLocal(localStations, { id: station.id, type: station.type, lat: Number(station.lat), lng: Number(station.lng) }, r) };
    }
    const res = mode === 'feeder'
      ? await global.SecApi.call('getFeederStations', { feeder: station.feeder })
      : await global.SecApi.call('getNearbyStations', { lat: station.lat, lng: station.lng, radiusKm: r }, { phone: true });
    if (!res || !res.success || !Array.isArray(res.stations)) throw new Error(res && res.error ? res.error : 'تعذّر جلب المحطات');
    const center = { lat: Number(station.lat), lng: Number(station.lng) };
    return { source: 'server', stations: res.stations.filter(function (s) { return !sameStation_(s, station); }).map(function (s) { return shape_(s, center); }) };
  }

  // ===== السكاكين الهوائية (11 نوفمبر) — Air-break switches =====
  // سكينة = صف في جدول التوزيع رقمه «رمز-رقم» (DB-150 / LBS-45). الصيغ المكتوبة يدويًا («db150»، «DB 150»، «DB - 150»،
  // بأرقام عربية) تُوحَّد إلى «DB-150» في الإضافة والبحث، فلا تتعدد صيغ السكينة الواحدة.
  // A switch = a distribution row whose id is «prefix-number»; hand-typed forms are unified to «DB-150» on add and search.
  const SWITCH_PREFIXES = (global.SEC2_CONFIG && global.SEC2_CONFIG.SWITCH_PREFIXES) || [];
  const SWITCH_RE = new RegExp('^(' + SWITCH_PREFIXES.join('|') + ')\\s*[-‐-―−]?\\s*([0-9]+)$');
  function latinUpper_(v) {
    return String(v == null ? '' : v).trim().toUpperCase()
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 1632); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 1776); });
  }
  /* ← { prefix, num } أو null — the prefix and number, or null */
  function switchParts(id) {
    if (!SWITCH_PREFIXES.length) return null;
    const m = SWITCH_RE.exec(latinUpper_(id));
    return m ? { prefix: m[1], num: m[2] } : null;
  }
  /* الرقم الموحّد من رمز ورقم — The unified id from a prefix and a number */
  function switchId(prefix, num) { return prefix + '-' + latinUpper_(num).replace(/[^0-9]/g, ''); }
  /* رقم السكينة بصيغته الموحّدة، وأي رقم آخر كما هو — A switch id unified, any other id as is */
  function canonicalId(id) { const p = switchParts(id); return p ? switchId(p.prefix, p.num) : id; }
  function isSwitch(s) { return !!s && s.type !== 'تحويل' && !!switchParts(s.id); }
  /* النوع للعرض: 'switch' | 'sub' | 'dist' — The kind for display */
  function kindOf(s) { return s && s.type === 'تحويل' ? 'sub' : isSwitch(s) ? 'switch' : 'dist'; }
  function kindLabel(s) { const k = kindOf(s); return k === 'sub' ? 'محطة تحويل' : k === 'switch' ? 'سكينة هوائية' : 'محطة توزيع'; }

  global.SecStationQuery = {
    NEARBY_KM: NEARBY_KM, MAP_NEARBY_KM: MAP_NEARBY_KM, MAP_CLOSE_KM: MAP_CLOSE_KM, hasCoordinates: hasCoordinates, distanceKm: distanceKm, nearbyLocal: nearbyLocal, feederLocal: feederLocal, query: query,
    SWITCH_PREFIXES: SWITCH_PREFIXES, switchParts: switchParts, switchId: switchId, canonicalId: canonicalId, isSwitch: isSwitch, kindOf: kindOf, kindLabel: kindLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
