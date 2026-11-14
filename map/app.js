// Written with AI assistance (Claude / GitHub Copilot)
// Boot: load data → pick real modules or stubs → init visibility → init store → mount read-only renderers.

import { loadAll } from '../lib/data.js';
import { createPipeline } from '../lib/pipeline.js';
import { initStore, setInputs, subscribe, getStore } from '../lib/store.js';
import { initVisibility, visibilityArrays } from './visibility.js';
import { prepareScenario, stateAt, pathUpTo, editScenario } from './scenario.js';
import { createMapView } from './map.js';
import { createPanels } from './panels.js';
import * as stubs from './stubs.js';
import { initMotion } from './motion.js';

const SPEED_MIN_PER_SEC = 2; // demo clock: 1 real second = 2 EVA minutes
const TAU_STORM = 3; // a tau event at or above this is captioned as a dust storm
// Story captions for the demo, one per scenario event type (plain-language narration for judges).
const CAPTIONS = {
  eva_start: () => 'The astronaut walks out to the Three Forks sample depot. Green means there is plenty of time to get home.',
  tau: e => e.value >= TAU_STORM
    ? `Dust storm (τ ${e.value}, sped up: real storms build over days). Visibility drops and the red no-landmark zones grow.`
    : `Dust is rising (τ ${e.value}). Red areas have no landmark in sight, so it is easy to get lost there.`,
  skyline_fix: () => 'Without GPS, Horizon Match finds the position by matching the horizon to NASA terrain.',
  sep_onset: () => 'Solar storm, replay of May 2024. Turn back to shelter now because of the radiation.',
  return_home: () => 'The astronaut turns back to the habitat.',
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
  let setCondition = null; // likewise: a condition control edits the scenario from the current demo time on
  let runHasSep = null; // likewise: does this run include the solar particle event? (null = no scenario file)
  const view = createMapView(data, { onPickTarget: target => { setInputs({ target }); retarget?.(target); } });
  let runEvents = null; // likewise: the run's current events (the timeline markers follow them)
  let setSpeed = null, getSpeed = null; // likewise: playback multiplier (player state, not model state)
  const renderPanels = createPanels(data, { setInputs, usingStubs, onCondition: (key, value) => setCondition ? setCondition(key, value) : false, runHasSep: () => runHasSep ? runHasSep() : null,
    runEvents: () => runEvents ? runEvents() : null, onSpeed: k => setSpeed?.(k), getSpeed: () => getSpeed ? getSpeed() : 1, speedBase: SPEED_MIN_PER_SEC });

  initStore(data, createPipeline(M), { astronaut: { ...data.meta.home, headingDeg: 0 } });
  for (const w of data.warnings) console.warn(w);
  subscribe(view.render);
  subscribe(renderPanels);

  const skyline = await optionalModule('../skyline/skyline.js');
  const skyIds = (data.targets ?? []).map(t => t.id);
  const skyResults = skyline ? await skyline.loadSkylineResults(skyIds) : {};
  initMotion();
  ({ retarget = null, setCondition = null, runHasSep = null, runEvents = null, setSpeed = null, getSpeed = null } = setupScenario(data, M, { skyline, skyResults, map: view.map }) ?? {});
  renderPanels(getStore()); // the run setting is known now: show it (a re-render, no state written)
  setupHelmet(data);
  setupSkyline(view.map, skyline, skyResults);
  setupWelcome();
  document.addEventListener('keydown', e => {
    if (e.key === 'v' && !e.target.closest('input, select, textarea')) document.body.classList.toggle('video');
  });
}

