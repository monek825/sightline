// Written with AI assistance (Claude / GitHub Copilot)
// Classic script: A-Frame component 'heightgrid-terrain'. World: x = east m, z = south m, y = up (home = 0).
(function () {
  if (!window.AFRAME) { console.error('heightgrid-terrain: AFRAME not found'); return; }
  const THREE = AFRAME.THREE;

  // Grid registration follows lib/geo.js toLatLon: cell (r,c) centre = latMax-(r+.5)/h*span, lonMin+(c+.5)/w*span.
  // Fractional cell coords <-> lat/lon (pure math, no THREE).
  function makeModel(grid, meta, exaggerate) {
    const b = meta.bounds, home = meta.home, w = grid.w, h = grid.h;
    const ns = grid.cellM;                                    // metres per cell, north-south
    const ew = grid.cellM * Math.cos(home.lat * Math.PI / 180); // metres per cell, east-west
    const frac = (lat, lon) => ({
      r: (b.latMax - lat) / (b.latMax - b.latMin) * h - 0.5,
      c: (lon - b.lonMin) / (b.lonMax - b.lonMin) * w - 0.5 });
    const clamp = (v, max) => Math.min(Math.max(v, 0), max);
    const sample = (r, c) => {                                // bilinear on fractional cell coords, clamped
      r = clamp(r, h - 1); c = clamp(c, w - 1);
      const r0 = Math.floor(r), c0 = Math.floor(c), r1 = Math.min(r0 + 1, h - 1), c1 = Math.min(c0 + 1, w - 1);
      const fr = r - r0, fc = c - c0, d = grid.data;
      const top = d[r0 * w + c0] * (1 - fc) + d[r0 * w + c1] * fc;
      const bot = d[r1 * w + c0] * (1 - fc) + d[r1 * w + c1] * fc;
      return top * (1 - fr) + bot * fr;
    };
    const h0 = frac(home.lat, home.lon);
    const hY = sample(h0.r, h0.c);
    const heightAt = (x, z) => (sample(z / ns + h0.r, x / ew + h0.c) - hY) * exaggerate;
    const toWorld = (lat, lon) => {
      const f = frac(lat, lon), x = (f.c - h0.c) * ew, z = (f.r - h0.r) * ns;
      return { x, y: heightAt(x, z), z };
    };
    return { ns, ew, h0, hY, heightAt, toWorld, frac };
  }

  function buildGeometry(grid, m, step, exaggerate) {
    const idx = (n) => { const a = []; for (let i = 0; i < n; i += step) a.push(i); if (a[a.length - 1] !== n - 1) a.push(n - 1); return a; };
    const cols = idx(grid.w), rows = idx(grid.h);
    const g = new THREE.PlaneGeometry(1, 1, cols.length - 1, rows.length - 1);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    rows.forEach((r, j) => cols.forEach((c, i) => {
      const k = j * cols.length + i;                          // row-major, row 0 = north
      pos.setXYZ(k, (c - m.h0.c) * m.ew, (grid.data[r * grid.w + c] - m.hY) * exaggerate, (r - m.h0.r) * m.ns);
      uv.setXY(k, (c + 0.5) / grid.w, 1 - (r + 0.5) / grid.h); // image top = north
    }));
    g.computeVertexNormals();
    return g;
  }

  const getJSON = (url) => fetch(url).then((res) => {
    if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
    return res.json();
  });
  const getTexture = (url) => new Promise((resolve) => new THREE.TextureLoader().load(url, resolve, undefined, () => {
    console.warn('heightgrid-terrain: texture failed to load, using flat colour');
    resolve(null);
  }));

  // Fine-grain bump texture (procedural value noise, tileable). Gives close-up ground grain the 20 m DTM can't;
  // purely visual, no fake elevation. ponytail: one 256 px canvas, repeated; upgrade = real HiRISE DTM tiles.
  function detailTexture(repeat) {
    const N = 256, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    const rnd = (x, y, s) => { const k = ((x % s + s) % s) * 7919 + ((y % s + s) % s) * 104729; const v = Math.sin(k) * 43758.5453; return v - Math.floor(v); };
    const smooth = (x, y, s) => { // tileable value noise at grid size s
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
      const a = rnd(x0, y0, s), b = rnd(x0 + 1, y0, s), cc = rnd(x0, y0 + 1, s), d = rnd(x0 + 1, y0 + 1, s);
      return (a * (1 - u) + b * u) * (1 - v) + (cc * (1 - u) + d * u) * v;
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let n = 0, amp = 0.55;
      for (const s of [8, 16, 32, 64]) { n += amp * smooth(x * s / N, y * s / N, s); amp *= 0.5; }
      const pebble = rnd(x, y, N) > 0.985 ? 0.35 : 0; // scattered small rocks
      const val = Math.min(255, Math.round((n + pebble) * 230));
      img.data.set([val, val, val, 255], (y * N + x) * 4);
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    return t;
  }

  // ---------- HiRISE close-up patches (data/hirise_patches.json, built by scripts/make_hirise_patch.py) ----------
  // Blended into the terrain material itself (one surface: no second mesh to z-fight with, works with a logarithmic
  // depth buffer, and rocks placed on heightAt stay on the visible ground). Inside a patch box the HiRISE image
  // (~0.7 m/px) replaces the CTX image (~5 m/px), blended in over the outer 8% (~240 m of a 3 km box) so the edge
  // does not show as a square from far away. The centre 2.5 km x 2.5 km is pure HiRISE.
  const PATCH_FEATHER = 0.08, ROUGH_W = 512;
  function patchShader(n) {
    let decl = 'varying vec3 vHWorld;\n', body = '';
    for (let i = 0; i < n; i++) {
      decl += `uniform sampler2D uHP${i}; uniform vec4 uHB${i};\n`;
      body += `
    {
      vec2 q = (vHWorld.xz - uHB${i}.xy) / (uHB${i}.zw - uHB${i}.xy);   // 0..1 across the box (x east, z south)
      vec2 qc = clamp(q, 0.0, 1.0);
      vec4 h = texture2D(uHP${i}, vec2(qc.x, 1.0 - qc.y));              // sampled outside any branch (mipmaps need it)
      float e = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
      float f = smoothstep(0.0, ${PATCH_FEATHER.toFixed(3)}, e);         // 0 outside the box, 1 inside the feather
      // keep the orbital image's Mars colour, take the HiRISE brightness detail (HiRISE red band is greyscale)
      float lc = max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.02);
      float lh = dot(h.rgb, vec3(0.299, 0.587, 0.114));
      vec3 hc = diffuseColor.rgb * (lh / lc);
      hc = mix(hc, diffuseColor.rgb, 0.25);                               // a little of the CTX tone so the edge never pops
      diffuseColor.rgb = mix(diffuseColor.rgb, hc, f);
    }`;
    }
    return { decl, body };
  }
  // How broken / rough the ground is, from the HiRISE image itself (local contrast at ~6 m cells), 0..1.
  // Sand ripple fields average out at this scale (smooth -> low); fractured rock and boulder fields stay rough (high).
  function roughnessMap(img) {
    const W = ROUGH_W, H = Math.max(1, Math.round(img.height * W / img.width));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data, L = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) L[i] = px[i * 4];
    const box = (src, r) => {                 // separable box blur, radius r
      const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += src[y * W + xx]; n++; } }
        tmp[y * W + x] = s / n;
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; n++; } }
        out[y * W + x] = s / n;
      }
      return out;
    };
    const mean = box(L, 2), dev = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) dev[i] = Math.abs(L[i] - mean[i]);
    const r = box(dev, 2);
    const sorted = Float32Array.from(r).sort();
    const lo = sorted[Math.floor(sorted.length * 0.1)], hi = sorted[Math.floor(sorted.length * 0.9)];
    for (let i = 0; i < r.length; i++) r[i] = Math.min(1, Math.max(0, (r[i] - lo) / Math.max(1e-3, hi - lo)));
    return { W, H, r };
  }

  AFRAME.registerComponent('heightgrid-terrain', {
    schema: {
      src: { default: 'data/heightgrid.json' }, meta: { default: 'data/meta.json' },
      texture: { default: 'data/terrain_texture.jpg' },
      step: { type: 'int', default: 1 }, exaggerate: { type: 'number', default: 1 },
      tint: { default: '#f0b483' },          // warms the greyscale CTX mosaic to Mars colour
      detailRepeat: { type: 'int', default: 0 }, // optional bump grain; off: its ~50 m tiles showed as a repeating diamond pattern close up (lib/ground.js grain covers close-up)
      patches: { default: '' } },            // url of hirise_patches.json; '' = CTX only. Loaded after first render.
    init: function () {
      this.ready = false;
      const d = this.data;
      Promise.all([getJSON(d.src), getJSON(d.meta), getTexture(d.texture)])
        .then(([grid, meta, tex]) => this.build(grid, meta, tex))
        .catch((e) => {
          console.error('heightgrid-terrain:', e);
          this.el.emit('terrain-error', { message: String(e && e.message || e) });
        });
    },
    build: function (grid, meta, tex) {
      if (this.removed) { if (tex) tex.dispose(); return; }
      const d = this.data, step = Math.max(1, d.step);
      const m = makeModel(grid, meta, d.exaggerate);
      if (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        // never upload a texture bigger than this GPU allows (or 4096): an oversized one kills the WebGL context
        const max = Math.min(4096, this.el.sceneEl.renderer?.capabilities.maxTextureSize ?? 4096);
        const img = tex.image;
        if (img && Math.max(img.width, img.height) > max) {
          const k = max / Math.max(img.width, img.height), c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          tex.image = c;
        }
      }
      const opts = tex ? { roughness: 1, metalness: 0, map: tex, color: d.tint } : { roughness: 1, metalness: 0, color: '#b0623a' };
      if (d.detailRepeat > 0) { opts.bumpMap = detailTexture(d.detailRepeat); opts.bumpScale = 1.2; }
      this.material = new THREE.MeshStandardMaterial(opts);
      this.geometry = buildGeometry(grid, m, step, d.exaggerate);
      this.el.setObject3D('mesh', new THREE.Mesh(this.geometry, this.material));
      this.toWorld = m.toWorld;
      this.heightAt = m.heightAt;
      this.sizeM = { ew: (grid.w - 1) * m.ew, ns: (grid.h - 1) * m.ns };
      this.patches = [];
      this.roughnessAt = () => null;
      this.ready = true;
      this.el.emit('terrain-loaded', this);
      if (d.patches) this.loadPatches(d.patches, m);
    },
    // After the terrain is up: fetch the patch list and images, then recompile the terrain material once with them.
    loadPatches: function (url, m) {
      const r = this.el.sceneEl && this.el.sceneEl.renderer;
      if (r && r.capabilities.maxTextureSize < 4096) { console.info('heightgrid-terrain: GPU too small for HiRISE patches, CTX only'); return; }
      const listUrl = new URL(url, location.href);
      getJSON(listUrl.href).then((list) => {
        if (!Array.isArray(list)) throw new Error('hirise_patches.json is not a list');
        const ok = list.filter((p) => p && typeof p.file === 'string' && ['latMin', 'latMax', 'lonMin', 'lonMax'].every((k) => Number.isFinite(p[k])));
        // files are listed repo-relative ("data/x.jpg"); they sit next to the list, so resolve by file name
        return Promise.all(ok.map((p) => getTexture(new URL(p.file.split('/').pop(), listUrl).href).then((tex) => ({ p, tex }))));
      }).then((loaded) => {
        if (this.removed) { loaded.forEach((l) => l.tex && l.tex.dispose()); return; }
        const use = loaded.filter((l) => l.tex);
        if (!use.length) return;
        const mat = this.material, uniforms = {};
        this.patches = use.map(({ p, tex }, i) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          const nw = m.toWorld(p.latMax, p.lonMin), se = m.toWorld(p.latMin, p.lonMax);
          const b = { xMin: nw.x, zMin: nw.z, xMax: se.x, zMax: se.z };
          uniforms['uHP' + i] = { value: tex };
          uniforms['uHB' + i] = { value: new THREE.Vector4(b.xMin, b.zMin, b.xMax, b.zMax) };
          let rough = null;
          try { rough = roughnessMap(tex.image); } catch (e) { console.warn('heightgrid-terrain: roughness map unavailable', e); }
          return { id: p.id, name: p.name, source: p.source, box: b, tex, rough };
        });
        const { decl, body } = patchShader(this.patches.length);
        const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
        mat.onBeforeCompile = (sh, r) => {
          if (prev) prev.call(mat, sh, r);
          Object.assign(sh.uniforms, uniforms);
          sh.vertexShader = 'varying vec3 vHWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
            '#include <worldpos_vertex>\n  vHWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
          sh.fragmentShader = decl + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>' + body);
        };
        mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|hirise' + this.patches.length;
        mat.needsUpdate = true;
        this.roughnessAt = (x, z) => {
          for (const q of this.patches) {
            const u = (x - q.box.xMin) / (q.box.xMax - q.box.xMin), v = (z - q.box.zMin) / (q.box.zMax - q.box.zMin);
            if (u < 0 || u > 1 || v < 0 || v > 1 || !q.rough) continue;
            const R = q.rough, i = Math.min(R.W - 1, Math.floor(u * R.W)), j = Math.min(R.H - 1, Math.floor(v * R.H));
            return R.r[j * R.W + i];
          }
          return null;
        };
        this.el.emit('patches-loaded', this);
      }).catch((e) => console.warn('heightgrid-terrain: HiRISE patches unavailable, CTX only:', e && e.message || e));
    },
    remove: function () {
      this.removed = true;
      this.el.removeObject3D('mesh');
      if (this.geometry) this.geometry.dispose();
      if (this.material) { this.material.map?.dispose(); this.material.bumpMap?.dispose(); this.material.dispose(); }
      for (const p of this.patches || []) p.tex.dispose();
    }
  });
})();
