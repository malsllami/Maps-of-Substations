/* ============================================================
 * components/perf-viewer.js — جدول قياس زمن الطلبات (عرض فقط، من سجل timing.js في هذا الجهاز)
 * ============================================================
 * تصميم V1 وسلوكه كما هما:
 * - «قياس زمن الطلبات — آخر N سجل» + «نسخ» و«مسح» و«↩ رجوع»، وسطر بتاريخ اليوم (ميلادي وهجري) وشرح الألوان.
 * - 11 عمودًا: البداية، الصفحة، التبويب، الإجراء، الخادم، الإجمالي، خارج الخادم، متزامنة، النهاية، الحالة، requestId.
 *   الأحدث أولًا، الأزمنة بالثواني، الأحمر = 8 ثوانٍ أو أكثر، سطر «فتح الصفحة» مميز، والضغط على صف له مراحل يكشفها.
 * - تحديث حي: أي قياس جديد من تبويب آخر يظهر فورًا مع بقاء موضع التمرير.
 * - النسخ: جدول نصي مفصول بـTab (مع المراحل) للصقه في الشيت أو المحادثة.
 * - لا يرسل أي طلب للخادم (فلا يضيف طلبات تفسد القياس).
 * V2: كل قيمة تُعرض نصًا؛ المراحل المفتوحة تبقى مفتوحة بعد التحديث الحي (في V1 كانت تُغلق)؛ رسالة النسخ داخل الشريط
 *   لا alert؛ «مسح» يطلب تأكيدًا بضغطة ثانية خلال 4 ث (في V1 يمسح فورًا بلا رجعة)؛ الصف قابل للفتح من لوحة المفاتيح.
 *
 * The request timing table (view only, from timing.js's log on this device). V1's design and behavior as is (title,
 * copy/clear/back, today's date in both calendars, 11 columns, newest first, red ≥ 8 s, open rows marked, tap a row for its
 * stages, live refresh keeping scroll, TSV copy, no server request). V2: values set as text; open stages stay open on live
 * refresh; the copy message inline (no alert); «clear» asks for a second tap within 4 s; rows open from the keyboard.
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = global.SEC2_CONFIG, D = global.SecDates, T = global.SecTiming;
  if (!CONFIG || !D || !T) throw new Error('perf-viewer.js يحتاج الإعدادات وdates.js وtiming.js قبله / needs config, dates.js and timing.js first');
  const SLOW_MS = CONFIG.TIMING.HEDGE_AFTER_MS; // 8 ث: نفس حد الطلب الاحتياطي / 8 s: the backup-request threshold
  const COLUMNS = ['البداية', 'الصفحة', 'التبويب', 'الإجراء', 'الخادم', 'الإجمالي', 'خارج الخادم', 'متزامنة', 'النهاية', 'الحالة', 'requestId'];
  const CONFIRM_MS = 4000;

  function secs_(ms) { return typeof ms === 'number' && isFinite(ms) ? (ms / 1000).toFixed(2) : '—'; }
  function td_(text, colspan) { const el = global.document.createElement('td'); el.textContent = text == null || text === '' ? '—' : String(text); if (colspan) el.colSpan = colspan; return el; }

  /* سطر نصي للنسخ (مع المراحل) — A text line for copying (with stages) */
  function tsv(log) {
    return [COLUMNS.join('\t')].concat(log.map(function (e) {
      if (e.kind === 'open') return [e.at, e.page, e.tab || '—', e.action].join('\t');
      const line = [e.at, e.page, e.tab || '—', e.action, secs_(e.serverMs), secs_(e.totalMs), secs_(e.outsideMs), e.concurrent, e.endAt || '—', e.status, e.rid].join('\t');
      return Array.isArray(e.stages) ? line + '\n' + e.stages.map(function (s) { return '\t\t   ' + s; }).join('\n') : line;
    })).join('\n');
  }

  /**
   * mount(container, opts) — opts: { closeLabel ('↩ رجوع')، onClose() }
   * يُرجع { render()، destroy() }
   */
  function mount(container, opts) {
    const o = opts || {};
    const open = new Set(); // requestId للصفوف المفتوحة / requestIds of open rows
    let confirmTimer = null, noteTimer = null;

    container.classList.add('perf-viewer');
    container.innerHTML = '<div class="pv-bar"><b data-role="title"></b>' +
      '<button type="button" data-act="copy">نسخ</button><button type="button" data-act="clear">مسح</button>' +
      '<button type="button" data-act="close">' + (o.closeLabel || '↩ رجوع') + '</button>' +
      '<span class="pv-note" data-role="note" role="status"></span>' +
      '<span class="pv-sub" data-role="sub"></span></div>' +
      '<div class="pv-wrap" data-role="wrap"><table><thead><tr>' + COLUMNS.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody data-role="body"></tbody></table></div>';
    const r = function (n) { return container.querySelector('[data-role="' + n + '"]'); };

    function render() {
      const wrap = r('wrap'), scrollTop = wrap.scrollTop;
      const log = T.readLog().slice().reverse();
      r('title').textContent = 'قياس زمن الطلبات — آخر ' + log.length + ' سجل';
      r('sub').textContent = D.dualDate(new Date()) + ' — الأزمنة بالثواني، الأحمر = ' + SLOW_MS / 1000 + ' ثوانٍ أو أكثر — يتحدّث تلقائيًا مع كل طلب من التبويبات الأخرى';
      const body = r('body'), frag = global.document.createDocumentFragment();
      if (!log.length) { const tr = global.document.createElement('tr'); tr.appendChild(td_('لا توجد قياسات بعد', COLUMNS.length)); frag.appendChild(tr); }
      log.forEach(function (e) {
        const tr = global.document.createElement('tr');
        if (e.kind === 'open') {
          tr.className = 'open';
          [e.at, e.page, e.tab].forEach(function (v) { tr.appendChild(td_(v)); });
          tr.appendChild(td_(e.action, COLUMNS.length - 3));
          frag.appendChild(tr);
          return;
        }
        const hasStages = Array.isArray(e.stages) && e.stages.length > 0;
        if (typeof e.totalMs === 'number' && e.totalMs >= SLOW_MS) tr.classList.add('slow');
        [e.at, e.page, e.tab, e.action + (hasStages ? ' ▾' : ''), secs_(e.serverMs), secs_(e.totalMs), secs_(e.outsideMs), e.concurrent, e.endAt, e.status, e.rid]
          .forEach(function (v) { tr.appendChild(td_(v)); });
        frag.appendChild(tr);
        if (!hasStages) return;
        tr.classList.add('has-stages');
        tr.tabIndex = 0;
        tr.dataset.rid = e.rid;
        tr.setAttribute('aria-expanded', open.has(e.rid) ? 'true' : 'false');
        const st = global.document.createElement('tr'), cell = td_('', COLUMNS.length), pre = global.document.createElement('pre');
        st.className = 'stages'; st.hidden = !open.has(e.rid);
        pre.textContent = e.stages.join('\n');
        cell.textContent = ''; cell.appendChild(pre); st.appendChild(cell);
        frag.appendChild(st);
      });
      body.replaceChildren(frag);
      wrap.scrollTop = scrollTop; // يبقى موضع التمرير مع التحديث الحي / scroll stays on live refresh
    }

    function note_(text) {
      r('note').textContent = text;
      global.clearTimeout(noteTimer);
      noteTimer = global.setTimeout(function () { r('note').textContent = ''; }, 2500);
    }
    function toggle_(tr) {
      const st = tr.nextElementSibling;
      if (!st || !st.classList.contains('stages')) return;
      st.hidden = !st.hidden;
      tr.setAttribute('aria-expanded', st.hidden ? 'false' : 'true');
      if (st.hidden) open.delete(tr.dataset.rid); else open.add(tr.dataset.rid);
    }

    function onClick_(ev) {
      const btn = ev.target.closest('[data-act]');
      if (btn) {
        const act = btn.dataset.act;
        if (act === 'copy') {
          const text = tsv(T.readLog());
          Promise.resolve().then(function () { return global.navigator.clipboard.writeText(text); })
            .then(function () { note_('تم النسخ'); }, function () { note_('تعذّر النسخ'); });
        } else if (act === 'clear') {
          if (btn.dataset.confirm === '1') {
            global.clearTimeout(confirmTimer);
            btn.dataset.confirm = ''; btn.textContent = 'مسح';
            T.clearLog(); open.clear(); render(); note_('تم مسح السجل');
          } else {
            btn.dataset.confirm = '1'; btn.textContent = 'تأكيد المسح؟';
            confirmTimer = global.setTimeout(function () { btn.dataset.confirm = ''; btn.textContent = 'مسح'; }, CONFIRM_MS);
          }
        } else if (act === 'close' && o.onClose) o.onClose();
        return;
      }
      const tr = ev.target.closest('tr.has-stages');
      if (tr && container.contains(tr)) toggle_(tr);
    }
    function onKey_(ev) { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('has-stages')) { ev.preventDefault(); toggle_(ev.target); } }
    // تحديث حي من التبويبات الأخرى — live refresh from other tabs
    function onStorage_(ev) { if (ev.key === T.logKey || ev.key === null) render(); }

    container.addEventListener('click', onClick_);
    container.addEventListener('keydown', onKey_);
    global.addEventListener('storage', onStorage_);
    render();

    return {
      render: render,
      destroy: function () {
        global.clearTimeout(confirmTimer); global.clearTimeout(noteTimer);
        container.removeEventListener('click', onClick_);
        container.removeEventListener('keydown', onKey_);
        global.removeEventListener('storage', onStorage_);
        container.innerHTML = '';
        container.classList.remove('perf-viewer');
      }
    };
  }

  global.SecPerfViewer = { mount: mount, tsv: tsv };
})(typeof window !== 'undefined' ? window : globalThis);
