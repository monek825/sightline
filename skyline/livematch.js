// Written with AI assistance (Claude / GitHub Copilot)
// LIVE Horizon Match: simulate the skyline the astronaut sees at their true position and match it against horizons
// computed from NASA terrain around where they think they are. Pure (no DOM); runs in steps so the page stays smooth.
//
// Same method as scripts/skyline.py and scripts/skyline_dust.py, at browser speed:
//   * terrain: data/heightgrid40.json (CTX DTM resampled to 40 m), Mars curvature d²/2R, eye height from crew constants
//   * observed skyline = horizon at the TRUE position + Gaussian edge noise (0.15° clear air, 0.30° in dust)
//   * dust: terrain beyond the visibility is hidden; a direction whose highest visible point is in the outer 15% of the
//     visibility is not scored (that "edge" is dust fading out); every candidate is scored on the same directions
//   * search: 61 x 61 grid, 100 m step, centred on the dead-reckoning position (where the astronaut thinks they are),
//     heading known to ±10° (gyro re-set against the Sun; same assumption as the real-photo study), then a 20 m refine
//   * uncertainty = farthest grid cell with RMS <= best + 0.05° (min 50 m); self-check rule from skyline_dust.py:
//     claim a fix only if >= 30 scored directions, uncertainty <= 500 m and RMS <= 3 x edge noise.
// Simulated: no camera, no real photo. The truth is the app's own simulated position.

export const AZ_STEP = 2, NAZ = 180;
export const GRID_N = 61, GRID_STEP_M = 100, REFINE_N = 11, REFINE_STEP_M = 20;
export const HEADING_DEG = 10, UNC_MARGIN_DEG = 0.05, UNC_MIN_M = 50;
export const NOISE_CLEAR_DEG = 0.15, NOISE_DUST_DEG = 0.30, CLEAR_VIS_KM = 15, FADE_FRAC = 0.85;
export const RULE = { minScoredDirections: 30, maxUncertaintyM: 500, maxRmsOverNoise: 3 };
const R_MARS = 3396190;

// sample distances: dense near, sparser far (40 m to 2 km, 80 m to 6 km, 160 m to 15 km)
function distances(maxM) {
  const d = [];
  for (let x = 40; x <= Math.min(2000, maxM); x += 40) d.push(x);
  for (let x = 2080; x <= Math.min(6000, maxM); x += 80) d.push(x);
  for (let x = 6160; x <= Math.min(15000, maxM); x += 160) d.push(x);
  return Float64Array.from(d);
}

// seeded RNG (mulberry32) + Box-Muller, so the same situation gives the same result
function rng(seed) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, n: () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()) };
}
export const seedOf = (lat, lon) => (Math.round(lat * 1e5) * 73856093) ^ (Math.round(lon * 1e5) * 19349663);

/** Geometry of a height grid (row 0 = north) in metres. bounds = data/meta.json bounds. */
export function gridModel(grid, bounds) {
  const latMid = (bounds.latMin + bounds.latMax) / 2;
  const mPerDegLat = 2 * Math.PI * R_MARS / 360, mPerDegLon = mPerDegLat * Math.cos(latMid * Math.PI / 180);
  const ns = (bounds.latMax - bounds.latMin) / grid.h * mPerDegLat, ew = (bounds.lonMax - bounds.lonMin) / grid.w * mPerDegLon;
  return {
    grid, ns, ew, mPerDegLat, mPerDegLon,
    row: lat => (bounds.latMax - lat) / (bounds.latMax - bounds.latMin) * grid.h - 0.5,
    col: lon => (lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin) * grid.w - 0.5,
    lat: r => bounds.latMax - (r + 0.5) / grid.h * (bounds.latMax - bounds.latMin),
    lon: c => bounds.lonMin + (c + 0.5) / grid.w * (bounds.lonMax - bounds.lonMin)
  };
}

function makeRays(M, maxM) {
  const D = distances(maxM), nd = D.length;
  const dr = new Float32Array(NAZ * nd), dc = new Float32Array(NAZ * nd), curv = new Float64Array(nd);
  for (let k = 0; k < nd; k++) curv[k] = D[k] * D[k] / (2 * R_MARS);
  for (let a = 0; a < NAZ; a++) {
    const az = a * AZ_STEP * Math.PI / 180, ca = Math.cos(az), sa = Math.sin(az);
    for (let k = 0; k < nd; k++) { dr[a * nd + k] = -ca * D[k] / M.ns; dc[a * nd + k] = sa * D[k] / M.ew; }
  }
  return { D, nd, dr, dc, curv };
}

