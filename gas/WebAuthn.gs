/**
 * ===================================================
 * WebAuthn.gs — تسجيل + دخول بالبصمة
 * ===================================================
 * يستخدم دوال Crypto.gs (decodeCbor, parseAuthData, ecdsaVerifyP256,
 * إلخ) بدون أي تعديل عليها — تلك الدوال مُختبرة ضد Node's native
 * crypto وثابتة. هذا الملف فقط يربطها بمخطط جداول هذا المشروع.
 *
 * إعداد إلزامي قبل النشر: تأكد RP_ID و ALLOWED_ORIGIN يطابقان
 * دومين GitHub Pages الفعلي (بدون مسار فرعي، بدون شرطة بالنهاية).
 */

var WEBAUTHN_CONFIG = {
  RP_ID: 'malsllami.github.io',
  RP_NAME: 'محطات التوزيع - SEC',
  ALLOWED_ORIGIN: 'https://malsllami.github.io',
  CHALLENGE_TTL_SECONDS: 120
};

/* ===================================================
 *  أدوات جدول البصمات
 * =================================================== */
function getCredentialsSheet_() {
  // إعادة محاولة عند فشل GAS المؤقت في الوصول لخدمة جداول البيانات
  // Retry on transient GAS Spreadsheet-service failures
  return withSheetRetry_(function () {
    return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.CREDENTIALS_SHEET);
  });
}

