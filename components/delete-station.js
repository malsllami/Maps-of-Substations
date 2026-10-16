/* ============================================================
 * components/delete-station.js — نافذة تأكيد حذف محطة (للمدير فقط — التصميم «أ» المعتمد من محمد)
 * ============================================================
 * - تُفتح من زر «🗑️ حذف» في بطاقة المحطة، والزر لا يظهر إلا للمدير (تذكرة دخول بالبصمة — SecSession.isAdmin).
 * - الحذف لا يتم إلا بعد كتابة رقم المحطة نفسه (مطابقة بمفتاح الرقم: الأحرف الصغيرة والمسافات لا تؤثر)، ثم «حذف نهائي».
 * - الطلب deleteStation بتذكرة الجلسة ومفتاح عملية ثابت طوال فتح النافذة: ضياع الرد ثم إعادة المحاولة لا يحذف الصف
 *   المكرر التالي بنفس الرقم. الخادم يرفض أي حذف بغير تذكرة مدير بالبصمة — الواجهة ليست الحماية.
 * - النجاح: تُزال المحطة من النسخة المحلية (stations-sync.remove) ثم onDeleted — بلا إعادة تحميل.
 * - بلا إنترنت: لا طلب، برسالة واضحة. التذكرة المرفوضة: SecSession.handleExpired. النتيجة غير المؤكدة: تُقال صراحة.
 *
 * The station delete confirmation (admin only — design «A» approved by Mohammed). The station number must be typed;
 * deleteStation goes with the session ticket and one operation key per opening (a retry never deletes the next duplicate).
 * The server refuses any delete without an admin fingerprint ticket — the UI is not the protection.
 * ============================================================ */
