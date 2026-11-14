// Written with AI assistance (Claude / GitHub Copilot)
// LOCATE — Horizon Match panel. Turn 360° → topographic scan of the search area (topo.js) → fix. Data: data/skyline/<site>.json (Sean's scripts/skyline.py).
// UI only: the one state write is setInputs() from a click/handler, never from a subscriber.

import { R } from '../lib/geo.js';
import { setInputs, getStore } from '../lib/store.js';
import { topoScan, SCAN_MS } from './topo.js';

const SWEEP_MS = 4000;
const SEARCH_MS = SCAN_MS; // the topographic scan (skyline/topo.js)
const MORPH_MS = 400; // 360° <-> 96° circle change
const STEPS = ['Look around', 'Compare with the map', 'You are here'];
const M_PER_DEG = 2 * Math.PI * R / 360;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART = { w: 720, h: 150, pad: 8 };

const cache = new Map();
let ui = null; // { dlg, overlay, timers, onClose, cmp: {circle, marker} | null, raf }

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
  const h = el('h2', null, 'Horizon Match');
  h.id = 'sky-h';
  const close = el('button', 'btn', 'Close');
  close.type = 'button';
  head.append(h, close);

  const lead = el('p', 'skyfix-lead', "Each spot in the crater has a different outline of hills on the horizon. The astronaut turns once, the outline is compared with NASA's 3D map, and the best match is the position.");
  const step = el('ol', 'skyfix-steps');
  step.setAttribute('aria-label', 'Progress');
  for (const label of STEPS) step.append(el('li', null, label));
  const status = el('p', 'skyfix-status');
  status.setAttribute('role', 'status');
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
  const axis = el('p', 'skyfix-axis');
  axis.setAttribute('aria-hidden', 'true');
  for (const d of ['N', 'E', 'S', 'W', 'N']) axis.append(el('span', null, d));
  const legend = el('p', 'skyfix-legend');
  legend.append(el('span', 'k-obs', 'Hills the astronaut sees'), el('span', 'k-best', "Hills in NASA's map at the match"));
  const result = el('div', 'skyfix-result');
  const how = el('details', 'skyfix-how');
  how.append(el('summary', null, 'More detail'));
  for (const line of [
    'The horizon for every spot comes from the NASA CTX elevation model of Jezero (20 m per point).',
    'Perseverance used the same idea while landing, matching its camera view to an orbital map. JPL reports horizon matching at about 10–100 m.',
    'Tested on simulated views so far. Real photos, dust and suit tilt will make it less accurate.'
  ]) how.append(el('p', null, line));

  dlg.append(head, lead, el('div', 'skyfix-top', null), chart, axis, legend, result, how);
  dlg.querySelector('.skyfix-top').append(compass, el('div', 'skyfix-prog', null));
  dlg.querySelector('.skyfix-prog').append(step, status);
  document.querySelector('.map-wrap').append(dlg);
  close.addEventListener('click', () => closeFix());
  dlg.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeFix(); } });
  return { dlg, step, status, compass, chart, result, how };
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

function gridBounds(g) {
  const half = (g.n - 1) / 2 * g.stepM + g.stepM / 2;
  const dLat = half / M_PER_DEG;
  const dLon = half / (M_PER_DEG * Math.cos(g.centerLat * Math.PI / 180));
  return [[g.centerLat - dLat, g.centerLon - dLon], [g.centerLat + dLat, g.centerLon + dLon]];
}

const isLL = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon);

/** Comparison view only: draws the 360° or 96° result on the map; never touches app state. */
function setCompareView(map, to, reduced) {
  if (!ui.cmp) {
    const style = { color: '#f3c66c', interactive: false };
    ui.cmp = {
      circle: L.circle([to.est.lat, to.est.lon], { ...style, radius: to.unc, weight: 2, dashArray: '5 5', fillColor: '#f3c66c', fillOpacity: 0.1 }).addTo(map),
      marker: L.circleMarker([to.est.lat, to.est.lon], { ...style, radius: 6, weight: 2, fillOpacity: 0.9 }).addTo(map)
    };
    return;
  }
  const { circle, marker } = ui.cmp;
  cancelAnimationFrame(ui.raf);
  const from = circle.getLatLng(), r0 = circle.getRadius(), t0 = performance.now();
  const apply = f => {
    const lat = from.lat + (to.est.lat - from.lat) * f, lon = from.lng + (to.est.lon - from.lng) * f;
    circle.setLatLng([lat, lon]).setRadius(r0 + (to.unc - r0) * f);
    marker.setLatLng([lat, lon]);
  };
  if (reduced) { apply(1); return; }
  const tick = now => {
    if (!ui?.cmp) return;
    const f = Math.min(1, (now - t0) / MORPH_MS);
    apply(f * (2 - f)); // ease-out
    if (f < 1) ui.raf = requestAnimationFrame(tick);
  };
  ui.raf = requestAnimationFrame(tick);
}