/** Horizon (deg) for an observer at fractional grid position (r0, c0); out[a], dist index of the max in outK[a]. */
function horizon(M, rays, r0, c0, eyeM, out, outK) {
  const { w, h, data } = M.grid, { nd, dr, dc, curv, D } = rays;
  const ri = Math.round(r0), ci = Math.round(c0);
  if (ri < 0 || ri >= h || ci < 0 || ci >= w) { out.fill(NaN); return; }
  const eye = data[ri * w + ci] + eyeM;
  for (let a = 0; a < NAZ; a++) {
    let best = -Infinity, bk = -1;
    const o = a * nd;
    for (let k = 0; k < nd; k++) {
      const rf = r0 + dr[o + k] + 0.5, cf = c0 + dc[o + k] + 0.5;      // nearest cell = floor(x + 0.5)
      if (rf < 0 || rf >= h || cf < 0 || cf >= w) continue;            // outside the DTM: contributes nothing
      const t = (data[(rf | 0) * w + (cf | 0)] - curv[k] - eye) / D[k]; // tan(elevation): atan once at the end
      if (t > best) { best = t; bk = k; }
    }
    out[a] = bk < 0 ? 0 : Math.atan(best) * 180 / Math.PI;
    if (outK) outK[a] = bk;
  }
}

/**
 * Generator: yields progress 0..1 between batches, returns the result (same shape as data/skyline/<site>.json).
 * @param {{grid, bounds, truth:{lat,lon}, prior:{lat,lon}, eyeM:number, visKm:number, seed?:number, name?:string}} o
 */
