/**
 * ===================================================
 * 09_Stats.gs — إحصاءات البطاقات: عدد المحطات، إضافات وتعديلات اليوم، ونسبة التغير عن أمس
 * ===================================================
 * - الإجمالي = أرقام المحطات الفريدة (بعد توحيد الأرقام العربية والأحرف) من فهرس المحطات، فالمكرر لا يُحسب مرتين.
 * - إضافات وتعديلات اليوم من «سجل التعديلات» بحدود يوم الرياض (+03:00 ثابت)، وتقسيمها توزيع/تحويل حسب
 *   وجود الرقم في كل فهرس (التوزيع أولًا — قاعدة V1). تُعدّ الموجودة فعلًا فقط (15 أكتوبر)، والعمليات على محطات
 *   حُذفت تُعاد جدولًا للمراجعة (removedToday).
 * - نسبة التغير: أمس صفر ← null إن كان اليوم أكثر من صفر، و0 إن كانا صفرًا؛ وإلا النسبة مقرّبة.
 * - الإحصاءات واحدة لكل المستخدمين، فتُحسب مرة وتُحفظ بمفتاح «رقم الإصدار + تاريخ اليوم»:
 *   أي إضافة/تعديل/حذف يغيّر الإصدار ← مفتاح جديد فورًا؛ ويوم جديد ← مفتاح جديد؛ والتعديل اليدوي بالشيت
 *   يظهر خلال 5 دقائق (مدة الكاش).
 * - قفل قصير (1.5 ث) حول الحساب: إن وصل عدة مستخدمين معًا يحسبها واحد والباقون يقرؤون ناتجه؛ وإن تعذّر
 *   القفل يُحسب مباشرة بلا حفظ — لا يفشل أي طلب.
 *
 * Card stats: station counts, today's additions and edits, and the change versus yesterday.
 * - Total = unique station numbers (after normalizing) from the station index, so duplicates count once.
 * - Today's additions and edits come from the audit log within the Riyadh day (fixed +03:00), split
 *   distribution/substation by which index holds the number (distribution first — V1 rule).
 * - Change: yesterday zero ← null if today is above zero, 0 if both are zero; otherwise the rounded percentage.
 * - Stats are the same for everyone, so they're computed once and cached under "data version + today's date":
 *   any add/edit/delete changes the version ← a new key at once; a new day ← a new key; a manual sheet edit
 *   shows within 5 minutes (the cache lifetime).
 * - A short lock (1.5 s) around the computation: concurrent users ← one computes, the rest read its result;
 *   without the lock it computes directly without saving — no request ever fails.
 * ===================================================
 */

const STATS_CACHE_SECONDS = 300;
const STATS_LOCK_WAIT_MS = 1500;
const RIYADH_OFFSET_MS = 3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/* بداية يوم الرياض (ميلي ثانية) للحظة معطاة — The start of the Riyadh day (ms) for a moment */
function riyadhMidnightMs_(date) {
  const parts = Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd').split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) - RIYADH_OFFSET_MS;
}

/* مفتاح الكاش: الإصدار + تاريخ اليوم — The cache key: version + today's date */
function statsCacheKey_() {
  return 'stats_' + getDataVersion().version + '_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd');
}

function readStatsCache_(key) {
  try { return JSON.parse(CacheService.getScriptCache().get(key) || 'null'); } catch (err) { return null; }
}

/* الإجراء: من الكاش، أو حساب واحد تحت القفل — The action: from the cache, or one computation under the lock */
function getStats() {
  const key = statsCacheKey_();
  const hit = perfMeasure_('كاش الإحصاءات', function () { return readStatsCache_(key); }, function (r) { return r ? 'مصاب' : 'مفقود'; });
  if (hit) return hit;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(STATS_LOCK_WAIT_MS)) {
    return readStatsCache_(key) || perfMeasure_('حساب الإحصاءات (بلا قفل)', computeStats_);
  }
  try {
    const meanwhile = readStatsCache_(key);
    if (meanwhile) return meanwhile;
    const stats = perfMeasure_('حساب الإحصاءات', computeStats_);
    try { CacheService.getScriptCache().put(key, JSON.stringify(stats), STATS_CACHE_SECONDS); } catch (err) { /* لا يُفشل الطلب / never fails the request */ }
    return stats;
  } finally {
    lock.releaseLock();
  }
}

