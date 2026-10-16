/**
 * ===================================================
 * 07_Members.gs — الأعضاء: البحث، التسجيل، الملف الكامل والمختصر، تعديل البيانات، وقوائم الإعدادات
 * ===================================================
 * - البحث بآخر 9 أرقام من الجوال، من كاش الجدول (5 دقائق) ويُبطل فور أي كتابة.
 * - التسجيل يمنع الرقم المكرر، ويكتب الجوال نصًا (لا تحذف جوجل علامة +)، ويعطي تذكرة دخول بالجوال.
 * - «آخر دخول ناجح» يحتسب الدخول بالبصمة وبرقم الجوال معًا.
 * - قوائم الورديات والأقسام والدول وأنواع العضوية تُقرأ من «الإعدادات» لا من الكود.
 *
 * Members: lookup, registration, full and lite profile, profile edit, and settings lists.
 * - Lookup by the phone's last 9 digits, from the table cache (5 minutes), invalidated on every write.
 * - Registration refuses a duplicate number, writes the phone as text, and issues a phone-login ticket.
 * - «Last successful login» counts fingerprint and phone logins alike.
 * - Shift, department, country and membership-type lists come from «الإعدادات», not from code.
 * ===================================================
 */

const MEMBERS_CACHE_KEY = 'members_rows';
const PROFILE_LIST_MAX = 50;
// الحذف يُسجَّل ليعرف الجهاز ما حُذف دون تحميل كامل (اقتراح محمد 16 أكتوبر)؛ «حذف_يدوي» = حذف صف من الشيت اكتشفه المشغّل
// Deletions are logged so devices learn what was removed without a full load; «manual» = a sheet row removal found by the trigger
const AUDIT_TYPE = { ADD: 'إضافة_محطة_جديدة', EDIT: 'تعديل_إحداثية', PROFILE: 'تعديل_بيانات_شخصية', DELETE: 'حذف_محطة', MANUAL_DELETE: 'حذف_يدوي' };
// أسماء الدخول في «سجل الزوار»: «دخول بالبصمة» منذ 16 أكتوبر (كان «دخول» قبلها ويبقى مقروءًا للصفوف القديمة)
// Login names in the visits log: «دخول بالبصمة» since 16 Oct (formerly «دخول», still read for old rows)
const LOGIN_LOG = { FINGERPRINT: 'دخول بالبصمة', PHONE: 'دخول برقم الجوال', LEGACY_FINGERPRINT: 'دخول' };
const LOGIN_ACTIONS = [LOGIN_LOG.FINGERPRINT, LOGIN_LOG.LEGACY_FINGERPRINT, LOGIN_LOG.PHONE];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MEMBER_MSG = {
  NAME_SHORT: 'الاسم يجب أن يكون ٣ أحرف على الأقل',
  PHONE_REQUIRED: 'رقم الجوال مطلوب',
  EMAIL_INVALID: 'الرجاء إدخال بريد إلكتروني صحيح',
  SHIFT_REQUIRED: 'حدد الوردية',
  DEPARTMENT_REQUIRED: 'حدد القسم',
  PHONE_FORMAT: 'رقم جوال غير صحيح',
  ALREADY_REGISTERED: 'هذا الرقم مسجل مسبقًا، سجّل الدخول بدل التسجيل',
  NOT_FOUND: 'العضو غير موجود'
};

// ===== البحث — Lookup =====

/* أول عضو يطابق الجوال (مع رقم صفه) أو null — The first member matching the phone (with its row number), or null */
function findMember_(phone) {
  const rows = cachedRows_(MEMBERS_CACHE_KEY, SHEETS.MEMBERS);
  const c = COL.MEMBER;
  for (let i = 1; i < rows.length; i++) {
    if (!phonesMatch_(rows[i][c.PHONE], phone)) continue;
    return {
      row: i + 1, name: String(rows[i][c.NAME] || ''), phone: formatPhone(rows[i][c.PHONE]) || formatPhone(phone), email: String(rows[i][c.EMAIL] || ''),
      memberType: String(rows[i][c.MEMBER_TYPE] || ''), shift: String(rows[i][c.SHIFT] || ''), status: String(rows[i][c.STATUS] || '').trim(),
      department: String(rows[i][c.DEPARTMENT] || '')
    };
  }
  return null;
}

function invalidateMembers_() {
  invalidateCache_(MEMBERS_CACHE_KEY);
}

// ===== قوائم الإعدادات — Settings lists =====

/* القوائم التي تحتاجها الواجهة (نماذج التسجيل والملف والمراسلة) — The lists the front end needs */
function getSettingsLists() {
  return {
    success: true,
    shifts: getSettingList_(SETTING_KEYS.SHIFTS),
    departments: getSettingList_(SETTING_KEYS.DEPARTMENTS),
    memberTypes: getSettingList_(SETTING_KEYS.MEMBER_TYPES),
    countries: getSettingList_(SETTING_KEYS.COUNTRIES).map(function (item) {
      const parts = item.split(':');
      return { name: parts[0].trim(), code: (parts[1] || '').trim() };
    }).filter(function (c) { return /^\+\d{1,4}$/.test(c.code); })
  };
}

