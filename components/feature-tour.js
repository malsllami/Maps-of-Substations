/* ============================================================
 * components/feature-tour.js — بطاقة «نسخة جديدة محسّنة» والجولة التعريفية بالمميزات (تصميم محمد — 16 أكتوبر)
 * ============================================================
 * - البطاقة: لوحة سفلية فوق الصفحة المعتّمة (النموذج «أ») بزر «تحديث» يبدأ الجولة.
 * - الجولة: الصفحة كلها مجمّدة؛ كل شريحة لقطة حقيقية من الموقع، والضوء على العنصر المشروح فقط («ثقب» في طبقة معتمة
 *   بإطار أخضر)، وبطاقة شرح وافية بجانبه (تحته أو فوقه حسب موضعه) بسهم يشير إليه.
 * - التنقل: «تخطي» في كل شريحة، «السابق» و«التالي»، وفي الأخيرة «ابدأ»؛ Esc يتخطى والأسهم تتنقل.
 * - الشرائح ونصوصها في config/جولة_تعريفية.js (محتوى يُعدَّل هناك لا هنا)، واللقطات في assets/tour/.
 * - تُفتح أيضًا من «الجولة التعريفية» في القائمة المنسدلة (app-header) بلا بطاقة.
 *
 * The «improved new version» card and the feature tour (Mohammed's design — 16 Oct): a bottom sheet over the dimmed page,
 * then a frozen-page tour where each slide is a real screenshot with a spotlight on the explained element and a full
 * explanation card next to it. Skip on every slide, back/next, «start» on the last; Esc skips, arrows move. The slides
 * live in config/جولة_تعريفية.js and the shots in assets/tour/. Also opened from the header menu (without the card).
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document;
  const SHOT_W = 390, SHOT_H = 844; // مقاس اللقطات بوحدات CSS — the screenshots' size in CSS units
  const MSG = { SKIP: 'تخطي', NEXT: 'التالي', BACK: 'السابق', START: 'ابدأ', CARD_TITLE: 'نسخة جديدة محسّنة من الموقع', CARD_TEXT: 'تعرّف على المميزات الجديدة في دقيقة', UPDATE: 'تحديث' };
  let overlay = null, keyHandler = null, resizeHandler = null;

  function slides_() { const s = global.SEC2_TOUR && global.SEC2_TOUR.SLIDES; return Array.isArray(s) ? s : []; }
  function el_(tag, cls, text) { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function close_() {
    if (keyHandler) { doc.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
    if (resizeHandler) { global.removeEventListener('resize', resizeHandler); resizeHandler = null; }
    if (overlay) { overlay.remove(); overlay = null; }
    doc.documentElement.classList.remove('tour-open');
  }
  function mount_() {
    close_();
    overlay = el_('div', 'tour-overlay');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    doc.body.appendChild(overlay);
    doc.documentElement.classList.add('tour-open'); // تجميد تمرير الصفحة — freezes page scrolling
    return overlay;
  }

  /**
   * showCard(opts) — بطاقة «نسخة جديدة محسّنة»؛ «تحديث» يفتح الجولة. opts: { onDone() } بعد انتهاء الجولة أو تخطيها
   */
  function showCard(opts) {
    const o = opts || {}, box = mount_();
    box.classList.add('tour-card-mode');
    box.setAttribute('aria-label', MSG.CARD_TITLE);
    const sheet = el_('div', 'tour-sheet');
    sheet.appendChild(el_('div', 'tour-sheet-ic', '🎉'));
    sheet.appendChild(el_('h2', '', MSG.CARD_TITLE));
    sheet.appendChild(el_('p', '', MSG.CARD_TEXT));
    const btn = el_('button', 'tour-btn primary', MSG.UPDATE); btn.type = 'button'; btn.dataset.act = 'tour-update';
    sheet.appendChild(btn);
    box.appendChild(sheet);
    btn.addEventListener('click', function () { open({ onDone: o.onDone }); });
    btn.focus();
  }

  /**
   * open(opts) — الجولة من الشريحة الأولى. opts: { onDone(), start (رقم الشريحة) }
   * يُرجع { go(i)، close() }
   */
  function open(opts) {
    const o = opts || {}, list = slides_();
    if (!list.length) { if (o.onDone) o.onDone(); return null; }
    const box = mount_();
    box.classList.add('tour-slides-mode');
    box.setAttribute('aria-label', 'الجولة التعريفية');
    const stage = el_('div', 'tour-stage');
    const img = el_('img', 'tour-shot'); img.alt = '';
    const hole = el_('div', 'tour-hole');
    const tip = el_('div', 'tour-tip'); tip.setAttribute('role', 'status');
    const count = el_('span', 'tour-count');
    const skip = el_('button', 'tour-skip', MSG.SKIP); skip.type = 'button'; skip.dataset.act = 'tour-skip';
    stage.appendChild(img); stage.appendChild(hole); stage.appendChild(tip);
    box.appendChild(stage); box.appendChild(count); box.appendChild(skip);
    let i = 0;
    // تحميل كل اللقطات مسبقًا فيكون التنقل فوريًا — preload all shots so moving between slides is instant
    list.forEach(function (s) { const p = new global.Image(); p.src = s.img; });

    /* مقاس المسرح: اللقطة بنسبتها داخل الشاشة — the stage keeps the shot's ratio inside the screen */
    function fit_() {
      const k = Math.min(global.innerWidth / SHOT_W, global.innerHeight / SHOT_H);
      stage.style.width = Math.round(SHOT_W * k) + 'px'; stage.style.height = Math.round(SHOT_H * k) + 'px';
    }
    function done_() { close_(); if (o.onDone) { try { o.onDone(); } catch (e) { /* لا شيء / nothing */ } } }
    function go(n) {
      i = Math.max(0, Math.min(list.length - 1, n));
      const s = list[i], r = s.rect || { x: 0, y: 0, w: 0, h: 0 };
      // لا تبقى لقطة الشريحة السابقة ظاهرة حتى تكتمل لقطة هذه — the previous shot never stays visible while this one loads
      stage.classList.add('loading');
      img.onload = img.onerror = function () { if (img.getAttribute('src') === s.img) stage.classList.remove('loading'); };
      img.src = s.img;
      if (img.complete && img.naturalWidth) stage.classList.remove('loading');
      // الثقب بالنسب المئوية من اللقطة، فيتبع أي مقاس شاشة — the hole in percentages of the shot, so it follows any screen size
      hole.style.left = (r.x / SHOT_W * 100) + '%'; hole.style.top = (r.y / SHOT_H * 100) + '%';
      hole.style.width = (r.w / SHOT_W * 100) + '%'; hole.style.height = (r.h / SHOT_H * 100) + '%';
      const below = (r.y + r.h / 2) < SHOT_H * 0.55; // العنصر في النصف العلوي ← الشرح تحته — element in the upper half ← the tip below it
      tip.className = 'tour-tip ' + (below ? 'below' : 'above');
      tip.style.top = below ? 'calc(' + ((r.y + r.h) / SHOT_H * 100) + '% + 16px)' : '';
      tip.style.bottom = below ? '' : 'calc(' + ((SHOT_H - r.y) / SHOT_H * 100) + '% + 16px)';
      // السهم يشير إلى «point» إن وُجد (عنصر بعينه داخل منطقة إضاءة أوسع)، وإلا إلى منتصف الإضاءة
      // The arrow points at «point» when given (one element inside a wider lit area), otherwise at the lit area's center
      const p = s.point || r;
      tip.style.setProperty('--arrow-x', Math.max(8, Math.min(92, (p.x + p.w / 2) / SHOT_W * 100)) + '%');
      tip.textContent = '';
      tip.appendChild(el_('h2', '', s.title));
      // الشرح الطويل يُمرَّر داخل جسمه فقط، فيبقى سهم البطاقة ظاهرًا بلا قص — a long text scrolls inside its body only, so the arrow is never clipped
      const body = el_('div', 'tour-body');
      String(s.text || '').split('\n').forEach(function (line) { body.appendChild(el_('p', '', line)); });
      tip.appendChild(body);
      const row = el_('div', 'tour-row'), dots = el_('div', 'tour-dots');
      list.forEach(function (x, k) { dots.appendChild(el_('i', k === i ? 'on' : '')); });
      const nav = el_('div', 'tour-nav');
      if (i > 0) { const b = el_('button', 'tour-btn ghost', MSG.BACK); b.type = 'button'; b.dataset.act = 'tour-back'; nav.appendChild(b); }
      const next = el_('button', 'tour-btn primary', i === list.length - 1 ? MSG.START : MSG.NEXT); next.type = 'button'; next.dataset.act = 'tour-next';
      nav.appendChild(next);
      row.appendChild(dots); row.appendChild(nav); tip.appendChild(row);
      count.textContent = (i + 1) + ' / ' + list.length;
      next.focus();
    }
    box.addEventListener('click', function (e) {
      const t = e.target.closest('[data-act]'); if (!t) return;
      if (t.dataset.act === 'tour-skip') done_();
      else if (t.dataset.act === 'tour-back') go(i - 1);
      else if (t.dataset.act === 'tour-next') { if (i === list.length - 1) done_(); else go(i + 1); }
    });
    keyHandler = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); done_(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (i < list.length - 1) go(i + 1); } // الواجهة من اليمين لليسار / RTL: left = next
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(i - 1); }
    };
    doc.addEventListener('keydown', keyHandler, true);
    resizeHandler = fit_; global.addEventListener('resize', fit_);
    fit_(); go(o.start || 0);
    return { go: go, close: done_ };
  }

  global.SecFeatureTour = { showCard: showCard, open: open, close: close_, isOpen: function () { return !!overlay; }, MSG: MSG };
})(typeof window !== 'undefined' ? window : globalThis);
