/**
 * ===================================================
 * 15_Usage.gs — عدّاد الاستخدام اليومي: عدد الطلبات لكل إجراء، وعمليات «خصائص السكربت»
 * ===================================================
 * - كل طلب يُعدّ في نهايته (حتى المرفوض وغير المعروف)، فتشمل العملية كل قراءات/كتابات الخصائص التي تمّت فيه.
 * - كل حالة اليوم في خاصية واحدة (JSON): قراءة + كتابة واحدة لكل طلب. تُصفَّر مع يوم الرياض الجديد، ويُحفظ
 *   إجمالي اليوم المنتهي (prev) للتقرير اليومي.
 * - كل وصول لخصائص السكربت يمر عبر scriptProps_() الذي يعدّه — جوجل تحدّ الحساب المجاني بـ50,000 عملية يوميًا،
 *   والعدد الحقيقي يُعرض في لوحة المدير. فشل العدّاد لا يُفشل أي طلب.
 *
 * Daily usage counter: requests per action, and Script Properties operations.
 * - Every request is counted at its end (even refused and unknown ones), so it includes all its property operations.
 * - The whole day's state is one property (JSON): one read + one write per request. It resets with the new Riyadh
 *   day, keeping the finished day's total (prev) for the daily report.
 * - Every Script Properties access goes through scriptProps_(), which counts it — Google caps free accounts at
 *   50,000 operations a day, and the real count is shown in the admin panel. A counter failure never fails a request.
 * ===================================================
 */

const DAILY_REQUEST_LIMIT = 20000;
const SCRIPT_PROPS_DAILY_LIMIT = 50000;
const USAGE_STATE_KEY = 'daily_usage';
const TOP_ACTIONS_COUNT = 5;

let propOpsThisRun_ = 0;

/* خصائص السكربت مع عدّ كل عملية — Script Properties with every operation counted */
function scriptProps_() {
  const props = PropertiesService.getScriptProperties();
  return {
    getProperty: function (key) { propOpsThisRun_++; return props.getProperty(key); },
    setProperty: function (key, value) { propOpsThisRun_++; props.setProperty(key, value); return this; }
  };
}

function riyadhDay_(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
}

/* حالة اليوم (تُبدأ من جديد إن تغيّر اليوم) — Today's state (restarted if the day changed) */
function usageState_(props) {
  let state = null;
  try { state = JSON.parse(props.getProperty(USAGE_STATE_KEY) || 'null'); } catch (err) { state = null; }
  state = state || { date: '', count: 0, breakdown: {}, propOps: 0, prevDate: '', prevCount: 0 };
  const today = riyadhDay_(new Date());
  if (state.date === today) return state;
  return { date: today, count: 0, breakdown: {}, propOps: 0, prevDate: state.date || '', prevCount: state.date ? state.count : 0 };
}

/* الحفظ مع عمليات الخصائص لهذا التنفيذ (ومنها هذه الكتابة نفسها)، ثم تصفير العدّ — Save with this run's property operations, then reset */
function saveUsageState_(props, state) {
  state.propOps = (state.propOps || 0) + propOpsThisRun_ + 1;
  props.setProperty(USAGE_STATE_KEY, JSON.stringify(state));
  propOpsThisRun_ = 0;
}

/* يُستدعى في نهاية كل طلب — Called at the end of every request */
function countRequest_(action) {
  try {
    const props = scriptProps_(), state = usageState_(props), key = action || 'غير معروف';
    state.count++;
    state.breakdown[key] = (state.breakdown[key] || 0) + 1;
    saveUsageState_(props, state);
  } catch (err) { /* العدّاد لا يُفشل الطلب / the counter never fails the request */ }
}

/* للمشغّلات الزمنية (ليست طلبات): عمليات الخصائص فقط — For time triggers (not requests): property operations only */
function countTriggerPropOps_() {
  try { const props = scriptProps_(); saveUsageState_(props, usageState_(props)); } catch (err) { /* لا يُفشل المشغّل / never fails the trigger */ }
}

/* أرقام اليوم للوحة المدير — Today's numbers for the admin dashboard */
function usageToday_() {
  const state = usageState_(scriptProps_()), breakdown = state.breakdown || {};
  const all = Object.keys(breakdown).map(function (k) { return { action: k, count: breakdown[k] }; })
    .sort(function (a, b) { return b.count - a.count; });
  return {
    requests: state.count, propOps: state.propOps || 0,
    topActions: all.slice(0, TOP_ACTIONS_COUNT),
    allActions: all // كل الأنواع (طلب محمد، 15 أكتوبر) — بلا قراءة إضافية / every type (Mohammed, 15 Oct) — no extra read
  };
}

/* إجمالي طلبات يوم معيّن (yyyy-MM-dd) — للتقرير اليومي عن الأمس: إن لم يصل طلب بعد في اليوم الجديد فالحالة ما زالت
 * تحمل الأمس، وإلا فإجماليه محفوظ في prev. يوم أقدم ← 0.
 * The request total of a given day — for the daily report about yesterday: if no request arrived yet in the new day the
 * state still holds yesterday, otherwise its total is kept in prev. An older day ← 0. */
function requestsOnDay_(day) {
  let state = null;
  try { state = JSON.parse(scriptProps_().getProperty(USAGE_STATE_KEY) || 'null'); } catch (err) { state = null; }
  if (!state) return 0;
  if (state.date === day) return state.count || 0;
  if (state.prevDate === day) return state.prevCount || 0;
  return 0;
}
