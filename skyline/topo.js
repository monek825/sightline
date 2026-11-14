// Written with AI assistance (Claude / GitHub Copilot)
// Horizon Match "scan" on the 2D map: a ring sweeps out from the last known position and reveals a topographic map
// (contour lines from the NASA CTX elevation grid), then every candidate spot from the search grid flickers while it is
// compared, wrong ones fade, and the best match locks. Visual only: the numbers come from data/skyline/<site>.json.

import { R } from '../lib/geo.js';

const NS = 'http://www.w3.org/2000/svg';
const M_PER_DEG = 2 * Math.PI * R / 360;
const STRIDE = 1;            // contour from every grid point of the 40 m grid
const TARGET_LEVELS = 18;    // about this many contour lines across the box
const INDEX_EVERY = 5;       // every 5th line is an index contour (brighter)
const CAND_STRIDE = 2;       // show every 2nd candidate of the 61 x 61 search grid (31 x 31 dots)
const DOT_R_M = 34, LOCK_R_M = 70, PRIOR_R_M = 60; // drawn sizes, metres on the ground
export const RING_MS = 1800, FLICKER_MS = 1400, SETTLE_MS = 600;
export const SCAN_MS = RING_MS + FLICKER_MS + SETTLE_MS;

let gridP = null;
const loadGrid = () => (gridP ??= Promise.all([
  fetch('data/heightgrid40.json').then(r => (r.ok ? r.json() : fetch('data/heightgrid.json').then(x => x.json()))),
  fetch('data/meta.json').then(r => r.json())
]).then(([grid, meta]) => ({ grid, b: meta.bounds })));

const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const niceStep = range => {
  const raw = range / TARGET_LEVELS, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(v => v >= raw) ?? 10 * p;
};

// marching squares on the sub-grid; returns one path string per level class (normal / index)
function contours(G, r0, r1, c0, c1) {
  const at = (r, c) => G.grid.data[r * G.grid.w + c];
  let lo = Infinity, hi = -Infinity;
  for (let r = r0; r <= r1; r += STRIDE) for (let c = c0; c <= c1; c += STRIDE) { const v = at(r, c); if (v < lo) lo = v; if (v > hi) hi = v; }
  const step = niceStep(hi - lo);
  const parts = { line: [], index: [] };
  for (let L = Math.ceil(lo / step) * step; L <= hi; L += step) {
    const out = Math.round(L / step) % INDEX_EVERY === 0 ? parts.index : parts.line;
    for (let r = r0; r + STRIDE <= r1; r += STRIDE) for (let c = c0; c + STRIDE <= c1; c += STRIDE) {
      const a = at(r, c), b = at(r, c + STRIDE), d = at(r + STRIDE, c), e = at(r + STRIDE, c + STRIDE);
      const k = (a > L) | ((b > L) << 1) | ((e > L) << 2) | ((d > L) << 3);
      if (k === 0 || k === 15) continue;
      const lerp = (v1, v2) => (L - v1) / (v2 - v1) * STRIDE;
      const T = [c + lerp(a, b), r], Rt = [c + STRIDE, r + lerp(b, e)], B = [c + lerp(d, e), r + STRIDE], Lf = [c, r + lerp(a, d)];
      const seg = { 1: [Lf, T], 2: [T, Rt], 3: [Lf, Rt], 4: [Rt, B], 5: [Lf, T, Rt, B], 6: [T, B], 7: [Lf, B],
        8: [Lf, B], 9: [T, B], 10: [T, Rt, Lf, B], 11: [Rt, B], 12: [Lf, Rt], 13: [T, Rt], 14: [Lf, T] }[k];
      for (let i = 0; i < seg.length; i += 2) out.push(`M${seg[i][0].toFixed(1)} ${seg[i][1].toFixed(1)}L${seg[i + 1][0].toFixed(1)} ${seg[i + 1][1].toFixed(1)}`);
    }
  }
  return { line: parts.line.join(''), index: parts.index.join(''), step };
}

/**
 * Start the scan for skyline result `s` on Leaflet `map`. Resolves to a controller:
 *   lock()   → fade the losers, pulse the best match (call when the result is shown)
 *   remove() → take everything off the map
 */
