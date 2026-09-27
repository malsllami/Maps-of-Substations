/* ============================================================
 * services/timing.js — قياس زمن طلبات الخادم بالمتصفح (تشخيص فقط)
 * يغلّف fetch بشفافية لطلبات Apps Script فقط: يضيف requestId للطلب،
 * يقيس الزمن الإجمالي الذي انتظره المتصفح، ويقارنه بزمن الخادم
 * (_timing.serverMs) ليُظهر كم ثانية ضاعت خارج كود Apps Script.
 * لا يغيّر أي طلب أو رد تستخدمه الصفحة. النتائج تُحفظ بهذا الجهاز فقط
 * (آخر 300 قياس) وتُعرض بجدول عند فتح أي صفحة مع ‎?perf=1‎.
 *
 * Browser-side request timing (diagnostics only). Transparently wraps
 * fetch for Apps Script requests only: adds a requestId, measures the
 * total time the browser waited, and compares it with the server time
 * (_timing.serverMs) to show how long was spent outside Apps Script code.
 * Never alters any request/response the page uses. Results stay on this
 * device only (last 300) and are shown in a table when any page is
 * opened with ?perf=1.
 * ============================================================ */
(function (global) {
  'use strict';

  const LOG_KEY = 'sec-perf-log';
  const MAX_ENTRIES = 300;
  const API_MARKER = 'script.google.com/macros/';
  const originalFetch = global.fetch.bind(global);
  let inFlight = 0;
  let leavingPage = false;
  global.addEventListener && global.addEventListener('pagehide', function () { leavingPage = true; });

  function pageName_() {
    return (location.pathname.split('/').pop() || 'index.html');
  }
  function clockTime_() {
    return new Date().toLocaleTimeString('en-GB', { hour12: false });
  }
  function newRequestId_() {
    return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
  }

  function readLog_() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; }
  }
  function appendLog_(entry) {
    try {
      const log = readLog_();
      log.push(entry);
      localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_ENTRIES)));
    } catch (e) { /* تخزين ممتلئ أو محظور — القياس يبقى بالـConsole فقط / storage full/blocked — console only */ }
  }

  /* سطر "فتح صفحة" يوضح كيف فُتحت (تحميل جديد/إعادة تحميل/رجوع) — يميّز حالات الاختبار A/B/C
   * A "page open" row describing how it was opened (fresh/reload/back) — distinguishes test cases A/B/C */
  function recordPageOpen_() {
    let navType = 'غير معروف';
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) navType = nav.type;
    } catch (e) {}
    // حالة الجلسة لحظة الفتح — تكشف فورًا لو كان القياس تم كزائر غير مسجّل / session state at open — reveals at once if a test ran as a logged-out guest
    let sessionState = 'زائر (غير مسجّل)';
    try { if (localStorage.getItem('sec-session')) sessionState = 'مسجّل دخول'; } catch (e) {}
    appendLog_({ at: clockTime_(), page: pageName_(), kind: 'open', action: 'فتح الصفحة (' + navType + ') — ' + sessionState });
  }

  function isApiPost_(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    return url.indexOf(API_MARKER) !== -1 && init && String(init.method || '').toUpperCase() === 'POST' && typeof init.body === 'string';
  }

  global.fetch = function (input, init) {
    if (!isApiPost_(input, init)) return originalFetch(input, init);

    let payload;
    try { payload = JSON.parse(init.body); } catch (e) { return originalFetch(input, init); }
    const requestId = newRequestId_();
    payload.requestId = requestId;
    const action = payload.action || 'غير معروف';
    const newInit = Object.assign({}, init, { body: JSON.stringify(payload) });

    inFlight++;
    const concurrent = inFlight;
    const start = performance.now();

    function finish_(serverMs, status, stages) {
      inFlight--;
      const totalMs = Math.round(performance.now() - start);
      const outsideMs = serverMs == null ? null : totalMs - serverMs;
      const entry = { at: clockTime_(), page: pageName_(), action: action, rid: requestId, serverMs: serverMs, totalMs: totalMs, outsideMs: outsideMs, concurrent: concurrent, status: status, stages: stages || null };
      appendLog_(entry);
      const s = function (ms) { return ms == null ? '—' : (ms / 1000).toFixed(2) + 'ث'; };
      console.log('[قياس] ' + action + ' | requestId: ' + requestId + ' | الخادم: ' + s(serverMs) + ' | الإجمالي: ' + s(totalMs) + ' | خارج الخادم: ' + s(outsideMs) + ' | متزامنة: ' + concurrent + ' | ' + status);
    }

    return originalFetch(input, newInit).then(function (res) {
      res.clone().text().then(function (text) {
        let serverMs = null, status = 'نجاح', stages = null;
        try {
          const json = JSON.parse(text);
          if (json && json._timing) { serverMs = json._timing.serverMs; stages = json._timing.stages || null; }
          else status = 'بلا _timing (نسخة خادم قديمة؟)';
          // التمييز بين وصول الرد ونجاح العملية نفسها — Distinguish "a reply arrived" from "the operation succeeded"
          if (json && json.error) status = 'رد بخطأ: ' + String(json.error).slice(0, 45);
          else if (json && json.success === false) status = 'رد بفشل';
        } catch (e) { status = 'رد غير JSON (HTTP ' + res.status + ')'; }
        finish_(serverMs, status, stages);
      }).catch(function () { finish_(null, 'تعذّر قراءة الرد'); });
      return res;
    }, function (err) {
      let status = err && err.name === 'AbortError' ? 'أُلغي (انتهت المهلة)' : 'فشل شبكة';
      if (leavingPage) status = 'أُلغي (مغادرة/إعادة تحميل الصفحة)'; // ليس عطلًا — المتصفح يلغي الطلبات الجارية / not a fault — the browser cancels in-flight requests
      finish_(null, status);
      throw err;
    });
  };

  /* ===== جدول العرض عند ‎?perf=1‎ — Viewer table when ?perf=1 ===== */
  function fmt_(ms) { return ms == null ? '—' : (ms / 1000).toFixed(2); }
  function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function todayBothCalendars_() {
    const d = new Date();
    const g = d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
    const h = d.toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
    return g + ' م — ' + h + ' هـ';
  }

  function renderViewer_() {
    const old = document.getElementById('secPerfViewer');
    if (old) old.remove();
    const log = readLog_().slice().reverse();
    const rows = log.map(function (e, i) {
      if (e.kind === 'open') {
        return '<tr class="open"><td>' + esc_(e.at) + '</td><td>' + esc_(e.page) + '</td><td colspan="7">' + esc_(e.action) + '</td></tr>';
      }
      const classes = [e.totalMs >= 8000 ? 'slow' : '', e.stages ? 'has-stages' : ''].join(' ').trim();
      // سطر المراحل الداخلية مخفي حتى الضغط على الصف — Internal-stages row, hidden until the row is tapped
      const stagesRow = e.stages
        ? '<tr class="stages" id="secPerfStages' + i + '" hidden><td colspan="9"><pre>' + esc_(e.stages.join('\n')) + '</pre></td></tr>'
        : '';
      return '<tr class="' + classes + '" data-stages="' + (e.stages ? i : '') + '"><td>' + esc_(e.at) + '</td><td>' + esc_(e.page) + '</td><td>' +
        esc_(e.action) + (e.stages ? ' ▾' : '') + '</td><td>' +
        fmt_(e.serverMs) + '</td><td>' + fmt_(e.totalMs) + '</td><td>' + fmt_(e.outsideMs) + '</td><td>' + esc_(e.concurrent) +
        '</td><td>' + esc_(e.status) + '</td><td>' + esc_(e.rid) + '</td></tr>' + stagesRow;
    }).join('');

    const box = document.createElement('div');
    box.id = 'secPerfViewer';
    box.innerHTML =
      '<style>' +
      '#secPerfViewer{position:fixed;inset:12px;z-index:99999;background:#0D1826;color:#EAF1F7;border:1px solid rgba(255,255,255,.16);border-radius:14px;display:flex;flex-direction:column;font-family:inherit;direction:rtl}' +
      '#secPerfViewer .bar{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.1);flex-wrap:wrap}' +
      '#secPerfViewer .bar b{flex:1;font-size:13px}' +
      '#secPerfViewer .bar span{font-size:11px;color:#8FA3B8;width:100%}' +
      '#secPerfViewer button{background:#101D2E;color:#EAF1F7;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:6px 12px;font-family:inherit;cursor:pointer}' +
      '#secPerfViewer .wrap{overflow:auto;flex:1}' +
      '#secPerfViewer table{width:100%;border-collapse:collapse}' +
      '#secPerfViewer th,#secPerfViewer td{text-align:center;font-size:12px;font-weight:700;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.07);white-space:nowrap}' +
      '#secPerfViewer th{position:sticky;top:0;background:#1FAE8C;color:#04241c}' +
      '#secPerfViewer tr.slow td{color:#FF8A75}' +
      '#secPerfViewer tr.open td{color:#4DD6B5;background:rgba(31,174,140,.08)}' +
      '#secPerfViewer tr.has-stages{cursor:pointer}' +
      '#secPerfViewer tr.stages td{text-align:right;background:#060B14}' +
      '#secPerfViewer tr.stages pre{margin:0;font-size:11.5px;font-weight:700;white-space:pre-wrap;direction:rtl;line-height:1.7;color:#EAF1F7}' +
      '</style>' +
      '<div class="bar"><b>قياس زمن الطلبات — آخر ' + log.length + ' سجل</b>' +
      '<button id="secPerfCopy">نسخ</button><button id="secPerfClear">مسح</button><button id="secPerfClose">إغلاق</button>' +
      '<span>' + todayBothCalendars_() + ' — الأزمنة بالثواني، الأحمر = 8 ثوانٍ أو أكثر</span></div>' +
      '<div class="wrap"><table><thead><tr><th>الوقت</th><th>الصفحة</th><th>الإجراء</th><th>الخادم</th><th>الإجمالي</th><th>خارج الخادم</th><th>متزامنة</th><th>الحالة</th><th>requestId</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9">لا توجد قياسات بعد</td></tr>') + '</tbody></table></div>';
    document.body.appendChild(box);

    box.querySelectorAll('tr.has-stages').forEach(function (tr) {
      tr.onclick = function () {
        const detail = document.getElementById('secPerfStages' + tr.getAttribute('data-stages'));
        if (detail) detail.hidden = !detail.hidden;
      };
    });
    document.getElementById('secPerfClose').onclick = function () { box.remove(); };
    document.getElementById('secPerfClear').onclick = function () { try { localStorage.removeItem(LOG_KEY); } catch (e) {} renderViewer_(); };
    document.getElementById('secPerfCopy').onclick = function () {
      const lines = ['الوقت\tالصفحة\tالإجراء\tالخادم\tالإجمالي\tخارج الخادم\tمتزامنة\tالحالة\trequestId'].concat(readLog_().map(function (e) {
        if (e.kind === 'open') return [e.at, e.page, e.action].join('\t');
        const line = [e.at, e.page, e.action, fmt_(e.serverMs), fmt_(e.totalMs), fmt_(e.outsideMs), e.concurrent, e.status, e.rid].join('\t');
        return e.stages ? line + '\n' + e.stages.map(function (s) { return '\t\t   ' + s; }).join('\n') : line;
      }));
      navigator.clipboard.writeText(lines.join('\n')).then(function () { alert('تم النسخ'); }, function () { alert('تعذّر النسخ'); });
    };
  }

  recordPageOpen_();
  if (new URLSearchParams(location.search).get('perf') === '1') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderViewer_);
    else renderViewer_();
  }

  global.SecTiming = { show: renderViewer_ };
})(window);