function setupScenario(data, M, sky) {
  if (!data.scenario) { document.getElementById('timeline').hidden = true; return null; }
  let scenario = data.scenario; // the user's condition edits make a new one; the data file is never touched
  let prep = prepareScenario(scenario, data, M);
  const play = document.getElementById('t-play');
  const scrub = document.getElementById('t-scrub');
  const label = document.getElementById('t-label');
  const homeBtn = document.getElementById('t-home');
  scrub.max = prep.endT;
  let t = 0, playing = false, last = 0, raf = 0;
  let speed = 1; // playback multiplier 1-10: player state, not model state (never in the store)

  const fixesOf = p => (p.scenario.events ?? []).filter(e => e.type === 'skyline_fix' && sky.skyResults[e.site]);
  let fixEvents = fixesOf(prep);
  const caption = document.getElementById('caption');
  const captionAt = tt => {
    const ev = (prep.scenario.events ?? []).filter(e => e.tMin <= tt && CAPTIONS[e.type]).pop();
    return ev ? CAPTIONS[ev.type](ev) : '';
  };
  const apply = () => {
    setInputs(stateAt(prep, t, sky.skyResults));
    const text = t > 0 || playing ? captionAt(t) : 'Press play to start the 100-second demo.';
    if (caption.textContent !== text) { caption.textContent = text; caption.hidden = !text; }
    scrub.value = t;
    label.textContent = `t = ${Math.round(t)} min`;
    homeBtn.disabled = !(t > 0 && t < prep.sepT && t < prep.endT); // a press only acts on the outbound leg
  };
  caption.textContent = 'Press play to start the 100-second demo.';
  caption.hidden = false;
  const frame = now => {
    if (!playing) return;
    const prevT = t;
    t = Math.min(prep.endT, t + (now - last) / 1000 * SPEED_MIN_PER_SEC * speed);
    last = now;
    apply();
    const fix = fixEvents.find(e => prevT < e.tMin && e.tMin <= t);
    if (fix) { // pause, play the Horizon Match, resume when the panel closes
      stop();
      const restore = show2D();
      sky.skyline.openSkylineFix(fix.site, sky.map, { applyFix: false, onClose: () => { restore(); start(); } });
      return;
    }
    if (t >= prep.endT) { stop(); return; }
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (t >= prep.endT) t = 0;
    playing = true; last = performance.now();
    play.dataset.state = 'playing'; play.setAttribute('aria-label', 'Pause demo');
    raf = requestAnimationFrame(frame);
  };
  function stop() {
    playing = false; cancelAnimationFrame(raf);
    play.dataset.state = 'paused'; play.setAttribute('aria-label', 'Play demo');
  }
  play.addEventListener('click', () => (playing ? stop() : start()));
  document.getElementById('t-reset').addEventListener('click', () => {
    stop();
    const sc = editScenario(scenario, t, 'returnHome', false);
    if (sc === scenario || !swap(sc, prep.target, prep.custom ? getStore().inputs.routeMode : 'safest', 'zero')) { t = 0; apply(); }
  });
  scrub.addEventListener('input', () => { stop(); t = Number(scrub.value); apply(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  // swap in a re-prepared walk for scenario `sc`; false (nothing changed) if the new one is unreachable.
  // clock: 'auto' = out walking keeps the clock and the walked prefix, else restart; 'keep' = keep the clock; 'zero' = restart
  const swap = (sc, target, mode, clock) => {
    // already out walking (before the turn-back): re-plan from the astronaut's position, keep the clock
    const walking = clock !== 'zero' && t > 0 && (prep.sepT === null || t <= prep.sepT) && t < prep.endT;
    // already heading home and only a condition changed: keep the whole outbound leg so the history does not move
    const returning = clock === 'keep' && prep.sepT !== null && t > prep.sepT;
    const from = walking ? { prefix: pathUpTo(prep.outPts, Math.min(prep.mPerMin * t, prep.outLen)), tMin: t }
      : returning ? { prefix: prep.outPts, tMin: prep.sepT, backPrefix: pathUpTo(prep.back, Math.min(prep.mPerMin * (t - prep.sepT), prep.backLen)), backTMin: t } : null;
    const next = prepareScenario(sc, data, M, target, mode, from);
    if (!next.outOk) return false;
    const wasPlaying = playing;
    stop();
    scenario = sc; prep = next; fixEvents = fixesOf(prep);
    scrub.max = prep.endT; if (clock === 'zero' || (clock === 'auto' && !from)) t = 0; apply();
    if (wasPlaying) start();
    return true;
  };
  // re-plan the walk for a target + mode; an unreachable one keeps the old walk
  const replan = (target, mode) => swap(editScenario(scenario, t, 'returnHome', false), target, mode, 'auto');
  // turn back to the habitat now, from here; only on the outbound leg
  homeBtn.addEventListener('click', () => {
    if (!(t > 0 && t < prep.sepT && t < prep.endT)) return;
    swap(editScenario(scenario, t, 'returnHome', true), prep.target, prep.custom ? getStore().inputs.routeMode : 'safest', 'keep');
  });
  // a condition control edit from demo time t on; sol is a different EVA day, so it restarts the walk
  const runHasSep = () => scenario.events.some(e => e.type === 'sep_onset'); // the run setting behind the checkbox
  const setCondition = (key, value) => {
    const sc = editScenario(scenario, t, key, value, prep.hourMin, data.scenario);
    if (key === 'sepActive' && sc !== scenario) {
      // the solar particle event is a run setting: if it changes the walk already shown (t is past the earlier leg switch), restart the run
      const mode = prep.custom ? getStore().inputs.routeMode : 'safest';
      const nextSwitch = prepareScenario(sc, data, M, prep.target, mode).sepT;
      swap(sc, prep.target, mode, t > Math.min(prep.sepT, nextSwitch) ? 'zero' : 'keep');
      apply(); // also puts the checkbox back when the change was unreachable
      return true;
    }
    if (sc !== scenario && swap(sc, prep.target, prep.custom ? getStore().inputs.routeMode : 'safest', key === 'sol' ? 'zero' : 'keep')) return true;
    apply(); // no-op or unreachable edit: put the controls back to what the demo shows
    return true;
  };
  // changing the route mode after picking a target re-plans the walk too (value from the event, not listener order)
  document.getElementById('c-mode').addEventListener('change', e => { if (prep.custom) replan(prep.target, e.target.value); });
  // Events you control: trigger one now, or start a scripted / random / calm run.
  const mode0 = () => (prep.custom ? getStore().inputs.routeMode : 'safest');
  const fixed = evs => evs.filter(e => e.type === 'eva_start' || e.type === 'eva_end' || e.type === 'skyline_fix');
  const randomEvents = () => {
    const r = (a, b) => Math.round(a + Math.random() * (b - a));
    const end = data.scenario.events.find(e => e.type === 'eva_end')?.tMin ?? 200;
    const evs = [...fixed(data.scenario.events), { tMin: r(10, 45), type: 'tau', value: +(0.4 + Math.random()).toFixed(1) }];
    if (Math.random() < 0.7) evs.push({ tMin: r(50, end - 60), type: 'tau', value: +(3 + Math.random() * 6).toFixed(1) });
    if (Math.random() < 0.6) evs.push({ ...data.scenario.events.find(e => e.type === 'sep_onset'), tMin: r(35, end - 50) });
    return evs;
  };
  const triggerEvent = kind => {
    if (kind === 'dust' || kind === 'clear') {   // storms build up (and clear) gradually, with gusts
      swap(editScenario(scenario, t, 'tauRamp', kind === 'dust' ? 6 : 0.4, prep.hourMin, data.scenario), prep.target, mode0(), 'keep');
      return apply();
    }
    if (kind === 'solar') { swap(editScenario(scenario, Math.max(t, 1), 'sepAt', true, prep.hourMin, data.scenario), prep.target, mode0(), 'keep'); return apply(); }
    if (kind === 'lost') { stop(); document.getElementById('btn-skyline').click(); return; }
    const list = kind === 'random' ? randomEvents() : kind === 'calm' ? fixed(data.scenario.events) : data.scenario.events;
    swap(editScenario(scenario, 0, 'events', list), prep.target, mode0(), 'zero');
    apply();
  };
  for (const b of document.querySelectorAll('[data-event]')) b.addEventListener('click', () => triggerEvent(b.dataset.event));
  const setSpeed = k => { speed = Math.min(10, Math.max(1, Math.round(Number(k)) || 1)); }; // takes effect on the next frame; the clock does not jump
  return { retarget: target => replan(target, getStore().inputs.routeMode), setCondition, runHasSep, runEvents: () => scenario.events, setSpeed, getSpeed: () => speed };
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
  // the main 3D map is hidden behind the helmet window: stop drawing it (one WebGL scene at a time)
  const pauseMain3D = paused => {
    const sc = document.querySelector('#view3d a-scene');
    if (!sc?.renderer) return;
    sc.renderer.setAnimationLoop(paused ? null : sc.render);
  };
  dlg.addEventListener('close', () => pauseMain3D(false));
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
    pauseMain3D(true);
  });
}

// Skyline Fix draws its search heat map on the 2D map: switch to 2D for it, and back afterwards.
function show2D() {
  const b2 = document.getElementById('v-2d');
  if (b2.getAttribute('aria-pressed') === 'true') return () => {};
  b2.click();
  return () => document.getElementById('v-3d').click();
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
  // Lost in dust: the astronaut cannot see the hills (local dust the app's τ model does not know about)
  document.getElementById('btn-lostdust')?.addEventListener('click', () => {
    const site = mod && nearestSite(results, getStore().inputs.astronaut);
    if (!site) return;
    const restore = show2D();
    mod.openSkylineFix(site, map, { onClose: restore, lost: true }).catch(err => console.error(err));
  });
  document.getElementById('btn-skyline').addEventListener('click', () => {
    const site = mod && nearestSite(results, getStore().inputs.astronaut);
    if (site) { const restore = show2D(); mod.openSkylineFix(site, map, { onClose: restore }).catch(err => console.error(err)); return; }
    const banner = document.getElementById('banner');
    banner.textContent = 'Horizon Match panel is not built yet (skyline/skyline.js).';
    banner.hidden = false;
    setTimeout(() => { banner.hidden = !getStore().inputs.sepActive; }, 3000);
  });
}

// the intro holds on the logo until this fires (or a timeout)
const announceReady = () => { window.sightlineReady = true; window.dispatchEvent(new Event('sightline:ready')); };
boot().then(announceReady, err => { announceReady(); console.error(err); fatal(`Sightline failed to start: ${err.message}`); });
