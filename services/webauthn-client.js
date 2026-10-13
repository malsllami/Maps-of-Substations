/* ============================================================
 * services/webauthn-client.js — البصمة في المتصفح (WebAuthn): التسجيل والدخول بعقد خادم V2 — منطق فقط بلا واجهة
 * ============================================================
 * العقد مع الخادم (WebAuthn.gs، منسوخ من V1 كما هو حتى تبقى البصمات المسجّلة صالحة):
 * - التسجيل: generateRegisterChallenge(phone) ← navigator.credentials.create (ES256، تحقق المستخدم إلزامي، بلا شهادة)
 *   ← registerCredential(phone, credentialId, attestationObjectB64, clientDataJSONB64, deviceName, opKey).
 * - الدخول: generateLoginChallenge(phone) ← navigator.credentials.get (allowCredentials من الخادم، تحقق إلزامي)
 *   ← verifyAssertion(phone, credentialId, authenticatorDataB64, clientDataJSONB64, signatureB64).
 *   عضو بلا بصمة مسجّلة (notRegistered) ← يُعاد { notRegistered, name } فتنتقل الواجهة لتفعيلها (سلوك V1).
 * - النجاح ← الجلسة عبر session.js (الدور من الخادم: «admin» للمدير بالبصمة فقط).
 * - طلبا الرمز بطلب احتياطي (تكرارهما آمن)، والتسجيل بمفتاح عملية (api-client)، والتحقق طلب واحد لا يُعاد (الرمز لمرة واحدة).
 * - طلب بصمة واحد في أي لحظة: أي طلب جديد يُلغي المعلّق (يمنع «تتكرر نافذة البصمة بعدد الضغطات» — V1).
 * - خطأ المتصفح (NotAllowedError…) يُسجَّل بنوعه ومدته عبر connection.js بلا أي بيانات بصمة أو رمز أو تذكرة.
 * - لا يحفظ ولا يطبع الرمز ولا المفاتيح ولا التذكرة في أي مكان (المفتاح الخاص لا يغادر جهاز المستخدم أصلًا).
 *
 * Fingerprint (WebAuthn) in the browser: registration and login with the V2 server contract — logic only, no UI.
 * Contract (WebAuthn.gs, copied from V1 so registered fingerprints stay valid): register = challenge ← create (ES256,
 * user verification required, no attestation) ← registerCredential; login = challenge ← get ← verifyAssertion. A member
 * without a registered fingerprint (notRegistered) ← { notRegistered, name } so the UI moves to activation (V1). Success
 * ← the session through session.js (role from the server). Challenges are hedged, registration uses an operation key,
 * verification is one request never resent. One prompt at a time. Browser errors are logged by type and duration with
 * no fingerprint data, challenge or ticket. Nothing secret is stored or printed (the private key never leaves the device).
 * ============================================================ */
