/**
 * ===================================================
 * WebAuthn.gs — البصمة: التسجيل والدخول (العمليات التشفيرية في Crypto.gs)
 * ===================================================
 * عقد ثابت حتى تبقى البصمات المسجّلة في V1 صالحة: النطاق RP_ID والأصل، أعمدة «بصمات الأجهزة»،
 * معرّف المستخدم = بايتات الجوال المنسّق، ومفتاح ES256 (س، ص بالست عشري).
 * - رمز التحدي لمرة واحدة، يُحفظ باسمه مربوطًا بالجوال، صالح 5 دقائق.
 * - التحقق من الدخول يقرأ صف البصمة من الشيت مباشرة (حذف جهاز يمنعه فورًا، والعداد حديث دائمًا).
 * - تسجيل بصمة موجودة مسبقًا يُرفض.
 * - تذكرة البصمة تحمل via='fingerprint' — وهي وحدها التي تمنح صلاحية المدير (02_Auth).
 *
 * Fingerprint registration and login (the cryptography is in Crypto.gs). A fixed contract so V1's
 * registered fingerprints stay valid: RP_ID and origin, the credentials columns, user id = the formatted
 * phone's bytes, ES256 key (x, y in hex).
 * - A one-time challenge, stored under its own value bound to the phone, valid 5 minutes.
 * - Login verification reads the credential row straight from the sheet (deleting a device blocks it at once).
 * - Registering an already-registered credential is refused.
 * - A fingerprint ticket carries via='fingerprint' — the only kind that grants admin rights (02_Auth).
 * ===================================================
 */

const WEBAUTHN = {
  RP_ID: 'malsllami.github.io',
  RP_NAME: 'محطات التوزيع - SEC',
  ORIGIN: 'https://malsllami.github.io',
  CHALLENGE_TTL_SECONDS: 300
};
const CREDENTIALS_CACHE_KEY = 'credentials_rows';

const WA_MSG = {
  REGISTER_FIRST: 'سجّل بياناتك أولًا قبل تفعيل البصمة',
  NOT_REGISTERED_PHONE: 'رقم الجوال غير مسجل',
  NO_CREDENTIAL: 'لا يوجد بصمة مسجلة لهذا الرقم',
  EXPIRED: 'انتهت صلاحية الطلب، حاول مرة أخرى',
  WRONG_TYPE: 'نوع طلب غير صحيح',
  UNTRUSTED_ORIGIN: 'مصدر الطلب غير موثوق',
  NO_PUBLIC_KEY: 'لا يوجد مفتاح عام بالاستجابة',
  RP_MISMATCH: 'rpId غير مطابق',
  NOT_VERIFIED: 'لم يتم التحقق من المستخدم على الجهاز',
  DUPLICATE: 'هذه البصمة مسجلة مسبقًا',
  DEVICE_UNKNOWN: 'هذا الجهاز غير مسجل لهذا الحساب',
  BAD_SIGNATURE: 'فشل التحقق من التوقيع',
  CLONED: 'تنبيه أمني: تم رفض الدخول (احتمال نسخ الجهاز)',
  REGISTER_FAILED: 'فشل تفعيل البصمة',
  LOGIN_FAILED: 'فشل تسجيل الدخول بالبصمة'
};

// ===== رمز التحدي — Challenge =====

