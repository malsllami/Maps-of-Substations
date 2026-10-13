/**
 * ===================================================
 * 06_Settings.gs — قراءة شيت «الإعدادات» (مخزّن 5 دقائق)
 * ===================================================
 * قيمة مفتاح، قائمة مفصولة بفاصلة، ومن هو المدير ومعلومات التواصل.
 * أي تعديل يدوي في الشيت يظهر خلال 5 دقائق كحد أقصى.
 *
 * Reading the «الإعدادات» sheet (cached 5 minutes): a key's value, a comma-separated list, who the
 * admin is and the contact details. Any manual sheet edit shows within 5 minutes at most.
 * ===================================================
 */

const SETTINGS_CACHE_KEY = 'settings_rows';

/* قيمة مفتاح (نص) — A key's value (text) */
function getSetting_(key) {
  const rows = cachedRows_(SETTINGS_CACHE_KEY, SHEETS.SETTINGS);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][COL.SETTING.KEY]).trim() === key) return String(rows[i][COL.SETTING.VALUE] == null ? '' : rows[i][COL.SETTING.VALUE]).trim();
  }
  return '';
}

/* قائمة مفصولة بفاصلة عربية أو إنجليزية — A list separated by Arabic or English commas */
function getSettingList_(key) {
  return getSetting_(key).split(/[،,]/).map(function (s) { return s.trim(); }).filter(Boolean);
}

/* هل هذا الجوال هو جوال المدير السري؟ (لا يكفي وحده لصلاحية المدير — انظر 02_Auth) — Is this the secret admin phone? (not enough alone — see 02_Auth) */
function isAdminPhone_(phone) {
  const secret = getSetting_(SETTING_KEYS.ADMIN_PHONE_SECRET);
  return !!secret && phonesMatch_(secret, phone);
}

/* معلومات التواصل مع المدير (عامة) — Admin contact details (public) */
function getAdminContactInfo() {
  return { success: true, phone: getSetting_(SETTING_KEYS.ADMIN_PHONE_PUBLIC), email: getSetting_(SETTING_KEYS.ADMIN_EMAIL) };
}
