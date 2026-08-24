/**
 * ===================================================
 * Code.gs — نظام محطات التوزيع (مشروع جديد)
 * الشركة السعودية للطاقة — جدة
 * ===================================================
 * يعتمد على Crypto.gs (بدون تعديل، منطق مُختبر) و WebAuthn.gs
 * (منطق جديد مكتوب خصيصًا لهذا المشروع، مأخوذ بنيويًا من مشروع
 * سابق لكن مُعاد كتابته بالكامل ليطابق مخطط الجداول الجديد).
 *
 * ===================================================
 * ملاحظة إصلاح أداء (هذه النسخة):
 * كانت دوال إعداد/هجرة المخطط (setupSheets, migrateSheetNames_,
 * fixCredentialsHeaderNaming_, ensureMembersHasDepartmentColumn_)
 * تُستدعى كاملةً مع كل طلب doPost بدون استثناء (حتى ping والبحث
 * الخفيف)، وبعضها بلا أي علامة "تم التنفيذ" فيعيد قراءة الشيت من
 * الصفر كل مرة. هذا هو سبب تأخير البحث. تم تجميعها الآن خلف علامة
 * تشغيل واحدة (ensureOneTimeSchemaSetup_) فتُنفَّذ فعليًا مرة واحدة
 * فقط بعد النشر، لا مع كل طلب.
 *
 * كذلك كانت findUser وisAdminPhone تقرآن جدول الأعضاء/الإعدادات
 * بالكامل مع كل استدعاء — وبما أن getActiveUsersDetail وgetChangesLog
 * يستدعيانهما لكل مستخدم/صف على حدة (حتى 500 صف بلوحة المدير)، كانت
 * النتيجة عشرات-مئات القراءات الكاملة لنفس الجدول بطلب واحد، وهذا
 * سبب فشل تحميل لوحة المدير. تم الآن تخزين القراءة مؤقتًا لعمر الطلب
 * الواحد فقط (request-scoped caching)، بنفس منطق المطابقة الفعلي
 * (phonesMatch_) بدون أي تغيير بالسلوك.
 * ===================================================
 */

const CONFIG = {
  MEMBERS_SHEET: 'الأعضاء',
  CREDENTIALS_SHEET: 'بصمات الأجهزة',
  SETTINGS_SHEET: 'الإعدادات',
  ERROR_LOG_SHEET: 'سجل الأخطاء',
  VISITS_SHEET: 'سجل الزوار',
  AUDIT_SHEET: 'سجل التعديلات',
  IDEMPOTENCY_SHEET: 'عمليات الحفظ',
  STATIONS_SHEET: 'احداثيات محطات التوزيع',
  SUBSTATIONS_SHEET: 'محطات التحويل'
};

// أعمدة شيت "احداثيات محطات التوزيع" (حسب الصورة الفعلية)
const COLS = {
  STATION_NUMBER: 0, FEEDER: 1, REGION: 2, GOOGLE_MAP: 3, LOCATION_LINK: 4,
  LAT: 5, LNG: 6, DATE: 7, TIME: 8, USER_NAME: 9, SHIFT: 10, USER_PHONE: 11,
  USER_EMAIL: 12, REASON: 13
};

// أعمدة شيت "محطات التحويل"
const SUB_COLS = {
  SHORT_NAME: 0, GOOGLE_MAP: 1, LOCATION_LINK: 2, LAT: 3, LNG: 4,
  DATE: 5, TIME: 6, USER_NAME: 7, SHIFT: 8, USER_PHONE: 9,
  USER_EMAIL: 10, REASON: 11
};

/* ===================================================
 *  تهيئة الجداول — شغّلها مرة واحدة يدويًا من المحرر
 * =================================================== */
function setupSheets() {
  ensureSheet_(CONFIG.MEMBERS_SHEET, ['الاسم', 'الجوال', 'الإيميل', 'الدور', 'نوع العضوية', 'الوردية', 'الحالة', 'تاريخ التسجيل']);
  ensureSheet_(CONFIG.CREDENTIALS_SHEET, ['الجوال', 'معرف الاعتماد', 'المفتاح العام س', 'المفتاح العام ص', 'اسم الجهاز', 'عداد التوقيع', 'تاريخ التسجيل', 'آخر استخدام']);
  ensureSheet_(CONFIG.SETTINGS_SHEET, ['المفتاح', 'القيمة']);
  ensureSheet_(CONFIG.ERROR_LOG_SHEET, ['الوقت', 'المصدر', 'الرسالة', 'تفاصيل']);
  ensureSheet_(CONFIG.VISITS_SHEET, ['الوقت', 'الجوال', 'الإجراء', 'النتيجة']);
  ensureSheet_(CONFIG.AUDIT_SHEET, ['الوقت', 'الجوال', 'نوع العملية', 'مرجع', 'تفاصيل']);
  ensureSheet_(CONFIG.IDEMPOTENCY_SHEET, ['مفتاح العملية', 'الوقت']);

  const settings = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SETTINGS_SHEET);
  if (settings.getLastRow() < 2) {
    settings.appendRow(['رقم جوال المدير', '+966500000000']);
    settings.appendRow(['رمز المدير', '1234']);
    settings.appendRow(['ايميل المدير', '']);
  }
}

/* ===================================================
 *  تجميع كل عمليات إعداد/هجرة المخطط خلف علامة تشغيل واحدة
 *  تُنفَّذ فعليًا مرة واحدة فقط طوال عمر النشر، لا مع كل طلب
 *  هذا هو الإصلاح الأساسي لمشكلة تأخير البحث: كانت هذه العمليات
 *  الأربع (كل واحدة تفحص شيتات فعليًا) تُستدعى قبل أي إجراء آخر
 *  بما فيها ping والبحث الخفيف
 * =================================================== */
function ensureOneTimeSchemaSetup_() {
  const props = PropertiesService.getScriptProperties();
  // لها علامة تشغيل مستقلة خاصة بها فتُفحص بكل طلب (فحص خفيف) لكن تُنفَّذ فعليًا مرة واحدة فقط —
  // مقصود إبقاؤها خارج بوابة schema_setup_done_v3 أدناه لأن تلك مُفعَّلة أصلًا بالنشر الحالي ولن
  // تُعيد استدعاء أي شيء بداخلها مجددًا؛ وضعها هنا يضمن تنفيذها ولو مرة واحدة على الأقل
  ensureMembersPhoneColumnIsText_();
  if (props.getProperty('schema_setup_done_v3') === 'true') return;
  setupSheets();
  migrateSheetNames_();
  fixCredentialsHeaderNaming_();
  ensureMembersHeaderNaming_();
  ensureMembersHasDepartmentColumn_();
  ensureErrorLogClassificationColumn_();
  props.setProperty('schema_setup_done_v3', 'true');
}

/* ===================================================
 *  هجرة آمنة لأسماء الجداول القديمة المخالفة (شرطة سفلية) — إعادة تسمية الشيت نفسه فقط، لا إنشاء ولا حذف
 *  Safe migration of old non-compliant table names (underscore) — renames the sheet itself only, no create/delete
 * =================================================== */
const SHEET_RENAME_MAP_ = {
  'بصمات_الأجهزة': 'بصمات الأجهزة',
  'سجل_الأخطاء': 'سجل الأخطاء',
  'سجل_الزوار': 'سجل الزوار',
  'سجل_التعديلات': 'سجل التعديلات',
  'عمليات_الحفظ': 'عمليات الحفظ'
};
function migrateSheetNames_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('sheet_names_migrated') === 'true') return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_RENAME_MAP_).forEach(function (oldName) {
    const newName = SHEET_RENAME_MAP_[oldName];
    const oldSheet = ss.getSheetByName(oldName);
    const newAlreadyExists = !!ss.getSheetByName(newName);
    if (oldSheet && !newAlreadyExists) oldSheet.setName(newName); // إعادة تسمية فقط — كل الصفوف والبيانات تبقى كما هي
  });
  props.setProperty('sheet_names_migrated', 'true');
}

/* تعريب أعمدة بصمات الأجهزة (كانت بالإنجليزي بالكامل) — تصحيح نص العنوان فقط، لا يمس أي بصمة محفوظة أسفله */
/* Arabizes the device-credentials columns (were fully in English) — header text fix only, doesn't touch any stored credential below */
const CREDENTIALS_HEADER_RENAME_MAP_ = {
  'CredentialID': 'معرف الاعتماد',
  'PublicKeyX': 'المفتاح العام س',
  'PublicKeyY': 'المفتاح العام ص',
  'SignCount': 'عداد التوقيع'
};
function fixCredentialsHeaderNaming_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('credentials_header_fixed') === 'true') return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.CREDENTIALS_SHEET);
  if (sheet) {
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    headers.forEach(function (h, i) {
      if (CREDENTIALS_HEADER_RENAME_MAP_[h]) sheet.getRange(1, i + 1).setValue(CREDENTIALS_HEADER_RENAME_MAP_[h]);
    });
  }
  props.setProperty('credentials_header_fixed', 'true');
}

function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    fixNonCompliantHeaderLabels_(sheet, headers);
  }
  return sheet;
}

/* تصحيح نص عناوين الأعمدة فقط (بدون الشرطة السفلية) بالشيتات الموجودة فعليًا مسبقًا — لا يمس أي بيانات أسفل الصف الأول إطلاقًا */
/* Fixes only the header label text (removing underscores) on already-existing sheets — never touches any data below row 1 */
function fixNonCompliantHeaderLabels_(sheet, correctHeaders) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (let i = 0; i < correctHeaders.length && i < currentHeaders.length; i++) {
    if (currentHeaders[i] !== correctHeaders[i] && String(currentHeaders[i]).replace(/_/g, ' ') === correctHeaders[i]) {
      sheet.getRange(1, i + 1).setValue(correctHeaders[i]);
    }
  }
}

/* ===================================================
 *  نقاط الدخول
 * =================================================== */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* تُستدعى من WebAuthn.gs (ملف منفصل بنفس المشروع) — لا تحذف حتى لو بدت "غير مستخدمة" عند فحص Code.gs وحده */
/* Called from WebAuthn.gs (a separate file in the same project) — never delete even if a single-file scan of Code.gs shows it as "unused" */
function checkPhoneValid(phone) {
  const formatted = formatPhone(phone);
  return formatted ? { ok: true, phone: formatted } : { ok: false, msg: 'رقم جوال غير صحيح' };
}

function doPost(e) {
  let result;
  let requestedAction = null;
  try { requestedAction = JSON.parse(e.postData.contents).action; } catch (parseErr) { /* سيُعاد تحليلها أدناه بأي حال، وتُسجَّل الأخطاء هناك */ }
  incrementDailyRequestCount_(requestedAction); // عدّ الطلب فورًا مع تصنيفه حسب نوع الإجراء — لكل الإجراءات بلا استثناء، لأن الحصة اليومية لـApps Script تُحسب على كل استدعاء
  // إصلاح: تُنفَّذ مرة واحدة فقط طوال عمر النشر (عبر علامة بالخصائص)، لا مع كل طلب — هذا هو سبب تأخير البحث السابق
  // مغلّفة بـ try/catch مستقل + إعادة محاولة، حتى لا يُسقِط فشل هذه الخطوة التمهيدية الطلب بأكمله دون رد أو تسجيل
  try {
    withSheetRetry_(function () { ensureOneTimeSchemaSetup_(); });
  } catch (setupErr) {
    logError('doPost/ensureOneTimeSchemaSetup_', setupErr.toString(), '');
  }
  try {
    const data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'registerUser':              result = registerUser(data); break;
      case 'getAdminContactInfo':       result = getAdminContactInfo_(); break;
      case 'updateCoordinates':         result = updateCoordinates(data); break;
      case 'addNewStation':             result = addNewStation(data); break;
      case 'deleteStation':             result = deleteStation(data); break;
      case 'searchStation':             result = searchStation(data.query); break;
      case 'getNearbyStations':         result = getNearbyStations(data); break;
      case 'getFeederStations':         result = getFeederStations(data); break;
      case 'getStats':                  result = getStats(); break;
      case 'ping':                      result = { success: true, t: Date.now() }; break;
      case 'clearSearchCache':          result = clearSearchCache(data); break;
      case 'getAllStations':            result = getAllStations(data.offset); break;
      case 'getUpdatedStationsSince':    result = getUpdatedStationsSince(data.since); break;
      case 'getDataVersion':            result = getDataVersion(); break;
      case 'getOperationsDashboard':    result = getOperationsDashboard(data.phone); break;
      case 'logClientError':            result = logClientError_(data); break;
      case 'getActiveUsersDetail':      result = getActiveUsersDetail(data); break;
      case 'getChangesLog':             result = getChangesLog(data); break;
      case 'getVisitorsChart':          result = getVisitorsChart(); break;
      case 'getPeakHoursHeatmap':       result = getPeakHoursHeatmap(); break;
      case 'getRegionActivity':         result = getRegionActivity(); break;
      case 'getMemberProfile':          result = getMemberProfile(data.phone); break;
      case 'updateMemberProfile':       result = updateMemberProfile(data); break;

      case 'generateRegisterChallenge': result = generateRegisterChallenge(data); break;
      case 'registerCredential':        result = registerCredential(data); break;
      case 'generateLoginChallenge':    result = generateLoginChallenge(data); break;
      case 'verifyAssertion':           result = verifyAssertion(data); break;
      case 'loginByPhone':              result = loginByPhone(data); break;

      default: result = { error: 'إجراء غير معروف: ' + data.action };
    }
  } catch (err) {
    logError('doPost', err.toString(), '');
    result = { error: 'حدث خطأ غير متوقع، حاول مرة أخرى' };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* تصحيح تلقائي آمن لعناوين شيت الأعضاء القديمة المخالفة لقاعدة تسمية الأعمدة (تحتوي شرطة سفلية) — تغيير نص العنوان فقط، لا يمس أي بيانات */
/* Safe automatic fix for old member-sheet headers violating the naming rule (underscore) — renames header text only, doesn't touch any data */
function ensureMembersHeaderNaming_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('members_header_fixed') === 'true') return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.MEMBERS_SHEET);
  if (sheet) {
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const fixedNames = { 'نوع_العضوية': 'نوع العضوية', 'تاريخ_التسجيل': 'تاريخ التسجيل' };
    headers.forEach(function (h, i) {
      if (fixedNames[h]) sheet.getRange(1, i + 1).setValue(fixedNames[h]);
    });
  }
  props.setProperty('members_header_fixed', 'true');
}