/* التحقق من بيانات العضو المشتركة بين التسجيل والتعديل — Validation shared by registration and edit */
function validateMemberFields_(data, requireMemberType) {
  if (!data.name || String(data.name).trim().length < 3) return MEMBER_MSG.NAME_SHORT;
  if (!EMAIL_RE.test(String(data.email || '').trim())) return MEMBER_MSG.EMAIL_INVALID;
  if (requireMemberType) {
    const types = getSettingList_(SETTING_KEYS.MEMBER_TYPES);
    if (types.indexOf(String(data.memberType || '')) === -1) return 'حدد نوع العضوية: ' + types.join(' أو ');
  }
  if (!data.shift || getSettingList_(SETTING_KEYS.SHIFTS).indexOf(String(data.shift)) === -1) return MEMBER_MSG.SHIFT_REQUIRED;
  if (!data.department || !String(data.department).trim()) return MEMBER_MSG.DEPARTMENT_REQUIRED;
  return '';
}

// ===== التسجيل — Registration =====

function registerUser(data) {
  if (!data.name || String(data.name).trim().length < 3) return { error: MEMBER_MSG.NAME_SHORT };
  if (!data.phone) return { error: MEMBER_MSG.PHONE_REQUIRED };
  const invalid = validateMemberFields_(data, true);
  if (invalid) return { error: invalid };
  const phone = formatPhone(data.phone);
  if (!phone) return { error: MEMBER_MSG.PHONE_FORMAT };
  if (findMember_(phone)) return { error: MEMBER_MSG.ALREADY_REGISTERED };

  // الجوال يُكتب بعلامة اقتباس فيبقى نصًا (+966…) — the phone is written with an apostrophe so it stays text (+966…)
  appendFormattedRow_(sheet_(SHEETS.MEMBERS), [
    sanitizeSheetText_(String(data.name).trim()), sanitizeSheetText_(phone), sanitizeSheetText_(String(data.email).trim()), 'عضو',
    String(data.memberType), sanitizeSheetText_(data.shift), MEMBER_STATUS.ACTIVE, nowStamp_(), sanitizeSheetText_(String(data.department).trim())
  ]);
  invalidateMembers_();
  logVisit_(phone, 'تسجيل_عضو', 'نجاح');
  return { success: true, identityToken: issueToken_(phone, LOGIN_VIA.PHONE) };
}

// ===== الملف — Profile =====

/* الملف المختصر (الرئيسية والورديات) — The lite profile (home and shifts) */
function getMemberProfileLite(data, auth) {
  const member = findMember_(auth.phone);
  if (!member) return { error: MEMBER_MSG.NOT_FOUND };
  return {
    success: true, name: member.name, phone: member.phone, email: member.email, memberType: member.memberType,
    role: roleFor_(auth.phone, auth.via), status: member.status, shift: member.shift, department: member.department
  };
}

/* الملف الكامل (حسابي): آخر دخول ناجح بأي طريقة، والإضافات والتعديلات — The full profile («My account») */
function getMemberProfile(data, auth) {
  const member = findMember_(auth.phone);
  if (!member) return { error: MEMBER_MSG.NOT_FOUND };
  const lastVisit = perfMeasure_('آخر دخول', function () { return findLastVisit_(auth.phone, LOGIN_ACTIONS); });
  const activity = perfMeasure_('المساهمات', function () { return memberActivity_(auth.phone); });
  return {
    success: true, name: member.name, phone: member.phone, email: member.email, memberType: member.memberType,
    role: roleFor_(auth.phone, auth.via), shift: member.shift, department: member.department,
    lastLogin: lastVisit ? lastVisit.time : null,
    additionsList: activity.additions.slice(0, PROFILE_LIST_MAX), editsList: activity.edits.slice(0, PROFILE_LIST_MAX),
    stats: { additions: activity.additions.length, edits: activity.edits.length, total: activity.additions.length + activity.edits.length }
  };
}

/* إضافات العضو وتعديلاته من «سجل التعديلات» (الأحدث أولًا) — The member's additions and edits from the audit log (newest first) */
function memberActivity_(phone) {
  const rows = readAllRows_(SHEETS.AUDIT);
  const regions = stationRegions_();
  const additions = [], edits = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const type = String(rows[i][2] || '');
    if ((type !== AUDIT_TYPE.ADD && type !== AUDIT_TYPE.EDIT) || !phonesMatch_(rows[i][1], phone)) continue;
    const t = rows[i][0] instanceof Date ? rows[i][0] : new Date(rows[i][0]);
    if (isNaN(t)) continue;
    const id = String(rows[i][3] || '');
    const entry = { stationId: id, region: regions[normalizeStationId_(id)] || '—', date: Utilities.formatDate(t, TIMEZONE, 'dd/MM/yyyy'), time: Utilities.formatDate(t, TIMEZONE, 'HH:mm:ss') };
    (type === AUDIT_TYPE.ADD ? additions : edits).push(entry);
  }
  return { additions: additions, edits: edits };
}

// ===== تعديل البيانات — Profile edit =====

function updateMemberProfile(data, auth) {
  const invalid = validateMemberFields_(data, false);
  if (invalid) return { error: invalid };
  const member = findMember_(auth.phone);
  if (!member) return { error: MEMBER_MSG.NOT_FOUND };
  const sheet = sheet_(SHEETS.MEMBERS), c = COL.MEMBER;
  sheet.getRange(member.row, c.NAME + 1).setValue(sanitizeSheetText_(String(data.name).trim()));
  sheet.getRange(member.row, c.EMAIL + 1).setValue(sanitizeSheetText_(String(data.email).trim()));
  sheet.getRange(member.row, c.SHIFT + 1).setValue(sanitizeSheetText_(data.shift));
  sheet.getRange(member.row, c.DEPARTMENT + 1).setValue(sanitizeSheetText_(String(data.department).trim()));
  invalidateMembers_();
  logAudit_(auth.phone, AUDIT_TYPE.PROFILE, auth.phone, String(data.name).trim());
  return { success: true };
}
