// Written with AI assistance (Claude / GitHub Copilot)
// LOCATE — Horizon Match panel. Turn 360° → topographic scan of the search area (topo.js) → fix. Data: data/skyline/<site>.json (Sean's scripts/skyline.py).
// UI only: the one state write is setInputs() from a click/handler, never from a subscriber.

import { R, distM } from '../lib/geo.js';
import { setInputs, getStore } from '../lib/store.js';
import { topoScan, SCAN_MS } from './topo.js';
import { lostInDustPlan, compass8 } from './lostdust.js';
import { visibilityArrays } from '../map/visibility.js';
import { liveMatchSteps, deadReckoningPrior, seedOf } from './livematch.js';

const SWEEP_MS = 4000;
const SEARCH_MS = SCAN_MS; // the topographic scan (skyline/topo.js)
const MORPH_MS = 400; // 360° <-> 96° circle change
const STEPS = ['Look around', 'Compare with the map', 'You are here'];
const M_PER_DEG = 2 * Math.PI * R / 360;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART = { w: 720, h: 150, pad: 8 };
const LEAD = "Each spot in the crater has a different outline of hills on the horizon. The astronaut turns once, the outline is compared with NASA's 3D map, and the best match is the position.";

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

// Horizon Match in dust (data/skyline_dust.json, scripts/skyline_dust.py). Missing file = clear-air behaviour only.
let dustP = null;
const loadDust = () => (dustP ??= fetch('data/skyline_dust.json').then(r => (r.ok ? r.json() : null)).catch(() => null));
const DUST_NOISE_DEG = 0.3;   // dust lowers edge contrast: use the noisier of the two simulated edge-noise levels
/** The dust result for a site at the current visibility: the tested visibility at or below it (conservative). */
function dustCase(dust, siteId, visKm) {
  if (!dust || !Array.isArray(dust.cases)) return null;
  const levels = [...new Set(dust.cases.map(c => c.visKm))].sort((a, b) => b - a);   // clear -> thick
  if (visKm >= levels[0]) return null;                                                // clear air: the normal site file
  const v = levels.find(l => l <= visKm) ?? levels[levels.length - 1];
  return dust.cases.find(c => c.site === siteId && c.truth === 0 && c.noise === DUST_NOISE_DEG && c.visKm === v) ?? null;
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

  const lead = el('p', 'skyfix-lead', LEAD);
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
    'The horizon for every spot comes from the NASA CTX elevation model of Jezero (20 m per point), with MOLA for far hills.',
    'JPL reports horizon matching at typically about 100 m, at best about 10 m (Nash et al., ICRA 2024). Perseverance landed with a related idea. Its Lander Vision System matched camera images to an orbital map, a few metres off against a 40 m requirement.',
    'Tested on real Perseverance Navcam panoramas, 4 of 5 positions were fixed within 51–143 m and one was 2.8 km off. So the app never claims better than ±100 m and checks every fix against your step count.',
    'In dust (simulated on NASA terrain), the self-check never claimed a wrong position down to 1.5 km visibility. Below that, or when it finds no clear match, the app switches to "Lost in dust".'
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

// opt.applied: false = the fix disagreed with dead reckoning and was not used; opt.note: what this result is
function showResult(box, s, map, reduced, opt = {}) {
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
  const note = el('p', 'skyfix-note', opt.note ?? 'Simulated test on NASA terrain. Real-photo tests are under More detail.');
  if (opt.applied === false) big.classList.add('rejected');
  box.append(big, note);

  let btns = [];
  const show = mode => {
    const is96 = mode === 96;
    const v = is96 ? v96 : full;
    strong.textContent = is96 ? 'One way only: ' : opt.applied === false ? 'Not applied ' : 'You are here ';
    what.textContent = is96 ? `${Math.round(v.err)} m off`
      : opt.applied === false ? '(the match disagrees with your step count)' : `(within ${Math.round(v.unc)} m)`;
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
  clearLostMap();
  if (ui.overlay) { ui.overlay.remove(); ui.overlay = null; }
  if (ui.scan) { ui.scan.then(c => c?.remove()); ui.scan = null; }
  if (ui.dlg.open) ui.dlg.close();
  const cb = ui.onClose; ui.onClose = null;
  cb?.();
}

// ---------- Lost in dust (skyline/lostdust.js) ----------
const SEE_CHOICES_KM = [0.1, 0.3, 1, 3];     // manual mode: "how far can you see?" (the astronaut's own judgement)
const fmtM = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

function clearLostMap() {
  if (ui?.lostLayers) { ui.lostLayers.forEach(l => l.remove()); ui.lostLayers = null; }
}

/** Show the lost-in-dust plan in the dialog. reason: 'visibility' | 'no-fix' | 'manual'. */
function showLost(map, reason, visKm, minVisKm, siteName) {
  const st = getStore(), d = st.data, der = st.derived, inp = st.inputs;
  const { dlg, result, chart, how } = ui;
  dlg.classList.add('lost');
  dlg.querySelector('.skyfix-head h2').textContent = reason === 'no-match' ? 'No clear match' : 'Lost in dust';
  dlg.querySelector('.skyfix-lead').textContent =
    reason === 'visibility' ? `Visibility is about ${fmtM(visKm * 1000)}: too few hills show to match the horizon safely. ` +
      `In the NASA-terrain test, Horizon Match gave a wrong answer below ${minVisKm} km, so the app does not guess.`
    : reason === 'no-fix' ? 'Dust hides too many hills near ' + siteName + ': no position matched clearly enough, so the app does not guess.'
    : reason === 'no-match' ? 'The hills around here look alike from several spots, so no position matched clearly enough. The app does not guess. ' +
      'Keep to your step count and try again from a spot with more distinctive hills in view.'
    : 'You cannot see the hills. Without a horizon there is no fix: here is what to do instead.';
  dlg.querySelector('.skyfix-top').hidden = true;
  chart.toggleAttribute('hidden', true);   // SVG: the .hidden property does not exist
  dlg.querySelector('.skyfix-axis').hidden = true;
  dlg.querySelector('.skyfix-legend').hidden = true;
  how.hidden = true;
  result.replaceChildren();

  const draw = vKm => {
    clearLostMap();
    let vis = null;
    try { vis = visibilityArrays(vKm); } catch (e) { console.warn('lost in dust: no visibility grid', e); }
    const p = lostInDustPlan({
      astronaut: inp.astronaut, visKm: vKm, vis, grid: d.grid, bounds: d.meta.bounds,
      posUncertaintyM: der.posUncertaintyM, driftPct: d.C.dead_reckoning_drift_pct,
      routeHomeKm: der.routeHomeKm, budget: der.budget, reason
    });
    const list = el('ol', 'lost-steps');
    const step = (title, text) => { const li = el('li'); li.append(el('strong', null, title), el('span', null, text)); list.append(li); };
    if (p.atHabitat) {
      step('You are at the habitat.', 'Go inside and wait for the dust to clear; plan the next walk when the hills are visible again.');
      return list;
    }
    step('Stop.', `Your position is known to about ±${fmtM(p.uncertaintyM)} (counted steps and heading since the last fix). ` +
      `Walking blind adds about ${d.C.dead_reckoning_drift_pct}% of every metre.`);
    const target = p.sightHome && p.sightHome.distM <= 3000 ? { ...p.sightHome, what: 'home' } : p.sightAny ? { ...p.sightAny, what: 'a landmark' } : null;
    if (target) {
      step(target.distM < 30 ? `${target.what === 'home' ? 'Home' : 'A landmark'} should be in view.` : `Nearest view of ${target.what}:`,
        target.distM < 30 ? 'From where the map thinks you are, it should be visible at this range. Look around slowly.'
          : `about ${fmtM(target.distM)} to the ${compass8(target.bearingDeg)} (${Math.round(target.bearingDeg)}°). ` +
            (p.uncertaintyExceedsVisibility ? 'Your position is less certain than you can see, so treat this as a direction to try, not a promise.' : ''));
    } else {
      step('No landmark in range.', `At ${fmtM(vKm * 1000)} visibility no mapped landmark is close enough to see from here.`);
    }
    if (p.spareMin != null) {
      step(p.spareMin > 0 ? `You can wait up to ${Math.round(p.spareMin)} min.` : 'No time to wait.',
        p.spareMin > 0
          ? `Suit time ${Math.round(p.suitMinLeft)} min, walk home ${Math.round(p.returnMin)} min. Local dust and dust devils pass in minutes to hours; ` +
            "Jezero's 2022 regional storm lasted about 6 sols and a global storm can last months, so don't wait past this."
          : `Suit time ${Math.round(p.suitMinLeft)} min is all needed for the ${Math.round(p.returnMin)} min walk home: start now.`);
    }
    if (p.homeKm != null) {
      step('Walk home on dead reckoning:', `follow the planned route (${p.homeKm.toFixed(1)} km) by step count and heading. ` +
        'There is no compass on Mars (no global magnetic field): heading comes from a gyro re-set against the Sun. ' +
        `Your uncertainty will grow to about ±${fmtM(p.endUncertaintyM)} by the habitat.` +
        (p.mayMissHabitat ? ` That is more than you can see (${fmtM(vKm * 1000)}), so you could walk past it: real missions plan radio or light beacons at the habitat for this (not simulated here).` : ''));
    }
    step('Try Horizon Match again', `when the hills come back${minVisKm ? ` (visibility above about ${minVisKm} km)` : ''}.`);

    const layers = [];
    if (target && target.distM >= 30 && map) {
      layers.push(L.polyline([[inp.astronaut.lat, inp.astronaut.lon], [target.lat, target.lon]], { color: '#f3c66c', weight: 2, dashArray: '6 6', interactive: false }).addTo(map));
      layers.push(L.circleMarker([target.lat, target.lon], { radius: 7, color: '#f3c66c', weight: 2, fillOpacity: 0.6, interactive: false })
        .bindTooltip(`Nearest view of ${target.what}`).addTo(map));
    }
    if (map) layers.push(L.circle([inp.astronaut.lat, inp.astronaut.lon], { radius: p.uncertaintyM, color: '#f3c66c', weight: 1, dashArray: '3 5', fillOpacity: 0.05, interactive: false }).addTo(map));
    ui.lostLayers = layers;
    return list;
  };

  const box = el('div', 'lost-box');
  let list = draw(visKm);
  if (reason === 'manual') {   // the app's dust model cannot see local dust: ask the astronaut how far they can see
    const row = el('div', 'skyfix-toggle');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'How far can you see?');
    row.append(el('span', 'lost-q', 'How far can you see?'));
    for (const km of SEE_CHOICES_KM) {
      const b = el('button', 'btn', fmtM(km * 1000));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(km === visKm));
      b.addEventListener('click', () => {
        row.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        const fresh = draw(km); list.replaceWith(fresh); list = fresh;
      });
      row.append(b);
    }
    box.append(row);
  }
  box.append(list, el('p', 'skyfix-note', 'Plan from the app\'s map and dead-reckoning model. The dust test is simulated on NASA terrain (scripts/skyline_dust.py).'));
  result.append(box);
  if (!dlg.open) dlg.show();
  if (map) map.flyTo([inp.astronaut.lat, inp.astronaut.lon], Math.max(map.getZoom(), 13), { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.8 });
}