/* ===================================================
 *  تسجيل عضو جديد (بدون بصمة بعد — خطوة منفصلة تالية)
 * =================================================== */
function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function registerUser(data) {
  if (!data.name || data.name.trim().length < 3) return { error: 'الاسم يجب أن يكون ٣ أحرف على الأقل' };
  if (!data.phone) return { error: 'رقم الجوال مطلوب' };
  if (!isValidEmail_(data.email)) return { error: 'الرجاء إدخال بريد إلكتروني صحيح' };
  if (!data.memberType || ['موظف', 'مقاول'].indexOf(data.memberType) === -1) {
    return { error: 'حدد نوع العضوية: موظف أو مقاول' };
  }
  if (!data.shift) return { error: 'حدد الوردية' };
  if (!data.department) return { error: 'حدد القسم' };

  const phone = formatPhone(data.phone);
  if (!phone) return { error: 'رقم جوال غير صحيح' };

  const existing = findUser(phone);
  if (existing) return { error: 'هذا الرقم مسجل مسبقًا، سجّل الدخول بدل التسجيل' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.MEMBERS_SHEET);
  const now = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([
    sanitizeSheetText_(data.name.trim()), phone, sanitizeSheetText_(data.email.trim()), 'عضو',
    data.memberType, sanitizeSheetText_(data.shift), 'نشط', now, sanitizeSheetText_(data.department.trim())
  ]);
  // إصلاح: تُطبَّق صيغة النص على خلية الجوال بعد appendRow مباشرة (على الصف الفعلي الذي كُتب لتوّه)،
  // لا قبلها على صف متوقَّع — تنسيق صف لم يُكتَب فيه بعد كان يفشل لو appendRow انتهى بصف مختلف
  // (تنفيذ متزامن آخر بينهما)، فتفسّر جوجل شيتس الرقم كصيغة عامة وتحذف علامة + تلقائيًا
  sheet.getRange(sheet.getLastRow(), 2).setNumberFormat('@').setValue(phone);
  invalidateMembersCache_();

  logVisit(phone, 'تسجيل_عضو', 'نجاح');
  return { success: true };
}
/* إضافة عمود "القسم" تلقائيًا لجدول الأعضاء الموجود فعليًا — دالة مستقلة تُضاف العمود فقط إن لم يكن موجودًا، لا تمس أي بيانات أو أعمدة قائمة إطلاقًا
 * إصلاح: أصبحت الآن مغلَّقة بعلامة تشغيل — كانت سابقًا تقرأ عناوين الشيت من جديد مع كل طلب لأنها بلا أي حماية تكرار */
/* Automatically adds a "Department" column to the already-existing members sheet — an independent function that only adds the column if missing, never touching any existing data or columns
 * Fix: now gated by a run-once flag — it previously re-read the sheet headers on every single request since it had no repetition guard */
function ensureMembersHasDepartmentColumn_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('members_department_col_added') === 'true') return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.MEMBERS_SHEET);
  if (sheet) {
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (headers.indexOf('القسم') === -1) {
      const newColIndex = lastCol + 1;
      sheet.getRange(1, newColIndex).setValue('القسم').setFontWeight('bold');
    }
  }
  props.setProperty('members_department_col_added', 'true');
}

/* تُجبر عمود "الجوال" (B) بشيت الأعضاء بالكامل على صيغة نص (@) مرة واحدة فقط — يمنع مستقبلًا
 * سيناريو تفسير جوجل شيتس لرقم يبدأ بـ+ كصيغة عامة (رقم موجب) وحذف العلامة تلقائيًا، بغضّ النظر
 * عن أي فجوة توقيت مستقبلية بكتابة الصفوف. طبقة حماية إضافية فوق الإصلاح داخل registerUser نفسها */
function ensureMembersPhoneColumnIsText_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('members_phone_col_text_forced') === 'true') return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.MEMBERS_SHEET);
  if (sheet) {
    const lastRow = Math.max(sheet.getLastRow(), 2);
    sheet.getRange(2, 2, lastRow - 1, 1).setNumberFormat('@');
  }
  props.setProperty('members_phone_col_text_forced', 'true');
}

/* ===================================================
 *  تحديث إحداثية محطة — مع منع التكرار (idempotency)
 * =================================================== */
function updateCoordinates(data) {
  if (!data.opKey) return { error: 'مفتاح عملية مفقود' };
  if (!data.phone || !data.stationId || !data.type) return { error: 'بيانات ناقصة' };

  const phone = formatPhone(data.phone);
  const member = phone ? findUser(phone) : null;
  if (!member) return { error: 'الرجاء تسجيل الدخول أولًا' };

  const lat = parseCoordinate_(data.lat);
  const lng = parseCoordinate_(data.lng);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: 'إحداثية غير صحيحة' };
  }

  const idemSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.IDEMPOTENCY_SHEET);
  const idemLastRow = idemSheet.getLastRow();
  const keys = idemLastRow > 1
    ? idemSheet.getRange(2, 1, idemLastRow - 1, 1).getValues().flat()
    : [];
  if (keys.includes(data.opKey)) {
    return { success: true, duplicate: true };
  }
  idemSheet.appendRow([data.opKey, new Date()]);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nowDate = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'dd/MM/yyyy');
  const nowTime = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'HH:mm:ss');
  const reason = data.reason ? String(data.reason).trim() : '';
  let updated = false;

  if (data.type === 'توزيع') {
    const sheet = ss.getSheetByName(CONFIG.STATIONS_SHEET);
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (normalizeArabicDigits_(String(values[i][COLS.STATION_NUMBER])).toUpperCase() === normalizeArabicDigits_(String(data.stationId)).toUpperCase()) {
        const row = i + 1;
        sheet.getRange(row, COLS.LAT + 1).setValue(lat);
        sheet.getRange(row, COLS.LNG + 1).setValue(lng);
        if (data.feeder) sheet.getRange(row, COLS.FEEDER + 1).setValue(sanitizeSheetText_(data.feeder));
        if (data.region) sheet.getRange(row, COLS.REGION + 1).setValue(sanitizeSheetText_(data.region));
        sheet.getRange(row, COLS.GOOGLE_MAP + 1).setValue(`https://www.google.com/maps?q=${lat},${lng}`);
        sheet.getRange(row, COLS.LOCATION_LINK + 1).setValue(`${lat},${lng}`);
        sheet.getRange(row, COLS.DATE + 1).setValue(nowDate);
        sheet.getRange(row, COLS.TIME + 1).setValue(nowTime);
        sheet.getRange(row, COLS.USER_NAME + 1).setValue(member.name);
        sheet.getRange(row, COLS.SHIFT + 1).setValue(member.shift || '');
        sheet.getRange(row, COLS.USER_PHONE + 1).setValue(phone);
        sheet.getRange(row, COLS.USER_EMAIL + 1).setValue(member.email || '');
        if (reason) sheet.getRange(row, COLS.REASON + 1).setValue(sanitizeSheetText_(reason));
        updated = true;
        break;
      }
    }
  } else if (data.type === 'تحويل') {
    const sheet = ss.getSheetByName(CONFIG.SUBSTATIONS_SHEET);
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (normalizeArabicDigits_(String(values[i][SUB_COLS.SHORT_NAME])).toUpperCase() === normalizeArabicDigits_(String(data.stationId)).toUpperCase()) {
        const row = i + 1;
        sheet.getRange(row, SUB_COLS.LAT + 1).setValue(lat);
        sheet.getRange(row, SUB_COLS.LNG + 1).setValue(lng);
        sheet.getRange(row, SUB_COLS.GOOGLE_MAP + 1).setValue(`https://www.google.com/maps?q=${lat},${lng}`);
        sheet.getRange(row, SUB_COLS.LOCATION_LINK + 1).setValue(`${lat},${lng}`);
        sheet.getRange(row, SUB_COLS.DATE + 1).setValue(nowDate);
        sheet.getRange(row, SUB_COLS.TIME + 1).setValue(nowTime);
        sheet.getRange(row, SUB_COLS.USER_NAME + 1).setValue(member.name);
        sheet.getRange(row, SUB_COLS.SHIFT + 1).setValue(member.shift || '');
        sheet.getRange(row, SUB_COLS.USER_PHONE + 1).setValue(phone);
        sheet.getRange(row, SUB_COLS.USER_EMAIL + 1).setValue(member.email || '');
        if (reason) sheet.getRange(row, SUB_COLS.REASON + 1).setValue(sanitizeSheetText_(reason));
        updated = true;
        break;
      }
    }
  }

  if (!updated) return { error: 'تعذّر إيجاد المحطة بالشيت' };

  if (data.type === 'توزيع') invalidateStationsCache_(); else invalidateSubstationsCache_();
  incrementDataVersion_();
  logAudit(phone, 'تعديل_إحداثية', data.stationId, `${lat},${lng} (${data.method || 'يدوي'})`);
  return { success: true };
}

/* ===================================================
 *  إضافة محطة جديدة كلياً — صف جديد، لا تعديل
 * =================================================== */
function addNewStation(data) {
  if (!data.opKey) return { error: 'مفتاح عملية مفقود' };
  if (!data.phone || !data.stationId || !data.type) return { error: 'بيانات ناقصة' };

  const phone = formatPhone(data.phone);
  const member = phone ? findUser(phone) : null;
  if (!member) return { error: 'الرجاء تسجيل الدخول أولًا' };

  const stationId = String(data.stationId).trim();
  if (!stationId) return { error: 'رقم المحطة مطلوب' };
  if (data.type === 'توزيع' && !String(data.region || '').trim()) {
    return { error: 'المنطقة مطلوبة' };
  }

  const lat = parseCoordinate_(data.lat);
  const lng = parseCoordinate_(data.lng);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: 'الإحداثية مطلوبة وإلا لن تُحفظ المحطة (حدد موقعك أو أدخلها يدويًا)' };
  }

  const idemSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.IDEMPOTENCY_SHEET);
  const idemLastRow = idemSheet.getLastRow();
  const keys = idemLastRow > 1
    ? idemSheet.getRange(2, 1, idemLastRow - 1, 1).getValues().flat()
    : [];
  if (keys.includes(data.opKey)) {
    return { success: true, duplicate: true };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nowDate = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'dd/MM/yyyy');
  const nowTime = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'HH:mm:ss');
  const normalizedId = normalizeArabicDigits_(stationId).toUpperCase();
  const reason = data.reason ? String(data.reason).trim() : 'محطة جديدة';
  const gmapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const rawLocation = `${lat},${lng}`;

  if (data.type === 'توزيع') {
    const sheet = ss.getSheetByName(CONFIG.STATIONS_SHEET);
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (normalizeArabicDigits_(String(values[i][COLS.STATION_NUMBER])).toUpperCase() === normalizedId) {
        return { error: 'رقم المحطة هذا موجود مسبقًا بالشيت، لا يمكن تكراره' };
      }
    }
    idemSheet.appendRow([data.opKey, new Date()]);
    sheet.appendRow([
      sanitizeSheetText_(stationId), sanitizeSheetText_(data.feeder || ''), sanitizeSheetText_(data.region.trim()), gmapUrl, rawLocation,
      lat, lng, nowDate, nowTime, member.name, member.shift || '', phone, member.email || '', sanitizeSheetText_(reason)
    ]);
    invalidateStationsCache_();
    incrementDataVersion_();
  } else if (data.type === 'تحويل') {
    const sheet = ss.getSheetByName(CONFIG.SUBSTATIONS_SHEET);
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (normalizeArabicDigits_(String(values[i][SUB_COLS.SHORT_NAME])).toUpperCase() === normalizedId) {
        return { error: 'رقم المحطة هذا موجود مسبقًا بالشيت، لا يمكن تكراره' };
      }
    }
    idemSheet.appendRow([data.opKey, new Date()]);
    sheet.appendRow([
      sanitizeSheetText_(stationId), gmapUrl, rawLocation, lat, lng, nowDate, nowTime, member.name, member.shift || '', phone, member.email || '', sanitizeSheetText_(reason)
    ]);
    invalidateSubstationsCache_();
    incrementDataVersion_();
  } else {
    return { error: 'نوع المحطة غير صحيح' };
  }

  logAudit(phone, 'إضافة_محطة_جديدة', stationId, `${lat},${lng}`);
  return { success: true };
}

