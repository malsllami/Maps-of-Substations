/**
 * ===================================================
 * 02_Auth.gs — الهوية: الجوال، التذكرة الموقّعة، الدخول برقم الجوال، ومستويات التحقق
 * ===================================================
 * - تنسيق الجوال ومطابقته (عقد ثابت مع البيانات المنسوخة).
 * - التذكرة: {phone, exp, iat, via} بتوقيع HMAC-SHA256 بمفتاح V2 الخاص (يُنشأ تلقائيًا أول مرة).
 *   via = 'fingerprint' أو 'phone' داخل الجزء الموقّع، فلا يمكن تزويره.
 * - **المدير = جوال يطابق «رقم جوال المدير السري» + تذكرة صادرة من دخول بالبصمة.** الدخول برقم الجوال
 *   يعطي صلاحية عضو دائمًا حتى لرقم المدير.
 * - مستويات التحقق للموجّه (01_Api) بنفس قواعد V1 لكل إجراء.
 *
 * Identity: phone, signed ticket, phone login and check levels.
 * - Phone formatting and matching (a fixed contract with the copied data).
 * - Ticket: {phone, exp, iat, via} signed HMAC-SHA256 with V2's own secret (created automatically).
 *   via = 'fingerprint' or 'phone' inside the signed part, so it cannot be forged.
 * - **Admin = a phone matching the secret admin phone + a ticket issued by a fingerprint login.** A phone
 *   login always gives member rights, even for the admin's number.
 * - Check levels for the router (01_Api), with V1's rules per action.
 * ===================================================
 */

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;          // صلاحية التذكرة 30 يومًا / ticket lifetime 30 days
const TOKEN_RENEW_GRACE_MS = 180 * 24 * 3600 * 1000; // تجديد المنتهية حتى 180 يومًا إن صح توقيعها / renew an expired one up to 180 days if its signature is valid
const LOGIN_VIA = { FINGERPRINT: 'fingerprint', PHONE: 'phone' };
const SECRET_KEY = 'IDENTITY_SECRET';
const KNOWN_COUNTRY_CODES = ['+966', '+971', '+973', '+965', '+974', '+968', '+962', '+20'];

const MSG = {
  TOKEN_INVALID: 'الجلسة منتهية أو غير صالحة — سجّل الدخول من جديد',
  TOKEN_TOO_OLD: 'الجلسة منتهية — سجّل الدخول من جديد',
  PHONE_INVALID: 'رقم الجوال غير صحيح',
  PHONE_NOT_REGISTERED: 'رقم الجوال غير مسجَّل',
  MEMBERSHIP_SUSPENDED: 'العضوية موقوفة، تواصل مع المدير',
  ACCOUNT_DISABLED: 'حسابك معطل، تواصل مع المدير',
  LOGIN_REQUIRED: 'يجب تسجيل الدخول لعرض بيانات المحطات',
  ADMIN_ONLY: 'هذه اللوحة مخصّصة للمدير فقط'
};

// ===== الجوال — Phone =====

/* توحيد الجوال: أرقام عربية، 00، 05، رمز الدولة، أصفار زائدة؛ الصالح فقط ‎+‎ ثم 10–13 رقمًا
 * Normalize a phone: Arabic digits, 00, 05, country code, extra zeros; valid only + then 10–13 digits */
function formatPhone(phone) {
  if (phone === null || phone === undefined || phone === '') return null;
  let p = normalizeDigits_(String(phone).trim()).replace(/[\s-]/g, '');
  if (p.indexOf('00') === 0) p = '+' + p.slice(2);
  if (p.indexOf('05') === 0) p = '+966' + p.slice(1);
  if (p.charAt(0) !== '+') {
    const bare = KNOWN_COUNTRY_CODES.map(function (c) { return c.slice(1); }).sort(function (a, b) { return b.length - a.length; })
      .filter(function (d) { return p.indexOf(d) === 0; })[0];
    p = bare ? '+' + p : '+966' + p;
  }
  const code = KNOWN_COUNTRY_CODES.filter(function (c) { return p.indexOf(c) === 0; })[0];
  if (code) p = code + p.slice(code.length).replace(/^0+/, '');
  return /^\+\d{10,13}$/.test(p) ? p : null;
}