/* نسبة التغير عن أمس — The change versus yesterday */
function changePct_(today, yesterday) {
  if (yesterday === 0) return today > 0 ? null : 0;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

/* أرقام المحطات الفريدة في فهرسين (مجموعتان) — The unique station numbers of both indexes (two sets) */
function stationIdSets_() {
  const ids = function (index) { const set = {}; index.forEach(function (e) { set[e.n] = true; }); return set; };
  return { dist: ids(stationIndex_(STATION_TYPE.DISTRIBUTION)), sub: ids(stationIndex_(STATION_TYPE.SUBSTATION)) };
}

/* إضافات وتعديلات المحطات في [start, end) من صفوف «سجل التعديلات»، وتقسيمها توزيع/تحويل حسب وجود الرقم
 * (التوزيع أولًا — قاعدة V1). تستخدمها الإحصاءات (اليوم وأمس) والتقرير اليومي (أمس) بنفس القواعد.
 * قرار محمد (15 أكتوبر): تُعدّ المحطات الموجودة فعلًا فقط، فيتطابق الإجمالي مع التقسيم دائمًا. عملية على محطة لم تعد
 * موجودة (أُضيفت أو عُدّلت ثم حُذفت، أو رقم في السجل لا يقابله صف) لا تُعدّ، وتُعاد في «removed» جدولًا للمراجعة —
 * فيُحكم عليها: حذف طبيعي أم مشكلة فعلية.
 * Station adds and edits within [start, end) from the audit rows, split by which index holds the number
 * (distribution first — V1 rule). Used by the stats (today and yesterday) and the daily report (yesterday) alike.
 * Mohammed's decision (15 Oct): only stations that exist now are counted, so the total always matches the split. An
 * operation on a station that no longer exists is not counted and is returned in «removed» as a table to review. */
const REMOVED_LIST_MAX = 50;
function stationChanges_(rows, start, end, ids) {
  const c = { additions: 0, edits: 0, additionsDistribution: 0, additionsSubstations: 0, editsDistribution: 0, editsSubstations: 0, removed: [], removedCount: 0 };
  for (let i = 1; i < rows.length; i++) {
    const t = (rows[i][0] instanceof Date ? rows[i][0] : new Date(rows[i][0])).getTime();
    if (isNaN(t) || t < start || t >= end) continue;
    const type = String(rows[i][2] || ''), ref = normalizeStationId_(rows[i][3]);
    const kind = type === AUDIT_TYPE.ADD ? 'additions' : type === AUDIT_TYPE.EDIT ? 'edits' : null;
    if (!kind) continue;
    const part = ids.dist[ref] ? 'Distribution' : ids.sub[ref] ? 'Substations' : null;
    if (!part) { // لم تعد موجودة ← للمراجعة لا للعدّ / no longer exists ← for review, not counted
      c.removedCount++;
      if (c.removed.length < REMOVED_LIST_MAX) {
        const phone = String(rows[i][1] || '');
        c.removed.push({ id: String(rows[i][3] || '').trim(), table: auditTableOf_(rows[i][4]) || 'غير معروف', op: kind === 'additions' ? 'إضافة' : 'تعديل', at: new Date(t).toISOString(), by: phone ? '***' + phone.slice(-4) : '—' });
      }
      continue;
    }
    c[kind]++;
    c[kind + part]++;
  }
  return c;
}

/* الحساب الفعلي — The actual computation */
function computeStats_() {
  const ids = stationIdSets_();
  const startToday = riyadhMidnightMs_(new Date()), startYesterday = startToday - DAY_MS;
  const rows = perfMeasure_('سجل التعديلات', function () { return readAllRows_(SHEETS.AUDIT); }, function (r) { return r.length + ' صف'; });
  const today = stationChanges_(rows, startToday, Infinity, ids), yesterday = stationChanges_(rows, startYesterday, startToday, ids);
  const distCount = Object.keys(ids.dist).length, subCount = Object.keys(ids.sub).length;
  return {
    success: true,
    totalStations: distCount + subCount, distribution: distCount, substations: subCount,
    additions: today.additions, edits: today.edits,
    additionsChangePct: changePct_(today.additions, yesterday.additions), editsChangePct: changePct_(today.edits, yesterday.edits),
    additionsDistribution: today.additionsDistribution, additionsSubstations: today.additionsSubstations,
    editsDistribution: today.editsDistribution, editsSubstations: today.editsSubstations,
    // عمليات اليوم على محطات لم تعد موجودة — للمراجعة لا للعدّ (15 أكتوبر) / today's operations on stations that no longer exist
    removedToday: today.removed, removedTodayCount: today.removedCount,
    version: getDataVersion().version
  };
}