/* حذف نهائي لمحطة من الشيت — للمدير فقط، بدون أي سجل تدقيق حسب الطلب الصريح */
function deleteStation(data) {
  if (!data.phone || !data.stationId || !data.type) return { error: 'بيانات ناقصة' };

  const phone = formatPhone(data.phone);
  if (!phone || !isAdminPhone(phone)) return { error: 'حذف المحطات متاح للمدير فقط' };

  const stationId = String(data.stationId).trim();
  if (!stationId) return { error: 'رقم المحطة مطلوب' };
  if (data.type !== 'توزيع' && data.type !== 'تحويل') return { error: 'نوع المحطة غير صحيح' };

  const normalizedId = normalizeArabicDigits_(stationId).toUpperCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(data.type === 'توزيع' ? CONFIG.STATIONS_SHEET : CONFIG.SUBSTATIONS_SHEET);
  if (!sheet) return { error: 'تعذّر الوصول لجدول المحطات' };
  const idCol = data.type === 'توزيع' ? COLS.STATION_NUMBER : SUB_COLS.SHORT_NAME;

  const values = sheet.getDataRange().getValues();
  let rowToDelete = -1;
  for (let i = 1; i < values.length; i++) {
    if (normalizeArabicDigits_(String(values[i][idCol])).toUpperCase() === normalizedId) {
      rowToDelete = i + 1;
      break;
    }
  }
  if (rowToDelete === -1) return { error: 'المحطة غير موجودة أصلًا بالشيت' };

  sheet.deleteRow(rowToDelete);

  if (data.type === 'توزيع') invalidateStationsCache_(); else invalidateSubstationsCache_();
  incrementDataVersion_();

  return { success: true };
}

function parseCoordinate_(val) {
  if (val === null || val === undefined || val === '') return NaN;
  const s = String(val).trim().replace(',', '.');
  return Number(s);
}

/* ===================================================
 *  طبقة تخزين مؤقت لفهرس المحطات — تقلّل قراءات Google Sheets المتكررة
 * =================================================== */
const CACHE_TTL_SECONDS = 300; // 5 دقائق
const STATIONS_CACHE_KEY = 'stations_index_v1';
const SUBSTATIONS_CACHE_KEY = 'substations_index_v1';

function buildStationsIndex_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.STATIONS_SHEET);
  if (!sheet) return [];
  const values = withSheetRetry_(function () { return sheet.getDataRange().getValues(); });
  const index = [];
  for (let i = 1; i < values.length; i++) {
    const id = values[i][COLS.STATION_NUMBER];
    if (id === '' || id === null || id === undefined) continue;
    index.push({
      id: id,
      normalizedId: normalizeArabicDigits_(String(id)).toUpperCase(),
      feeder: values[i][COLS.FEEDER],
      region: values[i][COLS.REGION],
      lat: parseCoordinate_(values[i][COLS.LAT]),
      lng: parseCoordinate_(values[i][COLS.LNG])
    });
  }
  return index;
}

function buildSubstationsIndex_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SUBSTATIONS_SHEET);
  if (!sheet) return [];
  const values = withSheetRetry_(function () { return sheet.getDataRange().getValues(); });
  const index = [];
  for (let i = 1; i < values.length; i++) {
    const id = values[i][SUB_COLS.SHORT_NAME];
    if (id === '' || id === null || id === undefined) continue;
    index.push({
      id: id,
      normalizedId: normalizeArabicDigits_(String(id)).toUpperCase(),
      lat: parseCoordinate_(values[i][SUB_COLS.LAT]),
      lng: parseCoordinate_(values[i][SUB_COLS.LNG])
    });
  }
  return index;
}

/* ===================================================
 *  إصلاح: تخزين الفهرس الكبير (٤٩ ألف+ صف) بأجزاء صغيرة بدل كتلة واحدة
 *  كان الفهرس الكامل يفشل صامتًا بالحفظ بالكاش لأن حجمه بالـJSON أكبر
 *  بكثير من حد 100 كيلوبايت المسموح لكل مفتاح كاش بـ Apps Script —
 *  فكانت كل دفعة تحميل (من العشر دفعات تقريبًا) تعيد بناء الفهرس من
 *  الصفر (قراءة كاملة للشيت) بدل قراءته جاهزًا من الكاش، وهذا هو سبب
 *  توقف شريط التحميل وتقطّعه. الآن يُقسَّم الفهرس لأجزاء آمنة الحجم
 *  قبل الحفظ، فتُقرأ الدفعات التالية من الكاش مباشرة بعد أول بناء.
 * =================================================== */
const CACHE_CHUNK_MAX_CHARS = 40000; // هامش أمان واسع تحت حد 100 كيلوبايت بالبايت، مع مراعاة تمدد الأحرف العربية عند ترميز UTF-8
function setChunkedCache_(baseKey, arr) {
  const cache = CacheService.getScriptCache();
  const payload = {};
  let chunkIndex = 0;
  let currentChunk = [];
  let currentChars = 2;

  for (let i = 0; i < arr.length; i++) {
    const itemJson = JSON.stringify(arr[i]);
    const itemChars = itemJson.length + 1;
    if (currentChunk.length > 0 && currentChars + itemChars > CACHE_CHUNK_MAX_CHARS) {
      payload[baseKey + '_chunk_' + chunkIndex] = JSON.stringify(currentChunk);
      chunkIndex++;
      currentChunk = [];
      currentChars = 2;
    }
    currentChunk.push(arr[i]);
    currentChars += itemChars;
  }
  if (currentChunk.length > 0) {
    payload[baseKey + '_chunk_' + chunkIndex] = JSON.stringify(currentChunk);
    chunkIndex++;
  }
  payload[baseKey + '_meta'] = JSON.stringify({ chunks: chunkIndex, total: arr.length });
  try {
    cache.putAll(payload, CACHE_TTL_SECONDS);
  } catch (e) { /* تجاهل فشل الحفظ بالكاش — لا يوقف الاستجابة، سيُعاد البناء من الشيت بالطلب القادم فقط */ }
}
function getChunkedCache_(baseKey) {
  try {
    const cache = CacheService.getScriptCache();
    const metaRaw = cache.get(baseKey + '_meta');
    if (!metaRaw) return null;
    const meta = JSON.parse(metaRaw);
    if (!meta) return null;
    if (meta.chunks === 0) return meta.total === 0 ? [] : null;

    const keys = [];
    for (let c = 0; c < meta.chunks; c++) keys.push(baseKey + '_chunk_' + c);
    const chunksMap = cache.getAll(keys);
    const result = [];
    for (let c = 0; c < meta.chunks; c++) {
      const raw = chunksMap[baseKey + '_chunk_' + c];
      if (!raw) return null; // جزء ناقص أو منتهي الصلاحية — الكاش غير مكتمل، يُعاد البناء من الشيت بأمان
      result.push.apply(result, JSON.parse(raw));
    }
    return result;
  } catch (e) {
    return null; // أي خطأ بقراءة الكاش المجزّأ — نتجاهله ونعيد البناء من الشيت بأمان، لا نُفشل الاستجابة أبدًا
  }
}

var _requestScopedIndexCache_ = {};
function getCachedIndex_(cacheKey, builderFn) {
  if (_requestScopedIndexCache_[cacheKey]) return _requestScopedIndexCache_[cacheKey];

  const cached = getChunkedCache_(cacheKey);
  if (cached) {
    _requestScopedIndexCache_[cacheKey] = cached;
    return cached;
  }
  const fresh = builderFn();
  _requestScopedIndexCache_[cacheKey] = fresh;
  setChunkedCache_(cacheKey, fresh);
  PropertiesService.getScriptProperties().setProperty(cacheKey + '_built_at', new Date().toISOString());
  return fresh;
}
function getStationsIndex_() { return getCachedIndex_(STATIONS_CACHE_KEY, buildStationsIndex_); }
function getSubstationsIndex_() { return getCachedIndex_(SUBSTATIONS_CACHE_KEY, buildSubstationsIndex_); }
/* إبطال الكاش المجزّأ: حذف مفتاح البيانات الوصفية (meta) وحده كافٍ — بدونه getChunkedCache_ يُرجع null فيُعاد البناء من الشيت تلقائيًا، والأجزاء القديمة تنتهي صلاحيتها بمفردها لاحقًا دون أي أثر */
function invalidateStationsCache_() { CacheService.getScriptCache().remove(STATIONS_CACHE_KEY + '_meta'); }
function invalidateSubstationsCache_() { CacheService.getScriptCache().remove(SUBSTATIONS_CACHE_KEY + '_meta'); }
function getCacheBuiltAt_(cacheKey) {
  return PropertiesService.getScriptProperties().getProperty(cacheKey + '_built_at') || null;
}

/* ===================================================
 *  إصلاح: تخزين مؤقت لقراءة جدول "الأعضاء" و"الإعدادات" لعمر الطلب
 *  الواحد فقط (request-scoped) — بدون تغيير أي منطق مطابقة موجود.
 *  هذا هو الإصلاح الأساسي لمشكلة فشل تحميل لوحة المدير: كانت
 *  findUser وisAdminPhone تُعيدان قراءة الشيت بالكامل مع كل استدعاء،
 *  وgetActiveUsersDetail وgetChangesLog تستدعيانهما لكل مستخدم/صف على
 *  حدة (حتى 500 مرة بطلب واحد)، فتتحول لعشرات-مئات القراءات الكاملة.
 * =================================================== */
var _membersRowsCache_ = null;
function getMembersRows_() {
  if (_membersRowsCache_) return _membersRowsCache_;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.MEMBERS_SHEET);
  _membersRowsCache_ = sheet ? withSheetRetry_(function () { return sheet.getDataRange().getValues(); }) : [];
  return _membersRowsCache_;
}
function invalidateMembersCache_() { _membersRowsCache_ = null; }

var _settingsRowsCache_ = null;
function getSettingsRows_() {
  if (_settingsRowsCache_) return _settingsRowsCache_;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SETTINGS_SHEET);
  _settingsRowsCache_ = sheet ? withSheetRetry_(function () { return sheet.getDataRange().getValues(); }) : [];
  return _settingsRowsCache_;
}

/* ============================================================
 *  البحث المحلي بالمتصفح — دعم الفهرس الكامل والتزايدي
 * ============================================================ */
function getUpdatedStationsSince(sinceIso) {
  const since = sinceIso ? new Date(sinceIso) : null;
  const serverTime = new Date();
  const updated = [];

  function scanSheet(sheetName, cols, type) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const id = data[i][cols.STATION_NUMBER !== undefined ? cols.STATION_NUMBER : cols.SHORT_NAME];
      if (!id) continue;
      const dateVal = data[i][cols.DATE], timeVal = data[i][cols.TIME];
      if (!dateVal) continue;
      let rowMoment;
      try { rowMoment = new Date(dateVal); if (timeVal) { const t = new Date(timeVal); rowMoment.setHours(t.getHours(), t.getMinutes(), t.getSeconds()); } } catch (e) { continue; }
      if (since && rowMoment <= since) continue;
      if (type === 'توزيع') {
        updated.push({ id: String(id), type: 'توزيع', feeder: data[i][cols.FEEDER], region: data[i][cols.REGION], lat: Number(data[i][cols.LAT]), lng: Number(data[i][cols.LNG]) });
      } else {
        updated.push({ id: String(id), type: 'تحويل', feeder: '', region: '', lat: Number(data[i][cols.LAT]), lng: Number(data[i][cols.LNG]) });
      }
    }
  }

  scanSheet(CONFIG.STATIONS_SHEET, COLS, 'توزيع');
  scanSheet(CONFIG.SUBSTATIONS_SHEET, SUB_COLS, 'تحويل');

  return { success: true, updated: updated, serverTime: serverTime.toISOString(), version: getDataVersion().version };
}

const STATIONS_BATCH_SIZE = 5000;
function getAllStations(offset) {
  offset = Number(offset) || 0;
  const stations = getStationsIndex_().map(function (st) {
    return { id: st.id, type: 'توزيع', feeder: st.feeder, region: st.region, lat: st.lat, lng: st.lng };
  });
  const substations = getSubstationsIndex_().map(function (st) {
    return { id: st.id, type: 'تحويل', feeder: '', region: '', lat: st.lat, lng: st.lng };
  });
  const all = stations.concat(substations);
  const batch = all.slice(offset, offset + STATIONS_BATCH_SIZE);
  return {
    success: true,
    stations: batch,
    totalCount: all.length,
    nextOffset: (offset + STATIONS_BATCH_SIZE < all.length) ? (offset + STATIONS_BATCH_SIZE) : null,
    version: getDataVersion().version
  };
}

