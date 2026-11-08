/* ============================================================
 * services/profile-cache.js — «حسابي» من ذاكرة الجهاز أولًا (الإصدار 3، فكرة محمد 8 نوفمبر)
 * ============================================================
 * - آخر رد سليم من الخادم لـ«حسابي» يُحفظ في الجهاز لكل عضو (بمفتاح جواله)، فيظهر «حسابي» فورًا عند فتحه،
 *   ثم يُحدَّث من الخادم في الخلفية (الخادم يبقى المصدر: التاريخ القديم، الأجهزة الأخرى، «آخر دخول»).
 * - كل إضافة أو تعديل ينجح على هذا الجهاز يُسجَّل فورًا «معلّقًا» ويُدمج في العرض، فيرى العضو عمله حالًا حتى قبل رد الخادم.
 *   رد الخادم التالي يشمله، فيُمسح كل معلّق سُجّل قبل بدء ذلك الطلب.
 * - عضو آخر على نفس الجهاز لا يرى إلا بياناته (المفتاح بجواله)، وتسجيل الخروج يمسح كل ما حُفظ هنا (clearProfileCopies_ في session.js).
 * - التخزين المحظور أو التالف ← لا شيء محفوظ، و«حسابي» يعمل من الخادم كما كان.
 *
 * «My account» from the device first (release 3): the last good server reply is kept per member and shown at once, then
 * refreshed from the server in the background. Each successful add/edit on this device is recorded as pending and merged
 * into the view; the next server reply includes it, so pending entries made before that request started are dropped.
 * Keyed by phone; logout wipes it. Blocked or corrupt storage ← nothing kept, the page works from the server as before.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, S = global.SecSession;
  if (!CONFIG || !S) throw new Error('profile-cache.js يحتاج الإعدادات وsession قبله / missing dependencies');
  const PREFIX = CONFIG.STORAGE_KEYS.PROFILE_CACHE;
  const LIST_MAX = 50;       // نفس حد الخادم لكل قائمة / the server's per-list limit
  const PENDING_MAX = 100;   // سقف المعلّقات حتى لا يكبر التخزين / a cap on pending entries

  /* المفتاح بآخر 9 أرقام من الجوال — The key by the phone's last 9 digits */
  function key_(phone) {
    const id = String(phone || '').replace(/\D/g, '').slice(-9);
    return id.length === 9 ? PREFIX + id : '';
  }
  function read_(phone) {
    const k = key_(phone);
    if (!k) return null;
    try { const v = JSON.parse(global.localStorage.getItem(k) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
  }
  function write_(phone, v) {
    const k = key_(phone);
    if (!k) return;
    try { global.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* تخزين محظور أو ممتلئ / storage blocked or full */ }
  }

  /* «dd/MM/yyyy» و«HH:mm:ss» كما يرسلها الخادم — the server's date and time format */
  function two_(n) { return (n < 10 ? '0' : '') + n; }
  function entry_(station, at) {
    const d = new Date(at);
    return {
      stationId: String(station.id), region: station.region || '—',
      date: two_(d.getDate()) + '/' + two_(d.getMonth() + 1) + '/' + d.getFullYear(),
      time: two_(d.getHours()) + ':' + two_(d.getMinutes()) + ':' + two_(d.getSeconds())
    };
  }

  /* إضافة أو تعديل نجح على هذا الجهاز — A successful add or edit on this device */
  function recordSave(station, mode) {
    const phone = S.getPhone();
    if (!phone || !station || station.id == null) return;
    const v = read_(phone) || {};
    const pending = Array.isArray(v.pending) ? v.pending : [];
    pending.push({ kind: mode === 'add' ? 'add' : 'edit', at: Date.now(), entry: entry_(station, Date.now()) });
    v.pending = pending.slice(-PENDING_MAX);
    write_(phone, v);
  }

  /* رد الخادم السليم: يُحفظ، ويُمسح كل معلّق سُجّل قبل بدء الطلب (الخادم يشمله)
   * A good server reply: kept, and pending entries made before the request started are dropped (the server has them) */
  function saveServer(res, requestStartedAt) {
    const phone = S.getPhone();
    if (!phone || !res || !res.success) return;
    const v = read_(phone) || {};
    const pending = (Array.isArray(v.pending) ? v.pending : []).filter(function (p) { return p && p.at > requestStartedAt; });
    const keep = {};
    ['success', 'name', 'phone', 'email', 'memberType', 'shift', 'department', 'lastLogin', 'additionsList', 'editsList', 'stats'].forEach(function (f) { keep[f] = res[f]; });
    write_(phone, { res: keep, savedAt: Date.now(), pending: pending });
  }

  /* تعديل بيانات الحساب نجح: الاسم والإيميل والوردية والقسم في النسخة المحفوظة — A profile edit succeeded: patch the saved copy */
  function updateFields(fields) {
    const phone = S.getPhone();
    const v = read_(phone);
    if (!v || !v.res || !fields) return;
    ['name', 'email', 'shift', 'department'].forEach(function (f) { if (fields[f] != null) v.res[f] = fields[f]; });
    write_(phone, v);
  }

  /* العرض المحفوظ مدموجًا بالمعلّقات (الأحدث أولًا)، أو null — The saved view merged with pending entries, or null */
  function view() {
    const phone = S.getPhone();
    const v = read_(phone);
    if (!v || !v.res || !v.res.success) return null;
    const res = JSON.parse(JSON.stringify(v.res));
    const pending = Array.isArray(v.pending) ? v.pending : [];
    const adds = [], edits = [];
    for (let i = pending.length - 1; i >= 0; i--) { const p = pending[i]; if (p && p.entry) (p.kind === 'add' ? adds : edits).push(p.entry); }
    res.additionsList = adds.concat(res.additionsList || []).slice(0, LIST_MAX);
    res.editsList = edits.concat(res.editsList || []).slice(0, LIST_MAX);
    const st = res.stats || { additions: 0, edits: 0, total: 0 };
    res.stats = { additions: (st.additions || 0) + adds.length, edits: (st.edits || 0) + edits.length, total: (st.total || 0) + adds.length + edits.length };
    res.fromDevice = true;
    return res;
  }

  global.SecProfileCache = { recordSave: recordSave, saveServer: saveServer, view: view, updateFields: updateFields };
})(typeof window !== 'undefined' ? window : globalThis);