export function* liveMatchSteps(o) {
  const M = gridModel(o.grid, o.bounds);
  const dust = Number.isFinite(o.visKm) && o.visKm < CLEAR_VIS_KM;
  const visM = dust ? o.visKm * 1000 : 15000;
  const noise = dust ? NOISE_DUST_DEG : NOISE_CLEAR_DEG;
  const rays = makeRays(M, visM);
  const g = rng(o.seed ?? seedOf(o.truth.lat, o.truth.lon));

  // observed: true horizon + noise; directions whose top is the dust fade are not scored
  const tr = M.row(o.truth.lat), tc = M.col(o.truth.lon);
  const trueH = new Float32Array(NAZ), trueK = new Int32Array(NAZ);
  horizon(M, rays, tr, tc, o.eyeM, trueH, trueK);
  const obs = new Float32Array(NAZ), use = [];
  for (let a = 0; a < NAZ; a++) {
    obs[a] = trueH[a] + noise * g.n();
    if (!dust || (trueK[a] >= 0 && rays.D[trueK[a]] < FADE_FRAC * visM)) use.push(a);
  }

  // candidates on the coarse grid around the prior (row 0 = north, col 0 = west)
  const n = GRID_N, half = (n - 1) / 2;
  const pr = M.row(o.prior.lat), pc = M.col(o.prior.lon);
  const cand = new Float32Array(n * n * NAZ), tmp = new Float32Array(NAZ);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      horizon(M, rays, pr + (i - half) * GRID_STEP_M / M.ns, pc + (j - half) * GRID_STEP_M / M.ew, o.eyeM, tmp, null);
      cand.set(tmp, (i * n + j) * NAZ);
    }
    yield 0.8 * (i + 1) / n;              // one grid row (~61 horizons) per step keeps frames short
  }
  const shifts = [];
  for (let s = -HEADING_DEG / AZ_STEP; s <= HEADING_DEG / AZ_STEP; s++) shifts.push(s);
  const score = (H, off) => {   // RMS over the scored directions, best heading shift
    let best = Infinity, bs = 0;
    for (const s of shifts) {
      let sum = 0;
      for (const a of use) { const v = H[off + ((a + s + NAZ) % NAZ)] - obs[a]; sum += v * v; }
      const r = Math.sqrt(sum / use.length);
      if (r < best) { best = r; bs = s; }
    }
    return [best, bs];
  };
  const rms = new Float32Array(n * n);
  let bi = 0, bestR = Infinity, bestS = 0;
  for (let k = 0; k < n * n; k++) {
    const [r, s] = use.length ? score(cand, k * NAZ) : [Infinity, 0];
    rms[k] = r;
    if (r < bestR) { bestR = r; bi = k; bestS = s; }
  }
  yield 0.85;
  const bI = Math.floor(bi / n), bJ = bi % n;
  let unc = UNC_MIN_M;
  for (let k = 0; k < n * n; k++) {
    if (rms[k] <= bestR + UNC_MARGIN_DEG) {
      const d = Math.hypot(Math.floor(k / n) - bI, k % n - bJ) * GRID_STEP_M;
      if (d > unc) unc = d;
    }
  }
  // refine: 11 x 11 at 20 m around the best coarse cell
  let fr = pr + (bI - half) * GRID_STEP_M / M.ns, fc = pc + (bJ - half) * GRID_STEP_M / M.ew, fR = bestR, fS = bestS;
  const best = new Float32Array(NAZ);
  horizon(M, rays, fr, fc, o.eyeM, best, null);
  const rh = (REFINE_N - 1) / 2;
  const c0r = fr, c0c = fc;
  for (let i = -rh; i <= rh; i++) for (let j = -rh; j <= rh; j++) {
    if (!i && !j) continue;
    const rr = c0r + i * REFINE_STEP_M / M.ns, cc = c0c + j * REFINE_STEP_M / M.ew;
    horizon(M, rays, rr, cc, o.eyeM, tmp, null);
    const [r, s] = use.length ? score(tmp, 0) : [Infinity, 0];
    if (r < fR) { fR = r; fS = s; fr = rr; fc = cc; best.set(tmp); }
  }
  yield 0.95;

  const est = { lat: M.lat(fr), lon: M.lon(fc) };
  const errorM = Math.hypot((est.lat - o.truth.lat) * M.mPerDegLat, (est.lon - o.truth.lon) * M.mPerDegLon);
  const fix = use.length >= RULE.minScoredDirections && unc <= RULE.maxUncertaintyM && fR <= RULE.maxRmsOverNoise * noise;
  const r3 = v => Math.round(v * 1000) / 1000;
  // best profile in the observer's frame (shifted by the matched heading) for the chart
  const bestProf = Array.from({ length: NAZ }, (_, a) => r3(best[(a + fS + NAZ) % NAZ]));
  return {
    site: 'live', name: o.name || 'your position', live: true,
    truth: { lat: o.truth.lat, lon: o.truth.lon }, prior: { lat: o.prior.lat, lon: o.prior.lon },
    estimate: est, errorM: Math.round(errorM), uncertaintyM: Math.round(unc), headingShiftDeg: fS * AZ_STEP,
    fix, scored: use.length, minRmsDeg: r3(fR), noiseDeg: noise, visKm: dust ? o.visKm : null,
    fovDeg: 360, azStepDeg: AZ_STEP,
    observed: Array.from(obs, r3), best: bestProf,
    grid: { centerLat: o.prior.lat, centerLon: o.prior.lon, stepM: GRID_STEP_M, n, rmsDeg: Array.from(rms, v => (Number.isFinite(v) ? r3(v) : 99)) },
    fov96: null,
    method: 'Simulated skyline at your position from the NASA CTX DTM (40 m grid) + camera noise, matched live; not a real photo.'
  };
}

/** Run the generator to completion synchronously (tests, Node). */
export function liveMatch(o) {
  const it = liveMatchSteps(o);
  for (;;) { const s = it.next(); if (s.done) return s.value; }
}

/** Where the astronaut THINKS they are: the true position plus a dead-reckoning error inside the uncertainty circle. */
export function deadReckoningPrior(truth, uncertaintyM, seed) {
  const g = rng(seed ^ 0x5bd1e995);
  const d = uncertaintyM * (0.3 + 0.7 * g.u()), a = 2 * Math.PI * g.u();
  const mLat = 2 * Math.PI * R_MARS / 360, mLon = mLat * Math.cos(truth.lat * Math.PI / 180);
  return { lat: truth.lat + d * Math.cos(a) / mLat, lon: truth.lon + d * Math.sin(a) / mLon, offsetM: d };
}
