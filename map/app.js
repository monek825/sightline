// Written with AI assistance (Claude / GitHub Copilot)
// Boot: load data → pick real modules or stubs → init visibility → init store → mount read-only renderers.

import { loadAll } from '../lib/data.js';
import { createPipeline } from '../lib/pipeline.js';
import { initStore, setInputs, subscribe, getStore } from '../lib/store.js';
import { initVisibility, visibilityArrays } from './visibility.js';
import { prepareScenario, stateAt } from './scenario.js';
import { createMapView } from './map.js';
import { createPanels } from './panels.js';
import * as stubs from './stubs.js';
import { initMotion } from './motion.js';

const SPEED_MIN_PER_SEC = 2; // demo clock: 1 real second = 2 EVA minutes
const TAU_STORM = 3; // a tau event at or above this is captioned as a dust storm
// Story captions for the demo, one per scenario event type (plain-language narration for judges).
const CAPTIONS = {
  eva_start: () => 'The astronaut walks out to the Three Forks sample depot. Green means plenty of time to get home.',
  tau: e => e.value >= TAU_STORM
    ? `Dust storm (τ ${e.value}). Visibility drops and the red no-landmark zones grow.`
    : `Dust is rising (τ ${e.value}). Red areas: no landmark in sight, so it's easy to get lost there.`,
  skyline_fix: () => 'Lost without GPS? Skyline Fix finds the position by matching the horizon to NASA terrain.',
  sep_onset: () => 'Solar storm (a replay of May 2024). Radiation means: turn back to shelter now.',
  eva_end: () => 'Back at the habitat. The walk budget kept the astronaut safe.'
};

async function optionalModule(path) {
  try { return await import(path); } catch (err) {
    // missing module = fine (stub used); a broken module should be visible, not silent
    if (!/Failed to fetch|Importing a module script failed|error loading dynamically/i.test(err.message)) console.error(`${path} failed to load:`, err);
    return null;
  }
}

function fatal(msg) {
  const box = document.createElement('div');
  box.className = 'fatal';
  box.setAttribute('role', 'alert');
  box.textContent = msg;
  document.body.prepend(box);
}

async function boot() {
  if (!window.L) { fatal('Map library failed to load. Check your connection and reload.'); return; }
  const data = await loadAll();

  const crew = await optionalModule('../crew/budget.js');
  const route = await optionalModule('../route/route.js');
  const usingStubs = [];
  const M = {
    computeLimits: crew?.computeLimits ?? (usingStubs.push('crew model'), stubs.computeLimits),
    computeBudget: crew?.computeBudget ?? stubs.computeBudget,
    planRoute: route?.planRoute ?? (usingStubs.push('route planner'), stubs.planRoute),
    visibilityArrays
  };
  if (crew?.REQUIRED_KEYS) {
    const missing = crew.REQUIRED_KEYS.filter(k => !(k in data.C));
    if (missing.length) data.warnings.push(`crew_constants.json is missing: ${missing.join(', ')}`);
  }

  initVisibility(data.viewsheds, data.landmarks, data.grid, data.bounds);
  let retarget = null; // set by setupScenario below: the clicked target drives the demo walk, not just the orange line
  const view = createMapView(data, { onPickTarget: target => { setInputs({ target }); retarget?.(target); } });
  const renderPanels = createPanels(data, { setInputs, usingStubs });

  initStore(data, createPipeline(M), { astronaut: { ...data.meta.home, headingDeg: 0 } });
  for (const w of data.warnings) console.warn(w);
  subscribe(view.render);
  subscribe(renderPanels);

  const skyline = await optionalModule('../skyline/skyline.js');
  const skyIds = (data.targets ?? []).map(t => t.id);
  const skyResults = skyline ? await skyline.loadSkylineResults(skyIds) : {};
  initMotion();
  retarget = setupScenario(data, M, { skyline, skyResults, map: view.map });
  setupHelmet(data);
  setupSkyline(view.map, skyline, skyResults);
  setupWelcome();
  document.addEventListener('keydown', e => {
    if (e.key === 'v' && !e.target.closest('input, select, textarea')) document.body.classList.toggle('video');
  });
}

