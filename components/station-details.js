/* ============================================================
 * components/station-details.js — شاشة «تفاصيل المحطة» بثلاثة تبويبات (إعادة التصميم، 19 أكتوبر، لوحة محمد)
 * ============================================================
 * - الرأس: رجوع، رقم المحطة كبيرًا، ونوعها بلونه ورمزه المعتمدين.
 * - «المعلومات»: الرقم، النوع، المغذي، المنطقة، عدد محطات المغذي، الإحداثيات مع «نسخ»؛ ثم أزرار المسار ونسخ
 *   الإحداثيات والمشاركة والتعديل.
 * - «الموقع»: الإحداثيات، «عرض على الخريطة»، «قوقل ماب».
 * - «المحطات القريبة»: من نسخة الجهاز بنفس منطق القريبة (station-query، 2 كم، الأقرب أولًا) في قائمة تتمرر داخل مساحتها؛
 *   الضغط على محطة يفتحها.
 * البيانات المعروضة هي حقول نسخة الجهاز فقط (الرقم، النوع، المغذي، المنطقة، الإحداثيات) — لا حقل بلا مصدر.
 * لا منطق أعمال هنا: الملاحة والتعديل والفتح تُحال للصفحة (deps)؛ كل نص من البيانات يُكتب نصًا.
 *
 * «Station details» with three tabs (redesign, Mohammed's board): info, location, nearby stations. Only the device
 * copy's fields are shown (id, type, feeder, region, coordinates) — no field without a source. No business logic here:
 * navigation, edit and opening go to the page (deps); every data text is set as text.
 * ============================================================ */
