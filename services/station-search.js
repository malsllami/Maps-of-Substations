/* ============================================================
 * services/station-search.js — البحث برقم المحطة: من نسخة الجهاز مع التأكد من الخادم (قرار ح٢) — منطق فقط بلا واجهة
 * ============================================================
 * سياسة V1 المعتمدة (searchStationSmart) فوق stations-sync — بلا أي تحميل أو مزامنة هنا (يستدعي ensureFresh فقط):
 * - لا نسخة في الجهاز ← بحث الخادم (searchStation) كما في V1.
 * - النسخة مؤكدة خلال 5 دقائق ← النتيجة المحلية نهائية بلا أي طلب.
 * - وُجدت محليًا ← تُعرض فورًا، ويُتحقق بالخلفية؛ إن تحدّثت النسخة وتغيّرت إحداثيات المحطة ← onUpdated(المحطة الجديدة)
 *   فتنقل الصفحة العلامة (أو وجهة الملاحة) مع «تم تحديث إحداثيات المحطة».
 * - غير موجودة محليًا ← onChecking() «جارٍ التأكد من الخادم…» ثم الحكم بعد التأكد (حد 10 ث)؛ تعذّر التأكد (بلا إنترنت
 *   أو بلا رد) ← { found:false, unverified:true } بصياغة غير قاطعة.
 *
 * Search by station number: from the device copy with server confirmation (decision H2) — logic only, no UI.
 * V1's approved policy on top of stations-sync, with no loading or syncing here (it only calls ensureFresh): no copy ←
 * the server's searchStation; confirmed within 5 minutes ← local is final; found locally ← shown at once, verified in the
 * background, changed coordinates ← onUpdated; not found locally ← onChecking() then the verdict (10 s cap); unconfirmable
 * ← { found:false, unverified:true }.
 * ============================================================ */
(function (global) {
  'use strict';

  const SYNC = global.SecStationsSync, D = global.SecDates;
  if (!SYNC || !D) throw new Error('station-search.js يحتاج stations-sync.js وdates.js قبله / needs stations-sync.js and dates.js first');
  const MSG = {
    CHECKING: 'جارٍ التأكد من الخادم…',
    COORDS_UPDATED: 'تم تحديث إحداثيات المحطة',
    CONNECTION: 'تعذّر الاتصال بالخادم، حاول مرة أخرى'
  };
  const EPS = 1e-7;

  function moved_(a, b) { return !b || !a || Math.abs(Number(a.lat) - Number(b.lat)) > EPS || Math.abs(Number(a.lng) - Number(b.lng)) > EPS; }

  /**
   * find(query, opts) ← { found, id, type, name, lat, lng, region, feeder, source: 'local'|'server', unverified? }
   * opts: { onChecking(), onUpdated(station) }. يرمي خطأ فقط عند فشل بحث الخادم (لا نسخة في الجهاز).
   */
  async function find(query, opts) {
    const o = opts || {};
    if (!SYNC.state().loaded) {
      const res = await global.SecApi.call('searchStation', { query: query }, { phone: true });
      if (!res || (!res.found && res.error)) throw new Error((res && res.error) || MSG.CONNECTION);
      return Object.assign({ source: 'server' }, res.found ? res : { found: false });
    }
    const local = Object.assign({ source: 'local' }, SYNC.search(query));
    // موجودة والنسخة مؤكدة ← فورًا؛ «غير موجودة» تُتحقق من الخادم دائمًا (طلب واحد) — قد تكون أُضيفت للتو (16 أكتوبر)
    // Found with a confirmed copy ← instant; «not found» is always checked with the server — it may have just been added
    if (local.found && SYNC.isConfirmed()) return local;
    if (local.found) {
      SYNC.ensureFresh().then(function (state) {
        if (state !== 'updated' || !o.onUpdated) return;
        const fresh = SYNC.search(query);
        if (fresh.found && fresh.id === local.id && fresh.type === local.type && moved_(local, fresh)) {
          try { o.onUpdated(Object.assign({ source: 'local' }, fresh)); } catch (e) { /* الصفحة لا توقف البحث / the page never breaks search */ }
        }
      });
      return local;
    }
    if (global.navigator.onLine === false) return Object.assign(local, { unverified: true });
    if (o.onChecking) { try { o.onChecking(); } catch (e) { /* لا شيء / nothing */ } }
    const state = await SYNC.ensureFreshBounded(undefined, { force: true });
    const again = Object.assign({ source: 'local' }, SYNC.search(query));
    if (!again.found && state === 'unverified') again.unverified = true;
    return again;
  }

  /* «غير موجودة» غير المؤكدة مع وقت آخر تأكيد للنسخة — The unconfirmed «not found» note with the copy's last confirmation */
  function unverifiedNote() {
    const at = SYNC.state().syncedAt;
    return 'غير موجودة في النسخة المحفوظة' + (at ? ' (آخر تحديث: ' + D.relativeTime(at) + ')' : '') + ' — تعذّر التأكد من الخادم';
  }

  global.SecStationSearch = { find: find, unverifiedNote: unverifiedNote, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
