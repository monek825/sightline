// Written with AI assistance (Claude / GitHub Copilot)
// Classic script: close-up ground realism shared by the helmet view and the main 3D view. Visual only, no science.
//   SightlineGround.detail(THREE)                 -> { tex }   one tileable 512 px procedural noise texture
//   SightlineGround.patchTerrain(THREE, mat, det, { near, far }) -> uniforms   sub-metre grain near the camera
//   SightlineGround.rocks(THREE, heightAt, det, layers, densityAt?) -> { group, update(cx, cz, fwdX, fwdZ, camH), reset() }
// Where the ground comes from: the orbital images (CTX ~5 m/px everywhere, HiRISE ~0.7 m/px near home and Three Forks,
// lib/terrain.js). Everything larger than a pixel of those images is real data. This file only adds what they
// cannot resolve: grain under a metre, and rocks. Rock density follows the HiRISE image where there is one
// (densityAt: rough, broken ground -> more rocks); elsewhere it is illustrative clumping.
(function () {
  const N = 512;
  const S_A = 0.31;            // grain UV scale (1/m): one tile = ~3.2 m, features a few cm to ~20 cm

  // integer hash -> [0,1)
  function hash01(ix, iz, salt) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // tileable fbm on an N x N grid; cells = lattice cells per tile for the first octave
  function fbm(cells, octaves, seed) {
    const out = new Float32Array(N * N);
    let amp = 0.5, total = 0;
    for (let o = 0; o < octaves; o++, cells *= 2, amp *= 0.5) {
      total += amp;
      const k = N / cells;
      for (let y = 0; y < N; y++) {
        const gy = y / k, y0 = Math.floor(gy), fy = gy - y0, v = fy * fy * (3 - 2 * fy);
        for (let x = 0; x < N; x++) {
          const gx = x / k, x0 = Math.floor(gx), fx = gx - x0, u = fx * fx * (3 - 2 * fx);
          const a = hash01(x0 % cells, y0 % cells, seed + o), b = hash01((x0 + 1) % cells, y0 % cells, seed + o);
          const c = hash01(x0 % cells, (y0 + 1) % cells, seed + o), d = hash01((x0 + 1) % cells, (y0 + 1) % cells, seed + o);
          out[y * N + x] += amp * ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v);
        }
      }
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }

  let cached = null;
  function detail(THREE) {
    if (cached) return cached;
    const fine = fbm(32, 3, 11), mid = fbm(4, 4, 23), big = fbm(2, 4, 37);
    // pebbles in the fine channel: small dark/light spots (a few px = a few cm at the grain scale)
    for (let s = 0; s < 2600; s++) {
      const cx = hash01(s, 1, 51) * N, cy = hash01(s, 2, 51) * N, r = 1 + 3.5 * hash01(s, 3, 51) ** 2;
      const shade = hash01(s, 4, 51) < 0.7 ? -0.28 : 0.22;
      for (let dy = -Math.ceil(r); dy <= r; dy++) for (let dx = -Math.ceil(r); dx <= r; dx++) {
        const q = 1 - (dx * dx + dy * dy) / (r * r);
        if (q <= 0) continue;
        const x = ((Math.round(cx) + dx) % N + N) % N, y = ((Math.round(cy) + dy) % N + N) % N;
        fine[y * N + x] += shade * Math.min(1, q * 2);
      }
    }
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      img.data[i * 4] = Math.max(0, Math.min(255, Math.round(fine[i] * 255)));
      img.data[i * 4 + 1] = Math.round(mid[i] * 255);
      img.data[i * 4 + 2] = Math.round(big[i] * 255);
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 8;
    cached = { tex };                         // .g / .b channels are also used by the helmet's dust veil
    return cached;
  }

  // Patch a MeshStandardMaterial (terrain or HiRISE patch) with sub-metre grain near the camera, in world space.
  // It only modulates brightness by a few % around 1.0: the orbital image underneath keeps every real feature.
  // Returns the uniforms; set uGCam each frame. Several materials may share one uniforms object (opt.uniforms).
  function patchTerrain(THREE, mat, det, opt) {
    const u = (opt && opt.uniforms) || {
      uGDetail: { value: det.tex },
      uGCam: { value: new THREE.Vector3() },
      uGNear: { value: (opt && opt.near) || 40 },
      uGFar: { value: (opt && opt.far) || 400 }
    };
    // chained with any other onBeforeCompile (lib/terrain.js adds the HiRISE patches at map_fragment); the grain goes
    // after color_fragment, i.e. after the image (CTX or HiRISE) has been chosen, so it applies to both
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'varying vec3 vGWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform sampler2D uGDetail; uniform vec3 uGCam; uniform float uGNear; uniform float uGFar;\nvarying vec3 vGWorld;\n' +
        sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec2 wp = vGWorld.xz;
    float nearF = 1.0 - smoothstep(uGNear, uGFar, length(wp - uGCam.xz));
    float grain = (texture2D(uGDetail, wp * ${S_A}).r - 0.5) * 2.0;   // -1..1, mean ~0: no net brightness change
    diffuseColor.rgb *= 1.0 + 0.3 * grain * nearF;
  }`);
    };
    mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|ground';
    mat.needsUpdate = true;
    if (mat.map) mat.map.anisotropy = 8;
    return u;
  }

  // ---------- rocks ----------
  function rockGeometry(THREE, detailLevel, seed, flatBottom) {
    const g = new THREE.IcosahedronGeometry(1, detailLevel);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // displacement depends only on the vertex position, so shared corners stay welded
      const h = hash01(Math.round(x * 1000), Math.round(y * 1000) * 7 + Math.round(z * 1000), seed);
      const k = 0.78 + 0.32 * h + 0.14 * Math.sin(3.1 * x + seed) * Math.sin(2.3 * z + 1.7 * y);
      x *= k; y *= k; z *= k;
      if (flatBottom && y < -0.25) y = -0.25 + (y + 0.25) * 0.25;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  }
  function smooth01(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
  // smooth value noise for clumping (rocks come in fields, not evenly)
  function clump(x, z, scale, salt) {
    const gx = x / scale, gz = z / scale, x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash01(x0, z0, salt), b = hash01(x0 + 1, z0, salt), c = hash01(x0, z0 + 1, salt), d = hash01(x0 + 1, z0 + 1, salt);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  // layers: [{ count, radius, cell, min, max, rescatter, detail, color, cast, clumpM, maxCamH, clearHome, salt, flat }]
  // densityAt(x, z) -> 0..1 (how rocky the HiRISE image says the ground is) or null where there is no HiRISE patch.
  // It can be set later with setDensity() (the patches load after the terrain); that forces a re-scatter.
  function rocks(THREE, heightAt, det, layers, densityAt) {
    let dataAt = densityAt || null;
    const group = new THREE.Group();
    const o = new THREE.Object3D(), col = new THREE.Color();
    const L = layers.map((cfg, li) => {
      const mat = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.95, metalness: 0, flatShading: true });
      const cap = Math.ceil(cfg.count * 1.6);
      const mesh = new THREE.InstancedMesh(rockGeometry(THREE, cfg.detail, 7 + li * 13, cfg.flat !== false), mat, cap);
      mesh.frustumCulled = false;          // instances move on re-scatter
      mesh.count = 0;
      mesh.castShadow = !!cfg.cast; mesh.receiveShadow = true;
      mesh.setColorAt(0, col.setRGB(1, 1, 1));
      group.add(mesh);
      return { cfg, mesh, cx: 1e9, cz: 1e9, salt: cfg.salt || (100 + li * 1000) };
    });
    function scatter(l, cx, cz) {
      const c = l.cfg, R = c.radius, cell = c.cell, cap = l.mesh.instanceMatrix.count, s = l.salt;
      l.cx = cx; l.cz = cz;
      const perCell = c.count / (Math.PI * R * R / (cell * cell));
      const i0 = Math.floor((cx - R) / cell), i1 = Math.floor((cx + R) / cell), j0 = Math.floor((cz - R) / cell), j1 = Math.floor((cz + R) / cell);
      let n = 0;
      for (let j = j0; j <= j1 && n < cap; j++) for (let i = i0; i <= i1 && n < cap; i++) {
        const mx = (i + 0.5) * cell, mz = (j + 0.5) * cell;
        if ((mx - cx) ** 2 + (mz - cz) ** 2 > (R + cell) ** 2) continue;
        // inside a HiRISE patch the image decides (smooth sand -> few, broken rock -> many); elsewhere illustrative clumps
        const dv = dataAt ? dataAt(mx, mz) : null;
        const dens = dv != null ? 0.08 + 1.92 * dv : 0.15 + 1.85 * smooth01(0.25, 0.8, clump(mx, mz, c.clumpM || 30, s));
        const k = Math.floor(perCell * dens + hash01(i, j, s + 1));
        for (let q = 0; q < k && n < cap; q++) {
          const b = s + 10 + q * 11;
          const x = (i + hash01(i, j, b)) * cell, z = (j + hash01(i, j, b + 1)) * cell;
          const d = Math.hypot(x - cx, z - cz);
          if (d > R) continue;
          if (c.clearHome && x * x + z * z < c.clearHome * c.clearHome) continue;
          const u = hash01(i, j, b + 2);
          let sz = c.min + (c.max - c.min) * u * u * u;          // many small, few big
          sz *= smooth01(R, R * 0.78, d);                        // shrink in at the edge so re-scatter does not pop
          if (sz < c.min * 0.3) continue;
          const sq = hash01(i, j, b + 3), sq2 = hash01(i, j, b + 4);
          const sy = sz * (0.4 + 0.45 * sq);
          const g = heightAt(x, z);
          o.position.set(x, (Number.isFinite(g) ? g : 0) + sy * 0.12, z);   // bottom sunk into the regolith
          o.rotation.set((hash01(i, j, b + 5) - 0.5) * 0.5, hash01(i, j, b + 6) * 6.283, (hash01(i, j, b + 7) - 0.5) * 0.5);
          o.scale.set(sz * (0.75 + 0.6 * sq2), sy, sz * (0.75 + 0.6 * (1 - sq)));
          o.updateMatrix();
          l.mesh.setMatrixAt(n, o.matrix);
          const v = 0.62 + 0.55 * hash01(i, j, b + 8), grey = hash01(i, j, b + 9) < 0.3 ? 0.9 : 1;
          l.mesh.setColorAt(n, col.setRGB(v, v * (grey > 0.95 ? 0.97 : 0.99), v * (grey > 0.95 ? 0.93 : 1.02)));
          n++;
        }
      }
      l.mesh.count = n;
      l.mesh.instanceMatrix.needsUpdate = true;
      if (l.mesh.instanceColor) l.mesh.instanceColor.needsUpdate = true;
    }
    // centre each layer a little ahead of the view (half its radius), so more of it is in front of you
    function update(cx, cz, fx, fz, camH) {
      let changed = false;
      const fl = Math.hypot(fx || 0, fz || 0) || 1;
      for (const l of L) {
        const on = !l.off && !(l.cfg.maxCamH && camH > l.cfg.maxCamH); // l.off: caller hides the layer (quality / moving fast)
        if (l.mesh.visible !== on) { l.mesh.visible = on; changed = true; }
        if (!on) continue;
        const ax = cx + (fx || 0) / fl * l.cfg.radius * 0.45, az = cz + (fz || 0) / fl * l.cfg.radius * 0.45;
        if (Math.hypot(ax - l.cx, az - l.cz) > l.cfg.rescatter) { scatter(l, ax, az); changed = true; }
      }
      return changed;
    }
    function reset() { for (const l of L) { l.cx = 1e9; l.cz = 1e9; } }
    function setDensity(fn) { dataAt = fn || null; reset(); }
    return { group, update, reset, setDensity, layers: L };
  }

  window.SightlineGround = { detail, patchTerrain, rocks, hash01 };
})();