(function (global) {
  'use strict';

  const API = global.SecApi, SESSION = global.SecSession;
  if (!API || !SESSION) throw new Error('webauthn-client.js يحتاج api-client.js وsession.js قبله / needs api-client.js and session.js first');
  const PROMPT_TIMEOUT_MS = 60000;
  const MSG = {
    UNSUPPORTED: 'هذا المتصفح لا يدعم البصمة. الرجاء استخدام متصفح حديث مثل Chrome أو Safari أو Edge، أو استخدم "دخول برقم الجوال" أعلاه.',
    CANCELLED: 'تم إلغاء العملية أو رفض البصمة',
    REGISTER_DEVICE: 'تعذّر تسجيل البصمة على هذا الجهاز',
    LOGIN_DEVICE: 'تعذّر التحقق من البصمة على هذا الجهاز',
    REGISTER_START: 'تعذّر بدء تسجيل البصمة',
    LOGIN_START: 'تعذّر بدء تسجيل الدخول',
    REGISTER_SAVE: 'فشل حفظ البصمة بالخادم',
    LOGIN_VERIFY: 'فشل التحقق من تسجيل الدخول'
  };
  let pending = null;

  // ===== base64url <-> ArrayBuffer =====
  function b64urlToBuffer(b64url) {
    let b64 = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const raw = global.atob(b64), buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return buf.buffer;
  }
  function bufferToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return global.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function isSupported() { return !!(global.PublicKeyCredential && global.navigator.credentials); }

  /* اسم الجهاز المحفوظ مع البصمة (V1) — The device name saved with the fingerprint (V1) */
  function deviceName() {
    const ua = global.navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'جهاز أندرويد';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'كمبيوتر ويندوز';
    return 'جهاز غير معروف';
  }

  /* نوع الأيقونة ونص الزر حسب الجهاز (V1) — The icon type and button label for the device (V1) */
  function deviceLabel() {
    const ua = global.navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return { icon: '🆔', iconType: 'face', label: 'الدخول بـ Face ID / Touch ID' };
    if (/Macintosh|Mac OS X/.test(ua)) return { icon: '👆', iconType: 'fingerprint', label: 'الدخول بـ Touch ID' };
    if (/Android/.test(ua)) return { icon: '👆', iconType: 'fingerprint', label: 'الدخول ببصمة الإصبع' };
    if (/Windows/.test(ua)) return { icon: '🔐', iconType: 'windows', label: 'الدخول بـ Windows Hello' };
    return { icon: '🔐', iconType: 'fingerprint', label: 'الدخول بالبصمة' };
  }

  /* خطأ البصمة بنوعه ومدته فقط — The fingerprint error, type and duration only */
  function report_(kind, err, startedAt) {
    try {
      const C = global.SecConnection;
      if (!C || !C.reportEvent) return;
      const name = (err && err.name) || 'غير معروف';
      C.reportEvent(kind === 'get' ? 'client/webauthn-assertion' : 'client/webauthn-credential',
        'خطأ البصمة (' + (kind === 'get' ? 'دخول' : 'تسجيل') + '): ' + name,
        'اسم الخطأ: ' + name + ' | رسالة المتصفح: ' + String((err && err.message) || '').slice(0, 120) + ' | المدة حتى الخطأ: ' + ((Date.now() - startedAt) / 1000).toFixed(1) + ' ث');
    } catch (e) { /* التسجيل لا يعطّل الدخول / logging never blocks sign-in */ }
  }

  function fail_(message, extra) { const e = new Error(message); e.name = 'WebAuthnFlowError'; Object.assign(e, extra || {}); return e; }

  /* نافذة البصمة (واحدة فقط في أي لحظة) — The fingerprint prompt (only one at a time) */
  async function prompt_(kind, publicKey) {
    abort();
    const controller = new global.AbortController();
    pending = controller;
    const startedAt = Date.now();
    try {
      return await global.navigator.credentials[kind]({ signal: controller.signal, publicKey: publicKey });
    } catch (err) {
      report_(kind, err, startedAt);
      throw fail_(err && err.name === 'NotAllowedError' ? MSG.CANCELLED : (kind === 'get' ? MSG.LOGIN_DEVICE : MSG.REGISTER_DEVICE), { cause: err && err.name });
    } finally {
      if (pending === controller) pending = null;
    }
  }

  function abort() { if (pending) { pending.abort(); pending = null; } }

  /* رد الخادم أو خطأ واضح (خطأ الاتصال برسالة api-client) — The server reply, or a clear error */
  async function call_(action, payload, fallback) {
    let res;
    try { res = await API.call(action, payload); } catch (err) { throw fail_(err.message || fallback); }
    return res || { error: fallback };
  }

  /**
   * تسجيل بصمة لعضو موجود ← { success, role, name } بعد حفظ الجلسة، أو يرمي خطأ برسالة عربية.
   * opts: { displayName, deviceName (افتراضيًا اسم الجهاز), onStage(stage) }
   */
  async function register(phone, opts) {
    const o = opts || {};
    if (!isSupported()) throw fail_(MSG.UNSUPPORTED);
    const begin = await call_('generateRegisterChallenge', { phone: phone }, MSG.REGISTER_START);
    if (!begin.success) throw fail_(begin.error || MSG.REGISTER_START);
    if (o.onStage) o.onStage('prompt');
    const cred = await prompt_('create', {
      challenge: b64urlToBuffer(begin.challenge),
      rp: { id: begin.rpId, name: begin.rpName },
      user: { id: b64urlToBuffer(begin.userIdB64), name: begin.userName, displayName: begin.userDisplayName || o.displayName || begin.userName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { userVerification: 'required' },
      timeout: PROMPT_TIMEOUT_MS,
      attestation: 'none'
    });
    if (o.onStage) o.onStage('verify');
    const res = await call_('registerCredential', {
      phone: phone,
      credentialId: bufferToB64url(cred.rawId),
      attestationObjectB64: bufferToB64url(cred.response.attestationObject),
      clientDataJSONB64: bufferToB64url(cred.response.clientDataJSON),
      deviceName: o.deviceName || deviceName()
    }, MSG.REGISTER_SAVE);
    if (!res.success) throw fail_(res.error || MSG.REGISTER_SAVE);
    SESSION.save({ phone: phone, name: res.name || o.displayName || '', role: res.role, identityToken: res.identityToken });
    return { success: true, role: res.role === 'admin' ? 'admin' : 'member', name: res.name || '' };
  }

  /**
   * الدخول بالبصمة ← { success, role, name } بعد حفظ الجلسة؛ أو { notRegistered: true, name } لعضو بلا بصمة (تفعّلها
   * الواجهة بـ register)؛ أو يرمي خطأ برسالة عربية. opts: { onStage(stage) }
   */
  async function login(phone, opts) {
    const o = opts || {};
    if (!isSupported()) throw fail_(MSG.UNSUPPORTED);
    const begin = await call_('generateLoginChallenge', { phone: phone }, MSG.LOGIN_START);
    if (!begin.success) {
      if (begin.notRegistered) return { notRegistered: true, name: begin.name || '' };
      throw fail_(begin.error || MSG.LOGIN_START);
    }
    if (o.onStage) o.onStage('prompt');
    const cred = await prompt_('get', {
      challenge: b64urlToBuffer(begin.challenge),
      rpId: begin.rpId,
      allowCredentials: (begin.allowCredentialIds || []).map(function (id) { return { type: 'public-key', id: b64urlToBuffer(id) }; }),
      userVerification: 'required',
      timeout: PROMPT_TIMEOUT_MS
    });
    if (o.onStage) o.onStage('verify');
    const res = await call_('verifyAssertion', {
      phone: phone,
      credentialId: bufferToB64url(cred.rawId),
      authenticatorDataB64: bufferToB64url(cred.response.authenticatorData),
      clientDataJSONB64: bufferToB64url(cred.response.clientDataJSON),
      signatureB64: bufferToB64url(cred.response.signature)
    }, MSG.LOGIN_VERIFY);
    if (!res.success) throw fail_(res.error || MSG.LOGIN_VERIFY);
    SESSION.save({ phone: phone, name: res.name || '', role: res.role, identityToken: res.identityToken });
    return { success: true, role: res.role === 'admin' ? 'admin' : 'member', name: res.name || '' };
  }

  global.SecWebAuthn = {
    isSupported: isSupported, register: register, login: login, abort: abort,
    deviceName: deviceName, deviceLabel: deviceLabel, b64urlToBuffer: b64urlToBuffer, bufferToB64url: bufferToB64url, MSG: MSG
  };
})(typeof window !== 'undefined' ? window : globalThis);