/* 32 بايتًا عشوائية آمنة من مولّد Utilities.getUuid — 32 secure random bytes from Utilities.getUuid */
function newChallenge_() {
  const hex = (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const bytes = [];
  for (let i = 0; i < 32; i++) bytes.push(parseInt(hex.substr(i * 2, 2), 16));
  return bytesToB64url(bytes);
}

function storeChallenge_(kind, phone, challenge) {
  CacheService.getScriptCache().put(kind + '_' + challenge, phone, WEBAUTHN.CHALLENGE_TTL_SECONDS);
}

/* يُرجع true ويحذف الرمز إن كان صادرًا لهذا الجوال وما زال صالحًا (لمرة واحدة) — true and deletes it if issued for this phone and still valid (single use) */
function takeChallenge_(kind, phone, challenge) {
  if (typeof challenge !== 'string' || !challenge || challenge.length > 200) return false;
  const cache = CacheService.getScriptCache(), key = kind + '_' + challenge;
  const owner = cache.get(key);
  if (!owner || !phonesMatch_(owner, phone)) return false;
  cache.remove(key);
  return true;
}

// ===== البصمات المسجّلة — Registered credentials =====

/* بصمات العضو لطلب الدخول (من الكاش — بيانات غير سرية لا تمنح دخولًا بذاتها) — The member's credentials for the login challenge (cached — non-secret) */
function credentialsFor_(phone) {
  const rows = cachedRows_(CREDENTIALS_CACHE_KEY, SHEETS.CREDENTIALS);
  const c = COL.CREDENTIAL, out = [];
  for (let i = 1; i < rows.length; i++) if (phonesMatch_(rows[i][c.PHONE], phone) && rows[i][c.ID]) out.push(String(rows[i][c.ID]));
  return out;
}

/* صف البصمة من الشيت مباشرة: نفس المعرّف (حساس للحالة) ونفس الجوال — The credential row straight from the sheet */
function findCredentialRow_(phone, credentialId) {
  if (!credentialId) return null;
  const sheet = sheet_(SHEETS.CREDENTIALS);
  const rows = findRowsByText_(sheet, COL.CREDENTIAL.ID, credentialId, true);
  for (let i = 0; i < rows.length; i++) {
    const row = readRow_(sheet, rows[i]);
    if (row[COL.CREDENTIAL.ID] === credentialId && phonesMatch_(row[COL.CREDENTIAL.PHONE], phone)) return { index: rows[i], row: row };
  }
  return null;
}

function bytesFromString_(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xff);
  return out;
}

function sameBytes_(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if ((a[i] & 0xff) !== (b[i] & 0xff)) return false;
  return true;
}

/* يقرأ clientDataJSON ويتحقق من نوعه وأصله ورمزه — Reads clientDataJSON and checks its type, origin and challenge */
function checkClientData_(b64, expectedType, kind, phone) {
  const bytes = b64urlDecodeToBytes(String(b64 || ''));
  const clientData = JSON.parse(utf8BytesToString(bytes));
  if (!takeChallenge_(kind, phone, clientData.challenge)) return { error: { error: WA_MSG.EXPIRED, expired: true } };
  if (clientData.type !== expectedType) return { error: { error: WA_MSG.WRONG_TYPE } };
  if (clientData.origin !== WEBAUTHN.ORIGIN) {
    logError_('WebAuthn origin mismatch', 'got=' + clientData.origin, phone);
    return { error: { error: WA_MSG.UNTRUSTED_ORIGIN } };
  }
  return { bytes: bytes };
}

// ===== التسجيل — Registration =====

function generateRegisterChallenge(data) {
  const phone = formatPhone(data.phone);
  if (!phone) return { error: MSG.PHONE_INVALID };
  const member = findMember_(phone);
  if (!member) return { error: WA_MSG.REGISTER_FIRST };
  const challenge = newChallenge_();
  storeChallenge_('reg', phone, challenge);
  return {
    success: true, challenge: challenge, rpId: WEBAUTHN.RP_ID, rpName: WEBAUTHN.RP_NAME,
    userIdB64: bytesToB64url(bytesFromString_(phone)), userName: phone, userDisplayName: member.name
  };
}

function registerCredential(data) {
  const phone = formatPhone(data.phone);
  if (!phone) return { error: MSG.PHONE_INVALID };
  try {
    const client = checkClientData_(data.clientDataJSONB64, 'webauthn.create', 'reg', phone);
    if (client.error) return client.error;
    const attestation = decodeCbor(b64urlDecodeToBytes(String(data.attestationObjectB64 || '')), 0).value;
    const auth = parseAuthData(attestation.authData);
    if (!auth.coseKey) return { error: WA_MSG.NO_PUBLIC_KEY };
    if (!sameBytes_(auth.rpIdHash, sha256(bytesFromString_(WEBAUTHN.RP_ID)))) return { error: WA_MSG.RP_MISMATCH };
    if (!auth.userVerified) return { error: WA_MSG.NOT_VERIFIED };

    const credentialId = bytesToB64url(auth.credentialId);
    const sheet = sheet_(SHEETS.CREDENTIALS);
    if (findRowsByText_(sheet, COL.CREDENTIAL.ID, credentialId, true).length) return { error: WA_MSG.DUPLICATE };

    const now = nowStamp_();
    appendFormattedRow_(sheet, [phone, credentialId, bytesToBigIntUnsigned(auth.coseKey[-2]).toString(16), bytesToBigIntUnsigned(auth.coseKey[-3]).toString(16),
      sanitizeSheetText_(data.deviceName || 'جهاز غير معروف'), auth.signCount, now, now]);
    invalidateCache_(CREDENTIALS_CACHE_KEY);
    const member = findMember_(phone);
    return { success: true, role: roleFor_(phone, LOGIN_VIA.FINGERPRINT), name: member ? member.name : '', identityToken: issueToken_(phone, LOGIN_VIA.FINGERPRINT) };
  } catch (err) {
    logError_('registerCredential exception', String(err), phone);
    return { error: WA_MSG.REGISTER_FAILED };
  }
}

