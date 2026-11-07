/**
 * ===================================================
 * 18_Versions.gs — إدارة نسخ الموقع: أحدث نسخة، ونسبة المحدَّثين، والمهلة، ومنع الكتابة من النسخ القديمة (8 نوفمبر 2026)
 * ===================================================
 * - أحدث نسخة يقرؤها الخادم من sw.js المنشور على GitHub (SITE_SW_URL) مرة في الساعة، لا مما يرسله الجوال حتى لا تُزوَّر.
 * - المشغّل الساعي يحسب من «سجل الاستخدام اليومي» نسبة الأعضاء النشطين خلال آخر 7 أيام الذين يعملون بأحدث نسخة بالضبط.
 * - بلوغ «نسبة التحديث المطلوبة» أو مرور «أقصى انتظار بالأيام» ← تبدأ «مهلة التحديث بالساعات»، وبعدها تُمنع الكتابة من النسخ
 *   الأقدم. و«أقل نسخة مسموحة» تمنع الأقدم فورًا (طوارئ). كل القيم من شيت «الإعدادات».
 * - الأجهزة التي لا ترسل رقم نسخة (قبل هذا التحديث) مسموح لها حتى تاريخ «إيقاف النسخ بلا رقم بعد».
 * - المنع على إجراءات الكتابة والإدارة فقط (VERSION_GATED)؛ البحث والمزامنة والدخول وسجل الأخطاء لا تُمنع أبدًا.
 *
 * Site version management: the latest version is read hourly from the published sw.js (never from what phones send); the
 * hourly trigger computes, from the daily usage log, the share of active members (last 7 days) on exactly the latest version.
 * Reaching the target share, or the maximum wait, starts the grace period; after it old versions can't write. «Lowest allowed
 * version» blocks older ones at once. Devices sending no version are allowed until the cutoff date. Only writes and admin
 * actions are gated; search, sync, login and the error log never are.
 * ===================================================
 */

const VERSION_POLICY_KEY = 'version_policy';      // خاصية السكربت: حالة النسخ / the script property holding the version state
const VERSION_POLICY_CACHE_SECONDS = 300;
const VERSION_ACTIVE_DAYS = 7;                     // «الأعضاء النشطون» = من استخدم الموقع خلال آخر 7 أيام / active = used the site in the last 7 days
const BUILD_RE = /^\d{8}-\d{6}/;
const OUTDATED_MSG = 'نسختك من التطبيق قديمة — أغلقه وافتحه مع اتصال جيد ليتحدث، ثم أعد المحاولة';

// الإجراءات الممنوعة على النسخ القديمة بعد المهلة — the actions old versions can't run after the grace period
const VERSION_GATED = {
  addNewStation: 1, updateCoordinates: 1, deleteStation: 1, updateMemberProfile: 1,
  getOperationsDashboard: 1, getActiveUsersDetail: 1, getChangesLog: 1, getVisitorsChart: 1, getPeakHoursHeatmap: 1,
  getRegionActivity: 1, getMembersList: 1, getDailyReport: 1
};

/* رقم نسخة صالح أو فارغ — a valid version number, or empty */
function buildOrEmpty_(value) {
  const s = typeof value === 'string' ? value.trim().slice(0, 40) : '';
  return BUILD_RE.test(s) && /^[0-9-]+$/.test(s) ? s : '';
}

/* تاريخ النسخة نصًا «yyyy-MM-dd HH:mm» — the version's date as text */
function buildDateText_(build) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(build || '');
  return m ? m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] : '';
}

function readVersionPolicy_() {
  try { return JSON.parse(scriptProps_().getProperty(VERSION_POLICY_KEY) || '{}') || {}; } catch (err) { return {}; }
}

/* أحدث نسخة منشورة من sw.js على GitHub، أو '' إن تعذّر — the latest published version from sw.js, or '' */
function fetchPublishedBuild_() {
  try {
    const res = UrlFetchApp.fetch(SITE_SW_URL + '?v=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return '';
    const m = /const SW_BUILD = '([^']*)'/.exec(res.getContentText());
    return m ? buildOrEmpty_(m[1]) : '';
  } catch (err) {
    return '';
  }
}

/* نسبة الأعضاء النشطين على أحدث نسخة بالضبط — the share of active members on exactly the latest version
 * ← { active, updated, pct } من آخر صف لكل جوال خلال آخر 7 أيام / from each phone's newest row in the last 7 days */
function updatedShare_(latest, now) {
  const sheet = sheet_(SHEETS.USAGE), headers = HEADERS[SHEETS.USAGE];
  const cDay = headers.indexOf('التاريخ'), cPhone = headers.indexOf('الجوال'), cVer = headers.indexOf('رقم النسخة');
  const oldest = riyadhDay_(new Date(now.getTime() - VERSION_ACTIVE_DAYS * 86400000));
  const last = {};
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (r) {
      const day = r[cDay] instanceof Date ? riyadhDay_(r[cDay]) : String(r[cDay] || ''), phone = String(r[cPhone] || '');
      if (!phone || day < oldest) return;
      if (!last[phone] || day >= last[phone].day) last[phone] = { day: day, ver: String(r[cVer] || '') };
    });
  }
  const phones = Object.keys(last), updated = phones.filter(function (p) { return last[p].ver === latest; }).length;
  return { active: phones.length, updated: updated, pct: phones.length ? Math.round(updated / phones.length * 100) : 0 };
}

