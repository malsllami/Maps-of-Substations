/**
 * ===================================================
 * 08_StationEdits.gs — المحطات: الإضافة، تعديل الإحداثية، والحذف (للمدير)
 * ===================================================
 * - كل كتابة داخل قفل السكربت: فحص التكرار والكتابة وتسجيل مفتاح العملية خطوة واحدة لا يتداخل فيها طلبان
 *   (لا رقم محطة مكرر، ولا تنفيذ مزدوج لنفس مفتاح العملية).
 * - مفتاح العملية (opKey) يُحفظ في «عمليات الحفظ» بعد نجاح الكتابة فقط، فإعادة الإرسال بعد ضياع الرد ترجع
 *   «تم» بلا تكرار، وطلب فشل (محطة غير موجودة مثلًا) يمكن إعادته فعلًا.
 * - بعد الكتابة: تحديث عنصر واحد في الفهرس المخزّن، ثم سجل التعديلات، ثم رفع رقم الإصدار (بعد السجل لأن
 *   الإحصاءات مربوطة بالإصدار وتعدّ صفوفه).
 * - الصف الجديد يُنسّق (توسيط، 12 عريض، حدود، التفاف).
 *
 * Stations: add, coordinate edit, and delete (admin).
 * - Every write runs inside the script lock: duplicate check, write and recording the operation key are one step
 *   two requests can't interleave (no duplicate station id, no double run of the same operation key).
 * - The operation key is saved to «عمليات الحفظ» only after a successful write, so a resend after a lost reply
 *   returns "done" without repeating, and a failed request (e.g. station not found) can really be retried.
 * - After the write: patch one index entry, then the audit log, then bump the version (after the log because
 *   stats are keyed on the version and count its rows).
 * - The new row is formatted (centered, 12 bold, borders, wrap).
 * ===================================================
 */

const WRITE_LOCK_WAIT_MS = 10000;

const EDIT_MSG = {
  OP_KEY_MISSING: 'مفتاح عملية مفقود',
  MISSING_DATA: 'بيانات ناقصة',
  BAD_TYPE: 'نوع المحطة غير صحيح',
  ID_REQUIRED: 'رقم المحطة مطلوب',
  REGION_REQUIRED: 'المنطقة مطلوبة',
  ADD_COORDINATE: 'الإحداثية مطلوبة وإلا لن تُحفظ المحطة (حدد موقعك أو أدخلها يدويًا)',
  BAD_COORDINATE: 'إحداثية غير صحيحة',
  DUPLICATE_ID: 'رقم المحطة هذا موجود مسبقًا بالشيت، لا يمكن تكراره',
  NOT_FOUND_EDIT: 'تعذّر إيجاد المحطة بالشيت',
  NOT_FOUND_DELETE: 'المحطة غير موجودة أصلًا بالشيت',
  BUSY: 'الخادم مشغول بحفظ آخر، حاول مرة أخرى'
};

// ===== أدوات — Helpers =====

/* أول صف يطابق رقم المحطة (بعد التوحيد) أو -1 — يبحث بالصيغتين اللاتينية والعربية للأرقام
 * The first row matching the station id (after normalizing) or -1 — searches both Latin and Arabic digit forms */
function findStationRow_(type, stationId) {
  const target = normalizeStationId_(stationId);
  const sheet = sheet_(stationSheetName_(type)), idCol = stationCols_(type).ID;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !target) return -1;
  return perfMeasure_('بحث رقم المحطة (TextFinder)', function () {
    const variants = [target];
    const arabic = target.replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.charAt(Number(d)); });
    if (arabic !== target) variants.push(arabic);
    let best = -1;
    variants.forEach(function (text) {
      const finder = sheet.getRange(2, idCol + 1, lastRow - 1, 1).createTextFinder(text).matchEntireCell(true).matchCase(false);
      let cell;
      while ((cell = finder.findNext()) !== null) {
        if (normalizeStationId_(cell.getValue()) !== target) continue;
        if (best === -1 || cell.getRow() < best) best = cell.getRow();
        break;
      }
    });
    return best;
  }, function (row) { return row === -1 ? 'غير موجود' : 'الصف ' + row; });
}

/* هل نُفّذ مفتاح العملية من قبل؟ — Was this operation key already done? */
function opKeyDone_(opKey) {
  return findRowsByText_(sheet_(SHEETS.IDEMPOTENCY), 0, opKey, true).length > 0;
}