function getDataVersion() {
  const props = PropertiesService.getScriptProperties();
  let version = props.getProperty('data_version');
  if (!version) {
    version = String(Date.now());
    props.setProperty('data_version', version);
  }
  return { success: true, version: version };
}
function incrementDataVersion_() {
  PropertiesService.getScriptProperties().setProperty('data_version', String(Date.now()));
}

function clearSearchCache(data) {
  const formatted = formatPhone(data.phone);
  if (!formatted || !findUser(formatted)) return { error: 'يجب تسجيل الدخول لاستخدام هذا الإجراء' };
  invalidateStationsCache_();
  invalidateSubstationsCache_();
  return { success: true, message: 'تم مسح الكاش المؤقت — البحث القادم سيقرأ البيانات الفعلية مباشرة من الشيت' };
}

/* ===================================================
 *  البحث عن محطة (عام، بدون تسجيل دخول)
 * =================================================== */
function searchStation(query) {
  if (!query) return { found: false };
  const q = normalizeArabicDigits_(String(query).trim()).toUpperCase();
  if (!q) return { found: false };

  const stations = getStationsIndex_();
  const cacheDebug = { 'تشخيص وقت بناء الكاش': getCacheBuiltAt_(STATIONS_CACHE_KEY) };
  for (let i = 0; i < stations.length; i++) {
    if (stations[i].normalizedId === q) {
      const st = stations[i];
      return {
        found: true, type: 'توزيع', id: st.id,
        name: 'محطة توزيع ' + st.id + (st.region ? ' — ' + st.region : ''),
        lat: st.lat, lng: st.lng, region: st.region, feeder: st.feeder,
        ...cacheDebug
      };
    }
  }

  const substations = getSubstationsIndex_();
  for (let i = 0; i < substations.length; i++) {
    if (substations[i].normalizedId === q) {
      const st = substations[i];
      return {
        found: true, type: 'تحويل', id: st.id,
        name: 'محطة تحويل ' + st.id,
        lat: st.lat, lng: st.lng, region: '', feeder: ''
      };
    }
  }

  return { found: false };
}

function getNearbyStations(data) {
  const lat = parseCoordinate_(data.lat);
  const lng = parseCoordinate_(data.lng);
  const radiusKm = data.radiusKm ? Number(data.radiusKm) : 2;
  if (isNaN(lat) || isNaN(lng)) return { error: 'إحداثية غير صحيحة' };

  const results = [];

  const stations = getStationsIndex_();
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    if (isNaN(st.lat) || isNaN(st.lng)) continue;
    const dist = haversineKm_(lat, lng, st.lat, st.lng);
    if (dist <= radiusKm) {
      results.push({
        id: st.id, type: 'توزيع',
        name: 'محطة توزيع ' + st.id + (st.region ? ' — ' + st.region : ''),
        lat: st.lat, lng: st.lng,
        region: st.region, feeder: st.feeder,
        distanceKm: Math.round(dist * 100) / 100
      });
    }
  }

  const substations = getSubstationsIndex_();
  for (let i = 0; i < substations.length; i++) {
    const st = substations[i];
    if (isNaN(st.lat) || isNaN(st.lng)) continue;
    const dist = haversineKm_(lat, lng, st.lat, st.lng);
    if (dist <= radiusKm) {
      results.push({
        id: st.id, type: 'تحويل',
        name: 'محطة تحويل ' + st.id,
        lat: st.lat, lng: st.lng,
        region: '', feeder: '',
        distanceKm: Math.round(dist * 100) / 100
      });
    }
  }

  results.sort(function(a, b) { return a.distanceKm - b.distanceKm; });
  return { success: true, stations: results };
}

function getFeederStations(data) {
  if (!data.feeder) return { error: 'اسم المغذي مطلوب' };
  const feederQuery = String(data.feeder).trim();
  if (!feederQuery) return { error: 'اسم المغذي مطلوب' };

  const results = [];
  const stations = getStationsIndex_();
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    if (String(st.feeder || '').trim() !== feederQuery) continue;
    if (isNaN(st.lat) || isNaN(st.lng)) continue;
    results.push({
      id: st.id, type: 'توزيع',
      name: 'محطة توزيع ' + st.id + (st.region ? ' — ' + st.region : ''),
      lat: st.lat, lng: st.lng,
      region: st.region, feeder: st.feeder
    });
  }

  return { success: true, stations: results };
}

function haversineKm_(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeArabicDigits_(str) {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  return String(str).replace(/[٠-٩]/g, d => String(arabicIndic.indexOf(d)));
}

/* تمنع حقن الصيغ بالشيت (Spreadsheet Formula Injection) — لو القيمة تبدأ بـ= أو + أو - أو @،
 * جوجل شيتس يفسّرها كصيغة فعلية عند الكتابة عبر setValue/appendRow (نفس تفسير الإدخال اليدوي).
 * إضافة علامة اقتباس مفردة بالبداية تجبر الخلية تُعامَل كنص بحت — وجوجل شيتس نفسه يُخفي هذي
 * العلامة بالعرض، فالنتيجة المرئية مطابقة 100% لأي بيانات طبيعية لا تبدأ بهذي الرموز */
function sanitizeSheetText_(str) {
  const s = String(str == null ? '' : str);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/* ===================================================
 *  حدود أيام الرياض — حساب آمن بغضّ النظر عن المنطقة الزمنية الافتراضية لمشروع Apps Script
 *  السعودية على فارق توقيت ثابت +03:00 بلا توقيت صيفي منذ 1968، فيصح الاعتماد عليه كرقم صريح
 *  بدل new Date(نص محلي) التي تتأثر بإعداد المنطقة الزمنية الافتراضية للمشروع نفسه (قد لا تطابق
 *  آسيا/الرياض) وتُنتج حدود يوم خاطئة صامتة
 * ===================================================
 *  Riyadh day boundaries — computed safely regardless of the Apps Script project's default
 *  timezone. Saudi Arabia has used a fixed +03:00 offset (no DST) since 1968, so it's safe to
 *  hardcode, instead of new Date(local string) which depends on the project's own default
 *  timezone setting (may not match Asia/Riyadh) and can silently produce wrong day boundaries
 * =================================================== */
const RIYADH_UTC_OFFSET_MS_ = 3 * 3600000;
function riyadhMidnightMs_(date) {
  const y = Number(Utilities.formatDate(date, 'Asia/Riyadh', 'yyyy'));
  const m = Number(Utilities.formatDate(date, 'Asia/Riyadh', 'MM'));
  const d = Number(Utilities.formatDate(date, 'Asia/Riyadh', 'dd'));
  return Date.UTC(y, m - 1, d) - RIYADH_UTC_OFFSET_MS_;
}
function riyadhDateStrToMs_(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) - RIYADH_UTC_OFFSET_MS_;
}

/* ===================================================
 *  إحصائيات البطاقات (عدد المحطات/الإضافات/التعديلات)
 * =================================================== */
function getStats() {
  function collectIds(index) {
    const ids = new Set();
    index.forEach(function(st) { ids.add(st.normalizedId); });
    return { filled: ids.size, ids: ids };
  }
  const stInfo = collectIds(getStationsIndex_());
  const subInfo = collectIds(getSubstationsIndex_());

  const auditSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.AUDIT_SHEET);
  const now = new Date();
  const startToday = new Date(riyadhMidnightMs_(now));
  const startYesterday = new Date(startToday.getTime() - 24 * 3600000);

  let additionsToday = 0, editsToday = 0, additionsYesterday = 0, editsYesterday = 0;
  let addDistToday = 0, addSubToday = 0, editDistToday = 0, editSubToday = 0;
  if (auditSheet) {
    const data = auditSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const t = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);
      if (isNaN(t)) continue;
      const type = data[i][2];
      const ref = normalizeArabicDigits_(String(data[i][3] || '')).toUpperCase();
      const isToday = t >= startToday;
      const isYesterday = t >= startYesterday && t < startToday;
      const isDistribution = stInfo.ids.has(ref);
      const isSubstation = subInfo.ids.has(ref);

      if (type === 'إضافة_محطة_جديدة') {
        if (isToday) { additionsToday++; if (isDistribution) addDistToday++; else if (isSubstation) addSubToday++; }
        else if (isYesterday) additionsYesterday++;
      } else if (type === 'تعديل_إحداثية') {
        if (isToday) { editsToday++; if (isDistribution) editDistToday++; else if (isSubstation) editSubToday++; }
        else if (isYesterday) editsYesterday++;
      }
    }
  }

  function pctChange(today, yesterday) {
    if (yesterday === 0) return today > 0 ? null : 0;
    return Math.round(((today - yesterday) / yesterday) * 100);
  }

  return {
    success: true,
    totalStations: stInfo.filled + subInfo.filled,
    distribution: stInfo.filled,
    substations: subInfo.filled,
    additions: additionsToday,
    edits: editsToday,
    additionsChangePct: pctChange(additionsToday, additionsYesterday),
    editsChangePct: pctChange(editsToday, editsYesterday),
    additionsDistribution: addDistToday,
    additionsSubstations: addSubToday,
    editsDistribution: editDistToday,
    editsSubstations: editSubToday
  };
}

function getMemberProfile(phone) {
  const formatted = formatPhone(phone);
  if (!formatted) return { error: 'رقم جوال غير صحيح' };
  const member = findUser(formatted);
  if (!member) return { error: 'العضو غير موجود' };

  const visitsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.VISITS_SHEET);
  let lastLogin = null;
  if (visitsSheet) {
    const data = visitsSheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (phonesMatch_(data[i][1], formatted) && data[i][2] === 'دخول' && data[i][3] === 'نجاح') {
        lastLogin = data[i][0];
        break;
      }
    }
  }

  const activity = getMemberActivity_(formatted);
  return {
    success: true,
    name: member.name, phone: member.phone, email: member.email,
    memberType: member.memberType, role: member.role,
    shift: member.shift, department: member.department,
    lastLogin: lastLogin,
    additionsList: activity.additionsList,
    editsList: activity.editsList,
    stats: { additions: activity.additions, edits: activity.edits, total: activity.additions + activity.edits }
  };
}

/* بناء قائمتي إضافات/تعديلات العضو مع اسم المنطقة (من فهرس محطات التوزيع — محطات التحويل ما فيها عمود منطقة أصلًا فتظهر "—") */
function getMemberActivity_(phone) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.AUDIT_SHEET);
  const additionsList = [], editsList = [];
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    const regionByNormalizedId = {};
    getStationsIndex_().forEach(function (st) { regionByNormalizedId[st.normalizedId] = st.region || ''; });

    for (let i = 1; i < data.length; i++) {
      if (!phonesMatch_(data[i][1], phone)) continue;
      const type = String(data[i][2] || '');
      if (type !== 'إضافة_محطة_جديدة' && type !== 'تعديل_إحداثية') continue;
      const t = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);
      if (isNaN(t)) continue;
      const stationId = data[i][3];
      const normalizedId = normalizeArabicDigits_(String(stationId || '')).toUpperCase();
      const entry = {
        stationId: stationId,
        region: regionByNormalizedId[normalizedId] || '—',
        date: Utilities.formatDate(t, 'Asia/Riyadh', 'dd/MM/yyyy'),
        time: Utilities.formatDate(t, 'Asia/Riyadh', 'HH:mm:ss'),
        _t: t.getTime()
      };
      if (type === 'إضافة_محطة_جديدة') additionsList.push(entry);
      else editsList.push(entry);
    }
  }
  additionsList.sort(function (a, b) { return b._t - a._t; }); // الأحدث أولًا
  editsList.sort(function (a, b) { return b._t - a._t; });
  additionsList.forEach(function (e) { delete e._t; });
  editsList.forEach(function (e) { delete e._t; });

  return {
    additions: additionsList.length,
    edits: editsList.length,
    additionsList: additionsList.slice(0, 50),
    editsList: editsList.slice(0, 50)
  };
}

function updateMemberProfile(data) {
  const phone = formatPhone(data.phone);
  if (!phone) return { error: 'رقم جوال غير صحيح' };
  if (!data.name || data.name.trim().length < 3) return { error: 'الاسم يجب أن يكون ٣ أحرف على الأقل' };
  if (!isValidEmail_(data.email)) return { error: 'الرجاء إدخال بريد إلكتروني صحيح' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.MEMBERS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (phonesMatch_(values[i][1], phone)) {
      sheet.getRange(i + 1, 1).setValue(sanitizeSheetText_(data.name.trim()));
      sheet.getRange(i + 1, 3).setValue(sanitizeSheetText_(data.email.trim()));
      if (data.shift) sheet.getRange(i + 1, 6).setValue(sanitizeSheetText_(data.shift));
      if (data.department) sheet.getRange(i + 1, 9).setValue(sanitizeSheetText_(data.department));
      invalidateMembersCache_();
      logAudit(phone, 'تعديل_بيانات_شخصية', phone, data.name.trim());
      return { success: true };
    }
  }
  return { error: 'العضو غير موجود' };
}

