// Written with AI assistance (Claude / GitHub Copilot)
// Boot: load data → pick real modules or stubs → init visibility → init store → mount read-only renderers.

import { loadAll } from '../lib/data.js';
import { createPipeline } from '../lib/pipeline.js';
import { initStore, setInputs, subscribe, getStore, DEFAULT_INPUTS } from '../lib/store.js';
import { initVisibility, visibilityArrays } from './visibility.js';
import { prepareScenario, stateAt, pathUpTo, editScenario, walkedOutM, nextDustForecast } from './scenario.js';
import { createMapView } from './map.js';
import { createPanels } from './panels.js';
import * as stubs from './stubs.js';
import { initMotion } from './motion.js';
import { setupPlanner } from './planner.js';
import { setupHowto } from './howto.js';

const FIX_AUTO_CLOSE_MS = 9000;   // demo: the scripted Horizon Match panel closes itself after the match plays (~5.5 s) plus time to read
const SPEED_MIN_PER_SEC = 2; // demo clock: 1 real second = 2 EVA minutes
// Story captions for the demo, one per scenario event type (plain-language narration for judges).
const CAPTIONS = {
  eva_start: (e, C, custom) => `The astronaut walks out ${custom ? 'on the planned walk' : 'to the Three Forks sample depot'}. Green means there is plenty of time to get home.`,
  tau: (e, C) => e.value <= (C?.tau_typical ?? 0.4) * 1.25 ? `Clear sky (τ ${e.value}): the hills are easy to see.` : e.value > (C?.tau_amber ?? 1)
    ? `Dust storm (τ ${e.value}, sped up: real storms build over days). Visibility drops and the red no-landmark zones grow.`
    : `Dust is rising (τ ${e.value}). Red areas have no landmark in sight, so it is easy to get lost there.`,
  skyline_fix: () => 'No GPS: after kilometres of counting steps, the suit\'s position guess has drifted (the ring). Horizon Match reads the hills and shrinks it back.',
  sep_onset: () => 'Solar storm, replay of May 2024 (about 30 chest X-rays of dose). Turn back to shelter now to keep the radiation low.',
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
  setupHowto(data, M);
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
  helmetLook = setupHelmet(data, view, skyline);
  viewRef = view;
  setupSkyline(view.map, skyline, skyResults);
  setupWelcome();
  setupBannerMini();
  document.addEventListener('keydown', e => {
    if (e.key === 'v' && !e.target.closest('input, select, textarea')) document.body.classList.toggle('video');
  });
}

// Guided story: when a chapter starts, the control that explains it glows and a short tip points at it (4.5 s).
const COACH = {
  'Walk out': ['#panel', 'Walk status: minutes left to get home, from NASA suit and body data.'],
  'Dust rises': ['#t-dust', 'Red on the map = no landmark in sight. Dust makes it grow.'],
  'Dust storm': ['#t-dust', 'Thick dust: the hills fade and the red zones spread.'],
  'Clear sky': ['#t-dust', 'Clear air: you can see landmarks far away, so the red zones shrink.'],
  'Position fix': ['#t-pos', 'No GPS: the ring is how far off the position may be. Horizon Match shrinks it.'],
  'Solar storm': ['#panel', 'Radiation: the plan turns the astronaut home now.'],
  'Turn back': ['#panel', 'Heading home on the route that keeps landmarks in sight.'],
  'Home': ['#layers', 'Your turn: switch views, hide layers, or start your own storm in Details.']
};
let coachT = 0, coachEl = null;
function coach(ch) {
  const tip = document.getElementById('coach'), spec = COACH[ch.name];
  if (!tip || !spec) return;
  clearTimeout(coachT);
  coachEl?.classList.remove('coach-on');
  const target = document.querySelector(spec[0]);
  const r = target?.getBoundingClientRect();
  const visible = r && r.width > 0 && r.right > 0 && r.left < innerWidth && !document.body.classList.contains('panel-hidden');
  tip.textContent = spec[1];
  tip.hidden = false;
  tip.classList.remove('show');
  const tw = Math.min(280, innerWidth - 24);
  let x = innerWidth / 2, y = innerHeight - 200, below = false;
  if (visible) {
    x = Math.min(innerWidth - tw / 2 - 12, Math.max(tw / 2 + 12, r.left + r.width / 2));
    below = r.top < 140;
    y = below ? r.bottom + 12 : r.top - 12;
    coachEl = target; target.classList.add('coach-on');
  }
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  tip.classList.toggle('below', below);
  requestAnimationFrame(() => tip.classList.add('show'));
  coachT = setTimeout(() => { tip.classList.remove('show'); coachEl?.classList.remove('coach-on'); setTimeout(() => { tip.hidden = true; }, 300); }, 4500);
}