/* إحداثيتان صالحتان أو null — Two valid coordinates, or null */
function validCoordinates_(data) {
  const lat = parseCoordinate_(data.lat), lng = parseCoordinate_(data.lng);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: lat, lng: lng };
}

/* تنفيذ داخل قفل السكربت، أو رد «مشغول» — Run inside the script lock, or a "busy" reply */
function withWriteLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(WRITE_LOCK_WAIT_MS)) return { error: EDIT_MSG.BUSY };
  try { return fn(); } finally { lock.releaseLock(); }
}

/* بيانات المعدّل والوقت المشتركة بين الإضافة والتعديل — The editor's data and time shared by add and edit */
function editStamp_(phone) {
  const member = findMember_(phone) || {};
  const now = new Date();
  return {
    date: Utilities.formatDate(now, TIMEZONE, 'dd/MM/yyyy'), time: Utilities.formatDate(now, TIMEZONE, 'HH:mm:ss'),
    name: sanitizeSheetText_(member.name || ''), shift: sanitizeSheetText_(member.shift || ''),
    phone: sanitizeSheetText_(phone), email: sanitizeSheetText_(member.email || '')
  };
}

/* إعادة قراءة الصف المكتوب وبناء عنصر الفهرس منه (نفس تحويلات جوجل للقيم كالبناء الكامل)
 * Re-read the written row and build its index entry (same Sheets value coercion as the full build) */
function entryFromSheetRow_(type, row) {
  const name = stationSheetName_(type);
  return indexEntry_(type, sheet_(name).getRange(row, 1, 1, HEADERS[name].length).getValues()[0]);
}

// ===== الإضافة — Add =====

function addNewStation(data, auth) {
  if (!data.opKey) return { error: EDIT_MSG.OP_KEY_MISSING };
  if (!data.stationId || !data.type) return { error: EDIT_MSG.MISSING_DATA };
  const type = data.type;
  if (type !== STATION_TYPE.DISTRIBUTION && type !== STATION_TYPE.SUBSTATION) return { error: EDIT_MSG.BAD_TYPE };
  const stationId = String(data.stationId).trim();
  if (!stationId) return { error: EDIT_MSG.ID_REQUIRED };
  const region = String(data.region || '').trim();
  if (type === STATION_TYPE.DISTRIBUTION && !region) return { error: EDIT_MSG.REGION_REQUIRED };
  const at = validCoordinates_(data);
  if (!at) return { error: EDIT_MSG.ADD_COORDINATE };

  return withWriteLock_(function () {
    if (opKeyDone_(data.opKey)) return { success: true, duplicate: true };
    if (findStationRow_(type, stationId) !== -1) return { error: EDIT_MSG.DUPLICATE_ID };

    const s = editStamp_(auth.phone), mapUrl = 'https://www.google.com/maps?q=' + at.lat + ',' + at.lng, location = at.lat + ',' + at.lng;
    const reason = sanitizeSheetText_(String(data.reason || '').trim() || 'محطة جديدة');
    const row = type === STATION_TYPE.DISTRIBUTION
      ? [sanitizeSheetText_(stationId), sanitizeSheetText_(String(data.feeder || '').trim()), sanitizeSheetText_(region), mapUrl, location, at.lat, at.lng, s.date, s.time, s.name, s.shift, s.phone, s.email, reason]
      : [sanitizeSheetText_(stationId), mapUrl, location, at.lat, at.lng, s.date, s.time, s.name, s.shift, s.phone, s.email, reason];
    const sheet = sheet_(stationSheetName_(type));
    perfMeasure_('كتابة صف المحطة', function () { appendFormattedRow_(sheet, row, true); });
    appendFormattedRow_(sheet_(SHEETS.IDEMPOTENCY), [data.opKey, new Date()], true);

    const newRow = sheet.getLastRow(), entry = entryFromSheetRow_(type, newRow);
    if (entry && entry.n === normalizeStationId_(stationId)) patchIndex_(type, 'add', entry);
    else dropIndex_(INDEX_KEYS[type]); // الصف الأخير ليس محطتنا ← يُبنى الفهرس من الشيت / the last row isn't ours ← rebuild from the sheet
    logAudit_(auth.phone, AUDIT_TYPE.ADD, stationId, auditDetailsWithTable_(location, type));
    bumpDataVersion_();
    return { success: true };
  });
}

// ===== تعديل الإحداثية — Coordinate edit =====

