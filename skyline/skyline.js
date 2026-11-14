// Written with AI assistance (Claude / GitHub Copilot)
// LOCATE — Skyline Fix panel. Turn 360° → search heat map → fix. Data: data/skyline/<site>.json (Sean's scripts/skyline.py).
// UI only: the one state write is setInputs() from a click/handler, never from a subscriber.

import { R } from '../lib/geo.js';
import { setInputs, getStore } from '../lib/store.js';

const SWEEP_MS = 4000;
const SEARCH_MS = 1200;
const M_PER_DEG = 2 * Math.PI * R / 360;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART = { w: 720, h: 150, pad: 8 };

const cache = new Map();
let ui = null; // { dlg, overlay, timers, onClose }

async function loadSite(siteId) {
  if (!/^[a-z_]+$/.test(siteId)) throw new Error('bad site id');
  if (!cache.has(siteId)) {
    const res = await fetch(`data/skyline/${siteId}.json`);
    if (!res.ok) throw new Error(`No skyline data for ${siteId}`);
    const s = await res.json();
    if (!Array.isArray(s.observed) || !Array.isArray(s.best) || !s.estimate || !s.grid?.rmsDeg) throw new Error(`Bad skyline file ${siteId}`);
    cache.set(siteId, s);
  }
  return cache.get(siteId);
}

/** Results keyed by site, for scenario.stateAt(prep, t, skylineResults). Missing files are skipped. */
export async function loadSkylineResults(ids) {
  const out = {};
  await Promise.all(ids.map(id => loadSite(id).then(s => { out[id] = s; }).catch(() => {})));
  return out;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const svg = (tag, attrs) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

function buildDialog() {
  const dlg = el('dialog', 'skyfix frost');
  dlg.setAttribute('aria-labelledby', 'sky-h');
  const head = el('div', 'skyfix-head');
  const h = el('h2', null, 'Skyline Fix');
  h.id = 'sky-h';
  const close = el('button', 'btn', 'Close');
  close.type = 'button';
  head.append(h, close);

  const step = el('p', 'skyfix-step');
  step.setAttribute('role', 'status');
  const compass = svg('svg', { viewBox: '0 0 100 100', class: 'skyfix-compass', 'aria-hidden': 'true' });
  compass.append(
    svg('circle', { cx: 50, cy: 50, r: 44, class: 'ring' }),
    svg('path', { d: 'M50 6 L50 16', class: 'tick' }),
    svg('path', { d: 'M50 50 L50 10', class: 'sweep' })
  );
  const n = svg('text', { x: 50, y: 30, 'text-anchor': 'middle', class: 'lbl' });
  n.textContent = 'N';
  compass.append(n);

  const chart = svg('svg', { viewBox: `0 0 ${CHART.w} ${CHART.h}`, class: 'skyfix-chart', role: 'img', 'aria-label': 'Observed skyline and best match' });
  const legend = el('p', 'skyfix-legend');
  legend.append(el('span', 'k-obs', 'Observed skyline'), el('span', 'k-best', 'Best match on NASA terrain'));
  const result = el('div', 'skyfix-result');
  const how = el('details', 'skyfix-how');
  how.append(el('summary', null, 'How it works'));
  for (const line of [
    'Every spot in Jezero has its own horizon. We compute it from the NASA CTX elevation model (20 m).',
    'The astronaut turns once; the helmet camera traces the skyline; we find the spot whose horizon matches best.',
    'Perseverance matched camera images to an orbital map while landing. JPL reports horizon matching at about 10–100 m.',
    'Not yet tested on real photos. Dust, camera and suit tilt will make it worse.'
  ]) how.append(el('p', null, line));

  dlg.append(head, el('div', 'skyfix-top', null), chart, legend, result, how);
  dlg.querySelector('.skyfix-top').append(compass, step);
  document.querySelector('.map-wrap').append(dlg);
  close.addEventListener('click', () => closeFix());
  dlg.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeFix(); } });
  return { dlg, step, compass, chart, result };
}

function chartScale(s) {
  const all = s.observed.concat(s.best);
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(hi - lo, 1);
  const x = i => CHART.pad + i / (s.observed.length - 1) * (CHART.w - 2 * CHART.pad);
  const y = v => CHART.h - CHART.pad - (v - lo) / span * (CHART.h - 2 * CHART.pad);
  return { x, y };
}
const points = (arr, { x, y }, upto = arr.length) => arr.slice(0, upto).map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

