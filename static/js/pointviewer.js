/* Point-cloud viewer for DUALingo role heatmaps (three.js r128, global THREE).
 *
 * Shading follows the Fig. 1 teaser renderer (paper/teaser/teaser_dualingo.py):
 * lit beads on a warm grey body, a far-to-near depth shade, a darker under-layer
 * between beads, and each role's colour ramped from the 0.12 display threshold
 * up to min(0.75, that role's peak). Where both roles score, the larger wins
 * (ties go to role a), so there is never a third "both hands" colour.
 *
 * Data: static/data/objects/<key>.bin = int16 xyz (n,3) then, per task,
 * uint8 heat a (n) and uint8 heat b (n). See tools/export_objects.py.
 */
(function () {
  const STYLE = {
    grey: "#EDECEB",
    roleA: "#F5A04A",
    roleB: "#8CC753",
    threshold: 0.12,
    rampTop: 0.75,
    rampFloor: 0.18,
    light: [-0.42, 0.46, 0.78],
    ambient: 0.8,
    depthShade: [0.86, 0.97],
    aoShade: 0.66,
    aoGrow: 1.75,
    beadScale: 1.6, // bead diameter in units of the median point spacing
    activeGrow: 1.3,
    elevation: 22,
    fov: 28,
  };

  const VERT = `
    attribute float heatA;
    attribute float heatB;
    uniform float uSize, uScale, uThrA, uThrB, uTopA, uTopB, uFloor, uGrow, uUnder;
    uniform vec3 uGrey, uColA, uColB;
    uniform float uNear, uFar;
    varying vec3 vColor;
    varying float vDepth;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      bool onA = heatA > uThrA, onB = heatB > uThrB;
      vec3 col = uGrey;
      float grow = 1.0;
      if (onA || onB) {
        bool isA = onA && (!onB || heatA >= heatB);
        float s = isA ? heatA : heatB, thr = isA ? uThrA : uThrB, top = isA ? uTopA : uTopB;
        float t = clamp((s - thr) / max(top - thr, 1e-3), 0.0, 1.0);
        col = mix(uGrey, isA ? uColA : uColB, uFloor + (1.0 - uFloor) * t);
        grow = uGrow;
      }
      vColor = col;
      float d = -mv.z;
      vDepth = clamp((d - uNear) / max(uFar - uNear, 1e-3), 0.0, 1.0);
      gl_PointSize = max(uSize * grow * uScale / d * mix(1.0, ${STYLE.aoGrow.toFixed(2)}, uUnder), 1.0);
      gl_Position = projectionMatrix * mv;
      // the under-layer sits a hair behind the beads it outlines
      gl_Position.z += uUnder * 0.004 * gl_Position.w;
    }`;

  const FRAG = `
    uniform vec3 uLight;
    uniform float uAmbient, uUnder, uShadeNear, uShadeFar, uAo;
    varying vec3 vColor;
    varying float vDepth;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      p.y = -p.y;
      float r2 = dot(p, p);
      if (r2 > 1.0) discard;
      float depth = mix(uShadeNear, uShadeFar, vDepth);
      if (uUnder > 0.5) {
        gl_FragColor = vec4(vColor * uAo * depth, 1.0);
        return;
      }
      vec3 n = vec3(p, sqrt(1.0 - r2));
      float shade = uAmbient + (1.0 - uAmbient) * max(dot(n, uLight), 0.0);
      gl_FragColor = vec4(vColor * shade * depth, 1.0);
    }`;

  const color = (hex) => new THREE.Color(hex);

  function makeMaterial(under) {
    const l = new THREE.Vector3(...STYLE.light).normalize();
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSize: { value: 0.02 },
        uScale: { value: 500 },
        uThrA: { value: STYLE.threshold },
        uThrB: { value: STYLE.threshold },
        uTopA: { value: STYLE.rampTop },
        uTopB: { value: STYLE.rampTop },
        uFloor: { value: STYLE.rampFloor },
        uGrow: { value: STYLE.activeGrow },
        uUnder: { value: under ? 1 : 0 },
        uGrey: { value: color(STYLE.grey) },
        uColA: { value: color(STYLE.roleA) },
        uColB: { value: color(STYLE.roleB) },
        uNear: { value: 1 },
        uFar: { value: 3 },
        uLight: { value: l },
        uAmbient: { value: STYLE.ambient },
        uShadeNear: { value: STYLE.depthShade[1] },
        uShadeFar: { value: STYLE.depthShade[0] },
        uAo: { value: STYLE.aoShade },
      },
    });
  }

  /* ---------- data ---------- */
  const cache = new Map();
  function loadObject(entry, base) {
    if (!cache.has(entry.key)) {
      const p = fetch(`${base}objects/${entry.key}.bin`)
        .then((r) => {
          if (!r.ok) throw new Error(`${entry.key}.bin: HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((buf) => {
          const n = entry.n;
          const q = new Int16Array(buf, 0, n * 3);
          const pos = new Float32Array(n * 3);
          for (let i = 0; i < pos.length; i++) pos[i] = q[i] / 32767;
          const heats = entry.tasks.map((_, t) => [
            new Uint8Array(buf, n * 6 + (2 * t) * n, n),
            new Uint8Array(buf, n * 6 + (2 * t + 1) * n, n),
          ]);
          const peaks = heats.map((pair) => pair.map((h) => {
            let m = 0;
            for (let i = 0; i < h.length; i++) if (h[i] > m) m = h[i];
            return m / 255;
          }));
          let minY = Infinity, r = 0;
          for (let i = 0; i < n; i++) {
            const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
            if (y < minY) minY = y;
            r = Math.max(r, Math.hypot(x, y, z));
          }
          return { pos, heats, peaks, minY, radius: r };
        });
      cache.set(entry.key, p);
    }
    return cache.get(entry.key);
  }

  /* ---------- scene ---------- */
  function shadowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(0,0,0,0.22)");
    grd.addColorStop(0.55, "rgba(0,0,0,0.08)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  class Scene {
    constructor() {
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(STYLE.fov, 1, 0.05, 50);
      this.geom = new THREE.BufferGeometry();
      this.matUnder = makeMaterial(true);
      this.matBead = makeMaterial(false);
      this.under = new THREE.Points(this.geom, this.matUnder);
      this.beads = new THREE.Points(this.geom, this.matBead);
      this.scene.add(this.under, this.beads);
      this.shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
      );
      this.shadow.rotation.x = -Math.PI / 2;
      this.scene.add(this.shadow);
      this.data = null;
    }

    setObject(entry, data) {
      this.entry = entry;
      this.data = data;
      this.geom.setAttribute("position", new THREE.BufferAttribute(data.pos, 3));
      this.geom.computeBoundingSphere();
      for (const m of [this.matUnder, this.matBead]) m.uniforms.uSize.value = entry.spacing * STYLE.beadScale;
      let sx = 0, sz = 0;
      for (let i = 0; i < data.pos.length; i += 3) {
        sx = Math.max(sx, Math.abs(data.pos[i]));
        sz = Math.max(sz, Math.abs(data.pos[i + 2]));
      }
      this.shadow.position.y = data.minY - 0.005;
      this.shadow.scale.set(2.6 * sx + 0.3, 2.6 * sz + 0.3, 1);
      this.dist = data.radius / Math.sin((STYLE.fov / 2) * Math.PI / 180) * 1.18;
    }

    setTask(t) {
      const [a, b] = this.data.heats[t];
      this.geom.setAttribute("heatA", new THREE.BufferAttribute(a, 1, true));
      this.geom.setAttribute("heatB", new THREE.BufferAttribute(b, 1, true));
      const [pa, pb] = this.data.peaks[t];
      // Annotations: the teaser ramp from 0.12. Predictions carry a per-role top-10% threshold
      // and, as in the paper's Fig. 4, show that set at full role colour (binary, no ramp).
      const thr = this.entry.tasks[t].thr;
      const [ta, tb] = thr || [STYLE.threshold, STYLE.threshold];
      const top = (p, th) => (thr ? th + 1e-4 : Math.min(STYLE.rampTop, Math.max(p, th + 0.05)));
      for (const m of [this.matUnder, this.matBead]) {
        m.uniforms.uThrA.value = ta;
        m.uniforms.uThrB.value = tb;
        m.uniforms.uTopA.value = top(pa, ta);
        m.uniforms.uTopB.value = top(pb, tb);
      }
    }

    homeCamera(target) {
      const e = ((this.entry.elevation ?? STYLE.elevation) * Math.PI) / 180;
      const a = (this.entry.azimuth * Math.PI) / 180;
      const d = this.dist;
      this.camera.position.set(d * Math.cos(e) * Math.sin(a), d * Math.sin(e), d * Math.cos(e) * Math.cos(a));
      this.camera.lookAt(target || new THREE.Vector3());
    }

    updateUniforms(heightPx) {
      const scale = heightPx / (2 * Math.tan((STYLE.fov / 2) * Math.PI / 180));
      const d = this.camera.position.length();
      const r = this.data ? this.data.radius : 1;
      for (const m of [this.matUnder, this.matBead]) {
        m.uniforms.uScale.value = scale;
        m.uniforms.uNear.value = d - r;
        m.uniforms.uFar.value = d + r;
      }
    }
  }

  /* ---------- interactive viewer ---------- */
  class DualViewer {
    constructor(container, opts = {}) {
      this.container = container;
      this.base = opts.base || "static/data/";
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(this.renderer.domElement);
      this.s = new Scene();
      this.controls = new THREE.OrbitControls(this.s.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.enablePan = false;
      this.calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.controls.autoRotate = !this.calm;
      this.controls.autoRotateSpeed = 1.6;
      this.controls.addEventListener("start", () => {
        this.controls.autoRotate = false;
        clearTimeout(this._resume);
      });
      this.controls.addEventListener("end", () => {
        if (!this.calm) this._resume = setTimeout(() => (this.controls.autoRotate = true), 4000);
      });
      new ResizeObserver(() => this.resize()).observe(container);
      this.resize();
      this._token = 0;
      this.visible = true;                                   // draw only while the stage is on screen
      new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(container);
      const loop = () => {
        requestAnimationFrame(loop);
        if (!this.s.data || document.hidden || !this.visible) return;
        this.controls.update();
        this.s.updateUniforms(this.renderer.domElement.height);
        this.renderer.render(this.s.scene, this.s.camera);
      };
      loop();
    }

    resize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.s.camera.aspect = w / h;
      this.s.camera.updateProjectionMatrix();
    }

    async show(entry, task = 0) {
      const token = ++this._token;
      this.container.classList.add("busy");
      const data = await loadObject(entry, this.base);
      if (token !== this._token) return;
      this.s.setObject(entry, data);
      this.s.setTask(task);
      this.controls.minDistance = this.s.dist * 0.45;
      this.controls.maxDistance = this.s.dist * 2.2;
      this.s.homeCamera();
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.container.classList.remove("busy");
    }

    setTask(t) {
      if (this.s.data) this.s.setTask(t);
    }
  }

  /* ---------- thumbnails (one shared offscreen renderer) ---------- */
  let thumbR = null, thumbS = null, queue = Promise.resolve();
  function thumbnail(entry, task = 0, size = 220, base = "static/data/") {
    const job = queue.then(async () => {
      const data = await loadObject(entry, base);
      if (!thumbR) {
        thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        thumbR.setPixelRatio(1);
        thumbS = new Scene();
      }
      thumbR.setSize(size, size, false);
      thumbS.camera.aspect = 1;
      thumbS.camera.updateProjectionMatrix();
      thumbS.setObject(entry, data);
      thumbS.setTask(task);
      thumbS.homeCamera();
      thumbS.updateUniforms(size);
      thumbR.render(thumbS.scene, thumbS.camera);
      return thumbR.domElement.toDataURL("image/png");
    });
    queue = job.catch(() => {});
    return job;
  }

  window.DUALingo = { DualViewer, thumbnail, loadObject, STYLE };
})();