function updateCoordinates(data, auth) {
  if (!data.opKey) return { error: EDIT_MSG.OP_KEY_MISSING };
  if (!data.stationId || !data.type) return { error: EDIT_MSG.MISSING_DATA };
  const type = data.type;
  if (type !== STATION_TYPE.DISTRIBUTION && type !== STATION_TYPE.SUBSTATION) return { error: EDIT_MSG.BAD_TYPE };
  const at = validCoordinates_(data);
  if (!at) return { error: EDIT_MSG.BAD_COORDINATE };

  return withWriteLock_(function () {
    if (opKeyDone_(data.opKey)) return { success: true, duplicate: true };
    const row = findStationRow_(type, data.stationId);
    if (row === -1) return { error: EDIT_MSG.NOT_FOUND_EDIT }; // المفتاح لا يُسجَّل ← يمكن إعادة المحاولة / the key isn't recorded ← retry works

    const c = stationCols_(type), s = editStamp_(auth.phone), fields = {};
    fields[c.LAT] = at.lat; fields[c.LNG] = at.lng;
    fields[c.MAP_URL] = 'https://www.google.com/maps?q=' + at.lat + ',' + at.lng;
    fields[c.LOCATION] = at.lat + ',' + at.lng;
    fields[c.DATE] = s.date; fields[c.TIME] = s.time;
    fields[c.USER_NAME] = s.name; fields[c.SHIFT] = s.shift; fields[c.USER_PHONE] = s.phone; fields[c.USER_EMAIL] = s.email;
    if (type === STATION_TYPE.DISTRIBUTION) {
      if (String(data.feeder || '').trim()) fields[c.FEEDER] = sanitizeSheetText_(String(data.feeder).trim());
      if (String(data.region || '').trim()) fields[c.REGION] = sanitizeSheetText_(String(data.region).trim());
    }
    const reason = String(data.reason || '').trim();
    if (reason) fields[c.REASON] = sanitizeSheetText_(reason);
    const sheet = sheet_(stationSheetName_(type));
    perfMeasure_('كتابة خلايا الصف', function () { writeRowFields_(sheet, row, fields); });
    appendFormattedRow_(sheet_(SHEETS.IDEMPOTENCY), [data.opKey, new Date()], true);

    const entry = entryFromSheetRow_(type, row);
    patchIndex_(type, 'replace', entry, entry ? entry.n : normalizeStationId_(data.stationId));
    logAudit_(auth.phone, AUDIT_TYPE.EDIT, String(data.stationId).trim(), auditDetailsWithTable_(fields[c.LOCATION] + ' (' + String(data.method || 'يدوي') + ')', type));
    bumpDataVersion_();
    return { success: true };
  });
}

// ===== الحذف (للمدير) — Delete (admin) =====

/* حذف نهائي لأول صف بالرقم — بلا سجل تعديلات (طلب صريح في V1، مراجعة أمنية لاحقة)
 * مفتاح العملية (اختياري للتوافق، والمتصفح يرسله دائمًا): إعادة الإرسال بعد ضياع الرد ترجع «تم» بلا حذف ثانٍ — وإلا لحُذف
 * الصف المكرر التالي بنفس الرقم (المكرر موجود فعلًا في الشيت).
 * Permanently deletes the first row with the id — no audit row (explicit V1 request; security review later).
 * The operation key (optional for compatibility; the browser always sends it): a resend after a lost reply returns «done»
 * with no second delete — otherwise the next duplicate row with the same id would be deleted. */
function deleteStation(data) {
  if (!data.stationId || !data.type) return { error: EDIT_MSG.MISSING_DATA };
  const type = data.type;
  if (type !== STATION_TYPE.DISTRIBUTION && type !== STATION_TYPE.SUBSTATION) return { error: EDIT_MSG.BAD_TYPE };
  const stationId = String(data.stationId).trim();
  if (!stationId) return { error: EDIT_MSG.ID_REQUIRED };

  return withWriteLock_(function () {
    if (data.opKey && opKeyDone_(data.opKey)) return { success: true, duplicate: true };
    const row = findStationRow_(type, stationId);
    if (row === -1) return { error: EDIT_MSG.NOT_FOUND_DELETE };
    withSheetRetry_(function () { sheet_(stationSheetName_(type)).deleteRow(row); });
    if (data.opKey) appendFormattedRow_(sheet_(SHEETS.IDEMPOTENCY), [data.opKey, new Date()], true);
    patchIndex_(type, 'remove', null, normalizeStationId_(stationId));
    bumpDataVersion_();
    return { success: true };
  });
}
