/**
 * ===================================================
 * 00_Config.gs — إعدادات النظام الثابتة فقط (بلا أي منطق)
 * ===================================================
 * أسماء الجداول، ترتيب الأعمدة، مفاتيح شيت «الإعدادات»، والمهل والحدود.
 * كل الملفات الأخرى تقرأ من هنا، فلا يتكرر اسم جدول أو رقم عمود في أي مكان آخر.
 * ترتيب الأعمدة عقد ثابت مع البيانات المنسوخة من V1 — الكود يعتمد على الترتيب لا على نص العنوان.
 *
 * Fixed system settings only (no logic): table names, column order, «الإعدادات» sheet keys,
 * timeouts and limits. Every other file reads from here, so no table name or column number is
 * repeated anywhere else. Column order is a fixed contract with the data copied from V1 — the code
 * relies on the order, not on the header text.
 * ===================================================
 */

/* أسماء الجداول — Table names */
const SHEETS = {
  MEMBERS: 'الأعضاء',
  CREDENTIALS: 'بصمات الأجهزة',
  SETTINGS: 'الإعدادات',
  STATIONS: 'احداثيات محطات التوزيع',
  SUBSTATIONS: 'محطات التحويل',
  ERRORS: 'سجل الأخطاء',
  VISITS: 'سجل الزوار',
  AUDIT: 'سجل التعديلات',
  IDEMPOTENCY: 'عمليات الحفظ',
  USAGE: 'سجل الاستخدام اليومي' // صف لكل عضو في كل يوم (22 أكتوبر) / one row per member per day
};

/* عناوين كل جدول بترتيب أعمدته — تُستخدم لإنشاء جدول ناقص ولتصحيح نص عنوان مخالف لقاعدة التسمية
 * Each table's headers in column order — used to create a missing table and to fix a header that breaks the naming rule */
const HEADERS = {
  'الأعضاء': ['الاسم', 'الجوال', 'الإيميل', 'الدور', 'نوع العضوية', 'الوردية', 'الحالة', 'تاريخ التسجيل', 'القسم'],
  'بصمات الأجهزة': ['الجوال', 'معرف الاعتماد', 'المفتاح العام س', 'المفتاح العام ص', 'اسم الجهاز', 'عداد التوقيع', 'تاريخ التسجيل', 'آخر استخدام'],
  'الإعدادات': ['المفتاح', 'القيمة'],
  'احداثيات محطات التوزيع': ['رقم محطات التوزيع', 'المغذي', 'الحي', 'رابط قوقل ماب', 'رابط الموقع على الطبيعه', 'خط العرض', 'خط الطول', 'التاريخ', 'الوقت', 'الاسم', 'الوردية', 'رقم الجوال', 'الايميل', 'السبب'],
  'محطات التحويل': ['اختصار اسم محطة التحويل', 'رابط قوقل ماب', 'رابط الموقع على الطبيعه', 'خط العرض', 'خط الطول', 'التاريخ', 'الوقت', 'الاسم', 'الوردية', 'رقم الجوال', 'الايميل', 'السبب'],
  // الأعمدة 6–18 أُضيفت 16 أكتوبر (اعتماد محمد): بيانات الجهاز والعضو ومكان الخطأ وتجميع المشاكل — إضافة فقط في آخر الجدول
  // Columns 6–18 added 16 Oct (Mohammed): device, member, error location and problem grouping — appended only
  'سجل الأخطاء': ['الوقت', 'المصدر', 'الرسالة', 'تفاصيل', 'التصنيف', 'نوع الجهاز', 'نظام التشغيل', 'المتصفح', 'طريقة الفتح', 'الجوال', 'اسم العضو',
    'الصفحة', 'الإجراء', 'الملف والسطر', 'نوع الفشل', 'النتيجة النهائية', 'الدرجة الابتدائية', 'رمز المشكلة'],
  'سجل الزوار': ['الوقت', 'الجوال', 'الإجراء', 'النتيجة'],
  'سجل التعديلات': ['الوقت', 'الجوال', 'نوع العملية', 'مرجع', 'تفاصيل'],
  'عمليات الحفظ': ['مفتاح العملية', 'الوقت'],
  // (22 أكتوبر) أعداد فقط — لا إحداثيات ولا أرقام محطات / counts only — no coordinates, no station numbers
  'سجل الاستخدام اليومي': ['التاريخ', 'الجوال', 'اسم العضو', 'مفتاح اليوم', 'مرات الفتح', 'دقائق الاستخدام', 'الجهاز', 'المتصفح',
    'تطبيق مثبت', 'استخدام بدون إنترنت', 'عمليات البحث', 'وجدت من الجهاز', 'وجدت من الخادم', 'غير موجودة', 'بحث الأعطال',
    'الملاحة', 'دقائق الملاحة', 'قوقل ماب', 'مشاركة', 'البيانات', 'المحطات', 'المزيد', 'التفاصيل', 'قريب', 'مغذي', 'القياس', 'آخر تحديث']
};