function resetDialog() {
  const { dlg, chart, how } = ui;
  dlg.classList.remove('lost');
  dlg.querySelector('.skyfix-top').hidden = false;
  chart.toggleAttribute('hidden', false);
  dlg.querySelector('.skyfix-axis').hidden = false;
  dlg.querySelector('.skyfix-legend').hidden = false;
  how.hidden = false;
  dlg.querySelector('.skyfix-lead').textContent = LEAD;
}

// Live match needs the 40 m terrain grid (the 3D view loads the same file, so it is usually cached); falls back to 80 m.
let grid40P = null;
const loadGrid40 = () => (grid40P ??= fetch('data/heightgrid40.json')
  .then(r => (r.ok ? r.json() : null))
  .then(g => (g && Number.isInteger(g.w) && Number.isInteger(g.h) && g.data?.length === g.w * g.h ? g : null))
  .catch(() => null));

/** Runs the live match in small steps (one grid row each) so the page keeps drawing. */
async function runLive(o, isCurrent, onProgress) {
  const it = liveMatchSteps(o);
  for (;;) {
    const st = it.next();
    if (st.done) return st.value;
    if (!isCurrent()) return null;
    onProgress?.(st.value);
    await new Promise(r => setTimeout(r, 0));
  }
}

/**
 * @param {string|null} siteId  file in data/skyline/ (scripted demo replay); null with opts.live / opts.lost
 * @param {L.Map} map
 * @param {{ applyFix?: boolean, onClose?: () => void, lost?: boolean, live?: boolean, visKm?: number }} opts
 *   live=true: match the horizon at the astronaut's own (simulated true) position, searching around where dead
 *   reckoning puts them (skyline/livematch.js). Without it, the precomputed result for siteId is replayed (demo).
 *   applyFix=false when the demo player owns the position; lost=true opens "Lost in dust" directly (manual);
 *   visKm overrides the app's dust visibility (default: derived.limits.visibilityKm).
 */