/* مفاتيح الدول المدعومة بقائمة اختيار الجوال بـauth.html — يجب مطابقتها لو أُضيفت دولة جديدة هناك */
const KNOWN_COUNTRY_CODES_ = ['+966', '+971', '+973', '+965', '+974', '+968', '+962', '+20'];
const KNOWN_COUNTRY_DIGITS_ = KNOWN_COUNTRY_CODES_.map(function (c) { return c.slice(1); })
  .sort(function (a, b) { return b.length - a.length; }); // الأطول أولًا لمنع تطابق جزئي خاطئ
function formatPhone(phone) {
  if (!phone) return null;
  let p = String(phone).trim();
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  p = p.replace(/[٠-٩]/g, d => String(arabicIndic.indexOf(d)));
  p = p.replace(/[\s-]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('05')) p = '+966' + p.slice(1);
  if (!p.startsWith('+')) {
    // القيمة تحمل مفتاح دولة فعليًا لكن بلا علامة + (مثل بيانات قديمة بالشيت: "966555889581") —
    // نضيف + فقط بدل إضافة +966 كاملة فوقها (كان هذا يُكرّر المفتاح ويُنتج رقمًا فاسدًا)
    const bareCode = KNOWN_COUNTRY_DIGITS_.find(function (d) { return p.startsWith(d); });
    p = bareCode ? '+' + p : '+966' + p;
  }

  // يمنع نمط "مفتاح الدولة + صفر زائد بداية الرقم المحلي" (مثل +9660501234567) — خطأ إدخال شائع
  // ناتج عن عادة كتابة الرقم بصفر بالبداية رغم اختيار مفتاح الدولة من القائمة بالواجهة
  const matchedCode = KNOWN_COUNTRY_CODES_.find(function (c) { return p.startsWith(c); });
  if (matchedCode) {
    const rest = p.slice(matchedCode.length).replace(/^0+/, '');
    p = matchedCode + rest;
  }

  return /^\+\d{10,13}$/.test(p) ? p : null;
}

function phonesMatch_(stored, lookup) {
  var digitsOnly = function(s) { return String(s).replace(/\D/g, ''); };
  var a = digitsOnly(stored).slice(-9);
  var b = digitsOnly(lookup).slice(-9);
  return a.length === 9 && a === b;
}

/* إصلاح: تقرأ الآن من getMembersRows_() المخزَّن مؤقتًا لعمر الطلب — نفس منطق المطابقة phonesMatch_ بلا أي تغيير بالسلوك،
 * لكن الشيت يُقرأ مرة واحدة فقط بدل قراءة كاملة جديدة لكل استدعاء (كانت هذه العلّة الأساسية لبطء/فشل لوحة المدير) */
function findUser(phone) {
  const data = getMembersRows_();
  for (let i = 1; i < data.length; i++) {
    if (phonesMatch_(data[i][1], phone)) {
      return {
        name: data[i][0], phone: formatPhone(data[i][1]) || phone, email: data[i][2],
        role: isAdminPhone(phone) ? 'admin' : 'member',
        memberType: data[i][4], shift: data[i][5], status: data[i][6],
        department: data[i][8] || ''
      };
    }
  }
  return null;
}

/* إصلاح: تقرأ الآن من getSettingsRows_() المخزَّن مؤقتًا لعمر الطلب بدل قراءة كاملة لشيت الإعدادات مع كل استدعاء
 * أمان: تقرأ من "رقم جوال المدير السري" (إعداد منفصل تمامًا، لا يظهر بأي واجهة) وليس من "رقم جوال المدير"
 * العام (المستخدم فقط لزري الاتصال/واتساب للتواصل) — يمنع أي شخص يعرف رقم التواصل العام من انتحال صلاحية المدير */
function isAdminPhone(phone) {
  const data = getSettingsRows_();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'رقم جوال المدير السري') return phonesMatch_(data[i][1], phone);
  }
  return false;
}
function getAdminContactInfo_() {
  const data = getSettingsRows_();
  let phone = '', email = '';
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'رقم جوال المدير') phone = String(data[i][1] || '').trim();
    if (data[i][0] === 'ايميل المدير') email = String(data[i][1] || '').trim();
  }
  return { success: true, phone: phone, email: email };
}

/* ===================================================
 *  سجلات
 * =================================================== */
function ensureErrorLogClassificationColumn_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('error_log_category_col_added') === 'true') return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ERROR_LOG_SHEET);
  if (sheet) {
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (headers.indexOf('التصنيف') === -1) {
      const newCol = lastCol + 1;
      sheet.getRange(1, newCol).setValue('التصنيف').setFontWeight('bold');
    }
  }
  props.setProperty('error_log_category_col_added', 'true');
}
function logError(source, message, details) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ERROR_LOG_SHEET)
      .appendRow([new Date(), source, sanitizeSheetText_(message), sanitizeSheetText_(details), classifyError_(source, message)]);
  } catch (e) {}
}

/* ===================================================
 *  تسجيل أخطاء الواجهة الأمامية (Client-side) بنفس شيت "سجل الأخطاء" الحالي — بدون أعمدة جديدة.
 *  هذا يسدّ فجوة تشخيصية: فشل استجابة Apps Script بصفحة HTML بدل JSON (بسبب بطء/حمل مؤقت) لا يمر
 *  عبر أي try/catch بالكود الخادمي، فلا يصل لسجل الأخطاء إطلاقًا إلا عبر هذا المسار من المتصفح.
 *  Logs client-side (browser) failures into the existing error-log sheet — no new columns. Closes a
 *  diagnostic gap: when Apps Script returns an HTML error page instead of JSON (transient slowness/
 *  load), it never passes through server-side try/catch, so only the browser can report it here.
 * =================================================== */
function logClientError_(data) {
  logError(data.source || 'client', String(data.message || ''), String(data.details || ''));
  return { success: true };
}

// إعادة محاولة عند فشل خدمة جداول البيانات المؤقت (قراءات فقط، آمنة للتكرار)
// Retry helper for transient Spreadsheet-service failures (read-only calls — safe to repeat)
function withSheetRetry_(fn, maxAttempts) {
  maxAttempts = maxAttempts || 3;
  var lastErr;
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      var msg = (err && err.toString()) || '';
      var isTransient = msg.indexOf('جداول البيانات') !== -1 || msg.indexOf('Spreadsheets') !== -1 || msg.indexOf('timed out') !== -1;
      if (!isTransient || attempt === maxAttempts) throw err;
      Utilities.sleep(300 * attempt);
    }
  }
  throw lastErr;
}
function logVisit(phone, action, result) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.VISITS_SHEET)
      .appendRow([new Date(), phone, action, result]);
  } catch (e) {}
}

/* ============================================================
 *  أدوات تنظيف يدوية (تُشغَّل من محرر Apps Script فقط، لا ترتبط بأي
 *  طلب من الموقع) — أُبقيت لأنها قد تُحتاج مجددًا مستقبلًا، لكنها لا
 *  تُستدعى تلقائيًا من doPost إطلاقًا
 * ============================================================ */
function looksLikePhoneNotEmail_(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (s.indexOf('@') !== -1) return false;
  const digitsOnly = normalizeArabicDigits_(s).replace(/[^0-9]/g, '');
  return digitsOnly.length >= 8;
}
function auditMisalignedStationRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [
    { sheet: ss.getSheetByName(CONFIG.STATIONS_SHEET), cols: COLS, label: 'محطات التوزيع' },
    { sheet: ss.getSheetByName(CONFIG.SUBSTATIONS_SHEET), cols: SUB_COLS, label: 'محطات التحويل' }
  ].forEach(function (table) {
    if (!table.sheet) return;
    const values = table.sheet.getDataRange().getValues();
    const affected = [];
    for (let i = 1; i < values.length; i++) {
      const emailCell = values[i][table.cols.USER_EMAIL];
      if (looksLikePhoneNotEmail_(emailCell)) {
        affected.push({
          صف: i + 1,
          معرف_المحطة: values[i][table.cols.STATION_NUMBER !== undefined ? table.cols.STATION_NUMBER : table.cols.SHORT_NAME],
          محتوى_عمود_رقم_الجوال_حاليًا: values[i][table.cols.USER_PHONE],
          محتوى_عمود_الإيميل_حاليًا: emailCell
        });
      }
    }
    Logger.log('== ' + table.label + ' — عدد الصفوف المتأثرة: ' + affected.length + ' ==');
    Logger.log(JSON.stringify(affected, null, 2));
  });
  Logger.log('انتهى الفحص. راجع القائمة أعلاه، وشغّل fixMisalignedStationRows() فقط بعد التأكد.');
}

/* تشخيصية فقط — لا تحذف ولا تعدّل أي شيء. تفحص شيتي التوزيع/التحويل كل واحد على حدة وتطبع
 * (Logger.log) أي رقم محطة يتكرر بأكثر من صف (بعد تطبيع الأرقام العربية وتوحيد حالة الأحرف،
 * نفس منطق normalizedId بـgetStats/buildStationsIndex_) — هذا هو سبب الفارق بين عدد "المعرّفات
 * الفريدة" المعروض بلوحة المدير وعدد "الصفوف الخام" المعروض بذاكرة المتصفح المؤقتة بـindex.html.
 * راجع النتيجة يدويًا وقرّر الدمج/الحذف بنفسك — لا يوجد إصلاح تلقائي لتكرار بيانات حقيقية */
function auditDuplicateStationIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [
    { sheet: ss.getSheetByName(CONFIG.STATIONS_SHEET), idCol: COLS.STATION_NUMBER, label: 'محطات التوزيع' },
    { sheet: ss.getSheetByName(CONFIG.SUBSTATIONS_SHEET), idCol: SUB_COLS.SHORT_NAME, label: 'محطات التحويل' }
  ].forEach(function (table) {
    if (!table.sheet) return;
    const values = table.sheet.getDataRange().getValues();
    const rowsByNormalizedId = {};
    for (let i = 1; i < values.length; i++) {
      const rawId = values[i][table.idCol];
      if (rawId === '' || rawId === null || rawId === undefined) continue;
      const normalizedId = normalizeArabicDigits_(String(rawId)).toUpperCase();
      if (!rowsByNormalizedId[normalizedId]) rowsByNormalizedId[normalizedId] = [];
      rowsByNormalizedId[normalizedId].push({ صف: i + 1, القيمة_كما_هي_بالشيت: rawId });
    }
    const duplicates = Object.keys(rowsByNormalizedId)
      .filter(function (id) { return rowsByNormalizedId[id].length > 1; })
      .map(function (id) { return { المعرف_الموحّد: id, الصفوف: rowsByNormalizedId[id] }; });
    Logger.log('== ' + table.label + ' — عدد أرقام المحطات المكرَّرة: ' + duplicates.length + ' ==');
    Logger.log(JSON.stringify(duplicates, null, 2));
  });
  Logger.log('انتهى الفحص. كل معرّف مكرَّر أعلاه يعني صفين أو أكثر بنفس رقم المحطة بعد التطبيع — راجعها يدويًا وقرّر الدمج/الحذف/التصحيح بنفسك بالشيت مباشرة.');
}

/* ============================================================
 *  دمج المحطات المكرَّرة — منطق القرار المشترك (بلا أي تعديل على الشيت)
 * ============================================================
 *  لكل مجموعة صفوف بنفس رقم المحطة (بعد التطبيع):
 *  ١) صف واحد فقط "مُعدَّل" (له تاريخ+اسم مستخدم حقيقيّين بعمودي التاريخ/اسم المستخدم،
 *     أي مرّ فعليًا بـaddNewStation أو updateCoordinates) → يُبقى هو وحده، الباقي يُحذف.
 *  ٢) أكثر من صف "مُعدَّل" → يُبقى صاحب أحدث تاريخ+وقت، الباقي يُحذف (حتى لو كان من
 *     ضمن الباقي صف "مُعدَّل" أيضًا لكن أقدم).
 *  ٣) ولا صف "مُعدَّل" (كلها بيانات أصلية غير ملموسة، غالبًا من استيراد قديم) → تُبقى
 *     أول نسخة بترتيب الشيت (أصغر رقم صف)، والباقي يُحذف.
 * ============================================================ */
