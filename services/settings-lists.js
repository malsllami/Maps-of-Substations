/* ============================================================
 * services/settings-lists.js — قوائم شيت «الإعدادات»: الورديات، الأقسام، أنواع العضوية، الدول (getSettingsLists)
 * ============================================================
 * - لا قوائم ثابتة في الكود (قرار محمد): كل قائمة تُقرأ من الشيت عبر الخادم.
 * - آخر نسخة تُحفظ في هذا الجهاز (sec2-settings-lists) فتعمل النماذج بلا إنترنت؛ ومع النسخة المحفوظة يُرد بها فورًا
 *   ويُحدَّث من الخادم في الخلفية مرة واحدة لكل فتح صفحة.
 * - طلب واحد في أي لحظة (أي استدعاء أثناء طلب جارٍ ينتظره). لا نسخة ولا اتصال ← null (والنموذج يعرض رسالة واضحة).
 * - كل قائمة تُنظَّف: نصوص غير فارغة بلا تكرار؛ والدول { name, code } برمز مثل +966 فقط.
 *
 * The «الإعدادات» sheet lists: shifts, departments, member types, countries. No lists in the code (Mohammed's decision).
 * The last copy is kept on this device so forms work offline; with a copy the answer is immediate and the server refresh
 * runs in the background once per page open. One request at a time. No copy and no connection ← null. Lists are cleaned.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG;
  if (!CONFIG) throw new Error('settings-lists.js يحتاج config/الإعدادات.js قبله / needs config/الإعدادات.js first');
  const KEY = CONFIG.STORAGE_KEYS.SETTINGS_LISTS;
  let memo = null, inFlight = null, refreshedThisPage = false;

  function cleanList_(v) {
    const seen = {};
    return (Array.isArray(v) ? v : []).map(function (x) { return String(x == null ? '' : x).trim(); })
      .filter(function (x) { if (!x || seen[x]) return false; seen[x] = true; return true; });
  }
  function clean_(res) {
    return {
      shifts: cleanList_(res.shifts), departments: cleanList_(res.departments), memberTypes: cleanList_(res.memberTypes),
      countries: (Array.isArray(res.countries) ? res.countries : []).map(function (c) { return { name: String((c && c.name) || '').trim(), code: String((c && c.code) || '').trim() }; })
        .filter(function (c) { return c.name && /^\+\d{1,4}$/.test(c.code); })
    };
  }
  function readSaved_() {
    try { const s = JSON.parse(global.localStorage.getItem(KEY) || 'null'); return s && s.lists ? s : null; } catch (e) { return null; }
  }

  /* من الخادم وحفظ النسخة — From the server, then keep the copy */
  function fetch_() {
    if (inFlight) return inFlight;
    inFlight = (async function () {
      try {
        const res = await global.SecApi.call('getSettingsLists');
        if (!res || !res.success) return null;
        memo = { lists: clean_(res), at: Date.now() };
        try { global.localStorage.setItem(KEY, JSON.stringify(memo)); } catch (e) { /* تخزين محظور / storage blocked */ }
        return memo.lists;
      } catch (e) { return null; } finally { inFlight = null; refreshedThisPage = true; }
    })();
    return inFlight;
  }

  /**
   * get() ← { shifts, departments, memberTypes, countries } أو null
   * النسخة المحفوظة فورًا (وتحديث بالخلفية مرة لكل فتح صفحة)، وإلا انتظار الخادم.
   */
  async function get() {
    if (!memo) memo = readSaved_();
    if (memo) {
      if (!refreshedThisPage && global.navigator.onLine !== false) fetch_();
      return memo.lists;
    }
    if (global.navigator.onLine === false) return null;
    return fetch_();
  }

  /* وقت آخر نسخة — The last copy's time */
  function savedAt() { const s = memo || readSaved_(); return s ? new Date(s.at) : null; }

  global.SecSettingsLists = { get: get, refresh: fetch_, savedAt: savedAt };
})(typeof window !== 'undefined' ? window : globalThis);