export async function openSkylineFix(siteId, map, opts = {}) {
  const live = !!opts.live, lost = !!opts.lost;
  const [s0, dust] = await Promise.all([live || lost ? null : loadSite(siteId), loadDust()]);
  if (!ui) ui = { ...buildDialog(), timers: [], overlay: null, onClose: null, cmp: null, raf: 0, lostLayers: null };
  closeFix();
  resetDialog();
  ui.onClose = opts.onClose ?? null;
  const token = ui.token = {};
  const current = () => ui.token === token && ui.dlg.open;
  const { dlg, step, status, compass, chart, result } = ui;
  const store = getStore();
  const visKm = Number.isFinite(opts.visKm) ? opts.visKm : (store.derived?.limits?.visibilityKm ?? Infinity);
  const minVis = Number.isFinite(dust?.noFalseFixMinVisKm) ? dust.noFalseFixMinVisKm : 0;
  const placeName = s0?.name ?? 'your position';
  if (lost) { showLost(map, 'manual', SEE_CHOICES_KM[1], minVis, placeName); return; }
  if (visKm < minVis) { showLost(map, 'visibility', visKm, minVis, placeName); return; }
  const setStep = (i, text) => {
    [...step.children].forEach((li, k) => { li.className = k < i ? 'done' : k === i ? 'now' : ''; });
    status.textContent = text;
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  chart.replaceChildren();
  result.replaceChildren();
  dlg.querySelector('.skyfix-head h2').textContent = 'Horizon Match';
  if (!dlg.open) dlg.show();

  // live: simulate the turn at the true position, search around the dead-reckoning position
  let s = s0, dc = null, ref = store.inputs.astronaut;
  const drM = store.derived?.posUncertaintyM ?? 0;
  if (live) {
    setStep(0, 'Reading the horizon…');
    const grid = (await loadGrid40()) ?? store.data.grid;
    if (!current()) return;
    const truth = store.inputs.astronaut;
    const seed = seedOf(truth.lat, truth.lon) ^ Math.round((store.inputs.evaMin ?? 0) * 7);
    ref = deadReckoningPrior(truth, drM, seed);   // where the step count says you are
    s = await runLive({ grid, bounds: store.data.meta.bounds, truth, prior: ref, eyeM: store.data.C?.eye_height_m ?? 1.7, visKm, seed },
      current, f => { status.textContent = `Reading the horizon… ${Math.round(f * 100)}%`; });
    if (!s || !current()) return;
  } else {
    dc = dustCase(dust, siteId, visKm);   // null in clear air
  }
  const noFix = live ? !s.fix : !!(dc && !dc.fix);
  const dusty = live ? s.visKm != null : !!dc;
  const sc = chartScale(s);
  chart.replaceChildren(
    svg('line', { x1: 0, x2: CHART.w, y1: sc.y(0), y2: sc.y(0), class: 'zero' }),
    svg('polyline', { points: '', class: 'obs' }),
    svg('polyline', { points: '', class: 'best' })
  );
  const [, obs, best] = chart.children;

  // 1. Turn 360°
  const dustTxt = dusty ? ` In this dust, only hills within about ${live ? s.visKm.toFixed(1) : dc.visKm} km show.` : '';
  setStep(0, (live ? `Where your step count puts you (±${Math.round(drM)} m).` : `Near ${s.name}.`) +
    ' The astronaut turns slowly and the helmet camera traces the hills.' + dustTxt);
  const sweep = compass.querySelector('.sweep');
  const n = s.observed.length;
  if (reduced) {
    obs.setAttribute('points', points(s.observed, sc));
  } else {
    const t0 = performance.now();
    const tick = now => {
      if (!current()) return;
      const f = Math.min(1, (now - t0) / SWEEP_MS);
      sweep.setAttribute('transform', `rotate(${f * 360} 50 50)`);
      obs.setAttribute('points', points(s.observed, sc, Math.max(2, Math.round(f * n))));
      if (f < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // 2. Search the map (the grid is centred on where the astronaut thinks they are)
  const later = (ms, fn) => ui.timers.push(setTimeout(fn, reduced ? 0 : ms));
  later(SWEEP_MS, () => {
    setStep(1, 'Scanning the NASA terrain map: every dot is a spot whose horizon is being compared.');
    ui.scan = topoScan(map, s, { reduced }).catch(err => { console.error(err); return null; });
    map.flyToBounds(gridBounds(s.grid), { duration: reduced ? 0 : 0.8, padding: [40, 40] });
  });

  // 3. Fix, or no fix: the self-check decides (rule from scripts/skyline_dust.py)
  later(SWEEP_MS + SEARCH_MS, () => {
    if (noFix) {
      setStep(2, 'No reliable match.');
      ui.scan?.then(c => c?.remove());
      ui.scan = null;
      showLost(map, dusty ? 'no-fix' : 'no-match', visKm, minVis, placeName);
      return;
    }
    setStep(2, 'Best match found.');
    ui.scan?.then(c => c?.lock());
    [...step.children].forEach(li => { li.className = 'done'; });
    best.setAttribute('points', points(s.best, sc));
    // Never claim better than published horizon-matching accuracy (JPL: typically ~100 m; crew_constants.json)
    const st = getStore(), floorM = st.data?.C?.horizon_fix_min_uncertainty_m ?? 100;
    const raw = dc ? { ...s, estimate: dc.estimate, errorM: dc.errorM, uncertaintyM: dc.uncertaintyM, fov96: null } : s;
    const res = { ...raw, uncertaintyM: Math.max(raw.uncertaintyM, floorM) };
    // a bad fix accepted blindly is worse than none: only use it if it agrees with dead reckoning
    const gapM = distM(ref.lat, ref.lon, res.estimate.lat, res.estimate.lon);
    const applied = opts.applyFix === false ? undefined : gapM <= drM + res.uncertaintyM;
    const note = live
      ? `Simulated: the horizon at your true position is computed from NASA terrain with camera noise, then matched around where your step count puts you. The match is ${Math.round(gapM)} m from your step-count position.`
      : undefined;
    showResult(result, res, map, reduced, { applied, note });
    if (dc) result.append(el('p', 'skyfix-note', `Dust: matched with only the hills within ${dc.visKm} km (simulated dust test on NASA terrain). The chart shows the clear-day horizon.`));
    if (applied === true) {
      const cur = st.inputs.astronaut;
      setInputs({ astronaut: { ...cur, lat: res.estimate.lat, lon: res.estimate.lon }, distSinceFixM: 0, fixUncertaintyM: res.uncertaintyM });
    } else if (applied === false) {
      result.append(el('p', 'skyfix-warn', `The match is ${Math.round(gapM)} m from where your step count puts you (±${Math.round(drM)} m). ` +
        'One of them is wrong: stop, turn around once more, and compare with a landmark before moving.'));
    }
    map.flyTo([res.estimate.lat, res.estimate.lon], Math.max(map.getZoom(), 14), { duration: reduced ? 0 : 0.8 });
  });
}