function planDuplicateStationMerges_(sheet, cols) {
  const values = sheet.getDataRange().getValues();
  const groups = {};
  for (let i = 1; i < values.length; i++) {
    const rawId = values[i][cols.idCol];
    if (rawId === '' || rawId === null || rawId === undefined) continue;
    const normalizedId = normalizeArabicDigits_(String(rawId)).toUpperCase();
    if (!groups[normalizedId]) groups[normalizedId] = [];
    groups[normalizedId].push(i + 1); // رقم الصف الفعلي بالشيت (1-indexed، شامل صف العناوين)
  }

  const rowsToDelete = [];   // { row, normalizedId, reason, snapshot }
  const rowsKept = [];        // { row, normalizedId, reason }

  function isEdited(row) {
    const dateVal = values[row - 1][cols.DATE];
    const userVal = values[row - 1][cols.USER_NAME];
    return dateVal !== '' && dateVal !== null && dateVal !== undefined &&
      userVal !== '' && userVal !== null && userVal !== undefined;
  }
  // يحلّل قيمة التاريخ يدويًا بصيغة dd/MM/yyyy (نفس صيغة Utilities.formatDate المُستخدمة بكل الكود)
  // بدل الاعتماد على new Date(string) — محرّك JS يفترض MM/dd/yyyy لسلاسل الشرطة المائلة فيقلب
  // اليوم والشهر خطأً؛ ويتعامل أيضًا مع حالة كون القيمة كائن Date فعليًا (لو جوجل شيتس حوّلها تلقائيًا)
  function parseSheetDateString_(s) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d) ? null : d;
  }
  function rowMoment(row) {
    const dateVal = values[row - 1][cols.DATE], timeVal = values[row - 1][cols.TIME];
    if (!dateVal) return null;
    const d = dateVal instanceof Date ? new Date(dateVal.getTime()) : parseSheetDateString_(dateVal);
    if (!d || isNaN(d)) return null;
    if (timeVal) {
      if (timeVal instanceof Date) {
        d.setHours(timeVal.getHours(), timeVal.getMinutes(), timeVal.getSeconds());
      } else {
        const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeVal).trim());
        if (tm) d.setHours(Number(tm[1]), Number(tm[2]), Number(tm[3] || 0));
      }
    }
    return d;
  }

  Object.keys(groups).forEach(function (normalizedId) {
    const rows = groups[normalizedId];
    if (rows.length < 2) return;

    const edited = rows.filter(isEdited);

    if (edited.length === 1) {
      const keepRow = edited[0];
      rowsKept.push({ row: keepRow, normalizedId: normalizedId, reason: 'الصف الوحيد المُعدَّل بالمجموعة' });
      rows.forEach(function (r) {
        if (r !== keepRow) rowsToDelete.push({ row: r, normalizedId: normalizedId, reason: 'مكرَّر غير مُعدَّل، والمجموعة فيها صف مُعدَّل واحد اُستُبقي', snapshot: values[r - 1] });
      });
    } else if (edited.length > 1) {
      let keepRow = edited[0], keepMoment = rowMoment(edited[0]);
      edited.forEach(function (r) {
        const m = rowMoment(r);
        if (m && (!keepMoment || m > keepMoment)) { keepRow = r; keepMoment = m; }
      });
      rowsKept.push({ row: keepRow, normalizedId: normalizedId, reason: 'أحدث صف مُعدَّل بمجموعة فيها أكثر من صف مُعدَّل' });
      rows.forEach(function (r) {
        if (r !== keepRow) rowsToDelete.push({ row: r, normalizedId: normalizedId, reason: 'مكرَّر (مُعدَّل أو لا) وليس الأحدث بمجموعة متعددة التعديل', snapshot: values[r - 1] });
      });
    } else {
      // ولا صف بالمجموعة له تاريخ تعديل — تُبقى أول نسخة بترتيب الشيت (أصغر رقم صف)، والباقي يُحذف
      const keepRow = rows[0];
      rowsKept.push({ row: keepRow, normalizedId: normalizedId, reason: 'أول نسخة بترتيب الشيت، بلا أي صف مُعدَّل بالمجموعة' });
      rows.forEach(function (r) {
        if (r !== keepRow) rowsToDelete.push({ row: r, normalizedId: normalizedId, reason: 'مكرَّر بلا تعديل، وليس أول نسخة بترتيب الشيت', snapshot: values[r - 1] });
      });
    }
  });

  return { rowsToDelete: rowsToDelete, rowsKept: rowsKept };
}

const DUPLICATE_MERGE_TABLES_ = [
  { key: 'STATIONS_SHEET', cols: Object.assign({ idCol: COLS.STATION_NUMBER }, COLS), label: 'محطات التوزيع' },
  { key: 'SUBSTATIONS_SHEET', cols: Object.assign({ idCol: SUB_COLS.SHORT_NAME }, SUB_COLS), label: 'محطات التحويل' }
];

/* معاينة فقط — بلا أي تعديل على الشيت إطلاقًا. تطبع بالضبط ما ستفعله mergeDuplicateStations()
 * لو شُغِّلت الآن (أي الصفوف التي ستُحذف ولماذا، وأيها ستُبقى).
 * شغّلها أولًا وراجع سجل التنفيذ بعناية قبل تشغيل mergeDuplicateStations() الفعلية */
function previewDuplicateStationMerge() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  DUPLICATE_MERGE_TABLES_.forEach(function (table) {
    const sheet = ss.getSheetByName(CONFIG[table.key]);
    if (!sheet) return;
    const plan = planDuplicateStationMerges_(sheet, table.cols);
    Logger.log('===== معاينة — ' + table.label + ' =====');
    Logger.log('صفوف ستُحذف: ' + plan.rowsToDelete.length);
    Logger.log(JSON.stringify(plan.rowsToDelete, null, 2));
    Logger.log('صفوف ستُبقى (الفائزة بكل مجموعة قرَّرها الكود): ' + plan.rowsKept.length);
    Logger.log(JSON.stringify(plan.rowsKept, null, 2));
  });
  Logger.log('انتهت المعاينة — لم يتغيّر أي شيء بالشيت. راجع القوائم أعلاه، وشغّل mergeDuplicateStations() فقط بعد التأكد التام.');
}

/* ⚠️ عملية مدمِّرة تحذف صفوفًا فعليًا من الشيت — لا يمكن التراجع عنها إلا من "سجل الإصدارات"
 * بجوجل شيتس (الملف ← سجل الإصدارات ← عرض سجل الإصدارات) خلال فترة الاحتفاظ. لا تُشغِّلها
 * إلا بعد تشغيل previewDuplicateStationMerge() ومراجعة نتيجتها بعناية تامة أولًا */
function mergeDuplicateStations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let totalDeleted = 0;

  DUPLICATE_MERGE_TABLES_.forEach(function (table) {
    const sheet = ss.getSheetByName(CONFIG[table.key]);
    if (!sheet) return;
    const plan = planDuplicateStationMerges_(sheet, table.cols);

    Logger.log('===== تنفيذ — ' + table.label + ' — سيُحذف ' + plan.rowsToDelete.length + ' صفًا =====');
    Logger.log(JSON.stringify(plan.rowsToDelete, null, 2)); // سجل كامل قبل الحذف — يحتوي نسخة كل صف محذوف كاحتياط مرجعي

    // الحذف من الأسفل للأعلى إلزاميًا — حذف صف يُزيح كل ما تحته لأعلى، فحذف من الأعلى
    // أولًا يُفسد أرقام الصفوف المحسوبة مسبقًا لبقية عمليات الحذف بنفس الدفعة
    const sortedRows = plan.rowsToDelete.map(function (item) { return item.row; }).sort(function (a, b) { return b - a; });
    sortedRows.forEach(function (row) { sheet.deleteRow(row); });
    totalDeleted += sortedRows.length;
  });

  invalidateStationsCache_();
  invalidateSubstationsCache_();
  incrementDataVersion_();

  Logger.log('اكتمل الدمج: حُذف ' + totalDeleted + ' صفًا مكرَّرًا إجمالًا.');
}

function fixMisalignedStationRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let totalFixed = 0;
  [
    { sheet: ss.getSheetByName(CONFIG.STATIONS_SHEET), cols: COLS },
    { sheet: ss.getSheetByName(CONFIG.SUBSTATIONS_SHEET), cols: SUB_COLS }
  ].forEach(function (table) {
    if (!table.sheet) return;
    const values = table.sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      const row = i + 1;
      const wrongEmailCell = values[i][table.cols.USER_EMAIL];
      if (!looksLikePhoneNotEmail_(wrongEmailCell)) continue;

      const wrongPhoneCell = values[i][table.cols.USER_PHONE];
      const realPhone = normalizeArabicDigits_(String(wrongEmailCell)).replace(/[^0-9]/g, '');
      const realReason = wrongPhoneCell;
      const member = findUser(formatPhone(realPhone) || realPhone);

      table.sheet.getRange(row, table.cols.USER_PHONE + 1).setValue(realPhone);
      table.sheet.getRange(row, table.cols.USER_EMAIL + 1).setValue(member ? (member.email || '') : '');
      table.sheet.getRange(row, table.cols.SHIFT + 1).setValue(member ? (member.shift || '') : '');
      if (realReason) table.sheet.getRange(row, table.cols.REASON + 1).setValue(realReason);
      totalFixed++;
    }
    invalidateStationsCache_();
    invalidateSubstationsCache_();
    incrementDataVersion_();
  });
  Logger.log('تم تصحيح ' + totalFixed + ' صفًا بنجاح.');
}

/* تُصحّح صيغة أرقام الجوال الموجودة فعليًا بشيت "الأعضاء" (عمود "الجوال") لتصبح +966XXXXXXXXX
 * موحّدة — لا تحذف ولا تضيف أي صف، فقط تُحدّث قيمة عمود الجوال للصفوف اللي صيغتها غير موحّدة
 * حاليًا. شغّلها يدويًا مرة واحدة من محرر Apps Script (Run) بعد أي دفعة بيانات قديمة مكسورة الصيغة.
 * لا ترتبط بـdoPost إطلاقًا، ولا تؤثر على تسجيل الدخول — phonesMatch_ أصلًا تتعرف على كل
 * الصيغ (بمفتاح دولة أو بدونه)، فهذا الإصلاح لتوحيد العرض بلوحة المدير والملف الشخصي فقط */
function fixMemberPhoneFormats() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.MEMBERS_SHEET);
  if (!sheet) { Logger.log('شيت الأعضاء غير موجود.'); return; }
  const values = sheet.getDataRange().getValues();
  let fixedCount = 0, skippedInvalid = 0;

  for (let i = 1; i < values.length; i++) {
    const raw = values[i][1];
    if (!raw) continue;
    const formatted = formatPhone(raw);
    if (!formatted) { skippedInvalid++; Logger.log('تخطّي صف ' + (i + 1) + ' — رقم غير صالح: ' + raw); continue; }
    if (String(raw).trim() === formatted) continue; // الصيغة سليمة أصلًا، لا داعي للكتابة
    sheet.getRange(i + 1, 2).setNumberFormat('@').setValue(formatted);
    fixedCount++;
  }
  invalidateMembersCache_();
  Logger.log('تم توحيد صيغة ' + fixedCount + ' رقم جوال. تخطّي ' + skippedInvalid + ' صف برقم غير صالح (يحتاج مراجعة يدوية).');
}

function logAudit(phone, type, ref, details) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.AUDIT_SHEET)
      .appendRow([new Date(), phone, type, sanitizeSheetText_(ref), sanitizeSheetText_(details)]);
  } catch (e) {}
}

/* ============================================================
 *  لوحة عمليات المدير
 * ============================================================ */
const DAILY_REQUEST_LIMIT = 20000;
function incrementDailyRequestCount_(actionName) {
  try {
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd');
    const storedDate = props.getProperty('daily_req_date');
    if (storedDate !== today && storedDate) {
      // تغيّر اليوم — أرشفة إجمالي اليوم المنتهي (storedDate) بخصائص "الأمس" قبل تصفير العدّاد،
      // ليبقى متاحًا للتقرير اليومي حتى لو وصل طلب مستخدم جديد قبل تشغيل التقرير فعليًا
      props.setProperty('daily_req_date_prev', storedDate);
      props.setProperty('daily_req_count_prev', props.getProperty('daily_req_count') || '0');
    }
    let count = (storedDate === today) ? Number(props.getProperty('daily_req_count') || 0) : 0;
    count++;
    props.setProperty('daily_req_date', today);
    props.setProperty('daily_req_count', String(count));

    const breakdownKey = 'daily_req_breakdown';
    let breakdown = (storedDate === today) ? JSON.parse(props.getProperty(breakdownKey) || '{}') : {};
    const key = actionName || 'غير معروف';
    breakdown[key] = (breakdown[key] || 0) + 1;
    props.setProperty(breakdownKey, JSON.stringify(breakdown));
  } catch (e) { /* لا نُفشل الطلب الأصلي أبدًا بسبب فشل العدّاد نفسه */ }
}
function getDailyRequestBreakdown_() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd');
  const storedDate = props.getProperty('daily_req_date');
  if (storedDate !== today) return [];
  let breakdown;
  try { breakdown = JSON.parse(props.getProperty('daily_req_breakdown') || '{}'); } catch (e) { return []; }
  return Object.keys(breakdown)
    .map(function (k) { return { action: k, count: breakdown[k] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 5);
}
function getDailyRequestCount_() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd');
  const storedDate = props.getProperty('daily_req_date');
  return (storedDate === today) ? Number(props.getProperty('daily_req_count') || 0) : 0;
}
/* إجمالي طلبات اليوم المنتهي فعليًا (الأمس) — يُستخدم بالتقرير اليومي فقط. منفصل عمدًا عن
 * getDailyRequestCount_ (عدّاد "اليوم الجاري") لأن ذاك يُصفَّر تلقائيًا فور وصول أول طلب باليوم
 * الجديد، فلا يصح الاعتماد عليه لمعرفة إجمالي اليوم الذي انتهى للتو وقت تشغيل التقرير */