function findCredentialRow_(phone, credentialIdB64url) {
  var sheet = getCredentialsSheet_();
  var data = withSheetRetry_(function () { return sheet.getDataRange().getValues(); });
  for (var i = 1; i < data.length; i++) {
    if (phonesMatch_(data[i][0], phone) && data[i][1] === credentialIdB64url) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

function listCredentialsForPhone_(phone) {
  var sheet = getCredentialsSheet_();
  var data = withSheetRetry_(function () { return sheet.getDataRange().getValues(); });
  var creds = [];
  for (var i = 1; i < data.length; i++) {
    if (phonesMatch_(data[i][0], phone)) {
      creds.push({ credentialId: data[i][1], pubX: data[i][2], pubY: data[i][3] });
    }
  }
  return creds;
}

function stringToBytes_(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
  return bytes;
}

function bytesEqual_(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if ((a[i] & 0xff) !== (b[i] & 0xff)) return false;
  return true;
}

/* توليد 32 بايت عشوائية بمصدر آمن تشفيريًا — Math.random() غير مضمون أمنيًا حسب مواصفة الجافاسكربت نفسها، بينما Utilities.getUuid() مدعوم بمولّد SecureRandom على منصة Apps Script. نولّد 3 معرّفات UUID (١٢٨ بت لكل واحد) ونأخذ أول ٣٢ بايت من مجموعها */
/* Generates 32 cryptographically-secure random bytes — Math.random() is explicitly NOT guaranteed secure per the JS spec, while Utilities.getUuid() is backed by a SecureRandom source on Apps Script's platform. We combine 3 UUIDs (128 bits each) and take the first 32 bytes */
function randomChallengeB64url_() {
  var hex = (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var bytes = [];
  for (var i = 0; i < 32; i++) bytes.push(parseInt(hex.substr(i * 2, 2), 16));
  return bytesToB64url(bytes);
}

/* ===================================================
 *  التسجيل — يتطلب وجود العضو مسبقًا بجدول الأعضاء
 *  (registerUser بـ Code.gs يُستدعى قبل هذا)
 * =================================================== */
function generateRegisterChallenge(data) {
  var phoneCheck = checkPhoneValid(data.phone);
  if (!phoneCheck.ok) return { error: phoneCheck.msg };

  var user = findUser(phoneCheck.phone);
  if (!user) return { error: 'سجّل بياناتك أولًا قبل تفعيل البصمة' };

  var challenge = randomChallengeB64url_();
  CacheService.getScriptCache().put('regchal_' + phoneCheck.phone, challenge, WEBAUTHN_CONFIG.CHALLENGE_TTL_SECONDS);

  return {
    success: true,
    challenge: challenge,
    rpId: WEBAUTHN_CONFIG.RP_ID,
    rpName: WEBAUTHN_CONFIG.RP_NAME,
    userIdB64: bytesToB64url(stringToBytes_(phoneCheck.phone)),
    userName: phoneCheck.phone,
    userDisplayName: user.name
  };
}

function registerCredential(data) {
  var phoneCheck = checkPhoneValid(data.phone);
  if (!phoneCheck.ok) return { error: phoneCheck.msg };
  var phone = phoneCheck.phone;

  try {
    var cache = CacheService.getScriptCache();
    var expectedChallenge = cache.get('regchal_' + phone);
    if (!expectedChallenge) return { error: 'انتهت صلاحية الطلب، حاول مرة أخرى', expired: true };
    cache.remove('regchal_' + phone);

    var clientDataJSONBytes = b64urlDecodeToBytes(data.clientDataJSONB64);
    var clientData = JSON.parse(utf8BytesToString(clientDataJSONBytes));

    if (clientData.type !== 'webauthn.create') return { error: 'نوع طلب غير صحيح' };
    if (clientData.challenge !== expectedChallenge) return { error: 'فشل التحقق من الطلب' };
    if (clientData.origin !== WEBAUTHN_CONFIG.ALLOWED_ORIGIN) {
      logError('WebAuthn origin mismatch', 'got=' + clientData.origin, phone);
      return { error: 'مصدر الطلب غير موثوق' };
    }

    var attestationBytes = b64urlDecodeToBytes(data.attestationObjectB64);
    var attestationObj = decodeCbor(attestationBytes, 0).value;
    var parsed = parseAuthData(attestationObj.authData);
    if (!parsed.coseKey) return { error: 'لا يوجد مفتاح عام بالاستجابة' };

    var expectedRpIdHash = sha256(stringToBytes_(WEBAUTHN_CONFIG.RP_ID));
    if (!bytesEqual_(parsed.rpIdHash, expectedRpIdHash)) return { error: 'rpId غير مطابق' };
    if (!parsed.userVerified) return { error: 'لم يتم التحقق من المستخدم على الجهاز' };

    var pubX = bytesToBigIntUnsigned(parsed.coseKey[-2]);
    var pubY = bytesToBigIntUnsigned(parsed.coseKey[-3]);
    var credentialIdB64url = bytesToB64url(parsed.credentialId);

    var sheet = getCredentialsSheet_();
    var now = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([phone, credentialIdB64url, pubX.toString(16), pubY.toString(16), sanitizeSheetText_(data.deviceName || 'جهاز غير معروف'), parsed.signCount, now, now]);

    var user = findUser(phone);
    if (!user) return { error: 'تعذّر إيجاد بيانات العضو بعد الحفظ، راجع الإدارة' };
    return { success: true, role: user.role, name: user.name };
  } catch (err) {
    logError('registerCredential exception', err.toString(), phone);
    return { error: 'فشل تفعيل البصمة' };
  }
}

/* ===================================================
 *  الدخول
 * =================================================== */
function generateLoginChallenge(data) {
  var phoneCheck = checkPhoneValid(data.phone);
  if (!phoneCheck.ok) return { error: phoneCheck.msg };
  var phone = phoneCheck.phone;

  var user = findUser(phone);
  if (!user) return { error: 'رقم الجوال غير مسجل' };
  if (user.status === 'معطل') return { error: 'حسابك معطل، تواصل مع المدير' };

  var creds = listCredentialsForPhone_(phone);
  if (creds.length === 0) return { error: 'لا يوجد بصمة مسجلة لهذا الرقم', notRegistered: true, name: user.name };

  var challenge = randomChallengeB64url_();
  CacheService.getScriptCache().put('logchal_' + phone, challenge, WEBAUTHN_CONFIG.CHALLENGE_TTL_SECONDS);

  return {
    success: true,
    challenge: challenge,
    rpId: WEBAUTHN_CONFIG.RP_ID,
    allowCredentialIds: creds.map(function (c) { return c.credentialId; })
  };
}

function verifyAssertion(data) {
  var phoneCheck = checkPhoneValid(data.phone);
  if (!phoneCheck.ok) return { error: phoneCheck.msg };
  var phone = phoneCheck.phone;

  try {
    var cache = CacheService.getScriptCache();
    var expectedChallenge = cache.get('logchal_' + phone);
    if (!expectedChallenge) return { error: 'انتهت صلاحية الطلب، حاول مرة أخرى', expired: true };
    cache.remove('logchal_' + phone);

    var credRow = findCredentialRow_(phone, data.credentialId);
    if (!credRow) return { error: 'هذا الجهاز غير مسجل لهذا الحساب' };

    var clientDataJSONBytes = b64urlDecodeToBytes(data.clientDataJSONB64);
    var clientData = JSON.parse(utf8BytesToString(clientDataJSONBytes));

    if (clientData.type !== 'webauthn.get') return { error: 'نوع طلب غير صحيح' };
    if (clientData.challenge !== expectedChallenge) return { error: 'فشل التحقق من الطلب' };
    if (clientData.origin !== WEBAUTHN_CONFIG.ALLOWED_ORIGIN) {
      logError('WebAuthn origin mismatch (login)', 'got=' + clientData.origin, phone);
      return { error: 'مصدر الطلب غير موثوق' };
    }

    var authDataBytes = b64urlDecodeToBytes(data.authenticatorDataB64);
    var parsedAuth = parseAuthData(authDataBytes);

    var expectedRpIdHash = sha256(stringToBytes_(WEBAUTHN_CONFIG.RP_ID));
    if (!bytesEqual_(parsedAuth.rpIdHash, expectedRpIdHash)) return { error: 'rpId غير مطابق' };
    if (!parsedAuth.userVerified) return { error: 'لم يتم التحقق من المستخدم على الجهاز' };

    var clientDataHash = sha256(clientDataJSONBytes);
    var signedData = concatBytes(authDataBytes, clientDataHash);
    var hashForVerify = sha256(signedData);

    var sigBytes = b64urlDecodeToBytes(data.signatureB64);
    var rs = derSignatureToRS(sigBytes);

    var Q = { x: BigInt('0x' + credRow.row[2]), y: BigInt('0x' + credRow.row[3]) };
    var sigValid = ecdsaVerifyP256(hashForVerify, rs.r, rs.s, Q);
    if (!sigValid) {
      logError('WebAuthn signature failed', 'phone=' + phone, phone);
      return { error: 'فشل التحقق من التوقيع' };
    }

    // فحص عداد التوقيع: الحماية الأساسية ضد إعادة التشغيل (replay) هي التحدي أحادي الاستخدام
    // + توقيع ECDSA أعلاه — عداد التوقيع طبقة دفاع إضافية ضد استنساخ فعلي للمفتاح الخاص،
    // لذا نحظر فقط عند الإشارة القوية (تراجع عداد غير صفري) ونفتح مسار استرجاع آمن لبقية الحالات
    // Signature-count check: the primary replay defense is the single-use challenge + the
    // ECDSA verification above — signCount is only a secondary defense against real key cloning,
    // so we hard-block only on the strong signal (a non-zero counter going backwards) and allow
    // a safe self-healing recovery path for the other cases (synced passkeys with unreliable counters)
    var storedSignCount = Number(credRow.row[5]) || 0;
    var newSignCount = parsedAuth.signCount;
    if (newSignCount > 0 && storedSignCount > 0 && newSignCount < storedSignCount) {
      logError('WebAuthn possible cloned device', 'phone=' + phone, phone);
      return { error: 'تنبيه أمني: تم رفض الدخول (احتمال نسخ الجهاز)' };
    }
    if (newSignCount === 0 && storedSignCount > 0) {
      // مصادقة لا تدعم العداد فعليًا (شائع مع البصمات المتزامنة) — سماح مع تسجيل توثيقي فقط،
      // وسيُعاد ضبط العداد المخزَّن ذاتيًا أدناه (يدخل لاحقًا استثناء "صفر/صفر" الآمن دائمًا
      logError('WebAuthn signCount reset (allowed)', 'phone=' + phone, phone);
    }

    var sheet = getCredentialsSheet_();
    var now = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(credRow.rowIndex, 6).setValue(newSignCount);
    sheet.getRange(credRow.rowIndex, 8).setValue(now);

    var user = findUser(phone);
    logVisit(phone, 'دخول', 'نجاح');

    return { success: true, role: user.role, name: user.name };
  } catch (err) {
    logError('verifyAssertion exception', err.toString(), phone);
    return { error: 'فشل تسجيل الدخول بالبصمة' };
  }
}