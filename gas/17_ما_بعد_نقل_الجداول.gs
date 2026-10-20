/**
 * ===================================================
 * 17_ما_بعد_نقل_الجداول.gs — أداة يدوية بعد لصق جداول V1 في V2 (خطة الانتقال — 16 أكتوبر)
 * ===================================================
 * مسؤوليته الوحيدة: بعد لصق بيانات الجداول الأربعة (الأعضاء، بصمات الأجهزة، محطات التوزيع، محطات التحويل)
 * يجعل الخادم يقرأ البيانات المنقولة فورًا:
 *   1. يفحص عناوين الجداول الأربعة (قراءة فقط) — تنبيه إن لُصقت عناوين V1 القديمة فوق عناوين V2.
 *   2. يطبع أعداد كل جدول لمطابقتها مع V1 (صفوف البيانات، والأرقام الفريدة والمكررة وبلا إحداثيات للمحطات).
 *   3. يمسح الذاكرة المؤقتة للأعضاء والبصمات ولوحة المدير.
 *   4. يعيد بناء فهرسي البحث (التوزيع والتحويل) من الشيت.
 *   5. يرفع رقم إصدار البيانات، فتحمّل الأجهزة النسخة الجديدة كاملة.
 * لا يمسح ولا يعدّل أي خلية في أي جدول. يُشغَّل يدويًا من المحرر: اختر «ما_بعد_نقل_الجداول» ثم «تشغيل»،
 * والنتيجة في «سجل التنفيذ». لا يستدعيه الموقع.
 *
 * Manual tool after pasting V1's tables into V2: checks the four tables' headers (read-only), prints each table's counts
 * to match against V1, clears the members/credentials/dashboard caches, rebuilds both search indexes from the sheet and
 * bumps the data version so devices reload. Never deletes or edits any cell. Run manually from the editor.
 * ===================================================
 */

// الجداول المنقولة من V1 (قرار محمد) — دالة لا ثابت، فلا تعتمد على ترتيب تحميل الملفات
// The tables moved from V1 (Mohammed's decision) — a function, not a constant, so it never depends on file load order
function afterCopyTables_() { return [SHEETS.MEMBERS, SHEETS.CREDENTIALS, SHEETS.STATIONS, SHEETS.SUBSTATIONS]; }
const AFTER_COPY_LOCK_MS = 30000;

/* عدد صفوف البيانات (أول عمود غير فارغ) — data rows (first column not empty) */
function afterCopyDataRows_(rows) {
  let n = 0;
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0] == null ? '' : rows[i][0]).trim() !== '') n++;
  return n;
}

/* أرقام المحطات: الفريدة والمكررة وبلا إحداثيات — station numbers: unique, duplicated and without coordinates */
function afterCopyStationCounts_(type, rows) {
  const c = stationCols_(type), seen = {};
  let unique = 0, duplicates = 0, noCoords = 0;
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] == null ? '' : rows[i][0]).trim();
    if (!id) continue;
    const n = normalizeStationId_(id);
    if (seen[n]) duplicates++; else { seen[n] = true; unique++; }
    if (coordinateOrNull_(rows[i][c.LAT]) === null || coordinateOrNull_(rows[i][c.LNG]) === null) noCoords++;
  }
  return { unique: unique, duplicates: duplicates, noCoords: noCoords };
}

/* هل عناوين الجدول هي عناوين V2 المعتمدة؟ — are the table's headers V2's approved ones? */
function afterCopyHeaderIssue_(name, rows) {
  const want = HEADERS[name], got = (rows[0] || []).slice(0, want.length).map(function (v) { return String(v == null ? '' : v); });
  for (let i = 0; i < want.length; i++) {
    if (got[i] !== want[i]) return 'العمود ' + (i + 1) + ': «' + got[i] + '» بدل «' + want[i] + '»';
  }
  return '';
}

/**
 * ما_بعد_نقل_الجداول — يُشغَّل مرة بعد اللصق (ويمكن إعادته بأمان: لا يغيّر أي بيانات)
 * Run once after pasting (safe to rerun: changes no data)
 */
function ما_بعد_نقل_الجداول() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(AFTER_COPY_LOCK_MS)) { console.log('⛔ الخادم مشغول بعملية أخرى — أعد التشغيل بعد دقيقة. لم يتغير شيء.'); return; }
  try {
    const lines = ['===== ما بعد نقل الجداول — ' + Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm:ss') + ' ====='];
    let headerProblems = 0;

    // 1 + 2) العناوين والأعداد (قراءة فقط) — headers and counts (read-only)
    afterCopyTables_().forEach(function (name) {
      const rows = readAllRows_(name);
      if (!rows.length) { lines.push('❌ ' + name + ': الجدول غير موجود أو فارغ تمامًا'); headerProblems++; return; }
      const issue = afterCopyHeaderIssue_(name, rows);
      if (issue) { headerProblems++; lines.push('⚠️ ' + name + ': عنوان مختلف عن V2 — ' + issue); }
      let line = (issue ? '   ' : '✅ ') + name + ': ' + afterCopyDataRows_(rows) + ' صف بيانات';
      if (name === SHEETS.STATIONS || name === SHEETS.SUBSTATIONS) {
        const s = afterCopyStationCounts_(name === SHEETS.STATIONS ? STATION_TYPE.DISTRIBUTION : STATION_TYPE.SUBSTATION, rows);
        line += ' | أرقام فريدة: ' + s.unique + ' | مكررة: ' + s.duplicates + ' | بلا إحداثيات: ' + s.noCoords;
      }
      lines.push(line);
    });

    // 3) الذاكرة المؤقتة — caches
    invalidateMembers_();
    invalidateCache_(CREDENTIALS_CACHE_KEY);
    CacheService.getScriptCache().remove(DASHBOARD_CACHE_KEY);
    lines.push('🧹 مُسحت الذاكرة المؤقتة: الأعضاء، البصمات، لوحة المدير');

    // 4) فهرسا البحث من الشيت — both search indexes from the sheet
    [STATION_TYPE.DISTRIBUTION, STATION_TYPE.SUBSTATION].forEach(function (type) {
      const start = Date.now();
      dropIndex_(INDEX_KEYS[type]);
      const index = buildAndSaveIndex_(type);
      lines.push('🔎 فهرس ' + type + ': ' + index.length + ' محطة | ' + (Date.now() - start) + ' ms');
    });

    // 5) رقم إصدار البيانات — the data version
    const before = getDataVersion().version;
    bumpDataVersion_();
    lines.push('🔢 رقم إصدار البيانات: ' + before + ' ← ' + getDataVersion().version + ' (الأجهزة تحمّل النسخة الجديدة كاملة)');

    lines.push(headerProblems
      ? '⚠️ النتيجة: ' + headerProblems + ' تنبيه في العناوين — راجعها (الأداة لم تعدّل أي عنوان أو بيانات)'
      : '✅ النتيجة: العناوين سليمة، والفهرس والإصدار محدّثان. طابق الأعداد أعلاه مع V1.');
    console.log(lines.join('\n'));
  } finally {
    lock.releaseLock();
  }
}