/* مطابقة جوالين بآخر 9 أرقام — Match two phones by their last 9 digits */
function phonesMatch_(a, b) {
  const last9 = function (s) { return String(s == null ? '' : s).replace(/\D/g, '').slice(-9); };
  const x = last9(a), y = last9(b);
  return x.length === 9 && x === y;
}

/* الأرقام العربية ← إنجليزية — Arabic-Indic digits ← Western */
function normalizeDigits_(s) {
  return String(s).replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); });
}

// ===== التذكرة — Ticket =====

/* مفتاح توقيع التذاكر. حارس (16 أكتوبر): قراءة فارغة عابرة لا تستبدل المفتاح — يُعاد القراءة تحت قفل السكربت قبل أي إنشاء،
 * وأي إنشاء لمفتاح جديد يُسجَّل في «سجل الأخطاء» (لأنه يُخرج كل المستخدمين) فلا يمر بصمت.
 * The ticket signing key. Guard: a transient empty read never replaces the key — re-read under the script lock before
 * creating one, and any new key is logged (it logs every user out) so it never passes silently. */
function identitySecret_() {
  const props = scriptProps_();
  let secret = props.getProperty(SECRET_KEY);
  if (secret) return secret;
  const lock = LockService.getScriptLock();
  const locked = lock.tryLock(10000);
  try {
    Utilities.sleep(200);
    secret = props.getProperty(SECRET_KEY); // إعادة القراءة: قراءة فارغة عابرة / re-read: a transient empty read
    if (secret) return secret;
    if (!locked) throw new Error('تعذّر قفل إنشاء مفتاح التوقيع — لم يُنشأ مفتاح جديد'); // لا إنشاء بلا قفل / never create without the lock
    secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(SECRET_KEY, secret);
    logError_('identitySecret_', 'أُنشئ مفتاح توقيع جديد للتذاكر — كل الجلسات السابقة صارت غير صالحة', 'إن لم يكن هذا أول تشغيل للخادم فهذا يُخرج كل المستخدمين');
    return secret;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function sign_(payloadB64) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payloadB64, identitySecret_()));
}

/* إصدار تذكرة — Issue a ticket */
function issueToken_(phone, via) {
  const now = Date.now();
  const payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify({ phone: phone, exp: now + TOKEN_TTL_MS, iat: now, via: via }));
  return payloadB64 + '.' + sign_(payloadB64);
}

