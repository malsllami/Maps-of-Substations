/* ============================================================
 * services/standalone-viewport.js — فراغ أسفل التطبيق المثبّت على الآيفون عند امتداد الصفحة خلف شريط الساعة
 * ============================================================
 * - الصفحة الرئيسية وحدها تمتد خلف شريط الساعة والبطارية في التطبيق المثبّت (black-translucent في index.html) لتظهر
 *   الخريطة خلفه. في هذا الوضع قد يحسب الآيفون ارتفاع الصفحة أقصر من الشاشة بمقدار الشريط، فيرتفع كل ما يُثبَّت في
 *   الأسفل ويظهر تحته فراغ (حدث في 20 أكتوبر).
 * - هنا يُقاس ذلك فعلًا: ارتفاع منطقة العناصر الثابتة مقابل ارتفاع الشاشة؛ والفرق يُكتب في --ios-gap ليُنزل الشريط
 *   السفلي والخريطة ولوحات الأسفل إلى الحافة الحقيقية. بلا فراغ (المتصفح، الأندرويد، أو آيفون سليم) ← 0 فلا يتغير شيء.
 * - لا يغيّر أي حجم أو ترتيب؛ يعيد فقط ما في الأسفل إلى مكانه.
 *
 * The bottom gap of the installed iPhone app when the page extends behind the status bar. Only the home page extends
 * behind the clock/battery bar in the installed app, to show the map there. In that mode the iPhone may compute the page
 * shorter than the screen by the bar's height, raising everything fixed at the bottom with a gap under it (seen 20 Oct).
 * Here it is measured for real: the fixed-elements area height against the screen height; the difference goes to
 * --ios-gap, lowering the bottom bar, the map and bottom sheets to the true edge. No gap (browser, Android, or a sound
 * iPhone) ← 0, nothing changes. No size or order changes; it only puts the bottom back in place.
 * ============================================================ */
(function (global) {
  'use strict';

  const doc = global.document;
  const MAX_GAP = 80; // أكبر من أي شريط ساعة؛ ما فوقه قياس خاطئ لا يُطبَّق / above any status bar; larger is a wrong reading

  /* ارتفاع الشاشة في الاتجاه الحالي — the screen height in the current orientation */
  function screenHeight_() {
    const s = global.screen, portrait = global.matchMedia ? global.matchMedia('(orientation: portrait)').matches : global.innerHeight >= global.innerWidth;
    return portrait ? Math.max(s.width, s.height) : Math.min(s.width, s.height);
  }

  /* ارتفاع منطقة العناصر الثابتة (top:0 → bottom:0) — the fixed-elements area height */
  function fixedAreaHeight_() {
    const probe = doc.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;top:0;bottom:0;left:0;width:1px;visibility:hidden;pointer-events:none;';
    doc.documentElement.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return h;
  }

  /**
   * measure() — يقيس الفراغ ويكتبه في --ios-gap ويُرجعه (0 خارج التطبيق المثبّت على الآيفون)
   * measures the gap, writes it to --ios-gap and returns it (0 outside the installed iPhone app)
   */
  function measure() {
    let gap = 0;
    if (global.navigator.standalone === true) {
      const g = Math.round(screenHeight_() - fixedAreaHeight_());
      gap = g > 0 && g <= MAX_GAP ? g : 0;
    }
    doc.documentElement.style.setProperty('--ios-gap', gap + 'px');
    return gap;
  }

  let frame = 0;
  function schedule_() { global.cancelAnimationFrame(frame); frame = global.requestAnimationFrame(measure); }

  if (global.navigator.standalone === true) {
    measure();
    ['resize', 'orientationchange', 'pageshow'].forEach(function (t) { global.addEventListener(t, schedule_); });
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', schedule_);
  }

  global.SecStandaloneViewport = { measure: measure };
})(window);