(function (global) {
  'use strict';

  const TI = global.SecTextInput;
  if (!TI) throw new Error('delete-station.js يحتاج text-input.js قبله / needs text-input.js first');
  const MSG = {
    TITLE: 'حذف المحطة نهائيًا',
    WARN: 'سيُحذف صف هذه المحطة من قاعدة البيانات، ولا يمكن التراجع عن الحذف.',
    TYPE_ID: 'للتأكيد اكتب رقم المحطة: ',
    CANCEL: 'إلغاء', CONFIRM: 'حذف نهائي', DELETING: 'جاري الحذف...',
    DONE: 'تم حذف المحطة', OFFLINE: 'هذه العملية تحتاج إلى اتصال بالإنترنت',
    NOT_ADMIN: 'حذف المحطات متاح للمدير فقط',
    UNCONFIRMED: 'لم يتأكد الحذف بسبب الاتصال — تحقق من المحطة بالبحث، ثم أعد المحاولة (لن يُحذف صف آخر)',
    FAILED: 'تعذّر الحذف، حاول مرة أخرى'
  };

  let ui = null, current = null;

  function build_() {
    if (ui) return ui;
    const doc = global.document;
    doc.body.insertAdjacentHTML('beforeend',
      '<div class="del-overlay" data-role="del-overlay" role="dialog" aria-modal="true" aria-labelledby="delTitle">' +
      '<div class="del-card"><div class="del-icon" aria-hidden="true">🗑️</div>' +
      '<h2 id="delTitle">' + MSG.TITLE + '</h2>' +
      '<div class="del-station" data-role="station"></div>' +
      '<p class="del-warn">' + MSG.WARN + '</p>' +
      '<label class="del-label" for="delConfirmInput"><span>' + MSG.TYPE_ID + '</span><b data-role="id"></b></label>' +
      '<input id="delConfirmInput" class="del-input" data-role="input" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" dir="ltr">' +
      '<div class="del-msg" data-role="msg" aria-live="polite"></div>' +
      '<div class="del-actions"><button type="button" class="del-cancel" data-act="cancel">' + MSG.CANCEL + '</button>' +
      '<button type="button" class="del-confirm" data-act="confirm" disabled>' + MSG.CONFIRM + '</button></div></div></div>');
    const el = doc.querySelector('[data-role="del-overlay"]');
    ui = {
      el: el, station: el.querySelector('[data-role="station"]'), id: el.querySelector('[data-role="id"]'),
      input: el.querySelector('[data-role="input"]'), msg: el.querySelector('[data-role="msg"]'),
      confirm: el.querySelector('[data-act="confirm"]'), cancel: el.querySelector('[data-act="cancel"]')
    };
    ui.input.addEventListener('input', sync_);
    ui.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !ui.confirm.disabled) run_(); });
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-act="cancel"]') || e.target === el) close();
      else if (e.target.closest('[data-act="confirm"]')) run_();
    });
    global.document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen() && current && !current.busy) close(); });
    return ui;
  }

  function matches_() { return !!current && TI.stationKey(ui.input.value) === TI.stationKey(current.station.id) && TI.stationKey(ui.input.value) !== ''; }
  function sync_() { if (current && !current.busy) ui.confirm.disabled = !matches_(); }
  function say_(text, kind) { ui.msg.textContent = text || ''; ui.msg.dataset.kind = kind || ''; }
  function busy_(on, c) {
    if (c) c.busy = on;
    if (!c || current !== c) return; // نافذة أخرى فُتحت بعدها — لا تُمس واجهتها / another window opened since — its UI is untouched
    ui.confirm.textContent = on ? MSG.DELETING : MSG.CONFIRM;
    ui.confirm.disabled = on || !matches_();
    ui.cancel.disabled = on; ui.input.disabled = on;
  }

  /**
   * open(station, opts) — opts: { onDeleted(station)، toast(text) }. لا يفتح لغير المدير.
   * Returns false when the viewer is not an admin.
   */
  function open(station, opts) {
    const S = global.SecSession;
    if (!station || !S || !S.isAdmin()) return false;
    if (current && current.busy) return false; // حذف جارٍ — لا تُفتح نافذة أخرى فوقه / a delete is running — no other window over it
    build_();
    current = { station: station, opts: opts || {}, opKey: global.SecApi.newOpKey('deleteStation'), busy: false };
    ui.station.textContent = (station.type === 'تحويل' ? '⚡ محطة تحويل ' : '🏭 محطة توزيع ') + station.id + (station.region ? ' — ' + station.region : '');
    ui.id.textContent = String(station.id);
    ui.input.value = ''; ui.input.disabled = false; ui.cancel.disabled = false;
    ui.confirm.disabled = true; ui.confirm.textContent = MSG.CONFIRM;
    say_('');
    ui.el.classList.add('show');
    global.setTimeout(function () { try { ui.input.focus(); } catch (e) { /* لا شيء / nothing */ } }, 50);
    return true;
  }
  function close() { if (!ui || (current && current.busy)) return; ui.el.classList.remove('show'); current = null; }
  function isOpen() { return !!ui && ui.el.classList.contains('show'); }

  async function run_() {
    if (!current || current.busy || !matches_()) return;
    const c = current, S = global.SecSession, API = global.SecApi;
    if (global.navigator.onLine === false) { say_(MSG.OFFLINE, 'error'); return; }
    busy_(true, c); say_('');
    const mine = function () { return current === c; }; // ما زالت نافذته هي المفتوحة / its window is still the open one
    let res;
    try {
      res = await API.call('deleteStation', { type: c.station.type, stationId: String(c.station.id), opKey: c.opKey }, { token: true });
    } catch (err) {
      busy_(false, c);
      if (mine()) say_(err && err.kind === 'offline' ? MSG.OFFLINE : err && err.kind === 'unconfirmed' ? MSG.UNCONFIRMED : MSG.FAILED, 'error');
      return;
    }
    if (S.isTokenInvalid(res)) { busy_(false, c); close(); S.handleExpired({ action: 'deleteStation', message: res.error }); return; }
    if (!res || !res.success) { busy_(false, c); if (mine()) say_(res && res.code === 'NOT_ADMIN' ? MSG.NOT_ADMIN : (res && res.error) || MSG.FAILED, 'error'); return; }
    // النسخة المحلية تتحدث في الذاكرة فورًا، وحفظها بالجهاز يكمل بالخلفية — لا تنتظر النافذة القرص
    // The local copy updates in memory at once; its device save finishes in the background — the window never waits on disk
    try { if (global.SecStationsSync) global.SecStationsSync.remove(c.station).catch(function () { /* تتزامن لاحقًا / syncs later */ }); } catch (e) { /* لا شيء / nothing */ }
    busy_(false, c); if (mine()) close();
    if (c.opts.toast) { try { c.opts.toast(MSG.DONE); } catch (e) { /* لا شيء / nothing */ } }
    if (c.opts.onDeleted) { try { c.opts.onDeleted(c.station); } catch (e) { /* لا شيء / nothing */ } }
  }

  global.SecDeleteStation = { open: open, close: close, isOpen: isOpen, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