/* المشغّل الساعي: يحدّث حالة النسخ — the hourly trigger: refreshes the version state */
function refreshVersionPolicy() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const now = new Date(), policy = readVersionPolicy_(), latest = fetchPublishedBuild_();
    if (latest && latest !== policy.latest) { // نسخة جديدة نُشرت ← تبدأ المتابعة من جديد / a new version was published ← tracking restarts
      policy.latest = latest; policy.latestSeenAt = now.getTime(); policy.graceStartAt = null; policy.notified = false;
    }
    if (policy.latest) {
      const share = updatedShare_(policy.latest, now);
      policy.share = share;
      const target = Number(getSetting_(SETTING_KEYS.UPDATE_TARGET_PCT)) || 90, maxDays = Number(getSetting_(SETTING_KEYS.UPDATE_MAX_DAYS)) || 7;
      const waitedDays = (now.getTime() - (policy.latestSeenAt || now.getTime())) / 86400000;
      if (!policy.graceStartAt && ((share.active && share.pct >= target) || waitedDays >= maxDays)) {
        policy.graceStartAt = now.getTime(); policy.graceReason = share.active && share.pct >= target ? 'pct' : 'days';
      }
    }
    policy.checkedAt = now.getTime();
    scriptProps_().setProperty(VERSION_POLICY_KEY, JSON.stringify(policy));
    CacheService.getScriptCache().remove(VERSION_POLICY_KEY);
  } catch (err) {
    logError_('refreshVersionPolicy', String(err), '');
  } finally {
    lock.releaseLock();
  }
  countTriggerPropOps_();
}

/* الحالة الفعالة لكل طلب (من الكاش 5 دقائق): أقل نسخة مسموحة، وهل تُمنع الأجهزة بلا رقم
 * The effective state per request (cached 5 minutes): the lowest allowed version, and whether version-less devices are blocked */
function versionGate_() {
  if (requestMemo_.versionGate) return requestMemo_.versionGate;
  const cache = CacheService.getScriptCache();
  let gate = null;
  try { gate = JSON.parse(cache.get(VERSION_POLICY_KEY) || 'null'); } catch (err) { gate = null; }
  if (!gate) {
    const policy = readVersionPolicy_(), now = Date.now();
    const graceHours = Number(getSetting_(SETTING_KEYS.UPDATE_GRACE_HOURS)) || 24;
    const byGrace = policy.latest && policy.graceStartAt && now >= policy.graceStartAt + graceHours * 3600000 ? policy.latest : '';
    const manual = buildOrEmpty_(getSetting_(SETTING_KEYS.MIN_ALLOWED_BUILD));
    const cutoff = String(getSetting_(SETTING_KEYS.UNVERSIONED_CUTOFF) || '').trim();
    gate = { min: manual > byGrace ? manual : byGrace, blockUnversioned: /^\d{4}-\d{2}-\d{2}$/.test(cutoff) && riyadhDay_(new Date()) > cutoff };
    try { cache.put(VERSION_POLICY_KEY, JSON.stringify(gate), VERSION_POLICY_CACHE_SECONDS); } catch (err) { /* لا يُفشل الطلب / never fails the request */ }
  }
  requestMemo_.versionGate = gate;
  return gate;
}

/* رد المنع أو null — the refusal reply, or null */
function versionRefusal_(action, data) {
  if (!VERSION_GATED[action]) return null;
  const gate = versionGate_(), ver = buildOrEmpty_(data.appVersion);
  if (!ver) return gate.blockUnversioned ? { error: OUTDATED_MSG, code: 'OUTDATED' } : null;
  return gate.min && ver < gate.min ? { error: OUTDATED_MSG, code: 'OUTDATED' } : null;
}

/* «ما الجديد» ونسخة الخروج الإجباري لبطاقة التحديث (عام) — what's new and the forced-logout version for the update card (public) */
function getUpdateInfo() {
  return { success: true, whatsNew: getSetting_(SETTING_KEYS.WHATS_NEW), logoutBuild: buildOrEmpty_(getSetting_(SETTING_KEYS.LOGOUT_WITH_BUILD)) };
}

/* سطر حالة التحديث للتقرير اليومي — the update-status line for the daily report */
function versionReportLine_() {
  const p = readVersionPolicy_();
  if (!p.latest) return '';
  const share = p.share || { active: 0, updated: 0, pct: 0 };
  const grace = Number(getSetting_(SETTING_KEYS.UPDATE_GRACE_HOURS)) || 24;
  let line = 'آخر نسخة ' + buildDateText_(p.latest) + ': حدّث ' + share.updated + ' من ' + share.active + ' عضو نشط (' + share.pct + '%)';
  if (p.graceStartAt) line += ' — بدأت مهلة ' + grace + ' ساعة' + (p.graceReason === 'days' ? ' (مرور أقصى انتظار)' : '') + '، وبعدها تُمنع الكتابة من النسخ الأقدم';
  return line;
}

/* تثبيت المشغّل الساعي يدويًا من المحرر (مرة واحدة)، ويحذف أي نسخة سابقة منه
 * Install the hourly trigger manually from the editor (once); removes any previous copy */
function تثبيت_مشغل_متابعة_النسخ() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'refreshVersionPolicy') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshVersionPolicy').timeBased().everyHours(1).create();
  refreshVersionPolicy();
  console.log('ثُبّت مشغّل متابعة النسخ (كل ساعة): ' + JSON.stringify(readVersionPolicy_()));
}