function showResult(box, s, map, reduced) {
  box.replaceChildren();
  const full = { est: s.estimate, err: s.errorM, unc: s.uncertaintyM };
  const hasEst96 = isLL(s.fov96?.estimate);
  const v96 = Number.isFinite(s.fov96?.errorM) && Number.isFinite(s.fov96?.uncertaintyM)
    ? { est: hasEst96 ? s.fov96.estimate : s.estimate, err: s.fov96.errorM, unc: s.fov96.uncertaintyM } : null;
  const same = !!v96 && Math.round(v96.err) === Math.round(full.err) && Math.round(v96.unc) === Math.round(full.unc)
    && (!hasEst96 || (Math.abs(v96.est.lat - full.est.lat) < 1e-5 && Math.abs(v96.est.lon - full.est.lon) < 1e-5));

  const strong = el('strong');
  const what = el('span');
  const big = el('p', 'skyfix-big');
  big.append(strong, what);
  const explain = el('p', 'skyfix-explain');
  explain.setAttribute('role', 'status');
  const note = el('p', 'skyfix-note', 'Simulated test on NASA terrain, not a real photo yet.');
  box.append(big, note);

  let btns = [];
  const show = mode => {
    const is96 = mode === 96;
    const v = is96 ? v96 : full;
    strong.textContent = is96 ? 'One way only: ' : 'You are here ';
    what.textContent = is96 ? `${Math.round(v.err)} m off` : `(within ${Math.round(v.unc)} m)`;
    btns.forEach(([b, m]) => b.setAttribute('aria-pressed', String(m === mode)));
    if (!is96) explain.textContent = 'Looking all the way round sees the most hills, so the match is reliable.';
    else if (same) explain.textContent = 'Here one direction is enough, but at other spots it is far off, so astronauts always turn all the way round.';
    else explain.textContent = `Looking one way sees too few hills, so the answer can be ${Math.round(v.err)} m off. Astronauts turn all the way round for this reason.`;
    setCompareView(map, v, reduced);
  };

  ui.how.querySelector('.skyfix-why')?.remove();
  if (v96) { // the comparison lives under "Turning all the way round" so the main card stays simple
    const why = el('div', 'skyfix-why');
    const group = el('div', 'skyfix-toggle');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Compare looking all the way round with looking one way (simulated)');
    btns = [[el('button', 'btn', 'Turn all the way round'), 360], [el('button', 'btn', 'Look one way only'), 96]];
    for (const [b, m] of btns) { b.type = 'button'; b.addEventListener('click', () => show(m)); group.append(b); }
    why.append(el('h3', null, 'Turning all the way round'), group, explain);
    ui.how.insertBefore(why, ui.how.children[1]);
  }
  show(360);
}

export function closeFix() {
  if (!ui) return;
  ui.timers.forEach(clearTimeout);
  ui.timers = [];
  cancelAnimationFrame(ui.raf);
  if (ui.cmp) { ui.cmp.circle.remove(); ui.cmp.marker.remove(); ui.cmp = null; }
  if (ui.overlay) { ui.overlay.remove(); ui.overlay = null; }
  if (ui.scan) { ui.scan.then(c => c?.remove()); ui.scan = null; }
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
  if (!ui) ui = { ...buildDialog(), timers: [], overlay: null, onClose: null, cmp: null, raf: 0 };
  closeFix();
  ui.onClose = opts.onClose ?? null;
  const { dlg, step, status, compass, chart, result } = ui;
  const setStep = (i, text) => {
    [...step.children].forEach((li, k) => { li.className = k < i ? 'done' : k === i ? 'now' : ''; });
    status.textContent = text;
  };
  const sc = chartScale(s);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  chart.replaceChildren(
    svg('line', { x1: 0, x2: CHART.w, y1: sc.y(0), y2: sc.y(0), class: 'zero' }),
    svg('polyline', { points: '', class: 'obs' }),
    svg('polyline', { points: '', class: 'best' })
  );
  const [, obs, best] = chart.children;
  result.replaceChildren();
  dlg.querySelector('.skyfix-head h2').textContent = 'Horizon Match';
  if (!dlg.open) dlg.show();

  // 1. Turn 360°
  setStep(0, `Near ${s.name}. The astronaut turns slowly and the helmet camera traces the hills.`);
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
    setStep(1, 'Scanning the NASA terrain map: every dot is a spot whose horizon is being compared.');
    ui.scan = topoScan(map, s, { reduced }).catch(err => { console.error(err); return null; });
    map.flyToBounds(gridBounds(s.grid), { duration: reduced ? 0 : 0.8, padding: [40, 40] });
  });

  // 3. Fix
  later(SWEEP_MS + SEARCH_MS, () => {
    setStep(2, 'Best match found.');
    ui.scan?.then(c => c?.lock());
    [...step.children].forEach(li => { li.className = 'done'; });
    best.setAttribute('points', points(s.best, sc));
    showResult(result, s, map, reduced);
    if (opts.applyFix !== false) {
      const cur = getStore().inputs.astronaut;
      setInputs({ astronaut: { ...cur, lat: s.estimate.lat, lon: s.estimate.lon }, distSinceFixM: 0, fixUncertaintyM: s.uncertaintyM });
    }
    map.flyTo([s.estimate.lat, s.estimate.lon], Math.max(map.getZoom(), 14), { duration: reduced ? 0 : 0.8 });
  });
}