function setupScenario(data, M, sky) {
  if (!data.scenario) { document.getElementById('timeline').hidden = true; return null; }
  let prep = prepareScenario(data.scenario, data, M);
  const play = document.getElementById('t-play');
  const scrub = document.getElementById('t-scrub');
  const label = document.getElementById('t-label');
  scrub.max = prep.endT;
  let t = 0, playing = false, last = 0, raf = 0;

  const fixesOf = p => (p.scenario.events ?? []).filter(e => e.type === 'skyline_fix' && sky.skyResults[e.site]);
  let fixEvents = fixesOf(prep);
  const caption = document.getElementById('caption');
  const captionAt = tt => {
    const ev = (prep.scenario.events ?? []).filter(e => e.tMin <= tt && CAPTIONS[e.type]).pop();
    return ev ? CAPTIONS[ev.type](ev) : '';
  };
  const apply = () => {
    setInputs(stateAt(prep, t, sky.skyResults));
    const text = t > 0 || playing ? captionAt(t) : '';
    if (caption.textContent !== text) { caption.textContent = text; caption.hidden = !text; }
    scrub.value = t;
    label.textContent = `t = ${Math.round(t)} min`;
  };
  const frame = now => {
    if (!playing) return;
    const prevT = t;
    t = Math.min(prep.endT, t + (now - last) / 1000 * SPEED_MIN_PER_SEC);
    last = now;
    apply();
    const fix = fixEvents.find(e => prevT < e.tMin && e.tMin <= t);
    if (fix) { // pause, play the Skyline Fix, resume when the panel closes
      stop();
      sky.skyline.openSkylineFix(fix.site, sky.map, { applyFix: false, onClose: start });
      return;
    }
    if (t >= prep.endT) { stop(); return; }
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (t >= prep.endT) t = 0;
    playing = true; last = performance.now();
    play.textContent = 'Pause'; play.setAttribute('aria-label', 'Pause demo');
    raf = requestAnimationFrame(frame);
  };
  function stop() {
    playing = false; cancelAnimationFrame(raf);
    play.textContent = 'Play demo'; play.setAttribute('aria-label', 'Play demo');
  }
  play.addEventListener('click', () => (playing ? stop() : start()));
  document.getElementById('t-reset').addEventListener('click', () => { stop(); t = 0; apply(); });
  scrub.addEventListener('input', () => { stop(); t = Number(scrub.value); apply(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  // re-plan the walk for a target + mode; an unreachable one keeps the old walk
  const replan = (target, mode) => {
    const next = prepareScenario(data.scenario, data, M, target, mode);
    if (!next.outOk) return;
    const wasPlaying = playing;
    stop();
    prep = next; fixEvents = fixesOf(prep);
    scrub.max = prep.endT; t = 0; apply();
    if (wasPlaying) start();
  };
  // changing the route mode after picking a target re-plans the walk too (value from the event, not listener order)
  document.getElementById('c-mode').addEventListener('change', e => { if (prep.custom) replan(prep.target, e.target.value); });
  return target => replan(target, getStore().inputs.routeMode);
}

// First-visit card: what this is + one-click story. Shown once per browser session.
function setupWelcome() {
  const card = document.getElementById('welcome');
  let seen = false;
  try { seen = sessionStorage.getItem('sightline-welcome') === '1'; } catch { /* storage blocked: show it */ }
  if (seen || !document.getElementById('timeline') || document.getElementById('timeline').hidden) return;
  const close = () => {
    card.hidden = true;
    try { sessionStorage.setItem('sightline-welcome', '1'); } catch { /* fine */ }
  };
  card.hidden = false;
  document.getElementById('w-play').addEventListener('click', () => { close(); document.getElementById('t-play').click(); });
  document.getElementById('w-close').addEventListener('click', close);
  card.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.getElementById('w-play').focus({ preventScroll: true });
}

function setupHelmet(data) {
  const dlg = document.getElementById('dlg-helmet');
  const frame = document.getElementById('helmet-frame');
  const msg = () => {
    const { inputs, derived } = getStore();
    // no typed arrays across the boundary (ARCHITECTURE §9)
    return { type: 'sightline:state', v: 1, inputs,
      derived: { limits: derived.limits, budget: derived.budget, routeHome: derived.routeHome, posUncertaintyM: derived.posUncertaintyM } };
  };
  const send = () => {
    if (!dlg.open || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage(msg(), location.origin); } catch { /* helmet not ready */ }
  };
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'sightline:hello') send();
  });
  subscribe(() => send());
  document.getElementById('btn-helmet').addEventListener('click', async () => {
    const ok = await fetch('helmet/index.html', { method: 'HEAD' }).then(r => r.ok).catch(() => false);
    if (!ok) { frame.removeAttribute('src'); frame.srcdoc = '<p style="font:16px sans-serif;color:#ccc;padding:24px">Helmet view is not built yet (helmet/index.html).</p>'; }
    else if (!frame.getAttribute('src') || frame.getAttribute('src') === 'about:blank') { frame.removeAttribute('srcdoc'); frame.src = 'helmet/index.html'; }
    dlg.showModal();
  });
}

function nearestSite(results, at) {
  let best = null, bestD = Infinity;
  for (const [id, s] of Object.entries(results)) {
    const d = (s.truth.lat - at.lat) ** 2 + ((s.truth.lon - at.lon) * Math.cos(at.lat * Math.PI / 180)) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

function setupSkyline(map, mod, results) {
  document.getElementById('btn-skyline').addEventListener('click', () => {
    const site = mod && nearestSite(results, getStore().inputs.astronaut);
    if (site) { mod.openSkylineFix(site, map).catch(err => console.error(err)); return; }
    const banner = document.getElementById('banner');
    banner.textContent = 'Skyline Fix panel is not built yet (skyline/skyline.js).';
    banner.hidden = false;
    setTimeout(() => { banner.hidden = !getStore().inputs.sepActive; }, 3000);
  });
}

boot().catch(err => { console.error(err); fatal(`Sightline failed to start: ${err.message}`); });
