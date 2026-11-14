// Written with AI assistance (Claude / GitHub Copilot)
// Writes data/route_demo.json: the scripted demo's outbound leg (scenario start -> scenario target, 'safest'),
// planned with the real height grid and real viewsheds, exactly like map/scenario.js prepareScenario().
// Run from the repo root: node route/make_route_demo.mjs

import fs from 'node:fs';
import zlib from 'node:zlib';
import { computeLimits } from '../crew/budget.js';
import { planRoute } from './route.js';
import { initVisibility, visibilityArrays } from '../map/visibility.js';
import { DEFAULT_INPUTS } from '../lib/store.js';

const rd = f => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));

// Minimal 8-bit grayscale PNG decoder (viewsheds are 8-bit gray): value > 127 -> 1, as loadPNGMask does.
function loadMask(file) {
  const b = fs.readFileSync(new URL(`../data/viewsheds/${file}.png`, import.meta.url));
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  if (b[24] !== 8 || b[25] !== 0 || b[28] !== 0) throw new Error(`${file}.png: expected 8-bit grayscale non-interlaced`);
  const idat = []; let o = 8;
  while (o < b.length) { const n = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8); if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n)); o += 12 + n; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h), prev = new Uint8Array(w), row = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)];
    for (let x = 0; x < w; x++) {
      const v = raw[y * (w + 1) + 1 + x], a = x ? row[x - 1] : 0, u = prev[x], c = x ? prev[x - 1] : 0;
      const p = a + u - c, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c);
      row[x] = (v + [0, a, u, (a + u) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? u : c][f]) & 255;
    }
    prev.set(row); for (let x = 0; x < w; x++) out[y * w + x] = row[x] > 127 ? 1 : 0;
  }
  return out;
}

const meta = rd('meta.json'), grid = rd('heightgrid.json'), scenario = rd('scenario_demo.json'), targets = rd('targets.json');
const C = Object.fromEntries(rd('crew_constants.json').map(r => [r.key, r.value]));
const landmarks = rd('landmarks.json');
if (!landmarks.some(l => l.id === 'home')) landmarks.unshift({ ...meta.home, kind: 'habitat' });
const viewsheds = Object.fromEntries(landmarks.map(l => [l.id, loadMask(l.id)]));
initVisibility(viewsheds, landmarks, grid, meta.bounds);

// same derivation as prepareScenario()
const start = scenario.start || meta.home;
const target = targets.find(t => t.id === scenario.target);
if (!target) throw new Error(`scenario target "${scenario.target}" not found in targets.json`);
const base = { ...DEFAULT_INPUTS, sol: scenario.sol, astronaut: { ...start, headingDeg: 0 } };
const lim = computeLimits(base, C);
const vis = visibilityArrays(Math.max(1, Math.round(lim.visibilityKm)));
const r = planRoute(grid, meta.bounds, vis, start, target, { mode: 'safest', maxSlopeDeg: lim.maxSlopeDeg, speedKmh: lim.speedKmh });
if (!r.ok) throw new Error('route failed: ' + r.reason);

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const out = {
  ok: r.ok, reason: r.reason, mode: r.mode,
  points: r.points.map(([la, lo]) => [round(la, 6), round(lo, 6)]),
  lengthKm: round(r.lengthKm, 3), etaMin: round(r.etaMin, 1), maxSlopeDeg: round(r.maxSlopeDeg, 1),
  blindFraction: round(r.blindFraction, 3), homeHiddenFraction: round(r.homeHiddenFraction, 3),
  from: meta.home.id, to: scenario.target,
  generatedBy: 'route/make_route_demo.mjs'
};
fs.writeFileSync(new URL('../data/route_demo.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote data/route_demo.json: ${out.points.length} points, ${out.lengthKm} km, ${out.etaMin} min, blind ${out.blindFraction}, homeHidden ${out.homeHiddenFraction}`);
