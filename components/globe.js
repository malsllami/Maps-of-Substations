/* ============================================================
 * components/globe.js — الكرة ثلاثية الأبعاد في الرئيسية (three.js r128 كما في V1، بقرار محمد)
 * ============================================================
 * سلوك V1 وشكله كما هما: كرة سلكية (Icosahedron) وكرة شبكية زرقاء ونقاط زخرفية، تدور ببطء (0.0016 لكل إطار، ميل 0.15)،
 * ألوانها حسب الثيم، الكاميرا حسب عرض المسرح (4.9 / 4.5 / 3.9)، ولقطة البحث: تلتفّ نحو المحطة (550 م ث، أقصر اتجاه)
 * ثم تتمدد حتى 2.4 وتبهت — والصفحة بعدها تُظهر الخريطة. نهاية الشاشة الافتتاحية: بعد 2.3 ث، أو بعد 400 م ث إن كان
 * الجهاز أبطأ من 40 إطارًا/ث.
 * مستقلة عن محرك الخريطة: لا تعرف Leaflet ولا map-view؛ الصفحة تربط بينهما.
 * الحالة البديلة (V1 بعد سجل «THREE is not defined»): بلا المكتبة أو بلا WebGL ← تختفي الكرة، وكل الدوال تعمل بلا أثر،
 *   ولقطة البحث تنتهي فورًا، والشاشة الافتتاحية تنتهي في وقتها — فلا تتعطل الصفحة بسبب زخرفة.
 * V2: الرسم يتوقف وقت ظهور الخريطة وعند إخفاء الصفحة (لا رسم خلف الخريطة يستهلك البطارية) ويعود بعدها؛ الشفافية بعد
 *   الرجوع من الخريطة = ألوان الثيم نفسها (V1 كان يرجع بقيم مختلفة عن قيم الثيم)؛ الثيم من services/theme.js.
 *
 * The home page 3D globe (three.js r128, as in V1). V1's behavior and look; independent of the map engine. Fallback when
 * the library or WebGL is missing: the globe hides and every call is a no-op. V2: rendering pauses while the map shows
 * or the page is hidden; after returning, the opacities are the theme's own.
 * ============================================================ */