function getYesterdayRequestCount_() {
  const props = PropertiesService.getScriptProperties();
  const yesterday = Utilities.formatDate(new Date(Date.now() - 24 * 3600000), 'Asia/Riyadh', 'yyyy-MM-dd');
  // الحالة الشائعة: لم يصل أي طلب بعد باليوم الجديد، فالعدّاد الحالي لا يزال يحمل إجمالي الأمس فعليًا
  if (props.getProperty('daily_req_date') === yesterday) return Number(props.getProperty('daily_req_count') || 0);
  // وصل طلب جديد بالفعل قبل تشغيل التقرير — استخدم النسخة المؤرشفة عند لحظة التبديل
  if (props.getProperty('daily_req_date_prev') === yesterday) return Number(props.getProperty('daily_req_count_prev') || 0);
  return 0;
}

function getShiftRange_(now) {
  const riyadhHour = Number(Utilities.formatDate(now, 'Asia/Riyadh', 'H'));
  const startOfToday = new Date(riyadhMidnightMs_(now));
  const sevenAM = new Date(startOfToday.getTime() + 7 * 3600000);
  const sevenPM = new Date(startOfToday.getTime() + 19 * 3600000);
  if (riyadhHour >= 7 && riyadhHour < 19) {
    return { start: sevenAM, end: sevenPM, label: 'الوردية النهارية (٧ص–٧م)' };
  }
  if (riyadhHour >= 19) {
    return { start: sevenPM, end: new Date(sevenPM.getTime() + 12 * 3600000), label: 'الوردية الليلية (٧م–٧ص)' };
  }
  const yesterday7PM = new Date(sevenPM.getTime() - 24 * 3600000);
  return { start: yesterday7PM, end: sevenAM, label: 'الوردية الليلية (٧م–٧ص)' };
}

let _rawActivityRowsCache_ = null;
function getRawActivityRows_() {
  if (_rawActivityRowsCache_) return _rawActivityRowsCache_;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = [];
  function collect(sheetName, timeCol, phoneCol, actionCol) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      const t = values[i][timeCol] instanceof Date ? values[i][timeCol] : new Date(values[i][timeCol]);
      if (isNaN(t)) continue;
      const phone = String(values[i][phoneCol] || '').trim();
      if (!phone) continue;
      rows.push({ time: t, phone: phone, action: values[i][actionCol] });
    }
  }
  collect(CONFIG.VISITS_SHEET, 0, 1, 2);
  collect(CONFIG.AUDIT_SHEET, 0, 1, 2);
  _rawActivityRowsCache_ = rows;
  return rows;
}

/* إصلاح: كانت تستدعي findUser(phone) لكل مستخدم نشط على حدة (كل استدعاء = قراءة كاملة لشيت الأعضاء).
 * أصبحت الآن تعتمد على getMembersRows_() المخزَّنة مؤقتًا لعمر الطلب، فالشيت يُقرأ مرة واحدة بغض النظر عن عدد المستخدمين */
function getActiveUsersDetail(data) {
  const now = new Date();
  let range;
  if (data.dateFrom && data.dateTo) {
    range = {
      start: new Date(riyadhDateStrToMs_(data.dateFrom)),
      end: new Date(riyadhDateStrToMs_(data.dateTo) + 24 * 3600000 - 1),
      label: 'من ' + data.dateFrom + ' إلى ' + data.dateTo
    };
  } else if (data.period === 'shift') {
    range = getShiftRange_(now);
  } else {
    const startOfToday = new Date(riyadhMidnightMs_(now));
    range = { start: startOfToday, end: now, label: 'اليوم الحالي' };
  }

  const activityByPhone = {};
  getRawActivityRows_().forEach(function (row) {
    if (row.time < range.start || row.time > range.end) return;
    if (!activityByPhone[row.phone] || row.time > activityByPhone[row.phone].lastActivity) {
      activityByPhone[row.phone] = { lastActivity: row.time, lastAction: row.action };
    }
  });

  const searchQuery = data.search ? normalizeArabicDigits_(String(data.search).trim().toLowerCase()) : '';
  let users = Object.keys(activityByPhone).map(function (phone) {
    const member = findUser(phone); // الآن يقرأ من الكاش المشترك بدل قراءة جديدة لكل جوال
    return {
      phone: phone,
      name: member ? member.name : '(غير مسجّل)',
      shift: member ? member.shift : '',
      lastAction: activityByPhone[phone].lastAction,
      lastActivity: Utilities.formatDate(activityByPhone[phone].lastActivity, 'Asia/Riyadh', 'yyyy-MM-dd HH:mm')
    };
  });
  if (searchQuery) {
    users = users.filter(function (u) {
      return normalizeArabicDigits_(u.phone).indexOf(searchQuery) !== -1 ||
        String(u.name).toLowerCase().indexOf(searchQuery) !== -1;
    });
  }
  users.sort(function (a, b) { return b.lastActivity.localeCompare(a.lastActivity); });

  return { success: true, period: range.label, count: users.length, users: users };
}

function getDataQualityReport() {
  const stations = getStationsIndex_();
  const substations = getSubstationsIndex_();
  const all = stations.concat(substations);
  const total = all.length;
  const needsReview = all.filter(function (st) { return isNaN(st.lat) || isNaN(st.lng); });
  const qualityPct = total > 0 ? Math.round(((total - needsReview.length) / total) * 100) : 100;
  return {
    success: true,
    qualityPct: qualityPct,
    total: total,
    needsReviewCount: needsReview.length,
    needsReviewStations: needsReview.slice(0, 50).map(function (st) { return st.id; })
  };
}

function getOperationsDashboard(phone) {
  const formatted = formatPhone(phone);
  if (!formatted || !isAdminPhone(formatted)) return { success: false, error: 'هذه اللوحة مخصّصة للمدير فقط' };

  // إصلاح أداء: تخزين مؤقت قصير المدى (TTL قصير جدًا) لناتج لوحة العمليات الثقيل — يمنع إعادة مسح
  // شيتات السجلات الكبيرة (زوار/تعديلات/أخطاء) كاملةً مع كل تحديث تلقائي أو عند تزامن عدة مديرين
  // بنفس اللحظة، وهو السبب الرئيسي المتبقي لبطء/فشل تحميل اللوحة (استجابة HTML بدل JSON من جوجل
  // عند تجاوز وقت التنفيذ). البيانات نفسها تبقى حقيقية من الشيت دائمًا، فقط قد تتأخر لحظات قليلة.
  // Performance fix: very-short-TTL cache for the heavy dashboard payload — avoids a full re-scan of
  // large log sheets (visits/audit/errors) on every auto-refresh or concurrent admin session, the main
  // remaining cause of slow/failed loads (Google returning an HTML page instead of JSON on timeout).
  // Data always stays real from the sheet — only delayed by a few seconds at most.
  const cacheKey = 'ops_dashboard_v1';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* كاش تالف — تجاهله وأعد البناء أدناه */ }
  }

  const result = buildOperationsDashboardData_();
  try { cache.put(cacheKey, JSON.stringify(result), 55); } catch (e) { /* لا نُفشل الطلب بسبب فشل الكتابة بالكاش */ }
  return result;
}

function buildOperationsDashboardData_() {
  const stats = getStats();
  const quality = getDataQualityReport();
  const todayUsers = getActiveUsersDetail({ period: 'today' });
  const shiftUsers = getActiveUsersDetail({ period: 'shift' });

  const errorSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ERROR_LOG_SHEET);
  const errorRows = errorSheet ? errorSheet.getDataRange().getValues() : [];
  const categoryCounts = { 'خطأ برمجي': 0, 'فشل تحديث بيانات': 0, 'محاولة دخول خاطئة': 0, 'مشاكل اتصال': 0, 'تنبيهات': 0 };
  for (let i = 1; i < errorRows.length; i++) {
    const category = classifyError_(errorRows[i][1], errorRows[i][2]);
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }

  return {
    success: true,
    dailyRequests: getDailyRequestCount_(),
    dailyRequestBreakdown: getDailyRequestBreakdown_(),
    dailyRequestLimit: DAILY_REQUEST_LIMIT,
    totalStations: stats.totalStations,
    totalStationsDistribution: stats.distribution,
    totalStationsSubstations: stats.substations,
    additionsToday: stats.additions,
    editsToday: stats.edits,
    searchesToday: getDailyRequestCount_(),
    dataQualityPct: quality.qualityPct,
    stationsNeedingReview: quality.needsReviewCount,
    activeUsersToday: todayUsers.count,
    activeUsersShift: shiftUsers.count,
    currentShiftLabel: getShiftRange_(new Date()).label,
    alertsSummary: categoryCounts
  };
}

/* ============================================================
 *  التقرير اليومي بالإيميل
 * ============================================================
 *  يُرسَل تلقائيًا كل يوم عبر مُشغّل زمني (Time-driven Trigger) — لا
 *  يعمل تلقائيًا بمجرد نشر الكود؛ يجب تثبيته مرة واحدة فقط بتشغيل
 *  createDailyReportTrigger() يدويًا من محرر Apps Script (Run) —
 *  بلا شرطة سفلية بنهاية الاسم عمدًا، لأن Apps Script يُخفي أي دالة
 *  تنتهي بـ"_" من قائمة "تنفيذ" بالمحرر (تُعامَل كدالة خاصة/مساعدة)
 *
 *  ملاحظة توقيت: جدولة Apps Script بالساعة (atHour) تقريبية — تُنفَّذ
 *  خلال نافذة تقارب الساعة حول الوقت المحدد (00:xx تقريبًا)، وليست
 *  دقيقة للثانية. هذا سلوك جوجل نفسه، لا علاقة له بمنطق الكود هنا.
 * ============================================================ */
function createDailyReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyOperationsReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyOperationsReport')
    .timeBased()
    .atHour(0)
    .everyDays(1)
    .inTimezone('Asia/Riyadh')
    .create();
}

/* يعدّ صفوف شيت مُعيَّن حدثت ضمن نطاق زمني [rangeStart, rangeEnd) مُحدَّد بالضبط، باختيار عمود الوقت وشرط اختياري لكل صف */
function countRowsInRange_(sheetName, timeCol, rangeStart, rangeEnd, rowPredicateFn) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return 0;
  const values = sheet.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < values.length; i++) {
    const t = values[i][timeCol] instanceof Date ? values[i][timeCol] : new Date(values[i][timeCol]);
    if (isNaN(t) || t < rangeStart || t >= rangeEnd) continue;
    if (!rowPredicateFn || rowPredicateFn(values[i])) count++;
  }
  return count;
}

/* إحصائيات إضافات/تعديلات المحطات (بتقسيم توزيع/تحويل) ليوم مُحدَّد بالضبط [dayStart, dayEnd) — يُستخدم
 * بالتقرير اليومي المُرسَل بالإيميل بدل getStats() لأن الأخير مبني دائمًا على "اليوم الجاري وقت
 * التنفيذ"، بينما التقرير يحتاج دائمًا اليوم الذي انتهى للتو بغضّ النظر عن وقت تشغيل المُشغّل الزمني */
function getStationChangesForDayRange_(dayStart, dayEnd) {
  function collectIds(index) {
    const ids = new Set();
    index.forEach(function (st) { ids.add(st.normalizedId); });
    return ids;
  }
  const distIds = collectIds(getStationsIndex_());
  const subIds = collectIds(getSubstationsIndex_());

  let additionsDistribution = 0, additionsSubstations = 0, editsDistribution = 0, editsSubstations = 0;
  const auditSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.AUDIT_SHEET);
  if (auditSheet) {
    const data = auditSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const t = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);
      if (isNaN(t) || t < dayStart || t >= dayEnd) continue;
      const type = data[i][2];
      const ref = normalizeArabicDigits_(String(data[i][3] || '')).toUpperCase();
      const isDistribution = distIds.has(ref);
      const isSubstation = subIds.has(ref);
      if (type === 'إضافة_محطة_جديدة') { if (isDistribution) additionsDistribution++; else if (isSubstation) additionsSubstations++; }
      else if (type === 'تعديل_إحداثية') { if (isDistribution) editsDistribution++; else if (isSubstation) editsSubstations++; }
    }
  }
  return { additionsDistribution: additionsDistribution, additionsSubstations: additionsSubstations, editsDistribution: editsDistribution, editsSubstations: editsSubstations };
}