// ===== الدخول — Login =====

function generateLoginChallenge(data) {
  const phone = formatPhone(data.phone);
  if (!phone) return { error: MSG.PHONE_INVALID };
  const member = findMember_(phone);
  if (!member) return { error: WA_MSG.NOT_REGISTERED_PHONE };
  if (member.status === MEMBER_STATUS.DISABLED) return { error: MSG.ACCOUNT_DISABLED };
  const ids = perfMeasure_('بصمات العضو', function () { return credentialsFor_(phone); }, function (r) { return r.length; });
  if (!ids.length) return { error: WA_MSG.NO_CREDENTIAL, notRegistered: true, name: member.name };
  const challenge = newChallenge_();
  storeChallenge_('login', phone, challenge);
  return { success: true, challenge: challenge, rpId: WEBAUTHN.RP_ID, allowCredentialIds: ids };
}

function verifyAssertion(data) {
  const phone = formatPhone(data.phone);
  if (!phone) return { error: MSG.PHONE_INVALID };
  try {
    const client = checkClientData_(data.clientDataJSONB64, 'webauthn.get', 'login', phone);
    if (client.error) return client.error;
    const cred = perfMeasure_('صف البصمة', function () { return findCredentialRow_(phone, data.credentialId); });
    if (!cred) return { error: WA_MSG.DEVICE_UNKNOWN };

    const authBytes = b64urlDecodeToBytes(String(data.authenticatorDataB64 || ''));
    const auth = parseAuthData(authBytes);
    if (!sameBytes_(auth.rpIdHash, sha256(bytesFromString_(WEBAUTHN.RP_ID)))) return { error: WA_MSG.RP_MISMATCH };
    if (!auth.userVerified) return { error: WA_MSG.NOT_VERIFIED };

    const signed = sha256(concatBytes(authBytes, sha256(client.bytes)));
    const rs = derSignatureToRS(b64urlDecodeToBytes(String(data.signatureB64 || '')));
    const c = COL.CREDENTIAL;
    const key = { x: BigInt('0x' + cred.row[c.PUB_X]), y: BigInt('0x' + cred.row[c.PUB_Y]) };
    if (!perfMeasure_('توقيع ECDSA', function () { return ecdsaVerifyP256(signed, rs.r, rs.s, key); })) {
      logError_('WebAuthn signature failed', 'phone=' + phone, phone);
      return { error: WA_MSG.BAD_SIGNATURE };
    }
    // العداد: الحماية الأساسية من الإعادة هي الرمز لمرة واحدة + التوقيع؛ العداد يرفض فقط التراجع غير الصفري (استنساخ)
    // Counter: the main replay defence is the one-time challenge + signature; the counter refuses only a non-zero step back (cloning)
    const stored = Number(cred.row[c.SIGN_COUNT]) || 0;
    if (auth.signCount > 0 && stored > 0 && auth.signCount < stored) {
      logError_('WebAuthn possible cloned device', 'phone=' + phone, phone);
      return { error: WA_MSG.CLONED };
    }
    if (auth.signCount === 0 && stored > 0) logError_('WebAuthn signCount reset (allowed)', 'phone=' + phone, phone);

    const sheet = sheet_(SHEETS.CREDENTIALS);
    sheet.getRange(cred.index, c.SIGN_COUNT + 1).setValue(auth.signCount);
    sheet.getRange(cred.index, c.LAST_USED + 1).setValue(nowStamp_());
    const member = findMember_(phone);
    logVisit_(phone, 'دخول', 'نجاح');
    return { success: true, role: roleFor_(phone, LOGIN_VIA.FINGERPRINT), name: member ? member.name : '', identityToken: issueToken_(phone, LOGIN_VIA.FINGERPRINT) };
  } catch (err) {
    logError_('verifyAssertion exception', String(err), phone);
    return { error: WA_MSG.LOGIN_FAILED };
  }
}
