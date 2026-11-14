// Written with AI assistance (Claude / GitHub Copilot)
// Demo integrity test. Run from repo root: node scripts/test_demo.mjs  (exit 0 healthy, 1 on any failure)
// Runs the real pipeline + real store headless over the whole demo scenario, like map/app.js does.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { computeLimits, computeBudget } from '../crew/budget.js';
import { planRoute } from '../route/route.js';
import { initVisibility, visibilityArrays } from '../map/visibility.js';
import { createPipeline } from '../lib/pipeline.js';
import { initStore, setInputs, getStore } from '../lib/store.js';
import { prepareScenario, stateAt } from '../map/scenario.js';

const MAX_DERIVE_MS = 50;
const STATUSES = ['GREEN', 'AMBER', 'RED'];
const HEADLINES = ['GO', 'CAUTION', 'RETURN NOW', 'AT SHELTER'];

// --- tiny collector ---
let passed = 0; const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}`); return; }
  failures.push(name);
  console.log(`FAIL  ${name}${detail ? ' -- ' + detail : ''}`);
}
const section = s => console.log(`\n== ${s} ==`);

// --- load data (same shape as lib/data.js loadAll, minus fetch/DOM) ---
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
  if (w * h !== out.length) throw new Error('mask size');
  return out;
}

const meta = rd('meta.json'), grid = rd('heightgrid.json');
const C = Object.fromEntries(rd('crew_constants.json').map(r => [r.key, r.value]));
const landmarks = rd('landmarks.json');
if (!landmarks.some(l => l.id === 'home')) landmarks.unshift({ ...meta.home, kind: 'habitat' });
const targets = rd('targets.json'), scenario = rd('scenario_demo.json');
const viewsheds = Object.fromEntries(landmarks.map(l => [l.id, loadMask(l.id)]));
const data = { meta, grid, bounds: meta.bounds, landmarks, targets, C, scenario, viewsheds };
const skyResults = Object.fromEntries(targets.flatMap(t => {
  try { return [[t.id, rd(`skyline/${t.id}.json`)]]; } catch { return []; }
}));

// --- build exactly like map/app.js ---
const probe = { plan: 0, vis: 0 }; // ms spent in planRoute / visibilityArrays during the current derive
const M = {
  computeLimits, computeBudget,
  planRoute: (...a) => { const t0 = performance.now(); try { return planRoute(...a); } finally { probe.plan += performance.now() - t0; } },
  visibilityArrays: k => { const t0 = performance.now(); try { return visibilityArrays(k); } finally { probe.vis += performance.now() - t0; } }
};
initVisibility(data.viewsheds, data.landmarks, data.grid, data.bounds);
const warns = [];
console.warn = (...a) => warns.push(a.join(' '));
const derive = createPipeline(M);
const timings = []; // { ms, miss }
function timedDerive(inputs, d, prev) {
  probe.plan = probe.vis = 0;
  const t0 = performance.now();
  const out = derive(inputs, d, prev);
  timings.push({ ms: performance.now() - t0, plan: probe.plan, vis: probe.vis,
    miss: out.routeHome !== prev.routeHome || out.routeOut !== prev.routeOut || out.vis !== prev.vis });
  return out;
}
const prep = prepareScenario(scenario, data, M);
initStore(data, timedDerive, { astronaut: { ...meta.home, headingDeg: 0 } });
timings.length = 0;

// --- run every minute, collect ---
function badValues(v, path, out) {
  if (v === undefined) out.push(`${path} undefined`);
  else if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(`${path}=${v}`); }
  else if (ArrayBuffer.isView(v)) { /* typed arrays: existence only */ }
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) badValues(x, `${path}.${k}`, out);
}
const inB = ([la, lo]) => la >= meta.bounds.latMin && la <= meta.bounds.latMax && lo >= meta.bounds.lonMin && lo <= meta.bounds.lonMax;
const badPts = r => (r?.points ?? []).filter(p => !(Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && inB(p)));

const steps = []; const bad = [], badStatus = [], badRoutes = [], nonMono = [];
let lastEva = -Infinity;
for (let t = 0; t <= prep.endT; t++) {
  setInputs(stateAt(prep, t, skyResults));
  const { inputs, derived: d } = getStore();
  steps.push({ t, d, inputs });
  const found = []; badValues(d, 'derived', found); badValues(inputs, 'inputs', found);
  if (found.length) bad.push(`t=${t}: ${found.slice(0, 3).join(', ')}`);
  if (!d.vis?.blind || !d.vis?.homeHidden) bad.push(`t=${t}: vis arrays missing`);
  if (!STATUSES.includes(d.budget.status) || !HEADLINES.includes(d.budget.headline)) badStatus.push(`t=${t}: ${d.budget.status}/${d.budget.headline}`);
  for (const [n, r] of [['routeHome', d.routeHome], ['routeOut', d.routeOut]]) {
    const p = badPts(r); if (p.length) badRoutes.push(`t=${t} ${n}: ${JSON.stringify(p[0])}`);
  }
  if (inputs.evaMin < lastEva) nonMono.push(`t=${t}`);
  lastEva = inputs.evaMin;
}
const at = t => steps[t];

section('invariants');
check(`ran ${steps.length} steps (t=0..${prep.endT})`, steps.length === prep.endT + 1);
check('no store validation warnings (inputs in range/bounds)', warns.length === 0, warns[0]);
check('no NaN/undefined in derived or inputs', bad.length === 0, bad.slice(0, 3).join(' | '));
check('budget.status/headline in allowed set', badStatus.length === 0, badStatus.slice(0, 3).join(' | '));
check('route points are [lat,lon] inside bounds', badRoutes.length === 0, badRoutes.slice(0, 3).join(' | '));
check('routeOut null iff no target (scenario never sets one)', steps.every(s => s.d.routeOut === null));
check('evaMin monotonic non-decreasing', nonMono.length === 0, nonMono.slice(0, 3).join(','));

section('timing');
// ARCHITECTURE.md §5: cache-hit derive <= 16 ms (we allow 50 for CI noise); A* replan < 300 ms.
const HIT_MS = 50, MISS_MS = 300;
const tm = timings.map((x, i) => ({ ...x, i }));
const ms = tm.map(x => x.ms).sort((a, b) => a - b);
const hits = tm.filter(x => !x.miss), misses = tm.filter(x => x.miss);
const worst = arr => arr.reduce((m, x) => (x.ms > m.ms ? x : m), { ms: -1, i: -1 });
console.log(`derive ms: min ${ms[0].toFixed(2)} / median ${ms[ms.length >> 1].toFixed(2)} / max ${ms.at(-1).toFixed(2)}  (${ms.length} calls, ${misses.length} cache-miss steps)`);
const wh = worst(hits), wm = worst(misses), ws = worst(tm);
console.log(`max cache-hit: ${wh.ms.toFixed(2)} ms at t=${wh.i}   max replan: ${wm.ms.toFixed(2)} ms at t=${wm.i}`);
console.log(`probe (slowest step t=${ws.i}, ${ws.ms.toFixed(1)} ms): planRoute ${ws.plan.toFixed(1)} ms, visibilityArrays ${ws.vis.toFixed(1)} ms`);
check(`cache-hit derive <= ${HIT_MS} ms`, wh.ms <= HIT_MS, `t=${wh.i} ${wh.ms.toFixed(1)}ms`);
check(`replan derive <= ${MISS_MS} ms`, wm.ms <= MISS_MS, `t=${wm.i} ${wm.ms.toFixed(1)}ms`);

section('story beats');
const b0 = at(0).d.budget;
check('t=0: GO / GREEN', b0.headline === 'GO' && b0.status === 'GREEN', `${b0.headline}/${b0.status}`);
const dust = t => at(t).d.budget.factors.find(f => f.id === 'dust');
check('tau 0.5 at t=30 keeps dust factor GREEN', dust(30).level === 'GREEN', dust(30).level);
check('tau 6 at t=75: dust factor RED, message cites tau 6.0', dust(75).level === 'RED' && dust(75).message.includes('6.0'), `${dust(75).level}: ${dust(75).message}`);
check('t=75: dust is the worst factor or ties for it (status RED)', at(75).d.budget.status === 'RED');
const sepBad = steps.filter(s => s.t >= 60 && !['RETURN NOW', 'AT SHELTER'].includes(s.d.budget.headline));
check('t>=60: RETURN NOW or AT SHELTER throughout', sepBad.length === 0, sepBad.slice(0, 3).map(s => `t=${s.t} ${s.d.budget.headline}`).join(', '));
check('t=60: radiation factor RED (SEP)', at(60).d.budget.factors.find(f => f.id === 'radiation')?.level === 'RED');
check('visibilityKm(75) < visibilityKm(74)', at(75).d.budget.visibilityKm < at(74).d.budget.visibilityKm,
  `${at(74).d.budget.visibilityKm} -> ${at(75).d.budget.visibilityKm}`);
check('skyline fix at t=55 lowers position uncertainty vs t=54', at(55).d.posUncertaintyM < at(54).d.posUncertaintyM || !skyResults.three_forks,
  `${at(54).d.posUncertaintyM} -> ${at(55).d.posUncertaintyM}`);

// --- edge cases ---
// Another dev fills this in. edge(name, fn): fn runs in try/catch; a throw or a false return fails the check.
function edge(name, fn) {
  try { check(`edge: ${name}`, fn() !== false); } catch (err) { check(`edge: ${name}`, false, `threw: ${err.message}`); }
}
section('edge cases');
const finite = (v, n) => { const f = []; badValues(v, n, f); if (f.length) throw new Error(f.slice(0, 3).join(', ')); };
const base = { ...getStore().inputs, astronaut: { ...meta.home, headingDeg: 0 } };
const lim = i => computeLimits(i, C);
for (const [label, patch] of [['tau 0.2', { tau: 0.2 }], ['tau 10', { tau: 10 }], ['evaMin 600', { evaMin: 600 }], ['evaMin 2000', { evaMin: 2000 }],
  ['sepActive at home', { sepActive: true }], ['sansAffected true', { sansAffected: true }], ['sansAffected false', { sansAffected: false }]]) {
  for (const km of (label.startsWith('sep') ? [0] : [0, 50, 500])) edge(`budget ${label}, routeHomeKm ${km}`, () => {
    const i = { ...base, ...patch }, b = computeBudget(i, lim(i), km, C);
    finite(b, 'budget'); finite(lim(i), 'limits');
    return STATUSES.includes(b.status) && HEADLINES.includes(b.headline);
  });
}
const bd = meta.bounds, mx = (a, b) => (a + b) / 2;
const goals = {};
for (const [n, la] of [['S', bd.latMin], ['M', mx(bd.latMin, bd.latMax)], ['N', bd.latMax]])
  for (const [m, lo] of [['W', bd.lonMin], ['C', mx(bd.lonMin, bd.lonMax)], ['E', bd.lonMax]]) if (n + m !== 'MC') goals[n + m] = { lat: la, lon: lo };
Object.assign(goals, { 'outside N': { lat: bd.latMax + 0.01, lon: meta.home.lon }, 'outside W': { lat: meta.home.lat, lon: bd.lonMin - 0.01 }, 'home->home': meta.home });
const inb = p => p[0] >= bd.latMin && p[0] <= bd.latMax && p[1] >= bd.lonMin && p[1] <= bd.lonMax;
const okRoute = r => r && typeof r === 'object' && typeof r.ok === 'boolean' && (r.ok || typeof r.reason === 'string') &&
  (!r.ok || (Array.isArray(r.points) && r.points.length > 0 && r.points.every(p => p.length === 2 && p.every(Number.isFinite) && inb(p))));
for (const mode of ['shortest', 'safest', 'homeInSight']) {
  const vis = visibilityArrays(Math.max(1, Math.round(lim(base).visibilityKm)));
  const o = { mode, ...lim(base) };
  const plan = (g, opts) => planRoute(grid, bd, vis, meta.home, g, opts);
  for (const [n, g] of Object.entries(goals)) edge(`planRoute ${mode} home -> ${n}`, () => okRoute(plan(g, o)));
  edge(`planRoute ${mode} unreachable (maxSlopeDeg 0.01)`, () => okRoute(plan(goals.NE, { ...o, maxSlopeDeg: 0.01 })));
  edge(`planRoute ${mode} maxExpansions 10`, () => okRoute(plan(goals.NE, { ...o, maxExpansions: 10 })));
}
// real store: bad input must clamp/reject and leave derived finite (store warnings are expected here)
for (const [label, patch] of [['tau 0', { tau: 0 }], ['tau 99', { tau: 99 }], ['astronaut outside bounds', { astronaut: { lat: bd.latMax + 1, lon: bd.lonMin } }]])
  edge(`store ${label}`, () => { setInputs(patch); const s = getStore(); finite(s.derived, 'derived'); finite(s.inputs, 'inputs'); });
warns.length = 0;

console.log(`\ntest_demo: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failures:\n  ' + failures.join('\n  ')); process.exit(1); }