/* محتوى تذكرة صحيحة التوقيع (بلا فحص الانتهاء) أو null — The payload of a correctly signed ticket (no expiry check), or null */
function readToken_(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!constantTimeEqual_(sign_(parts[0]), parts[1])) return null;
  try {
    const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    if (!payload || !payload.phone || !payload.exp || (payload.via !== LOGIN_VIA.FINGERPRINT && payload.via !== LOGIN_VIA.PHONE)) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

/* محتوى تذكرة صالحة غير منتهية أو null — The payload of a valid, unexpired ticket, or null */
function verifyToken_(token) {
  const payload = readToken_(token);
  return payload && payload.exp >= Date.now() ? payload : null;
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* الدور: مدير فقط لجوال المدير السري مع دخول بالبصمة — Role: admin only for the secret admin phone with a fingerprint login */
function roleFor_(phone, via) {
  return via === LOGIN_VIA.FINGERPRINT && isAdminPhone_(phone) ? 'admin' : 'member';
}

// ===== الإجراءات — Actions =====

/* الدخول برقم الجوال — صلاحية عضو دائمًا — Phone login — always member rights */
function loginByPhone(data) {
  const phone = formatPhone(data.phone);
  if (!phone) { logLoginFailure_(data.phone, LOGIN_LOG.PHONE, MSG.PHONE_INVALID); return { error: MSG.PHONE_INVALID }; }
  const member = findMember_(phone);
  if (!member) { logLoginFailure_(phone, LOGIN_LOG.PHONE, MSG.PHONE_NOT_REGISTERED); return { error: MSG.PHONE_NOT_REGISTERED }; }
  if (member.status !== MEMBER_STATUS.ACTIVE) { logLoginFailure_(phone, LOGIN_LOG.PHONE, MSG.MEMBERSHIP_SUSPENDED); return { error: MSG.MEMBERSHIP_SUSPENDED }; }
  logVisit_(phone, LOGIN_LOG.PHONE, 'نجاح');
  return { success: true, role: 'member', name: member.name, identityToken: issueToken_(phone, LOGIN_VIA.PHONE) };
}

/* تجديد التذكرة: تقبل المنتهية حتى 180 يومًا إن صح توقيعها، وتحافظ على نوع الدخول
 * Renew the ticket: accepts an expired one up to 180 days if its signature is valid, and keeps the login type */
function refreshIdentityToken(data) {
  const payload = readToken_(data.identityToken);
  if (!payload) return { error: MSG.TOKEN_INVALID, code: 'TOKEN_INVALID' };
  if (payload.exp < Date.now() - TOKEN_RENEW_GRACE_MS) return { error: MSG.TOKEN_TOO_OLD, code: 'TOKEN_INVALID' };
  const member = findMember_(payload.phone);
  if (!member) return { error: MSG.PHONE_NOT_REGISTERED, code: 'TOKEN_INVALID' };
  if (member.status === MEMBER_STATUS.DISABLED) return { error: MSG.ACCOUNT_DISABLED, code: 'TOKEN_INVALID' };
  return { success: true, identityToken: issueToken_(payload.phone, payload.via), role: roleFor_(payload.phone, payload.via) };
}

// ===== مستويات التحقق للموجّه — Check levels for the router =====

/* يُرجع { auth } عند النجاح أو { deny: رد الرفض } — Returns { auth } on success or { deny: the refusal reply } */
function checkAccess_(route, data) {
  switch (route.access) {
    case ACCESS.PUBLIC:
      return { auth: null };
    case ACCESS.MEMBER: { // جوال عضو موجود (قاعدة V1) / an existing member's phone (V1 rule)
      const phone = formatPhone(data.phone);
      if (!phone || !findMember_(phone)) return { deny: { error: route.deniedMessage || MSG.LOGIN_REQUIRED } };
      return { auth: { phone: phone } };
    }
    case ACCESS.TOKEN: {
      const payload = verifyToken_(data.identityToken);
      if (!payload) return { deny: { error: MSG.TOKEN_INVALID, code: 'TOKEN_INVALID' } };
      return { auth: { phone: payload.phone, via: payload.via } };
    }
    case ACCESS.ADMIN: {
      const payload = verifyToken_(data.identityToken);
      if (!payload) {
        logAdminDenied_(route, data, 'TOKEN_INVALID', null);
        return { deny: { success: false, error: MSG.TOKEN_TOO_OLD, code: 'TOKEN_INVALID' } };
      }
      if (roleFor_(payload.phone, payload.via) !== 'admin') {
        logAdminDenied_(route, data, isAdminPhone_(payload.phone) ? 'ADMIN_VIA_PHONE' : 'NOT_ADMIN_PHONE', payload.phone);
        return { deny: { success: false, error: route.deniedMessage || MSG.ADMIN_ONLY, code: 'NOT_ADMIN' } };
      }
      return { auth: { phone: payload.phone, via: payload.via, admin: true } };
    }
    default:
      throw new Error('مستوى تحقق غير معروف: ' + route.access);
  }
}

/* تشخيص رفض لوحة المدير في «سجل الأخطاء» (للإجراءات المعلَّمة logDenied): السبب وآخر 4 أرقام فقط — لا التذكرة ولا السر
 * Admin-dashboard refusal diagnostics in the error log (for logDenied actions): the reason and the last 4 digits only — never the ticket or secret */
function logAdminDenied_(route, data, reason, phone) {
  if (!route.logDenied) return;
  logError_(String(data.action), 'رفض دخول لوحة المدير: ' + reason, 'reason=' + reason + ', phone=' + (phone ? '***' + String(phone).slice(-4) : 'null'));
}
