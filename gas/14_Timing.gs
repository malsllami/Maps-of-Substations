/**
 * ===================================================
 * 14_Timing.gs — قياس زمن مراحل الطلب (تشخيص فقط)
 * ===================================================
 * يقيس زمن كل مرحلة داخل الطلب ويكتبه في سجل التنفيذ فقط (لا يكتب في الشيت)،
 * ويُرجع ملخصًا صغيرًا `_timing` مع الرد ليقارن المتصفح زمن الخادم بالزمن الكلي.
 * كل الدوال آمنة خارج الطلب (المشغّلات الزمنية): بلا قياس جارٍ تُنفَّذ الدالة كما هي.
 *
 * Request stage timing (diagnostics only): writes to the execution log only (never the sheet),
 * and returns a small `_timing` summary so the browser can compare server time with total time.
 * All helpers are safe outside a request (time triggers): with no active measurement they just run.
 * ===================================================
 */

let perf_ = null;

/* بدء قياس طلب — Start measuring a request */
function perfStart_(requestId, action) {
  perf_ = { requestId: requestId || '-', action: action || 'غير معروف', t0: Date.now(), depth: 0, lines: [] };
}

/* يقيس زمن fn باسم label ويُرجع ناتجها كما هو؛ countFn اختيارية تستخرج رقمًا يُسجَّل بجانبه
 * Times fn under label and returns its result as is; optional countFn extracts a number logged next to it */
function perfMeasure_(label, fn, countFn) {
  if (!perf_) return fn();
  const p = perf_, index = p.lines.length, depth = p.depth, start = Date.now();
  p.lines.push(null); // مكان السطر محجوز لتظهر المراحل الداخلية تحته / slot reserved so nested stages print below it
  p.depth++;
  try {
    const result = fn();
    let extra = '';
    if (countFn) { try { extra = ' | ' + countFn(result); } catch (e) { /* العدّ اختياري / counting is optional */ } }
    p.lines[index] = indent_(depth) + label + ': ' + (Date.now() - start) + ' ms' + extra;
    return result;
  } catch (err) {
    p.lines[index] = indent_(depth) + label + ': ' + (Date.now() - start) + ' ms | فشل: ' + err;
    throw err;
  } finally {
    p.depth--;
  }
}

/* معلومة بلا زمن (كاش مصاب/مفقود…) — A timeless note (cache hit/miss…) */
function perfNote_(label, value) {
  if (perf_) perf_.lines.push(indent_(perf_.depth) + label + ': ' + value);
}

/* إنهاء القياس: سجل التنفيذ + ملخص للرد — Finish: execution log + reply summary */
function perfEnd_() {
  if (!perf_) return null;
  const p = perf_, serverMs = Date.now() - p.t0;
  const stages = p.lines.filter(function (l) { return l !== null; });
  console.log('REQUEST requestId=' + p.requestId + ' action=' + p.action + '\n' + stages.join('\n') + '\nSERVER TOTAL: ' + serverMs + ' ms');
  perf_ = null;
  return { requestId: p.requestId, serverMs: serverMs, stages: stages };
}

function indent_(depth) {
  return new Array(depth + 1).join('  ');
}