export async function topoScan(map, s, { reduced = false } = {}) {
  const G = await loadGrid();
  const g = s.grid, half = ((g.n - 1) / 2 + 3) * g.stepM; // search box + a little margin
  const dLat = half / M_PER_DEG, dLon = half / (M_PER_DEG * Math.cos(g.centerLat * Math.PI / 180));
  const b = G.b, h = G.grid.h, w = G.grid.w;
  const cellM = (b.latMax - b.latMin) * M_PER_DEG / h;          // grid cell size in metres (40 m, or 80 m fallback)
  const row = lat => (b.latMax - lat) / (b.latMax - b.latMin) * h - 0.5;   // fractional cell (centre = integer)
  const col = lon => (lon - b.lonMin) / (b.lonMax - b.lonMin) * w - 0.5;
  const clampR = v => Math.min(h - 1, Math.max(0, v)), clampC = v => Math.min(w - 1, Math.max(0, v));
  const r0 = clampR(Math.floor(row(g.centerLat + dLat))), r1 = clampR(Math.ceil(row(g.centerLat - dLat)));
  const c0 = clampC(Math.floor(col(g.centerLon - dLon))), c1 = clampC(Math.ceil(col(g.centerLon + dLon)));
  const latAt = r => b.latMax - (r + 0.5) / h * (b.latMax - b.latMin), lonAt = c => b.lonMin + (c + 0.5) / w * (b.lonMax - b.lonMin);
  const bounds = [[latAt(r1), lonAt(c0)], [latAt(r0), lonAt(c1)]];

  const topo = contours(G, r0, r1, c0, c1);
  const root = el('svg', { viewBox: `${c0} ${r0} ${c1 - c0} ${r1 - r0}`, class: 'topo-scan', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  const id = `scan${Math.random().toString(36).slice(2, 8)}`;
  const cx = col(g.centerLon), cy = row(g.centerLat);           // scan starts at the prior (last known position)
  const maxR = Math.hypot(Math.max(cx - c0, c1 - cx), Math.max(cy - r0, r1 - cy));
  const defs = el('defs'), mask = el('mask', { id });
  const reveal = el('circle', { cx, cy, r: reduced ? maxR : 0, fill: '#fff' });
  mask.append(el('rect', { x: c0, y: r0, width: c1 - c0, height: r1 - r0, fill: '#000' }), reveal);
  defs.append(mask);
  // the scanned area gets a dark wash so the contour lines read over the bright imagery
  const wash = el('circle', { cx, cy, r: maxR, class: 'topo-wash' });
  const lines = el('g', { mask: `url(#${id})` });
  lines.append(wash, el('path', { d: topo.line, class: 'topo-line' }), el('path', { d: topo.index, class: 'topo-index' }));
  const ring = el('circle', { cx, cy, r: 0, class: 'topo-ring' });
  const start = el('circle', { cx, cy, r: PRIOR_R_M / cellM, class: 'topo-prior' });

  // candidates: the search grid (row 0 = north), every CAND_STRIDE-th cell
  const cands = el('g', { class: 'topo-cands' });
  // goodness by rank (1 = best match, 0 = worst): one bad outlier can't squash everyone else to 'good'
  const sorted = [...g.rmsDeg].sort((x, y) => x - y);
  const rank = v => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; } return lo / sorted.length; };
  const dots = [];
  for (let i = 0; i < g.n; i += CAND_STRIDE) for (let j = 0; j < g.n; j += CAND_STRIDE) {
    const north = ((g.n - 1) / 2 - i) * g.stepM, east = (j - (g.n - 1) / 2) * g.stepM;
    const lat = g.centerLat + north / M_PER_DEG, lon = g.centerLon + east / (M_PER_DEG * Math.cos(g.centerLat * Math.PI / 180));
    const good = 1 - rank(g.rmsDeg[i * g.n + j]);
    const dot = el('circle', { cx: col(lon), cy: row(lat), r: DOT_R_M / cellM, class: 'topo-cand' });
    dot.style.opacity = '0';
    dots.push({ dot, good, d: Math.hypot(col(lon) - cx, row(lat) - cy) });
    cands.append(dot);
  }
  const lockDot = el('circle', { cx: col(s.estimate.lon), cy: row(s.estimate.lat), r: LOCK_R_M / cellM, class: 'topo-lock' });
  lockDot.style.opacity = '0';
  root.append(defs, lines, cands, ring, start, lockDot);
  const layer = L.svgOverlay(root, bounds, { interactive: false, className: 'topo-layer' }).addTo(map);

  // animation: ring grows (reveals contours), dots appear behind it and flicker, then settle by how well they match
  let raf = 0;
  const t0 = performance.now();
  const frame = now => {
    const t = Math.max(0, now - t0);   // the first rAF timestamp can be slightly before t0 (negative radius error)
    const f = Math.min(1, t / RING_MS), rr = maxR * (1 - (1 - f) ** 2);    // quadratic ease-out
    reveal.setAttribute('r', rr.toFixed(1));
    ring.setAttribute('r', rr.toFixed(1));
    ring.style.opacity = String(f < 1 ? 0.9 : Math.max(0, 1 - (t - RING_MS) / 400));
    const flick = t > RING_MS && t < RING_MS + FLICKER_MS;
    const settle = Math.min(1, Math.max(0, (t - RING_MS - FLICKER_MS) / SETTLE_MS));
    for (const p of dots) {
      if (p.d > rr) continue;
      const base = flick ? 0.25 + 0.75 * Math.random() * (0.3 + 0.7 * p.good) : 0.55;
      p.dot.style.opacity = String(settle > 0 ? base * (1 - settle) + p.good ** 40 * settle : base);
    }
    if (t < SCAN_MS) raf = requestAnimationFrame(frame);
  };
  if (reduced) { for (const p of dots) p.dot.style.opacity = String(p.good ** 40); }
  else raf = requestAnimationFrame(frame);

  return {
    lock() {
      cancelAnimationFrame(raf);
      reveal.setAttribute('r', maxR.toFixed(1));
      ring.style.opacity = '0';
      for (const p of dots) p.dot.style.opacity = String(p.good ** 40 * 0.8);
      lockDot.style.opacity = '1';
      lockDot.classList.add('is-locked');
    },
    remove() { cancelAnimationFrame(raf); layer.remove(); }
  };
}