/* ترتيب أعمدة الجداول (يبدأ من 0) — Column order (0-based) */
const COL = {
  STATION: { ID: 0, FEEDER: 1, REGION: 2, MAP_URL: 3, LOCATION: 4, LAT: 5, LNG: 6, DATE: 7, TIME: 8, USER_NAME: 9, SHIFT: 10, USER_PHONE: 11, USER_EMAIL: 12, REASON: 13 },
  SUBSTATION: { ID: 0, MAP_URL: 1, LOCATION: 2, LAT: 3, LNG: 4, DATE: 5, TIME: 6, USER_NAME: 7, SHIFT: 8, USER_PHONE: 9, USER_EMAIL: 10, REASON: 11 },
  MEMBER: { NAME: 0, PHONE: 1, EMAIL: 2, ROLE: 3, MEMBER_TYPE: 4, SHIFT: 5, STATUS: 6, REGISTERED_AT: 7, DEPARTMENT: 8 },
  CREDENTIAL: { PHONE: 0, ID: 1, PUB_X: 2, PUB_Y: 3, DEVICE: 4, SIGN_COUNT: 5, REGISTERED_AT: 6, LAST_USED: 7 },
  SETTING: { KEY: 0, VALUE: 1 }
};

/* مفاتيح شيت «الإعدادات» — «الإعدادات» sheet keys */
const SETTING_KEYS = {
  ADMIN_PHONE_PUBLIC: 'رقم جوال المدير',        // للتواصل فقط (زر الاتصال وواتساب) / contact only
  ADMIN_PHONE_SECRET: 'رقم جوال المدير السري',  // يحدد من هو المدير / decides who the admin is
  ADMIN_EMAIL: 'ايميل المدير',
  SHIFTS: 'قائمة الورديات',
  DEPARTMENTS: 'قائمة الأقسام',
  COUNTRIES: 'قائمة الدول',
  MEMBER_TYPES: 'أنواع العضوية'
};

/* القيم الابتدائية للقوائم — تُكتب في «الإعدادات» مرة واحدة إن لم يوجد المفتاح، وبعدها تُعدَّل من الشيت فقط
 * Initial list values — written to «الإعدادات» once if the key is missing; after that they are edited in the sheet only */
const SETTING_DEFAULTS = {
  'قائمة الورديات': 'أ، ب، ج، د، دوام ثابت',
  'قائمة الأقسام': 'التشغيل، الصيانة، اللحام، الفحص، الإنشاءات، التخطيط، السلامة، أخرى',
  'قائمة الدول': 'السعودية:+966، الإمارات:+971، البحرين:+973، الكويت:+965، قطر:+974، عُمان:+968، مصر:+20، الأردن:+962',
  'أنواع العضوية': 'موظف، مقاول'
};

/* حالات العضو — Member status values */
const MEMBER_STATUS = { ACTIVE: 'نشط', DISABLED: 'معطل' };

/* أنواع المحطات — Station types */
const STATION_TYPE = { DISTRIBUTION: 'توزيع', SUBSTATION: 'تحويل' };

/* المنطقة الزمنية — Timezone */
const TIMEZONE = 'Asia/Riyadh';

/* تنسيق كل صف جديد يُضاف لأي جدول (قرار محمد): توسيط، خط 12 عريض، حدود، التفاف النص داخل الخلية
 * The format of every new row added to any table (Mohammed's rule): centered, 12 bold, borders, text wrapped inside the cell */
const NEW_ROW_FORMAT = { FONT_SIZE: 12, BOLD: true, ALIGN: 'center', WRAP: true };
