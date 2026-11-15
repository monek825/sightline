// Written with AI assistance (Claude / GitHub Copilot)
// Loads every data file once: real file first, mock as fallback.
// Records status per file ('real' | 'mock' | 'missing') so the UI can show a MOCK DATA badge.
// Validates contracts from ARCHITECTURE.md §7 at the boundary.

import { distM, bearingDeg, toLatLon } from './geo.js';

const MOCK_DIR = 'map/mock/';

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json(); // throws on NaN / invalid JSON — that's the point
}

async function loadWithFallback(name, realPath, mockPath, validate, status, warnings) {
  try {
    const v = await fetchJSON(realPath);
    validate(v);
    status[name] = 'real';
    return v;
  } catch (err) {
    if (!String(err.message).includes('HTTP 404')) warnings.push(`${realPath}: ${err.message}`);
  }
  if (!mockPath) { status[name] = 'missing'; return null; }
  const v = await fetchJSON(mockPath);
  validate(v);
  status[name] = 'mock';
  return v;
}

function inside(b, p) {
  return p.lat >= b.latMin && p.lat <= b.latMax && p.lon >= b.lonMin && p.lon <= b.lonMax;
}

const v = {
  meta(m) {
    const b = m?.bounds;
    if (!b || !['latMin', 'latMax', 'lonMin', 'lonMax'].every(k => Number.isFinite(b[k]))) throw new Error('meta.bounds invalid');
    if (!m.home || !inside(b, m.home)) throw new Error('meta.home outside bounds');
  },
  grid(g) {
    if (!Number.isInteger(g?.w) || !Number.isInteger(g?.h) || g.data?.length !== g.w * g.h) throw new Error('heightgrid: data length != w*h');
    if (!g.data.every(Number.isFinite)) throw new Error('heightgrid: non-finite values');
  },
  list(rows) { if (!Array.isArray(rows)) throw new Error('expected an array'); },
  scenario(s) {
    const t = (s?.events || []).map(e => e.tMin);
    if (t.some((x, i) => i && x < t[i - 1])) throw new Error('scenario events not sorted');
  }
};

// Synthetic grid so the app runs before scripts/make_grid.py has been run. Clearly marked mock.
function mockGrid() {
  const w = 399, h = 378, data = new Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const x = c / w, y = r / h;
    const bowl = 400 * ((x - 0.55) ** 2 + (y - 0.5) ** 2);
    const hills = 60 * Math.sin(x * 23) * Math.cos(y * 17) + 30 * Math.sin(x * 51 + y * 37);
    data[r * w + c] = Math.round((-2600 + bowl * 4 + hills) * 10) / 10;
  }
  let min = Infinity, max = -Infinity;
  for (const x of data) { if (x < min) min = x; if (x > max) max = x; } // no spread: 150k args overflow the stack
  return { w, h, cellM: 80, min, max, data, mock: true };
}

// Synthetic viewshed: visible inside an irregular radius around the landmark. Clearly marked mock.
function mockViewshed(grid, b, lm, seed) {
  const out = new Uint8Array(grid.w * grid.h);
  const base = lm.kind === 'habitat' ? 2500 : 6000;
  for (let r = 0; r < grid.h; r++) for (let c = 0; c < grid.w; c++) {
    const p = toLatLon(grid, b, r, c);
    const d = distM(lm.lat, lm.lon, p.lat, p.lon);
    const a = bearingDeg(lm.lat, lm.lon, p.lat, p.lon) * Math.PI / 180;
    const reach = base * (0.55 + 0.45 * Math.sin(3 * a + seed) * Math.cos(5 * a - seed));
    out[r * grid.w + c] = d < Math.max(reach, 300) ? 1 : 0;
  }
  return out;
}