/* ألوان شارات التقرير اليومي — كل مفتاح: خلفية فاتحة + نص + حدّ بنفس درجة اللون */
const REPORT_COLORS_ = {
  green:  { bg: '#E8F8F0', text: '#1E8449', border: '#82E0AA' },
  yellow: { bg: '#FEF9E7', text: '#9A7D0A', border: '#F7DC6F' },
  orange: { bg: '#FDF2E9', text: '#B9770E', border: '#F5B041' },
  blue:   { bg: '#EBF5FB', text: '#2874A6', border: '#85C1E9' },
  teal:   { bg: '#E8F8F5', text: '#148F77', border: '#76D7C4' },
  red:    { bg: '#FDEDEC', text: '#C0392B', border: '#F1948A' }
};
function reportBadge_(text, colorKey) {
  const c = REPORT_COLORS_[colorKey] || REPORT_COLORS_.teal;
  return '<span style="display:inline-block;padding:5px 14px;border-radius:20px;background:' + c.bg +
    ';color:' + c.text + ';border:1px solid ' + c.border + ';font-weight:700;font-size:13px;white-space:nowrap;">' + text + '</span>';
}
function reportRow_(label, valueHtml) {
  return '<tr>' +
    '<td style="padding:12px 10px;border-bottom:1px solid #EEE;font-size:13.5px;color:#333;text-align:right;">' + label + '</td>' +
    '<td style="padding:12px 10px;border-bottom:1px solid #EEE;text-align:left;">' + valueHtml + '</td>' +
    '</tr>';
}
/* درجة لون نسبة استهلاك الحصة اليومية: أخضر < ٦٠٪، أصفر ٦٠-٨٤٪، أحمر ٨٥٪+ */
function quotaColorKey_(pct) {
  if (pct < 60) return 'green';
  if (pct < 85) return 'yellow';
  return 'red';
}
/* حالة النظام مبنية على أرقام حقيقية فقط (عدد الأخطاء + نسبة الحصة) — بلا نسبة مئوية وهمية للحالة نفسها */
function systemStatusInfo_(errorsToday, quotaPct) {
  if (errorsToday === 0 && quotaPct < 60) return { label: 'ممتاز ✅', color: 'green' };
  if (errorsToday <= 5 && quotaPct < 85) return { label: 'جيد ✅', color: 'green' };
  if (errorsToday <= 20 && quotaPct < 90) return { label: 'تحذير ⚠️', color: 'yellow' };
  return { label: 'حرج 🔴', color: 'red' };
}

function sendDailyOperationsReport() {
  try {
    const adminInfo = getAdminContactInfo_();
    if (!adminInfo.email) {
      logError('sendDailyOperationsReport', 'لا يوجد إيميل مدير مسجّل بشيت الإعدادات، تعذّر إرسال التقرير اليومي', '');
      return;
    }

    /* إصلاح: المُشغّل يعمل قرب منتصف الليل (atHour(0))، أي فور بداية يوم جديد — فكانت كل الأرقام
     * تُحسب لحظيًا وقت التنفيذ (بضع دقائق من يوم بدأ للتو) بدل اليوم الكامل الذي انتهى فعليًا، فتصل
     * شبه صفرية دائمًا. الآن يُحسب نطاق "الأمس" الكامل بتوقيت الرياض صراحةً ويُستخدم لكل الأرقام */
    const now = new Date();
    const startOfToday = new Date(riyadhMidnightMs_(now));
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 3600000);

    const changeStats = getStationChangesForDayRange_(startOfYesterday, startOfToday);
    const dailyRequests = getYesterdayRequestCount_();
    const newMembersYesterday = countRowsInRange_(CONFIG.VISITS_SHEET, 0, startOfYesterday, startOfToday, function (row) {
      return row[2] === 'تسجيل_عضو' && row[3] === 'نجاح';
    });
    const errorsYesterday = countRowsInRange_(CONFIG.ERROR_LOG_SHEET, 0, startOfYesterday, startOfToday, null);

    const quotaPct = Math.round((dailyRequests / DAILY_REQUEST_LIMIT) * 100);
    const quotaColor = quotaColorKey_(quotaPct);
    const errorsColor = errorsYesterday > 0 ? 'yellow' : 'green';
    const status = systemStatusInfo_(errorsYesterday, quotaPct);

    const reportDateLabel = Utilities.formatDate(startOfYesterday, 'Asia/Riyadh', 'dd/MM/yyyy');
    const subject = 'التقرير اليومي — نظام محطات التوزيع (' + reportDateLabel + ')';

    const rows =
      reportRow_('أ) عدد طلبات السكربت', reportBadge_(dailyRequests + ' / ' + DAILY_REQUEST_LIMIT + ' (' + quotaPct + '%)', quotaColor)) +
      reportRow_('ب) الأعضاء الجدد المسجلين', reportBadge_(String(newMembersYesterday), 'teal')) +
      reportRow_('ج) محطات مُعدَّلة (توزيع | تحويل)', reportBadge_(changeStats.editsDistribution + ' | ' + changeStats.editsSubstations, 'orange')) +
      reportRow_('د) محطات مُضافة (توزيع | تحويل)', reportBadge_(changeStats.additionsDistribution + ' | ' + changeStats.additionsSubstations, 'blue')) +
      reportRow_('س) عدد الأخطاء المُسجَّلة', reportBadge_(String(errorsYesterday), errorsColor)) +
      reportRow_('ر) حالة النظام', reportBadge_(status.label, status.color));

    const htmlBody =
      '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;padding:20px;">' +
      '<h2 style="text-align:center;color:#1B4D8C;margin:0 0 4px;">التقرير اليومي</h2>' +
      '<div style="text-align:center;color:#888;font-size:12.5px;margin-bottom:18px;">نظام محطات التوزيع — ' + reportDateLabel + '</div>' +
      '<table style="width:100%;border-collapse:collapse;">' + rows + '</table>' +
      '<div style="text-align:center;color:#AAA;font-size:11px;margin-top:18px;">تقرير آلي، لا حاجة للرد عليه</div>' +
      '</div>';

    const plainBody =
      'التقرير اليومي لنظام محطات التوزيع — ' + reportDateLabel + '\n\n' +
      'أ) عدد طلبات السكربت: ' + dailyRequests + ' من أصل ' + DAILY_REQUEST_LIMIT + ' (' + quotaPct + '%)\n' +
      'ب) عدد الأعضاء الجدد المسجلين: ' + newMembersYesterday + '\n' +
      'ج) عدد المحطات المُعدَّلة بياناتها — توزيع: ' + changeStats.editsDistribution + ' | تحويل: ' + changeStats.editsSubstations + '\n' +
      'د) عدد محطات التوزيع/التحويل المُضافة — توزيع: ' + changeStats.additionsDistribution + ' | تحويل: ' + changeStats.additionsSubstations + '\n' +
      'س) عدد الأخطاء المُسجَّلة: ' + errorsYesterday + '\n' +
      'ر) حالة النظام: ' + status.label + '\n\n' +
      '— تقرير آلي، لا حاجة للرد عليه.';

    MailApp.sendEmail({ to: adminInfo.email, subject: subject, body: plainBody, htmlBody: htmlBody });
  } catch (err) {
    logError('sendDailyOperationsReport exception', err.toString(), '');
  }
}

function classifyError_(source, message) {
  const s = String(source || '').toLowerCase();
  const m = String(message || '').toLowerCase();

  if (m.indexOf('referenceerror') !== -1 || m.indexOf('typeerror') !== -1 || m.indexOf('syntaxerror') !== -1 ||
      m.indexOf('is not defined') !== -1 || m.indexOf('is not a function') !== -1 || m.indexOf('cannot read') !== -1) {
    return 'خطأ برمجي';
  }
  if (s.indexOf('credential') !== -1 || s.indexOf('assertion') !== -1 || s.indexOf('admincode') !== -1) {
    return 'محاولة دخول خاطئة';
  }
  if (s.indexOf('update') !== -1 || s.indexOf('addnewstation') !== -1 || s.indexOf('coordinates') !== -1) {
    return 'فشل تحديث بيانات';
  }
  if (m.indexOf('timeout') !== -1 || m.indexOf('timed out') !== -1 || m.indexOf('network') !== -1 || m.indexOf('service invoked too many times') !== -1) {
    return 'مشاكل اتصال';
  }
  return 'تنبيهات';
}

/* إصلاح: findUser بالحلقة تعتمد الآن على الكاش المشترك بدل قراءة جديدة لكل صف (حتى 500 صف بحد أقصى بلوحة المدير) */
function getChangesLog(data) {
  const typeFilter = data && data.type;
  const limit = (data && data.limit) ? Number(data.limit) : 100;
  const dateFrom = data && data.dateFrom ? new Date(riyadhDateStrToMs_(data.dateFrom)) : null;
  const dateTo = data && data.dateTo ? new Date(riyadhDateStrToMs_(data.dateTo) + 24 * 3600000 - 1) : null;
  const searchQuery = data && data.search ? normalizeArabicDigits_(String(data.search).trim().toLowerCase()) : '';

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.AUDIT_SHEET);
  if (!sheet) return { success: true, changes: [] };
  const rows = sheet.getDataRange().getValues();

  const changes = [];
  for (let i = rows.length - 1; i >= 1 && changes.length < limit; i--) {
    const type = rows[i][2];
    if (typeFilter && type !== typeFilter) continue;
    const t = rows[i][0] instanceof Date ? rows[i][0] : new Date(rows[i][0]);
    if (dateFrom && t < dateFrom) continue;
    if (dateTo && t > dateTo) continue;

    const phone = String(rows[i][1] || '');
    const member = findUser(phone); // يقرأ من الكاش المشترك الآن
    const stationId = String(rows[i][3] || '');
    const memberName = member ? member.name : '(غير معروف)';

    if (searchQuery) {
      const haystack = normalizeArabicDigits_(stationId + ' ' + memberName + ' ' + phone).toLowerCase();
      if (haystack.indexOf(searchQuery) === -1) continue;
    }

    changes.push({
      stationId: stationId,
      memberName: memberName,
      phone: phone,
      shift: member ? member.shift : '',
      changeType: type,
      date: Utilities.formatDate(t, 'Asia/Riyadh', 'dd/MM/yyyy'),
      time: Utilities.formatDate(t, 'Asia/Riyadh', 'HH:mm:ss'),
      details: rows[i][4]
    });
  }
  return { success: true, changes: changes };
}

/* ============================================================
 *  الرسوم البيانية
 * ============================================================ */
function collectActivityEvents_(daysBack) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cutoff = new Date(Date.now() - daysBack * 24 * 3600000);
  const events = [];

  const visitsSheet = ss.getSheetByName(CONFIG.VISITS_SHEET);
  if (visitsSheet) {
    const rows = visitsSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const t = rows[i][0] instanceof Date ? rows[i][0] : new Date(rows[i][0]);
      if (isNaN(t) || t < cutoff) continue;
      events.push({ time: t, ref: '' });
    }
  }
  const auditSheet = ss.getSheetByName(CONFIG.AUDIT_SHEET);
  if (auditSheet) {
    const rows = auditSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const t = rows[i][0] instanceof Date ? rows[i][0] : new Date(rows[i][0]);
      if (isNaN(t) || t < cutoff) continue;
      events.push({ time: t, ref: normalizeArabicDigits_(String(rows[i][3] || '')).toUpperCase() });
    }
  }
  return events;
}

function getVisitorsChart() {
  const events = collectActivityEvents_(7);
  const counts = {};
  for (let d = 6; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * 3600000);
    counts[Utilities.formatDate(date, 'Asia/Riyadh', 'yyyy-MM-dd')] = 0;
  }
  events.forEach(function (ev) {
    const key = Utilities.formatDate(ev.time, 'Asia/Riyadh', 'yyyy-MM-dd');
    if (key in counts) counts[key]++;
  });
  const days = Object.keys(counts).sort();
  return {
    success: true,
    labels: days.map(function (d) { return Utilities.formatDate(new Date(riyadhDateStrToMs_(d)), 'Asia/Riyadh', 'EEE dd/MM'); }),
    values: days.map(function (d) { return counts[d]; })
  };
}

function getPeakHoursHeatmap() {
  const events = collectActivityEvents_(30);
  const matrix = [];
  for (let d = 0; d < 7; d++) matrix.push(new Array(24).fill(0));
  events.forEach(function (ev) {
    const weekday = Number(Utilities.formatDate(ev.time, 'Asia/Riyadh', 'u')) % 7;
    const hour = Number(Utilities.formatDate(ev.time, 'Asia/Riyadh', 'H'));
    matrix[weekday][hour]++;
  });
  let peakDay = 0, peakHour = 0, peakCount = -1;
  matrix.forEach(function (row, d) {
    row.forEach(function (count, h) {
      if (count > peakCount) { peakCount = count; peakDay = d; peakHour = h; }
    });
  });
  const WEEKDAY_LABELS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return {
    success: true,
    matrix: matrix,
    weekdayLabels: WEEKDAY_LABELS,
    peak: peakCount > 0 ? { day: WEEKDAY_LABELS[peakDay], hour: peakHour, count: peakCount } : null
  };
}

function getRegionActivity() {
  const events = collectActivityEvents_(30).filter(function (ev) { return ev.ref; });
  const stations = getStationsIndex_();
  const regionByNormalizedId = {};
  stations.forEach(function (st) { regionByNormalizedId[st.normalizedId] = st.region || 'غير محدّدة'; });

  const counts = {};
  events.forEach(function (ev) {
    const region = regionByNormalizedId[ev.ref] || 'غير محدّدة';
    counts[region] = (counts[region] || 0) + 1;
  });

  const ranked = Object.keys(counts)
    .map(function (region) { return { region: region, count: counts[region] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 10);

  return { success: true, regions: ranked };
}