(function (global) {
  'use strict';

  const ROT_SPEED = 0.0016, TILT = 0.15, TURN_MS = 550;
  const EXPAND_STEP = 0.06, EXPAND_MAX = 2.4, EXPAND_TICK_MS = 16;
  const INTRO_MAX_MS = 2300, INTRO_CHECK_MS = 400, INTRO_MIN_FPS = 40;
  /* 46 نقطة زخرفية عشوائية كما في V1 (قرار محمد): عنصر رسومي لا بيانات — لا تمثّل محطات ولا مواقع، ولا تدخل البحث ولا
   * الإحصاءات ولا الخريطة ولا الخادم. ربطها ببيانات حقيقية يحتاج قرار تصميم جديدًا واختبارًا مستقلًا.
   * 46 decorative random dots as in V1 (Mohammed's decision): a graphic, not data — never stations or locations, never in
   * search, stats, the map or the server. Binding them to real data needs a new design decision and its own test. */
  const DECOR_POINTS = 46;
  const COLORS = {
    dark: { wire: 0x4DD6B5, ring: 0x4A86E8, point: 0x2ECC71, wireOpacity: 0.20, ringOpacity: 0.13 },
    light: { wire: 0x6D9EEB, ring: 0x4A86E8, point: 0x0B804B, wireOpacity: 0.30, ringOpacity: 0.07 }
  };

  function cameraZ_(w) { return w <= 420 ? 4.9 : w <= 600 ? 4.5 : 3.9; }
  function shortestDelta_(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  /* زاوية الدوران التي تجعل الموقع أمام الكاميرا (V1) — The rotation that brings a location to the front (V1) */
  function targetRotationY(lat, lng) {
    const phi = (90 - lat) * Math.PI / 180, theta = (lng + 180) * Math.PI / 180;
    const x = -Math.sin(phi) * Math.cos(theta), z = Math.sin(phi) * Math.sin(theta);
    return Math.atan2(-x, z);
  }

  /**
   * mount(stage, opts) — stage: عنصر .globe-stage (تُضاف فيه لوحة الرسم). opts: { onIntroDone() }
   * يُرجع { ready، turnTo(lat,lng) → Promise، reset()، pause()، resume()، resize()، rotation()، destroy() }
   */
  function mount(stage, opts) {
    const o = opts || {}, THREE = global.THREE, doc = global.document;
    const canvas = doc.createElement('canvas');
    canvas.className = 'globe-canvas';
    stage.classList.add('globe-stage');
    stage.insertBefore(canvas, stage.firstChild);

    let introDone = false;
    const introStart = global.performance.now();
    function finishIntro_() {
      if (introDone) return;
      introDone = true;
      if (o.onIntroDone) { try { o.onIntroDone(); } catch (e) { /* لا شيء / nothing */ } }
    }

    // ===== الحالة البديلة — The fallback =====
    let renderer = null;
    if (THREE) { try { renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true }); } catch (e) { renderer = null; } }
    if (!renderer) {
      canvas.style.display = 'none';
      stage.classList.add('globe-off');
      const t = global.setTimeout(finishIntro_, INTRO_MAX_MS);
      const noop = function () {};
      return {
        ready: false, turnTo: function () { return Promise.resolve(); }, reset: noop, pause: noop, resume: noop, resize: noop,
        rotation: function () { return null; },
        destroy: function () { global.clearTimeout(t); canvas.remove(); stage.classList.remove('globe-off'); }
      };
    }

    // ===== المشهد (V1) — The scene (V1) =====
    function size_() { return { w: stage.clientWidth || 1, h: stage.clientHeight || 1 }; }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, size_().w / size_().h, 0.1, 1000);
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    const group = new THREE.Group();
    scene.add(group);
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x4DD6B5, wireframe: true, transparent: true, opacity: 0.18 });
    group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 3), wireMat));
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2E7DD1, wireframe: true, transparent: true, opacity: 0.10 });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 24), ringMat));
    const pointMat = new THREE.MeshBasicMaterial({ color: 0x4DD6B5 });
    const pointGeo = new THREE.SphereGeometry(0.022, 8, 8), points = new THREE.Group();
    for (let i = 0; i < DECOR_POINTS; i++) {
      const lat = Math.random() * 160 - 80, lng = Math.random() * 360 - 180;
      const phi = (90 - lat) * Math.PI / 180, theta = (lng + 180) * Math.PI / 180, r = 1.52;
      const m = new THREE.Mesh(pointGeo, pointMat);
      m.position.set(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
      points.add(m);
    }
    group.add(points);

    function theme_() { return global.SecTheme ? global.SecTheme.get() : (doc.documentElement.getAttribute('data-theme') || 'dark'); }
    function applyColors_() {
      const c = COLORS[theme_() === 'light' ? 'light' : 'dark'];
      wireMat.color.set(c.wire); ringMat.color.set(c.ring); pointMat.color.set(c.point);
      wireMat.opacity = c.wireOpacity; ringMat.opacity = c.ringOpacity;
    }
    applyColors_();
    const unTheme = global.SecTheme && global.SecTheme.onChange ? global.SecTheme.onChange(applyColors_) : null;

    function resize() {
      const s = size_();
      if (!stage.clientWidth || !stage.clientHeight) return;
      camera.aspect = s.w / s.h;
      camera.position.z = cameraZ_(s.w);
      camera.updateProjectionMatrix();
      renderer.setSize(s.w, s.h, false);
    }
    resize();

    // ===== الحركة — Animation =====
    let speed = ROT_SPEED, frames = 0, introChecked = false, raf = 0, paused = false, alive = true, expandTimer = 0;
    function frame_() {
      raf = 0;
      if (!alive || paused || doc.hidden) return;
      raf = global.requestAnimationFrame(frame_);
      group.rotation.y += speed;
      group.rotation.x = TILT;
      renderer.render(scene, camera);
      if (!introDone) {
        frames++;
        const elapsed = global.performance.now() - introStart;
        if (!introChecked && elapsed >= INTRO_CHECK_MS) { introChecked = true; if (frames / (elapsed / 1000) < INTRO_MIN_FPS) finishIntro_(); }
        if (elapsed >= INTRO_MAX_MS) finishIntro_();
      }
    }
    function start_() { if (!raf && alive && !paused && !doc.hidden) raf = global.requestAnimationFrame(frame_); }
    // الشاشة الافتتاحية تنتهي في وقتها حتى لو كانت الصفحة مخفية / the intro still ends on time even if the page is hidden
    const introTimer = global.setTimeout(finishIntro_, INTRO_MAX_MS + 200);
    function onVisibility_() { if (!doc.hidden) start_(); }
    doc.addEventListener('visibilitychange', onVisibility_);
    const ro = global.ResizeObserver ? new global.ResizeObserver(resize) : null;
    if (ro) ro.observe(stage);
    start_();

    /* لقطة البحث: التفاف نحو الموقع ثم تمدد — The search shot: turn toward the location, then expand */
    function turnTo(lat, lng) {
      speed = 0;
      global.clearInterval(expandTimer);
      return new Promise(function (resolve) {
        const from = group.rotation.y, delta = shortestDelta_(from, targetRotationY(lat, lng)), t0 = global.performance.now();
        function step() {
          if (!alive) return resolve();
          const p = Math.min((global.performance.now() - t0) / TURN_MS, 1);
          group.rotation.y = from + delta * (1 - Math.pow(1 - p, 3));
          if (paused || doc.hidden) renderer.render(scene, camera);
          if (p < 1) { global.requestAnimationFrame(step); return; }
          let scale = 1;
          expandTimer = global.setInterval(function () {
            scale += EXPAND_STEP;
            group.scale.set(scale, scale, scale);
            wireMat.opacity = Math.max(0, 0.18 - (scale - 1) * 0.1);
            ringMat.opacity = Math.max(0, 0.10 - (scale - 1) * 0.06);
            if (scale > EXPAND_MAX || !alive) { global.clearInterval(expandTimer); expandTimer = 0; resolve(); }
          }, EXPAND_TICK_MS);
        }
        global.requestAnimationFrame(step);
      });
    }
    /* الرجوع من الخريطة — Back from the map */
    function reset() {
      global.clearInterval(expandTimer); expandTimer = 0;
      group.scale.set(1, 1, 1);
      applyColors_();
      speed = ROT_SPEED;
      paused = false;
      start_();
    }

    return {
      ready: true, turnTo: turnTo, reset: reset, resize: resize,
      pause: function () { paused = true; },
      resume: function () { paused = false; start_(); },
      rotation: function () { return { x: group.rotation.x, y: group.rotation.y, scale: group.scale.x, wireOpacity: wireMat.opacity, ringOpacity: ringMat.opacity, wireColor: wireMat.color.getHex(), running: !!raf, z: camera.position.z }; },
      destroy: function () {
        alive = false;
        if (raf) global.cancelAnimationFrame(raf);
        raf = 0;
        global.clearInterval(expandTimer); global.clearTimeout(introTimer);
        doc.removeEventListener('visibilitychange', onVisibility_);
        if (ro) ro.disconnect();
        if (typeof unTheme === 'function') unTheme();
        renderer.dispose();
        canvas.remove();
      }
    };
  }

  global.SecGlobe = { mount: mount, targetRotationY: targetRotationY, shortestDelta: shortestDelta_ };
})(typeof window !== 'undefined' ? window : globalThis);