function loadPNGMask(url, w, h) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth !== w || img.naturalHeight !== h) {
        reject(new Error(`${url} is ${img.naturalWidth}x${img.naturalHeight}, grid is ${w}x${h}`));
        return;
      }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, w, h).data;
      const out = new Uint8Array(w * h);
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4] > 127 ? 1 : 0;
      resolve(out);
    };
    img.onerror = () => reject(new Error(`${url}: not found`));
    img.src = url;
  });
}

function imageExists(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export async function loadAll() {
  const status = {}, warnings = [];
  const L = (name, file, mock, val) => loadWithFallback(name, `data/${file}`, mock && MOCK_DIR + mock, val, status, warnings);

  const [meta, gridReal, landmarks, targets, traverse, constantsRows, scenario] = await Promise.all([
    L('meta', 'meta.json', 'meta.mock.json', v.meta),
    L('heightgrid', 'heightgrid.json', null, v.grid),
    L('landmarks', 'landmarks.json', 'landmarks.mock.json', v.list),
    L('targets', 'targets.json', 'targets.mock.json', v.list),
    L('traverse', 'traverse.json', 'traverse.mock.json', v.list),
    L('crew_constants', 'crew_constants.json', null, v.list),
    L('scenario', 'scenario_demo.json', 'scenario.mock.json', v.scenario)
  ]);
  if (!meta) throw new Error('meta.json could not be loaded');
  if (!constantsRows) throw new Error('data/crew_constants.json could not be loaded');

  let grid = gridReal;
  if (!grid) { grid = mockGrid(); status.heightgrid = 'mock'; }

  const b = meta.bounds;
  const dropOutside = (name, rows) => (rows || []).filter(p => {
    const ok = inside(b, p);
    if (!ok) warnings.push(`${name}: point outside bounds dropped (lat/lon swapped?)`);
    return ok;
  });
  const lms = dropOutside('landmarks', landmarks);
  if (!lms.some(l => l.id === 'home')) lms.unshift({ ...meta.home, kind: 'habitat' });

  const viewsheds = {};
  let vsMock = 0;
  for (const [i, lm] of lms.entries()) {
    try {
      viewsheds[lm.id] = await loadPNGMask(`data/viewsheds/${encodeURIComponent(lm.id)}.png`, grid.w, grid.h);
    } catch (err) {
      if (!err.message.endsWith('not found')) warnings.push(err.message);
      viewsheds[lm.id] = mockViewshed(grid, b, lm, i * 1.7);
      vsMock++;
    }
  }
  status.viewsheds = vsMock === 0 ? 'real' : 'mock';

  // optional: steepest 40 m slope per 80 m cell (scripts/make_slope80.mjs); the planner refuses cells steeper than the
  // day's limit. Missing file = old behaviour (80 m average slope only), with a warning.
  const slopeMax = await fetch('data/slope80.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  const slopeOk = slopeMax && slopeMax.w === grid.w && slopeMax.h === grid.h && slopeMax.data?.length === grid.w * grid.h;
  status.slope80 = slopeOk ? 'real' : 'missing';
  if (!slopeOk) warnings.push('slope80.json missing: routes check slope on 80 m cells only');

  const hasBasemap = await imageExists('data/basemap.png');
  status.basemap = hasBasemap ? 'real' : 'missing';

  const C = Object.fromEntries(constantsRows.map(r => [r.key, r.value]));
  const constantsByKey = Object.fromEntries(constantsRows.map(r => [r.key, r]));

  return Object.freeze({
    meta, grid, bounds: b,
    landmarks: lms, targets: dropOutside('targets', targets), traverse: dropOutside('traverse', traverse),
    constantsRows, constantsByKey, C, scenario, viewsheds, hasBasemap, slopeMax: slopeOk ? Float32Array.from(slopeMax.data) : null,
    status, warnings
  });
}

// Fail loudly if the model needs a constant that the data file lacks.
export function assertKeys(C, keys, who) {
  const missing = keys.filter(k => !(k in C));
  if (missing.length) throw new Error(`${who}: missing constants ${missing.join(', ')}`);
}