function setupScenario(data, M, sky) {
  if (!data.scenario) { document.getElementById('timeline').hidden = true; return null; }
  let scenario = data.scenario; // the user's condition edits make a new one; the data file is never touched
  let prep = prepareScenario(scenario, data, M);
  const play = document.getElementById('t-play');
  const scrub = document.getElementById('t-scrub');
  const label = document.getElementById('t-label');
  const homeBtn = document.getElementById('t-turnback');
  scrub.max = prep.endT;
  let t = 0, playing = false, last = 0, raf = 0;
  let pauseId = 0; // bumped by every start/stop: a Horizon Match pause only resumes if nothing happened since
  let speed = 1; // playback multiplier 1-10: player state, not model state (never in the store)

  const fixesOf = p => (p.scenario.events ?? []).filter(e => e.type === 'skyline_fix' && sky.skyResults[e.site]);
  let fixEvents = fixesOf(prep);
  const caption = document.getElementById('caption');
  // Story chapters (the timeline in the bottom centre): from the run's events, plus "Home" when the astronaut arrives.
  const CH = { eva_start: 'Walk out', skyline_fix: 'Position fix', sep_onset: 'Solar storm', return_home: 'Turn back' };
  const chapters = () => {
    const out = [];
    for (const e of prep.scenario.events ?? []) {
      const name = e.type === 'tau' ? (e.value > (data.C?.tau_amber ?? 1) ? 'Dust storm' : e.value > (data.C?.tau_typical ?? 0.4) * 1.25 ? 'Dust rises' : 'Clear sky') : CH[e.type];
      if (!name || (out.length && out[out.length - 1].name === name)) continue;
      out.push({ name, t: e.tMin, ev: e });
    }
    const home = prep.sepT !== null && prep.backLen ? prep.sepT + prep.backLen / prep.mPerMin : null;
    if (home !== null && home < prep.endT) out.push({ name: 'Home', t: home, ev: { type: 'eva_end' } });
    return out.sort((a, b) => a.t - b.t);
  };
  let chs = [], chKey = '', lastCh = -1;
  const steps = document.getElementById('story-steps');
  const buildSteps = () => {
    chs = chapters();
    const key = chs.map(c => c.name + c.t.toFixed(1)).join('|');
    if (key === chKey) return;
    chKey = key; lastCh = -1;
    const fill = document.createElement('span'); fill.className = 'story-fill';
    steps.replaceChildren(fill, ...chs.map((c, i) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.dataset.i = i;
      b.append(document.createElement('i'), Object.assign(document.createElement('span'), { textContent: c.name }));
      b.setAttribute('aria-label', `Jump to ${c.name}`);
      b.addEventListener('click', () => { t = Math.min(prep.endT, c.t + 0.01); apply(); });
      li.append(b);
      return li;
    }));
  };
  const chapterAt = tt => { let k = -1; chs.forEach((c, i) => { if (c.t <= tt) k = i; }); return k; };
  const captionAt = tt => {
    const k = chapterAt(tt);
    // Orbiter forecast: shown before a dust storm starts; the storm's own caption takes over at the event.
    // During a solar storm both are shown, the solar storm first (more urgent).
    const fc = nextDustForecast(prep.scenario, tt, data.C?.tau_amber ?? 1);
    const fcText = fc ? `Orbiter forecast: dust storm in ~${fc.inMin} min.` : '';
    const ev = k < 0 ? null : chs[k].ev;
    if (ev?.type === 'sep_onset') return [CAPTIONS.sep_onset(ev, data.C), fcText].filter(Boolean).join(' ');
    if (fc) return `${fcText} Plan the way home now.`;
    return ev && CAPTIONS[ev.type] ? CAPTIONS[ev.type](ev, data.C, prep.custom) : '';
  };
  const showSteps = tt => {
    const k = chapterAt(tt), n = chs.length;
    // fill: evenly spaced steps, so the bar reaches step k and then moves toward step k+1 with time
    const next = chs[k + 1], cur = chs[k];
    const f = k < 0 ? 0 : next ? (tt - cur.t) / Math.max(0.01, next.t - cur.t) : 1;
    steps.style.setProperty('--fill', n > 1 ? String(Math.min(1, (Math.max(0, k) + Math.min(1, f)) / (n - 1))) : '0');
    if (k !== lastCh) {
      [...steps.querySelectorAll('button')].forEach((b, i) => { b.classList.toggle('done', i < k); b.classList.toggle('now', i === k); });
      if (playing && k > lastCh && k >= 0) { coach(chs[k]); narrateChapter(chs[k].name); }
      lastCh = k;
    }
  };
  // Narration (optional): the team's recorded voice-over (ElevenLabs TTS, assets/voice/) plays as each story chapter starts
  const VOICE = { 'Walk out': 'walk-out', 'Dust rises': 'dust-rises', 'Position fix': 'position-fix', 'Solar storm': 'solar-storm', 'Dust storm': 'dust-storm', 'Home': 'home' };
  const voice = new Audio();
  let narrateOn = false;
  const narrateChapter = name => {
    if (!narrateOn || !VOICE[name]) return;
    voice.pause();
    voice.src = `assets/voice/${VOICE[name]}.mp3`;
    voice.play().catch(err => console.warn('narration could not play', err));
  };
  const narrBtn = document.getElementById('story-narrate');
  if (narrBtn) {
    narrBtn.hidden = false;
    narrBtn.addEventListener('click', () => {
      narrateOn = !narrateOn;
      narrBtn.setAttribute('aria-pressed', String(narrateOn));
      if (narrateOn) { const k = chapterAt(t); if (k >= 0) narrateChapter(chs[k].name); } else voice.pause();
    });
  }
  const apply = () => {
    setInputs(stateAt(prep, t, sky.skyResults));
    buildSteps(); showSteps(t);
    const text = t > 0 || playing ? captionAt(t) : 'Press play: the story shows every feature in 100 seconds.';
    if (caption.textContent !== text) { caption.textContent = text; caption.hidden = !text; }
    scrub.value = t;
    label.textContent = `t = ${Math.round(t)} min`;
    homeBtn.disabled = !(t > 0 && t < prep.sepT && t < prep.endT); // a press only acts on the outbound leg
  };
  caption.textContent = 'Press play: the story shows every feature in 100 seconds.';
  buildSteps(); showSteps(0);
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
      caption.textContent = 'Horizon Match: matching the hill outline. The demo goes on by itself.'; caption.hidden = false;
      const id = pauseId;
      show2D().then(restore => {
        sky.skyline.openSkylineFix(fix.site, sky.map, { applyFix: false, onClose: () => { restore(); if (id === pauseId) start(); } });
        setTimeout(() => { if (id === pauseId) sky.skyline.closeFix(); }, FIX_AUTO_CLOSE_MS);   // the demo never waits on a click
      });
      return;
    }
    if (t >= prep.endT) { stop(); return; }
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (t >= prep.endT) t = 0;
    pauseId++; playing = true; last = performance.now();
    play.dataset.state = 'playing'; play.setAttribute('aria-label', 'Pause demo');
    raf = requestAnimationFrame(frame);
  };
  function stop() {
    pauseId++; playing = false; cancelAnimationFrame(raf);
    voice.pause();   // narration stops with the story
    play.dataset.state = 'paused'; play.setAttribute('aria-label', 'Play demo');
  }
  play.addEventListener('click', () => (playing ? stop() : start()));
  document.getElementById('t-reset').addEventListener('click', () => {
    stop();
    sky.skyline?.closeFix();   // an open Horizon Match panel belongs to the run being reset
    // Reset = the original story again: scripted events, story target, default route and speed, default crew settings
    scenario = data.scenario; prep = prepareScenario(scenario, data, M); fixEvents = fixesOf(prep);
    scrub.max = prep.endT; speed = 1; t = 0;
    const d = DEFAULT_INPUTS;
    setInputs({ sol: d.sol, sansAffected: d.sansAffected, routeMode: d.routeMode, target: null });
    for (const [id, v] of [['c-mode', d.routeMode], ['c-sans', d.sansAffected], ['c-sep', false], ['c-speed', 1]]) {
      const el = document.getElementById(id);
      if (el) { if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input')); }
    }
    apply();
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
    const from = walking ? { prefix: pathUpTo(prep.outPts, walkedOutM(prep, t)), tMin: t }
      : returning ? { prefix: prep.outPts, tMin: prep.sepT, backPrefix: pathUpTo(prep.back, Math.min(prep.mPerMin * (t - prep.sepT), prep.backLen)), backTMin: t } : null;
    // a restart from minute 0 begins at the local time shown now (else a time set mid-walk jumped back: 7:00 -> 6:06)
    const restart = clock === 'zero' || (clock === 'auto' && !from);
    if (restart && t > 0) sc = { ...sc, startLtst: sc.startLtst + t / prep.hourMin };
    const next = prepareScenario(sc, data, M, target, mode, from);
    if (!next.outOk) return false;
    const wasPlaying = playing;
    stop();
    scenario = sc; prep = next; fixEvents = fixesOf(prep);
    scrub.max = prep.endT; if (restart) t = 0; apply();
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
  // Random run, drawn from what Mars does (data/crew_constants.json, all marked): a season, the normal dust for it,
  // then maybe a regional storm (dusty season), rarely a global one, and maybe a solar storm. Dice, not a forecast.
  const randomEvents = () => {
    const C = data.C, u = Math.random, r = (a, b) => Math.round(a + u() * (b - a)), f1 = v => +v.toFixed(1);
    const end = data.scenario.events.find(e => e.type === 'eva_end')?.tMin ?? 200;
    const dusty = u() < C.dusty_season_frac;
    const base = dusty ? C.tau_typical + u() * (C.tau_dusty_season_max - C.tau_typical) : C.tau_typical * (0.75 + 0.5 * u());
    const evs = [...fixed(data.scenario.events), { tMin: r(10, 45), type: 'tau', value: f1(base) }];
    const roll = u();
    if (dusty && roll < C.global_storm_chance) evs.push({ tMin: r(50, end - 60), type: 'tau', value: f1(C.global_storm_tau * (0.7 + 0.3 * u())) });
    else if (dusty && roll < C.global_storm_chance + C.regional_storm_chance) evs.push({ tMin: r(50, end - 60), type: 'tau', value: f1(C.tau_amber + 0.2 + u() * (C.regional_storm_tau_max - C.tau_amber - 0.2)) });
    if (u() < C.sep_chance) evs.push({ ...data.scenario.events.find(e => e.type === 'sep_onset'), tMin: r(35, end - 50) });
    return evs;
  };
  const triggerEvent = kind => {
    if (kind === 'dust' || kind === 'clear') {   // storms build up (and clear) gradually, with gusts
      swap(editScenario(scenario, t, 'tauRamp', kind === 'dust' ? 6 : 0.4, prep.hourMin, data.scenario), prep.target, mode0(), 'keep');
      apply();
      if (!playing) start();   // paused: nothing would show until Play
      return;
    }
    if (kind === 'solar') { swap(editScenario(scenario, Math.max(t, 1), 'sepAt', true, prep.hourMin, data.scenario), prep.target, mode0(), 'keep'); apply(); if (!playing) start(); return; }
    if (kind === 'lost') { stop(); document.getElementById('btn-skyline').click(); return; }
    const list = kind === 'random' ? randomEvents() : kind === 'calm' ? fixed(data.scenario.events) : data.scenario.events;
    swap(editScenario(scenario, 0, 'events', list), prep.target, mode0(), 'zero');
    apply();
  };
  for (const b of document.querySelectorAll('[data-event]')) b.addEventListener('click', () => triggerEvent(b.dataset.event));
  const setSpeed = k => { speed = Math.min(10, Math.max(1, Math.round(Number(k)) || 1)); }; // takes effect on the next frame; the clock does not jump
  const openPlanner = setupPlanner({
    data, M, getStore, sky, randomEvents, fixed,
    current: () => ({ scenario, prep }),
    run: (sc, target) => { stop(); t = 0; if (!swap(sc, target, 'safest', 'zero')) return false; start(); return true; }
  });
  document.getElementById('w-plan')?.addEventListener('click', () => { document.getElementById('w-close')?.click(); openPlanner(); });
  document.getElementById('story-edit')?.addEventListener('click', () => openPlanner());
  return { retarget: target => replan(target, getStore().inputs.routeMode), setCondition, runHasSep, runEvents: () => scenario.events, setSpeed, getSpeed: () => speed };
}

// The warning shows in full for 10 s (a bar counts down), then shrinks to a pulsing triangle at the top centre so it
// doesn't cover the map. Click the triangle to read it again. Any new warning text starts it over.
function setupBannerMini() {
  const b = document.getElementById('banner');
  if (!b) return;
  let timer = 0;
  const full = () => {
    clearTimeout(timer);
    b.classList.remove('mini');
    b.classList.remove('counting'); void b.offsetWidth; b.classList.add('counting');   // restart the countdown bar
    timer = setTimeout(() => { if (!b.hidden) b.classList.add('mini'); }, 10000);
  };
  new MutationObserver(() => { if (!b.hidden) full(); else { clearTimeout(timer); b.classList.remove('mini', 'counting'); } })
    .observe(b, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
  b.addEventListener('click', () => { if (b.classList.contains('mini')) full(); });
  b.setAttribute('title', 'Warning (click to read it again when it shrinks)');
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

function setupHelmet(data, view, skyline) {
  let wantLook = false;
  const dlg = document.getElementById('dlg-helmet');
  // the main 3D map is hidden behind the helmet window: free it completely (rebuilt on close)
  const pauseMain3D = paused => (paused ? view.release3D() : view.show3D());
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
  const loading = document.getElementById('helmet-loading');
  let helmetReady = false, loadT = 0;
  const lift = () => { helmetReady = true; clearTimeout(loadT); loading.classList.add('done'); setTimeout(() => { loading.hidden = true; }, 500); };
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type === 'sightline:hello') send();
    if (e.data?.type === 'sightline:toggle-play') document.getElementById('t-play')?.click();   // Play / Pause from inside the helmet
    if (e.data?.type === 'sightline:helmet-ready') { lift(); if (wantLook) { wantLook = false; frame.contentWindow.postMessage({ type: 'sightline:hm-auto' }, location.origin); } }
    // Horizon Match from inside the helmet: the helmet turns, the map page matches (worker) and applies the fix
    if (e.data?.type === 'sightline:hm-request' && skyline?.lookAroundFix) {
      skyline.lookAroundFix().then(res => frame.contentWindow?.postMessage({ type: 'sightline:hm-result', ...res }, location.origin))
        .catch(err => { console.error(err); frame.contentWindow?.postMessage({ type: 'sightline:hm-result', fix: false, observed: [], reason: 'error' }, location.origin); });
    }
  });
  subscribe(() => send());
  document.getElementById('btn-helmet').addEventListener('click', async () => {
    const ok = await fetch('helmet/index.html', { method: 'HEAD' }).then(r => r.ok).catch(() => false);
    if (!ok) { frame.removeAttribute('src'); frame.srcdoc = '<p style="font:16px sans-serif;color:#ccc;padding:24px">Helmet view is not built yet (helmet/index.html).</p>'; }
    pauseMain3D(true);            // free the GPU first, then open
    if (!helmetReady) { loading.hidden = false; loading.classList.remove('done'); loadT = setTimeout(lift, 25000); }
    dlg.showModal();
    // start loading after the dialog has painted, so its open animation is not starved
    if (ok && (!frame.getAttribute('src') || frame.getAttribute('src') === 'about:blank')) {
      setTimeout(() => { frame.removeAttribute('srcdoc'); frame.src = 'helmet/index.html'; }, 60);   // timer, not rAF: still loads in a background tab
    } else if (!ok) lift();
  });
  // open the helmet and start the look-around (Position tab button); waits for the helmet to load the first time
  return () => {
    document.getElementById('btn-helmet').click();
    if (helmetReady) frame.contentWindow?.postMessage({ type: 'sightline:hm-auto' }, location.origin);
    else wantLook = true;
  };
}

// Skyline Fix draws its search heat map on the 2D map: switch to 2D for it, and back afterwards.
// Horizon Match stays in the view you are in (switching views mid-demo was confusing and slow).
// ponytail: kept as a hook so callers don't change; returns the "restore" callback.
let viewRef = null, helmetLook = null;
async function show2D() { return () => {}; }

function setupSkyline(map, mod, results) {
  // the real-photo test: our skyline vs Perseverance's photos (skyline/realphoto.js), also at the top of the Horizon Match panel
  document.getElementById('btn-realphoto')?.addEventListener('click', e => {
    const opener = e.currentTarget;
    import('../skyline/realphoto.js').then(m => m.openRealPhoto(opener)).catch(err => console.error(err));
  });
  // Lost in dust: the astronaut cannot see the hills (local dust the app's τ model does not know about)
  document.getElementById('btn-lostdust')?.addEventListener('click', e => {
    if (!mod) return;
    const opener = e.currentTarget;   // focus returns here when the panel closes (switching to 2D moves focus first)
    show2D().then(restore => mod.openSkylineFix(null, map, { onClose: restore, lost: true, opener })).catch(err => console.error(err));
  });
  // the button matches the horizon where the astronaut actually is (live, skyline/livematch.js); the scripted demo
  // event still replays its precomputed site result
  document.getElementById('btn-skyline').addEventListener('click', e => {
    if (mod && helmetLook) { helmetLook(); return; }   // the astronaut looks around in the helmet view
    const opener = e.currentTarget;
    if (mod) { show2D().then(restore => mod.openSkylineFix(null, map, { onClose: restore, live: true, opener })).catch(err => console.error(err)); return; }
    const banner = document.getElementById('banner');
    banner.textContent = 'Horizon Match panel is not built yet (skyline/skyline.js).';
    banner.hidden = false;
    setTimeout(() => { banner.hidden = !getStore().inputs.sepActive; }, 3000);
  });
}

// the intro holds on the logo until this fires (or a timeout)
const announceReady = () => { window.sightlineReady = true; window.dispatchEvent(new Event('sightline:ready')); };
boot().then(announceReady, err => { announceReady(); console.error(err); fatal(`Sightline failed to start: ${err.message}`); });
