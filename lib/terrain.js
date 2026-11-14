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
    return { ns, ew, h0, hY, heightAt, toWorld };
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

  AFRAME.registerComponent('heightgrid-terrain', {
    schema: {
      src: { default: 'data/heightgrid.json' }, meta: { default: 'data/meta.json' },
      texture: { default: 'data/terrain_texture.jpg' },
      step: { type: 'int', default: 1 }, exaggerate: { type: 'number', default: 1 },
      tint: { default: '#f0b483' },          // warms the greyscale CTX mosaic to Mars colour
      detailRepeat: { type: 'int', default: 600 } }, // bump grain tiles across the crater (~50 m per tile); 0 = off
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
      if (tex) tex.colorSpace = THREE.SRGBColorSpace;
      const opts = tex ? { roughness: 1, metalness: 0, map: tex, color: d.tint } : { roughness: 1, metalness: 0, color: '#b0623a' };
      if (d.detailRepeat > 0) { opts.bumpMap = detailTexture(d.detailRepeat); opts.bumpScale = 1.2; }
      this.material = new THREE.MeshStandardMaterial(opts);
      this.geometry = buildGeometry(grid, m, step, d.exaggerate);
      this.el.setObject3D('mesh', new THREE.Mesh(this.geometry, this.material));
      this.toWorld = m.toWorld;
      this.heightAt = m.heightAt;
      this.sizeM = { ew: (grid.w - 1) * m.ew, ns: (grid.h - 1) * m.ns };
      this.ready = true;
      this.el.emit('terrain-loaded', this);
    },
    remove: function () {
      this.removed = true;
      this.el.removeObject3D('mesh');
      if (this.geometry) this.geometry.dispose();
      if (this.material) { this.material.map?.dispose(); this.material.bumpMap?.dispose(); this.material.dispose(); }
    }
  });
})();