(function (global) {
  'use strict';

  const Q = global.SecStationQuery;
  if (!Q) throw new Error('station-details.js يحتاج station-query.js قبله / needs station-query.js first');
  const doc = global.document;
  const NEARBY_MAX = 30; // أقصى عدد في القائمة (تتمرر داخلها) / the list's maximum (scrolls inside)
  const TABS = [{ k: 'info', t: 'المعلومات' }, { k: 'loc', t: 'الموقع' }, { k: 'near', t: 'المحطات القريبة' }];
  const TYPE_ICON = { // الرمزان المعتمدان — the approved symbols
    'توزيع': '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.5 5.2M12 11.5l5.5 5.2"/></svg>',
    'تحويل': '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></svg>'
  };
  const ICON = {
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>'
  };

  function el_(tag, cls, text) { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function coordsText_(s) { return Number(s.lat).toFixed(6) + ', ' + Number(s.lng).toFixed(6); }
  function km_(d) { return d < 1 ? Math.round(d * 1000) + ' م' : (Math.round(d * 10) / 10) + ' كم'; }

  /**
   * mount(container, deps) ← { open(station), station(), tab(), isOpen(), close() }
   * deps: { onBack(), onNavigate(s), onEdit(s), canEdit(), onShowOnMap(s), onOpenStation(s), googleMapsUrl(s), shareText(s),
   *         localStations() → Array|null, dataFreshness() → Date|null (آخر تحديث للنسخة / the copy's last update), toast(text) }
   */
  function mount(container, deps) {
    const d = deps || {};
    let s = null, tab = 'info';
    container.classList.add('station-details');
    container.innerHTML =
      '<div class="sd-head"><button type="button" class="sd-back" data-act="back" aria-label="رجوع">' + ICON.back + '</button><span class="sd-title">تفاصيل المحطة</span></div>' +
      '<div class="sd-hero"><span class="sd-badge" data-role="badge"></span><div class="sd-hero-text"><bdi class="sd-id" data-role="id"></bdi><span class="sd-type" data-role="type"></span></div></div>' +
      '<div class="sd-tabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" class="sd-tab" role="tab" data-tab="' + t.k + '">' + t.t + '</button>'; }).join('') + '</div>' +
      '<div class="sd-panel" data-role="panel" role="tabpanel"></div>';
    const q = function (r) { return container.querySelector('[data-role="' + r + '"]'); };
    const toast = function (t) { try { if (d.toast) d.toast(t); } catch (e) { /* لا شيء / nothing */ } };

    /* صف «عنوان | قيمة» — a «label | value» row */
    function row_(label, value, opts) {
      const r = el_('div', 'sd-row');
      r.appendChild(el_('span', 'sd-k', label));
      const v = el_('bdi', 'sd-v' + (opts && opts.mono ? ' mono' : ''), value);
      r.appendChild(v);
      if (opts && opts.copy) {
        const b = el_('button', 'sd-copy'); b.type = 'button'; b.dataset.act = 'copy'; b.setAttribute('aria-label', 'نسخ الإحداثيات'); b.title = 'نسخ الإحداثيات';
        b.innerHTML = ICON.copy; r.appendChild(b);
      }
      return r;
    }
    function btn_(act, cls, label, disabled) {
      const b = el_('button', 'sd-btn ' + cls, label); b.type = 'button'; b.dataset.act = act; if (disabled) b.disabled = true; return b;
    }
    /* عدد محطات المغذي من نسخة الجهاز (نفس قاعدة بطاقة المحطة)؛ بلا مغذي أو نسخة ← لا شيء — the feeder count, same rule as the card */
    function feederCount_() {
      const feeder = String(s.feeder || '').trim(), all = d.localStations ? d.localStations() : null;
      if (!feeder || !Array.isArray(all) || !all.length) return null;
      return all.filter(function (x) { return String(x.feeder || '').trim() === feeder; }).length;
    }

    function drawInfo_(p) {
      const list = el_('div', 'sd-list');
      list.appendChild(row_('رقم المحطة', String(s.id), { mono: true }));
      list.appendChild(row_('النوع', s.type === 'تحويل' ? 'محطة تحويل' : 'محطة توزيع'));
      if (s.feeder) list.appendChild(row_('المغذي', String(s.feeder), { mono: true }));
      if (s.region) list.appendChild(row_('المنطقة', String(s.region)));
      const fc = feederCount_();
      if (fc != null) list.appendChild(row_('محطات المغذي', fc + ' محطة'));
      list.appendChild(Q.hasCoordinates(s) ? row_('الإحداثيات', coordsText_(s), { mono: true, copy: true }) : row_('الإحداثيات', 'لا توجد إحداثيات صالحة'));
      // آخر تحديث لنسخة المحطات على الجهاز (انتقل من البطاقة — قرار محمد 20 أكتوبر) — the device copy's last update (moved from the card)
      const fresh = d.dataFreshness ? d.dataFreshness() : null;
      if (fresh && global.SecDates) list.appendChild(row_('آخر تحديث لنسخة المحطات', global.SecDates.dualDateTime(fresh)));
      p.appendChild(list);
      const acts = el_('div', 'sd-actions');
      const coords = Q.hasCoordinates(s);
      acts.appendChild(btn_('navigate', 'sd-primary', 'المسار من موقعي', !coords));
      acts.appendChild(btn_('copy', 'sd-sub', 'نسخ الإحداثيات', !coords));
      acts.appendChild(btn_('share', 'sd-sub', 'مشاركة'));
      if (d.canEdit && d.canEdit()) acts.appendChild(btn_('edit', 'sd-ops', 'تعديل'));
      p.appendChild(acts);
    }
    function drawLoc_(p) {
      const list = el_('div', 'sd-list');
      if (Q.hasCoordinates(s)) {
        list.appendChild(row_('خط العرض', Number(s.lat).toFixed(6), { mono: true }));
        list.appendChild(row_('خط الطول', Number(s.lng).toFixed(6), { mono: true }));
      } else list.appendChild(row_('الإحداثيات', 'لا توجد إحداثيات صالحة'));
      p.appendChild(list);
      const acts = el_('div', 'sd-actions');
      const coords = Q.hasCoordinates(s);
      acts.appendChild(btn_('show-map', 'sd-primary', 'عرض على الخريطة', !coords));
      if (coords) {
        const a = el_('a', 'sd-btn sd-sub', 'قوقل ماب'); a.href = d.googleMapsUrl ? d.googleMapsUrl(s) : '#'; a.target = '_blank'; a.rel = 'noopener'; a.dataset.act = 'google';
        acts.appendChild(a);
      }
      acts.appendChild(btn_('copy', 'sd-sub', 'نسخ الإحداثيات', !coords));
      p.appendChild(acts);
    }
    /* القريبة من نسخة الجهاز؛ بلا نسخة أو بلا إحداثيات ← حالة واضحة لا قائمة فارغة — nearby from the device copy; clear states */
    function drawNear_(p) {
      const all = d.localStations ? d.localStations() : null;
      const state = function (text) { p.appendChild(el_('div', 'sd-state', text)); };
      if (!Q.hasCoordinates(s)) { state('لا توجد إحداثيات صالحة لهذه المحطة، فلا يمكن حساب القريبة'); return; }
      if (!Array.isArray(all) || !all.length) { state('نسخة المحطات لم تُحمَّل بعد على هذا الجهاز — تظهر القريبة بعد اكتمالها'); return; }
      const near = Q.nearbyLocal(all, { id: s.id, type: s.type, lat: Number(s.lat), lng: Number(s.lng) });
      if (!near.length) { state('لا توجد محطات أخرى ضمن ' + Q.NEARBY_KM + ' كم'); return; }
      p.appendChild(el_('div', 'sd-note', 'ضمن ' + Q.NEARBY_KM + ' كم — الأقرب أولًا (' + near.length + ' محطة)'));
      const ul = el_('div', 'sd-near');
      near.slice(0, NEARBY_MAX).forEach(function (x, i) {
        const b = el_('button', 'sd-near-row'); b.type = 'button'; b.dataset.act = 'open'; b.dataset.i = String(i);
        const ic = el_('span', 'sd-near-ic ' + (x.type === 'تحويل' ? 'is-sub' : 'is-dist')); ic.innerHTML = TYPE_ICON[x.type] || TYPE_ICON['توزيع'];
        const tx = el_('span', 'sd-near-tx');
        tx.appendChild(el_('bdi', 'sd-near-id', String(x.id)));
        tx.appendChild(el_('span', 'sd-near-sub', (x.type === 'تحويل' ? 'محطة تحويل' : 'محطة توزيع') + (x.region ? ' · ' + x.region : '')));
        b.appendChild(ic); b.appendChild(tx);
        b.appendChild(el_('span', 'sd-near-km', km_(x.distanceKm)));
        const ch = el_('span', 'sd-near-ch'); ch.innerHTML = ICON.chev; b.appendChild(ch);
        ul.appendChild(b);
      });
      p.appendChild(ul);
      if (near.length > NEARBY_MAX) p.appendChild(el_('div', 'sd-note', 'يُعرض أقرب ' + NEARBY_MAX + ' — بقيتها بزر «قريب» على الخريطة'));
      container._near = near.slice(0, NEARBY_MAX);
    }

    function draw_() {
      if (!s) return;
      const sub = s.type === 'تحويل';
      const badge = q('badge'); badge.className = 'sd-badge ' + (sub ? 'is-sub' : 'is-dist'); badge.innerHTML = TYPE_ICON[s.type] || TYPE_ICON['توزيع'];
      q('id').textContent = String(s.id);
      const t = q('type'); t.textContent = sub ? 'محطة تحويل' : 'محطة توزيع'; t.className = 'sd-type ' + (sub ? 'is-sub' : 'is-dist');
      container.querySelectorAll('.sd-tab').forEach(function (b) { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      const p = q('panel'); p.textContent = '';
      if (tab === 'info') drawInfo_(p); else if (tab === 'loc') drawLoc_(p); else drawNear_(p);
    }

    async function copy_() {
      if (!Q.hasCoordinates(s)) return;
      const text = coordsText_(s);
      try { await global.navigator.clipboard.writeText(text); toast('تم نسخ الإحداثيات 📋'); }
      catch (e) { toast('تعذّر النسخ — الإحداثيات: ' + text); }
    }
    async function share_() {
      const text = d.shareText ? d.shareText(s) : String(s.id), nav = global.navigator;
      if (nav.share) { try { await nav.share({ title: 'بيانات محطة ' + s.id, text: text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      try { await nav.clipboard.writeText(text); toast('تم نسخ بيانات المحطة 📋'); } catch (e) { toast('تعذّر نسخ البيانات'); }
    }

    container.addEventListener('click', function (e) {
      const t = e.target.closest('[data-tab],[data-act]');
      if (!t || !container.contains(t) || t.disabled) return;
      if (t.dataset.tab) { tab = t.dataset.tab; draw_(); return; }
      const act = t.dataset.act;
      try {
        if (act === 'back') { if (d.onBack) d.onBack(); }
        else if (act === 'copy') copy_();
        else if (act === 'share') share_();
        else if (act === 'navigate') { if (d.onNavigate) d.onNavigate(s); }
        else if (act === 'edit') { if (d.onEdit) d.onEdit(s); }
        else if (act === 'show-map') { if (d.onShowOnMap) d.onShowOnMap(s); }
        else if (act === 'open') { const x = (container._near || [])[Number(t.dataset.i)]; if (x && d.onOpenStation) d.onOpenStation(x); }
      } catch (err) { toast('تعذّر تنفيذ الإجراء، حاول مرة أخرى'); }
    });

    return {
      open: function (station, startTab) { s = station; tab = startTab || 'info'; draw_(); },
      refresh: draw_,
      station: function () { return s; },
      tab: function () { return tab; },
      isOpen: function () { return !!s; },
      close: function () { s = null; }
    };
  }

  global.SecStationDetails = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
