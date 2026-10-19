/* ============================================================
 * services/stations-sync.js — نسخة المحطات في الجهاز: متى تُحمَّل وكيف تُزامَن وتُؤكَّد وتُبحث (منطق فقط بلا واجهة)
 * ============================================================
 * يبني فوق stations-db.js (التجميع والتحقق من العدد والاعتماد الكامل بعملية واحدة) ولا يكرر منطقه. هنا فقط:
 * - البدء: النسخة المحفوظة إلى الذاكرة فورًا (تعمل بلا إنترنت)، ثم getDataVersion: بلا نسخة ← تحميل كامل؛ إصدار
 *   مختلف ← مزامنة تزايدية؛ مطابق ← «تأكدت الآن».
 * - التحميل الكامل دفعة دفعة (getAllStations المضغوط): الدفعة الفاشلة تُعاد وحدها 2 ث ثم 5 ث (فوق الطلب الاحتياطي)؛
 *   إن استمر الفشل تبقى الدفعات الناجحة في الذاكرة ويُستكمل التحميل من نفس الدفعة لاحقًا (حادثة 30 سبتمبر)؛ تغيّر
 *   الإصدار في المنتصف ← من الصفر (بحد 3 مرات)؛ عدد الدفعات محدود بالعدد المتوقع + هامش.
 * - المزامنة التزايدية (getUpdatedStationsSince): نسخة جديدة كاملة من المحفوظة + المتغيّر؛ العدد لا يطابق الخادم
 *   (محطة حُذفت أو تغيّر رقمها) ← تحميل كامل تلقائي.
 * - لا «محفوظة» قبل اكتمال الكتابة والتحقق: بعد الاعتماد تُقرأ النسخة من الجهاز ويُطابَق إصدارها وعددها. فشل الحفظ
 *   (IndexedDB معطلة/ممتلئة) ← النسخة في الذاكرة لهذه الجلسة فقط ومُعلنة «غير محفوظة في الجهاز» — والصفحة تعمل.
 *   لا احتياط localStorage (قرار محمد).
 * - التأكد قبل الوثوق بالبحث المحلي (قرار ح٢): مؤكدة خلال 5 دقائق ← نهائية؛ وإلا طلب getDataVersion واحد مشترك
 *   ← مطابق «fresh»، تغيّر ← مزامنة «updated»، تعذّر ← «unverified». طلب معلّق لا يحجز غيره بعد 30 ث.
 * - إضافة/تعديل/حذف ناجح من الموقع ← في الذاكرة فورًا (البحث يجدها)، ثم يُحفظ بالدور بعد أي مزامنة جارية ويُعاد
 *   فوق نتيجتها فلا يضيع. الإصدار ووقت المزامنة لا يتغيران، فالمزامنة القادمة تجلب نسخة الخادم الرسمية.
 * - سجل النسخ الناجحة (آخر 20) وسجل الإخفاقات (بلا إنترنت فعلًا لا يُسجَّل) ووصف النسخة — بيانات وصفية فقط.
 * - لا يمس قاعدة V1 (sec-stations) ولا مفاتيحه: كل التخزين بمفاتيح sec2- من الإعدادات.
 *
 * The on-device stations copy: when it loads, how it syncs, is confirmed and searched (logic only, no UI). Builds on
 * stations-db.js and never repeats it. Start: the stored copy into memory at once, then getDataVersion: none ← full load;
 * different ← incremental sync; same ← confirmed now. Full load batch by batch, a failed batch retried alone (2 s, 5 s),
 * kept in memory to resume from the same batch; a version change midway ← from zero (at most 3 times). Incremental sync;
 * a count mismatch ← automatic full load. Never «saved» before the write AND a read-back check. IndexedDB failure ← the
 * copy lives in memory for this session, announced «not saved on the device», the page keeps working (no localStorage
 * fallback). Confirm before trusting local search (5 min, one shared request). Adds/edits/deletes go to memory at once and
 * are saved in turn, re-applied over any running sync. Logs are metadata only. Never touches V1's database or keys.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, DB = global.SecStationsDB, TI = global.SecTextInput;
  if (!CONFIG || !DB || !TI) throw new Error('stations-sync.js يحتاج الإعدادات وstations-db.js وtext-input.js قبله / needs config, stations-db.js and text-input.js first');
  const T = CONFIG.TIMING, K = CONFIG.STORAGE_KEYS;
  const BATCH_SIZE = 5000;                 // حجم دفعة الخادم (08_Stations.gs) — يُستخدم لحساب حد الدفعات فقط / the server batch size, for the batch cap only
  const MAX_RESTARTS = 3;                  // تغيّر الإصدار أثناء التحميل / version changes during a load
  const LOG_MAX = 20;
  const FRESH_STALE_MS = 30000;
  const MSG = {
    NO_DATA_OFFLINE: 'تحميل البيانات يحتاج اتصالًا بالإنترنت',
    STOPPED: function (loaded, total) { return 'توقف التحميل عند ' + loaded + (total ? '/' + total : '') + ' — اضغط للمتابعة'; },
    NOT_SAVED: 'تعذّر الحفظ في ذاكرة الجهاز — البيانات تعمل لهذه الجلسة فقط'
  };

  // ===== الحالة — State =====
  let copy = null;            // { stations, version, lastSync, sizeBytes, savedAt } — النسخة المعتمدة / the committed copy
  let persisted = false;      // هل النسخة في الذاكرة محفوظة ومتحقق منها في الجهاز؟ / is the in-memory copy saved and verified on the device?
  let store = 'idb';          // 'idb' | 'memory'
  let syncedAt = 0;           // آخر تأكيد من الخادم (تحميل/مزامنة/مطابقة) / the last server confirmation
  let loader = null;          // مجمّع تحميل متوقف للاستكمال / a stopped load's assembler, to resume
  // إصدار أحدث معروف من الخادم لم تكتمل مزامنته بعد — للعرض فقط (شريط الحالة البرتقالي، طلب محمد 19 أكتوبر)؛ لا يغيّر موعد
  // المزامنة ولا طريقتها. A newer known server version not yet synced — display only (the orange status bar); never changes
  // when or how syncing happens.
  let pendingVersion = null;
  let loading = null;         // { loaded, total } أثناء التحميل / while loading
  let firstLoadFailed = false;
  let opChain = Promise.resolve();
  let fullLoadRun = null, freshCheck = null, freshCheckAt = 0, initRun = null;
  const listeners = [];

  function now_() { return Date.now(); }
  function offline_() { return global.navigator.onLine === false; }
  function delay_(ms) { return new Promise(function (r) { global.setTimeout(r, ms); }); }
  function lsGet_(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet_(k, v) { try { global.localStorage.setItem(k, v); } catch (e) { /* تخزين ممتلئ/محظور — وصفي فقط / storage full/blocked — metadata only */ } }

  /* عمليات النسخة بالتتابع (تحميل، مزامنة، تعديل محلي، مسح) — Copy operations run one at a time */
  function serial_(job) {
    const run = opChain.then(job, job);
    opChain = run.catch(function () {});
    return run;
  }

  function state() {
    return {
      loaded: !!copy, count: copy ? copy.stations.length : 0, version: copy ? copy.version : null, lastSync: copy ? copy.lastSync : null,
      sizeBytes: copy ? copy.sizeBytes || 0 : 0, persisted: persisted, store: store, syncedAt: syncedAt ? new Date(syncedAt) : null,
      loading: loading ? Object.assign({}, loading) : null, resumable: loader ? loader.progress() : null, firstLoadFailed: firstLoadFailed,
      pending: pendingVersion
    };
  }
  function emit_(event, detail) {
    const s = state();
    listeners.slice().forEach(function (fn) { try { fn(event, s, detail || null); } catch (e) { /* مستمع فاشل لا يوقف الباقي / a failing listener never stops the rest */ } });
  }
  function onChange(fn) { listeners.push(fn); return function () { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); }; }

  // ===== السجلات الوصفية — Metadata logs =====
  function pushLog_(key, entry) {
    let log = [];
    try { log = JSON.parse(lsGet_(key) || '[]'); if (!Array.isArray(log)) log = []; } catch (e) { log = []; }
    log.unshift(entry);
    lsSet_(key, JSON.stringify(log.slice(0, LOG_MAX)));
  }
  function logLoad_(type, changes) {
    pushLog_(K.STATIONS_LOAD_LOG, { at: now_(), type: type, version: copy.version, count: copy.stations.length, bytes: copy.sizeBytes || 0, changes: changes == null ? null : changes, store: store, persisted: persisted });
  }
  function logIssue_(type, reason) {
    if (offline_()) return; // فشل متوقع / an expected failure
    pushLog_(K.STATIONS_ISSUES_LOG, { at: now_(), type: type, result: 'failed', reason: String(reason).slice(0, 160) });
  }
  function writeMeta_() {
    if (!copy) return;
    lsSet_(K.STATIONS_META, JSON.stringify({ version: copy.version, count: copy.stations.length, bytes: copy.sizeBytes || 0, savedAt: copy.savedAt || null, lastSync: copy.lastSync || null, syncedAt: syncedAt || null, store: store, persisted: persisted }));
  }
  function markSynced_() { syncedAt = now_(); firstLoadFailed = false; pendingVersion = null; writeMeta_(); emit_('confirmed'); }
  function markPending_(version) { pendingVersion = String(version); emit_('pending'); }

  // ===== الاعتماد والتحقق — Commit and verify =====
  /* يعتمد النسخة ثم يقرؤها من الجهاز ويطابق الإصدار والعدد؛ فشل أي خطوة ← الذاكرة فقط (غير محفوظة)
   * Commits, then reads it back and matches version and count; any failure ← memory only (not saved) */
  async function commit_(stations, version, lastSync) {
    const next = { stations: stations, version: String(version), lastSync: lastSync || null, sizeBytes: 0, savedAt: null };
    let saved = false, reason = '';
    if (store === 'idb') {
      try {
        const rec = await DB.commit({ stations: stations, version: next.version, lastSync: next.lastSync });
        const back = await DB.read();
        if (back && back.version === rec.version && back.count === stations.length && Array.isArray(back.stations) && back.stations.length === stations.length) {
          saved = true; next.sizeBytes = rec.sizeBytes; next.savedAt = rec.savedAt;
        } else reason = 'النسخة المقروءة من الجهاز لا تطابق المكتوبة';
      } catch (e) { reason = (e && e.message) || 'تعذّر الحفظ في ذاكرة الجهاز'; }
    } else reason = 'IndexedDB غير متاحة';
    copy = next; persisted = saved;
    return { saved: saved, reason: reason };
  }

  // ===== البدء — Start =====
  /* النسخة المحفوظة إلى الذاكرة (مرة واحدة) — The stored copy into memory (once) */
  function init() {
    if (initRun) return initRun;
    initRun = (async function () {
      try {
        const rec = await DB.read();
        store = 'idb';
        if (rec && Array.isArray(rec.stations) && rec.stations.length && rec.version) {
          copy = { stations: rec.stations, version: rec.version, lastSync: rec.lastSync || null, sizeBytes: rec.sizeBytes || 0, savedAt: rec.savedAt || null };
          persisted = true;
          let meta = null; try { meta = JSON.parse(lsGet_(K.STATIONS_META) || 'null'); } catch (e) { meta = null; }
          if (meta && meta.version === rec.version && meta.syncedAt) syncedAt = Number(meta.syncedAt) || 0;
          writeMeta_();
        }
      } catch (e) {
        store = 'memory'; // التصفح الخاص أو IndexedDB معطلة — الصفحة تعمل بنسخة الذاكرة / private mode or IndexedDB broken — memory copy
      }
      emit_('init');
      return state();
    })();
    return initRun;
  }

  /**
   * البدء الكامل عند فتح الصفحة ← 'loaded' | 'synced' | 'fresh' | 'offline' | 'failed'
   * Full start on page open
   */
  async function start(opts) {
    await init();
    if (offline_()) { if (!copy) firstLoadFailed = true; emit_('offline'); return 'offline'; }
    let v = null;
    try { v = await global.SecApi.call('getDataVersion'); } catch (e) { v = null; }
    if (!copy) return (await fullLoad(opts)).ok ? 'loaded' : 'failed';
    if (!v || !v.success) return 'failed';
    if (DB.isCurrent(copy, v.version)) { markSynced_(); return 'fresh'; }
    markPending_(v.version);
    return (await sync()).ok ? 'synced' : 'failed';
  }

  // ===== التحميل الكامل — The full load =====
  /* دفعة واحدة بإعادتين (2 ث، 5 ث) فوق الطلب الاحتياطي — One batch with two retries on top of the backup request */
  async function fetchBatch_(offset) {
    const delays = T.BATCH_RETRY_DELAYS_MS;
    for (let i = 0; ; i++) {
      let res = null;
      try { res = await global.SecApi.call('getAllStations', { offset: offset, compact: true }, { phone: true }); } catch (e) { res = null; }
      if (res && res.success && Array.isArray(res.stations)) return res;
      if (i >= delays.length || offline_()) return res && res.error ? { error: res.error } : null;
      await delay_(delays[i]);
    }
  }

  /**
   * تحميل كامل (أو استكمال تحميل متوقف) ← { ok, persisted, stopped, reason }. طلب واحد في أي لحظة.
   * opts: { onProgress(loaded, total) }
   */
  function fullLoad(opts) {
    if (fullLoadRun) return fullLoadRun;
    fullLoadRun = serial_(function () { return fullLoad_(opts || {}); }).finally(function () { fullLoadRun = null; loading = null; });
    return fullLoadRun;
  }
  async function fullLoad_(o) {
    if (offline_()) { if (!copy) firstLoadFailed = true; return { ok: false, reason: MSG.NO_DATA_OFFLINE }; }
    const fl = loader || DB.createFullLoad();
    const resumed = !!loader;
    loader = null;
    let restarts = 0, batches = 0;
    const progress_ = function () {
      loading = fl.progress();
      emit_('progress');
      if (o.onProgress) { try { o.onProgress(loading.loaded, loading.total); } catch (e) { /* الواجهة لا توقف التحميل / the UI never stops the load */ } }
    };
    if (resumed) progress_();
    while (fl.nextOffset() !== null) {
      const total = fl.progress().total;
      const cap = (total ? Math.ceil(total / BATCH_SIZE) : 10) + 5;
      if (++batches > cap * (restarts + 1)) { logIssue_('full', 'تجاوز الحد الآمن لعدد الدفعات'); return stop_(fl, 'تجاوز الحد الآمن لعدد الدفعات'); }
      const offset = fl.nextOffset();
      const res = await fetchBatch_(offset);
      if (!res || res.error) {
        const p = fl.progress();
        logIssue_('full', (res && res.error) || ('فشل تحميل الدفعة عند ' + p.loaded + (p.total ? '/' + p.total : '') + ' بعد إعادة المحاولة — يُستكمل من مكانه'));
        return stop_(fl, (res && res.error) || MSG.STOPPED(p.loaded, p.total));
      }
      const r = fl.add(res, offset);
      if (r === 'restart') {
        if (++restarts > MAX_RESTARTS) { logIssue_('full', 'تغيّر إصدار البيانات أثناء التحميل أكثر من ' + MAX_RESTARTS + ' مرات'); return stop_(null, 'تتغير البيانات بالخادم باستمرار — حاول لاحقًا'); }
        progress_(); continue; // من الصفر / from zero
      }
      if (r === 'invalid' || r === 'gap') { logIssue_('full', r === 'gap' ? 'دفعة قافزة عن الترتيب' : 'رد غير صالح من الخادم'); return stop_(null, 'رد غير صالح من الخادم'); }
      progress_();
    }
    const result = fl.result();
    if (!result.ok) { logIssue_('full', result.reason); return stop_(null, result.reason); }
    const c = await commit_(result.stations, result.version, new Date().toISOString());
    if (!c.saved) logIssue_('full', MSG.NOT_SAVED + ' (' + c.reason + ')');
    logLoad_('full');
    markSynced_();
    emit_('loaded');
    return { ok: true, persisted: c.saved, count: result.stations.length, version: result.version, reason: c.saved ? '' : MSG.NOT_SAVED };
  }
  /* توقف: الدفعات الناجحة تبقى للاستكمال (fl) أو تُرمى (null) — Stop: good batches kept to resume (fl) or dropped (null) */
  function stop_(fl, reason) {
    loader = fl || null;
    if (!copy) firstLoadFailed = true;
    emit_('stopped');
    return { ok: false, stopped: true, resumable: !!loader, reason: reason };
  }

  // ===== المزامنة التزايدية — Incremental sync =====
  /* ← { ok, persisted, changes, reason } — مزامنة تحتاج تحميلًا كاملًا تنتقل إليه تلقائيًا */
  async function sync() {
    if (!copy) return fullLoad();
    if (offline_()) return { ok: false, reason: MSG.NO_DATA_OFFLINE };
    let res = null;
    try { res = await global.SecApi.call('getUpdatedStationsSince', { since: copy.lastSync || null }); } catch (e) { res = null; }
    if (!res) { logIssue_('sync', 'انقطع الاتصال بالخادم أثناء المزامنة'); return { ok: false, reason: 'تعذّر الاتصال بالخادم' }; }
    const outcome = await serial_(async function () {
      if (!copy) return { needsFullLoad: true };
      const built = DB.buildSync(copy, res);
      if (!built.ok) return built.needsFullLoad ? { needsFullLoad: true, reason: built.reason } : { ok: false, reason: built.reason };
      const c = await commit_(built.stations, built.version, built.lastSync);
      if (!c.saved) logIssue_('sync', MSG.NOT_SAVED + ' (' + c.reason + ')');
      logLoad_('sync', built.changes);
      markSynced_();
      // المضاف والمعدّل فعلًا — لرسالة «تم تحديث … من تعديلات الزملاء» / really added and modified — for the update message
      emit_('synced', { added: built.added || 0, modified: built.modified || 0, removed: built.removed || 0 });
      return { ok: true, persisted: c.saved, changes: built.changes };
    });
    if (outcome.needsFullLoad) {
      logIssue_('sync', (outcome.reason || 'المزامنة تحتاج تحميلًا كاملًا') + ' — تحميل كامل تلقائي');
      return fullLoad();
    }
    if (!outcome.ok) logIssue_('sync', outcome.reason);
    return outcome;
  }

  // ===== التأكد قبل الوثوق بالبحث — Confirming before trusting search =====
  function isConfirmed() { return !!copy && now_() - syncedAt < T.STATIONS_CONFIRM_MAX_AGE_MS; }

  /* ← 'fresh' | 'updated' | 'unverified' — طلب واحد مشترك لكل البحوث المتزامنة.
     opts.force: يتحقق من الخادم حتى داخل مدة الثقة (لمحطة غير موجودة محليًا — قد يكون غيرك أضافها للتو)
     opts.force: checks the server even within the trust window (for a station missing locally — someone may have just added it) */
  function ensureFresh(opts) {
    if (!copy) return Promise.resolve('unverified');
    if (!(opts && opts.force) && isConfirmed()) return Promise.resolve('fresh');
    if (offline_()) return Promise.resolve('unverified');
    if (freshCheck && now_() - freshCheckAt > FRESH_STALE_MS) freshCheck = null;
    if (!freshCheck) {
      freshCheckAt = now_();
      const check = (async function () {
        try {
          const v = await global.SecApi.call('getDataVersion');
          if (!v || !v.success) return 'unverified';
          if (DB.isCurrent(copy, v.version)) { markSynced_(); return 'fresh'; }
          markPending_(v.version);
          return (await sync()).ok ? 'updated' : 'unverified';
        } catch (e) { return 'unverified'; }
      })().finally(function () { if (freshCheck === check) freshCheck = null; });
      freshCheck = check;
    }
    return freshCheck;
  }
  /* نفس التأكد بحد انتظار (10 ث افتراضيًا) ويكمل بالخلفية — The same check with a wait cap, carrying on in the background */
  function ensureFreshBounded(ms, opts) {
    return Promise.race([ensureFresh(opts), delay_(ms || T.NOT_FOUND_VERIFY_WAIT_MS).then(function () { return 'unverified'; })]);
  }

  // ===== البحث المحلي — Local search =====
  function norm_(v) { return TI.normalizeDigits(String(v == null ? '' : v).trim()).toUpperCase(); }
  /* ← { found:false } أو المحطة بشكل V1 (مع الاسم) — مطابقة تامة، ثم بالأحرف والأرقام فقط (لصق ملتصق بنص)، ثم بمفتاح
   * المطابقة TI.stationKey (المسافات والشرطة الطرفية لا تؤثر) */
  function search(query) {
    if (!copy) return { found: false };
    const q = norm_(query);
    if (!q) return { found: false };
    const list = copy.stations;
    let st = null;
    for (let i = 0; i < list.length && !st; i++) if (norm_(list[i].id) === q) st = list[i];
    if (!st) {
      const bare = q.replace(/[^A-Z0-9\-]/g, '');
      if (bare && bare !== q) for (let i = 0; i < list.length && !st; i++) if (norm_(list[i].id) === bare) st = list[i];
    }
    if (!st) {
      // بمفتاح المطابقة: «mdn 2» ← MDN2، «ANS1» ← «ANS 1»، «2283» ← «2283-» / by the match key
      const key = TI.stationKey(q);
      if (key) for (let i = 0; i < list.length && !st; i++) if (TI.stationKey(list[i].id) === key) st = list[i];
    }
    if (!st) return { found: false };
    return {
      found: true, id: st.id, type: st.type, lat: st.lat, lng: st.lng, region: st.region || '', feeder: st.feeder || '',
      name: (st.type === 'تحويل' ? 'محطة تحويل ' : 'محطة توزيع ') + st.id + (st.region ? ' — ' + st.region : '')
    };
  }
  function stations() { return copy ? copy.stations : null; }

  // ===== تعديل محلي بعد حفظ ناجح بالخادم — Local change after a successful server save =====
  function keyOf_(s) { return String(s.id).toUpperCase() + '\u0001' + s.type; }
  function applyLocal_(list, change) {
    if (change.kind === 'remove') { const k = keyOf_(change.station); return list.filter(function (s) { return keyOf_(s) !== k; }); }
    return DB.applyUpdates(list, [change.station]).stations;
  }
  function local_(change) {
    if (!copy) return Promise.resolve(false);
    copy = Object.assign({}, copy, { stations: applyLocal_(copy.stations, change) }); // فورًا للبحث / at once for search
    emit_('local');
    return serial_(async function () {
      if (!copy) return false; // مُسحت أثناء الانتظار / cleared meanwhile
      const list = applyLocal_(copy.stations, change); // يُعاد فوق نتيجة أي مزامنة سبقته / re-applied over any sync that ran before
      const c = await commit_(list, copy.version, copy.lastSync);
      writeMeta_();
      emit_('local-saved');
      return c.saved;
    });
  }
  function upsert(station) { return local_({ kind: 'upsert', station: station }); }
  function remove(station) { return local_({ kind: 'remove', station: station }); }

  /* زر «مسح البيانات المؤقتة»: نسخة V2 فقط (لا يمس V1) — The «clear temporary data» button: the V2 copy only */
  function clear() {
    return serial_(async function () {
      copy = null; persisted = false; loader = null; syncedAt = 0; pendingVersion = null;
      try { global.localStorage.removeItem(K.STATIONS_META); } catch (e) { /* محظور / blocked */ }
      try { if (store === 'idb') await DB.clear(); } catch (e) { /* تبقى الصفحة تعمل / the page keeps working */ }
      emit_('cleared');
      return true;
    });
  }

  global.SecStationsSync = {
    init: init, start: start, fullLoad: fullLoad, sync: sync, ensureFresh: ensureFresh, ensureFreshBounded: ensureFreshBounded,
    isConfirmed: isConfirmed, search: search, stations: stations, upsert: upsert, remove: remove, clear: clear,
    state: state, onChange: onChange, MSG: MSG
  };
})(typeof window !== 'undefined' ? window : globalThis);
