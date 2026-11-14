// Written with AI assistance (Claude)
// Classic script: close-up ground realism shared by the helmet view and the main 3D view. Visual only, no science.
//   SightlineGround.detail(THREE)                 -> { tex, sandAt(x, z) }   one tileable 512 px procedural texture
//   SightlineGround.patchTerrain(THREE, mat, det, { near, far }) -> uniforms   world-space grain, sand ripples, sand/rock patches
//   SightlineGround.rocks(THREE, heightAt, det, layers) -> { group, update(cx, cz, fwdX, fwdZ, camH) }
// The 20 m DTM and the 6 m/px orbital image cannot show anything smaller than a few metres; this layer fills
// in what an astronaut would see at their feet. Rocks avoid the sand patches the shader draws (same texture).
(function () {
  const N = 512;
  // UV scales (1/m) and offsets used by both the shader and sandAt(): keep the two in step.
  const S_A = 0.31, S_B = 0.043, S_C = 0.0061, O_B = 0.31, O_C = 0.67;

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
    tex.flipY = false;                       // row 0 = v 0, so sandAt() below reads the same texel as the shader
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 8;
    const at = (arr, u, v) => {               // bilinear, wrapped; u,v in texture units
      const x = (u - Math.floor(u)) * N - 0.5, y = (v - Math.floor(v)) * N - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const i0 = (x0 + N) % N, i1 = (x0 + 1 + N) % N, j0 = (y0 + N) % N, j1 = (y0 + 1 + N) % N;
      return (arr[j0 * N + i0] * (1 - fx) + arr[j0 * N + i1] * fx) * (1 - fy) + (arr[j1 * N + i0] * (1 - fx) + arr[j1 * N + i1] * fx) * fy;
    };
    const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    // 0 = rocky ground, 1 = sand patch (same formula as the shader)
    const sandAt = (x, z) => smooth(0.44, 0.6, at(big, x * S_C + O_C, z * S_C + O_C) * 0.75 + at(mid, x * S_B + O_B, z * S_B + O_B) * 0.25);
    cached = { tex, sandAt };
    return cached;
  }

  // Patch a MeshStandardMaterial (the terrain) with world-space detail. Returns the uniforms; set uGCam each frame.
  function patchTerrain(THREE, mat, det, opt) {
    const u = {
      uGDetail: { value: det.tex },
      uGCam: { value: new THREE.Vector3() },
      uGNear: { value: (opt && opt.near) || 40 },
      uGFar: { value: (opt && opt.far) || 400 }
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'varying vec3 vGWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform sampler2D uGDetail; uniform vec3 uGCam; uniform float uGNear; uniform float uGFar;\nvarying vec3 vGWorld;\n' +
        sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec2 wp = vGWorld.xz;
    float nearF = 1.0 - smoothstep(uGNear, uGFar, length(wp - uGCam.xz));
    vec4 tA = texture2D(uGDetail, wp * ${S_A});
    vec4 tB = texture2D(uGDetail, wp * ${S_B} + ${O_B});
    vec4 tC = texture2D(uGDetail, wp * ${S_C} + ${O_C});
    float sand = smoothstep(0.44, 0.6, tC.b * 0.75 + tB.g * 0.25);
    float grain = (tA.r - 0.5) * 2.0;
    // wind ripples on the sand: ~0.7 m crests, wobbled by the mid noise
    float rip = 0.5 + 0.5 * sin(dot(wp, vec2(0.8, 0.6)) * 9.0 + (tB.g - 0.5) * 16.0);
    vec3 rocky = vec3(0.80, 0.72, 0.67) * (1.0 + 0.42 * grain) * (0.84 + 0.32 * tB.r);
    vec3 sandy = vec3(1.16, 0.97, 0.80) * (1.0 + 0.12 * grain) * (0.93 + 0.13 * rip * nearF);
    vec3 farC = mix(vec3(0.86, 0.80, 0.76) * (0.9 + 0.2 * tB.r), vec3(1.12, 0.96, 0.81), sand);
    diffuseColor.rgb *= mix(farC, mix(rocky, sandy, sand), nearF);
  }`);
    };
    mat.customProgramCacheKey = () => 'sightline-ground';
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

  // layers: [{ count, radius, cell, min, max, rescatter, detail, color, cast, sandAvoid, maxCamH, salt, flat }]
  function rocks(THREE, heightAt, det, layers) {
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
        let dens = 0.15 + 1.85 * smooth01(0.25, 0.8, clump(mx, mz, c.clumpM || 30, s));
        if (c.sandAvoid) dens *= 1 - c.sandAvoid * det.sandAt(mx, mz);
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
        const on = !(l.cfg.maxCamH && camH > l.cfg.maxCamH);
        if (l.mesh.visible !== on) { l.mesh.visible = on; changed = true; }
        if (!on) continue;
        const ax = cx + (fx || 0) / fl * l.cfg.radius * 0.45, az = cz + (fz || 0) / fl * l.cfg.radius * 0.45;
        if (Math.hypot(ax - l.cx, az - l.cz) > l.cfg.rescatter) { scatter(l, ax, az); changed = true; }
      }
      return changed;
    }
    return { group, update, layers: L };
  }

  window.SightlineGround = { detail, patchTerrain, rocks, hash01 };
})();