function heatImage(grid) {
  const { n, rmsDeg } = grid;
  const best = Math.min(...rmsDeg), worst = Math.max(...rmsDeg);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const good = 1 - (rmsDeg[i] - best) / Math.max(worst - best, 1e-6); // 1 = best match
    const a = good ** 4;
    img.data.set([255, 196 + 59 * a, 90 + 120 * a, Math.round(a * 220)], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function gridBounds(g) {
  const half = (g.n - 1) / 2 * g.stepM + g.stepM / 2;
  const dLat = half / M_PER_DEG;
  const dLon = half / (M_PER_DEG * Math.cos(g.centerLat * Math.PI / 180));
  return [[g.centerLat - dLat, g.centerLon - dLon], [g.centerLat + dLat, g.centerLon + dLon]];
}

function showResult(box, s) {
  box.replaceChildren();
  const big = el('p', 'skyfix-big');
  big.append(el('strong', null, `± ${Math.round(s.uncertaintyM)} m`), el('span', null, ` position fixed · error ${Math.round(s.errorM)} m`));
  box.append(big,
    el('p', null, `With only a 96° camera view: error ${Math.round(s.fov96?.errorM ?? NaN)} m, ± ${Math.round(s.fov96?.uncertaintyM ?? NaN)} m. That's why the astronaut turns a full circle.`),
    el('p', 'skyfix-note', `Simulated skyline (${s.noiseDeg}° noise) on NASA terrain, not a real photo. Real cameras: expect about 10–100 m (JPL).`));
}

export function closeFix() {
  if (!ui) return;
  ui.timers.forEach(clearTimeout);
  ui.timers = [];
  if (ui.overlay) { ui.overlay.remove(); ui.overlay = null; }
  if (ui.dlg.open) ui.dlg.close();
  const cb = ui.onClose; ui.onClose = null;
  cb?.();
}

/**
 * @param {string} siteId  file in data/skyline/
 * @param {L.Map} map
 * @param {{ applyFix?: boolean, onClose?: () => void }} opts  applyFix=false when the demo player owns the position
 */
export async function openSkylineFix(siteId, map, opts = {}) {
  const s = await loadSite(siteId);
  if (!ui) ui = { ...buildDialog(), timers: [], overlay: null, onClose: null };
  closeFix();
  ui.onClose = opts.onClose ?? null;
  const { dlg, step, compass, chart, result } = ui;
  const sc = chartScale(s);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  chart.replaceChildren(
    svg('line', { x1: 0, x2: CHART.w, y1: sc.y(0), y2: sc.y(0), class: 'zero' }),
    svg('polyline', { points: '', class: 'obs' }),
    svg('polyline', { points: '', class: 'best' })
  );
  const [, obs, best] = chart.children;
  result.replaceChildren();
  dlg.querySelector('.skyfix-head h2').textContent = `Skyline Fix · ${s.name}`;
  if (!dlg.open) dlg.show();

  // 1. Turn 360°
  step.textContent = '1 · Turn slowly 360°. The camera traces the skyline.';
  const sweep = compass.querySelector('.sweep');
  const n = s.observed.length;
  if (reduced) {
    obs.setAttribute('points', points(s.observed, sc));
  } else {
    const t0 = performance.now();
    const tick = now => {
      if (!dlg.open) return;
      const f = Math.min(1, (now - t0) / SWEEP_MS);
      sweep.setAttribute('transform', `rotate(${f * 360} 50 50)`);
      obs.setAttribute('points', points(s.observed, sc, Math.max(2, Math.round(f * n))));
      if (f < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // 2. Search the map
  const later = (ms, fn) => ui.timers.push(setTimeout(fn, reduced ? 0 : ms));
  later(SWEEP_MS, () => {
    step.textContent = '2 · Compare with the horizon of every spot nearby.';
    ui.overlay = L.imageOverlay(heatImage(s.grid), gridBounds(s.grid), { opacity: 0.85, interactive: false, className: 'skyfix-heat' }).addTo(map);
    map.flyToBounds(gridBounds(s.grid), { duration: reduced ? 0 : 0.8, padding: [40, 40] });
  });

  // 3. Fix
  later(SWEEP_MS + SEARCH_MS, () => {
    step.textContent = '3 · Best match found.';
    best.setAttribute('points', points(s.best, sc));
    showResult(result, s);
    if (opts.applyFix !== false) {
      const cur = getStore().inputs.astronaut;
      setInputs({ astronaut: { ...cur, lat: s.estimate.lat, lon: s.estimate.lon }, distSinceFixM: 0, fixUncertaintyM: s.uncertaintyM });
    }
    map.flyTo([s.estimate.lat, s.estimate.lon], Math.max(map.getZoom(), 14), { duration: reduced ? 0 : 0.8 });
  });
}
