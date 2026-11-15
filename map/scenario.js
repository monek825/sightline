// Written with AI assistance (Claude / GitHub Copilot)
// Deterministic demo (ARCHITECTURE.md §6): inputs are rebuilt from scratch for any time t.
// Legs are planned once in prepareScenario(); stateAt() is pure, so scrubbing works both ways.

import { distM, bearingDeg } from '../lib/geo.js';
import { DEFAULT_INPUTS } from '../lib/store.js';

const MARS_HOUR_MIN = 61.65; // mirrors crew constant mars_hour_min; read from C below when present

function legLengthM(points) {
  let m = 0;
  for (let i = 0; i < points.length - 1; i++) m += distM(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
  return m;
}

// Position after walking `m` metres along a polyline of [lat, lon] points.
export function pointAlong(points, m) {
  let left = Math.max(0, m);
  for (let i = 0; i < points.length - 1; i++) {
    const [a1, o1] = points[i], [a2, o2] = points[i + 1];
    const seg = distM(a1, o1, a2, o2);
    const heading = bearingDeg(a1, o1, a2, o2);
    if (left <= seg || i === points.length - 2) {
      const f = seg ? Math.min(1, left / seg) : 1;
      return { lat: a1 + (a2 - a1) * f, lon: o1 + (o2 - o1) * f, headingDeg: heading };
    }
    left -= seg;
  }
  const [lat, lon] = points[0];
  return { lat, lon, headingDeg: 0 };
}

// The part of a polyline already walked after `m` metres: its points up to, and ending with, that position.
export function pathUpTo(points, m) {
  const out = [points[0]];
  let left = Math.max(0, m);
  for (let i = 0; i < points.length - 1; i++) {
    const seg = distM(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    if (left <= seg) break;
    left -= seg;
    out.push(points[i + 1]);
  }
  const p = pointAlong(points, m), last = out.at(-1);
  if (p.lat !== last[0] || p.lon !== last[1]) out.push([p.lat, p.lon]);
  return out;
}

function eventsUpTo(scenario, t) {
  return scenario.events.filter(e => e.tMin <= t);
}

/** Pure: a NEW scenario with one user condition edit applied (input never mutated).
 *  key: 'tau' | 'ltst' | 'sol' | 'sepActive' | 'returnHome'; anything else returns the scenario unchanged (same object).
 *  tau / ltst apply from demo time t on. 'sepActive' is a run setting, not a live switch: on = the scripted sep_onset
 *  of `original` (the unedited scenario) is part of the run, off = no sep_onset / sep_end at all.
 *  An edit that changes nothing (setting already holds, or no scripted storm to add) returns the same object. */
export function editScenario(scenario, t, key, value, hourMin, original = scenario) {
  const evs = scenario.events ?? [];
  const sorted = list => list.map((e, i) => [e, i]).sort((a, b) => a[0].tMin - b[0].tMin || a[1] - b[1]).map(x => x[0]);
  const withEvents = list => ({ ...scenario, events: sorted(list) });
  if (key === 'tau') return withEvents([...evs.filter(e => e.type !== 'tau' || e.tMin < t), { tMin: t, type: 'tau', value, rampMin: 0 }]); // slider: at once
  if (key === 'tauRamp') return withEvents([...evs.filter(e => e.type !== 'tau' || e.tMin < t), { tMin: t, type: 'tau', value }]); // storm arrives gradually
  if (key === 'sepAt') { // a solar particle event starting at t (replaces any other), keeping the scripted event's citation
    const cite = (original.events ?? []).find(e => e.type === 'sep_onset') ?? { type: 'sep_onset' };
    return withEvents([...evs.filter(e => e.type !== 'sep_onset' && e.type !== 'sep_end'), { ...cite, tMin: t }]);
  }
  if (key === 'events') return withEvents(value); // a whole new event list (random / calm / scripted runs)
  if (key === 'ltst') return { ...scenario, startLtst: value - t / hourMin };
  if (key === 'sol') return { ...scenario, sol: value };
  if (key === 'returnHome') { // turn back at t; one event at most, false removes it
    const rest = evs.filter(e => e.type !== 'return_home');
    return value === false ? (rest.length === evs.length ? scenario : withEvents(rest)) : withEvents([...rest, { tMin: t, type: 'return_home' }]);
  }
  if (key !== 'sepActive') return scenario;
  const storm = e => e.type === 'sep_onset' || e.type === 'sep_end';
  const rest = evs.filter(e => !storm(e));
  if (!value) return rest.length === evs.length ? scenario : withEvents(rest);
  const scripted = (original.events ?? []).find(e => e.type === 'sep_onset');
  const ended = evs.some(e => e.type === 'sep_end');
  if (!scripted || (evs.some(e => e.type === 'sep_onset') && !ended)) return scenario;
  return withEvents([...rest, { ...scripted }]);
}

/** Plan both legs once. Same inputs → same legs → same video every time.
 *  targetOverride ({lat, lon, id?}) replaces the scripted target (clicked point drives the walk);
 *  outMode is the outbound route mode then (ignored without an override). The return leg is always 'safest'.
 *  A return_home event turns back too, and so does the first tau event above tau_red (RED dust): the leg switches at the
 *  earliest of them and the sep_onset, planned from there. Without any the crew still turns back (sepT = turn-back time,
 *  so that they are home at EVA end).
 *  from ({prefix, tMin}, with an override) re-plans mid-walk: the walked prefix is kept and the fresh leg starts at its end,
 *  planned with the limits/visibility in force at tMin (what the orange line uses); walking speed stays the t = 0 one.
 *  from.backPrefix/backTMin (already returning, tMin = the switch time): prefix is the whole outbound leg, kept as is, and the
 *  rest of the way home is re-planned from the end of backPrefix for the state at backTMin. */
export function prepareScenario(scenario, data, M, targetOverride = null, outMode = 'safest', from = null) {
  const C = data.C;
  // a scripted skyline_fix belongs to the scripted site: drop it for any other target (copy, never mutate)
  if (targetOverride && targetOverride.id !== scenario.target)
    scenario = { ...scenario, events: scenario.events.filter(e => e.type !== 'skyline_fix') };
  const start0 = scenario.start || data.meta.home;
  const here = from?.prefix.at(-1);
  const start = here ? { lat: here[0], lon: here[1] } : start0;
  const target = targetOverride || data.targets.find(t => t.id === scenario.target) || data.meta.home;
  const base = { ...DEFAULT_INPUTS, sol: scenario.sol, astronaut: { ...start0, headingDeg: 0 } };
  const lim0 = M.computeLimits(base, C);
  const tauAt = tt => eventsUpTo(scenario, tt).filter(e => e.type === 'tau').pop()?.value ?? base.tau;
  const limF = from ? M.computeLimits({ ...base, tau: tauAt(from.tMin), sepActive: false }, C) : lim0;
  // same per-cell slope check as the drawn routes (lib/pipeline.js), so the walk follows the orange line
  const opts = { mode: 'safest', maxSlopeDeg: limF.maxSlopeDeg, speedKmh: limF.speedKmh, cellMaxSlopeDeg: data.slopeMax };
  const sep = scenario.events.find(e => e.type === 'sep_onset');
  const end = scenario.events.find(e => e.type === 'eva_end')?.tMin ?? 200;
  // leg switch: the earliest of the storm, the return_home press and the first RED dust level (tau > tau_red)
  const times = type => scenario.events.filter(e => e.type === type).map(e => e.tMin);
  const redT = C.tau_red == null ? [] : scenario.events.filter(e => e.type === 'tau' && e.value > C.tau_red).map(e => e.tMin);
  const swT = Math.min(...times('sep_onset'), ...times('return_home'), ...redT);
  const bk = from?.backPrefix && swT === from.tMin ? from : null; // already returning: outbound leg and walked part of `back` are kept
  let out = { ok: true }, outPts = from?.prefix;
  if (!bk) {
    const vis0 = M.visibilityArrays(Math.max(1, Math.round(limF.visibilityKm)));
    out = M.planRoute(data.grid, data.bounds, vis0, start, target, targetOverride ? { ...opts, mode: outMode } : opts);
    const fresh = out.ok ? out.points : [[start.lat, start.lon], [target.lat, target.lon]];
    outPts = from ? [...from.prefix, ...(fresh[0][0] === here[0] && fresh[0][1] === here[1] ? fresh.slice(1) : fresh)] : fresh;
  }
  const mPerMin = lim0.speedKmh * 1000 / 60;

  const toHome = (at, lim) => {
    const vis = M.visibilityArrays(Math.max(1, Math.round(lim.visibilityKm)));
    const r = M.planRoute(data.grid, data.bounds, vis, at, data.meta.home, { ...opts, maxSlopeDeg: lim.maxSlopeDeg });
    return r.ok ? r.points : [[at.lat, at.lon], [data.meta.home.lat, data.meta.home.lon]];
  };
  let back, sepT;
  if (swT < Infinity) { // storm, return_home and/or RED dust: turn back at the earliest
    const tl = bk ? from.backTMin : swT; // the rest of the way home is planned for the state now
    const at = bk ? { lat: from.backPrefix.at(-1)[0], lon: from.backPrefix.at(-1)[1] } : pointAlong(outPts, mPerMin * swT);
    const fresh = toHome(at, M.computeLimits({ ...base, tau: tauAt(tl), sepActive: Boolean(sep) && sep.tMin <= tl }, C));
    back = bk ? [...from.backPrefix, ...(fresh[0][0] === at.lat && fresh[0][1] === at.lon ? fresh.slice(1) : fresh)] : fresh;
    sepT = swT;
  } else { // nothing triggers: walk out, wait at the target, turn back in time to be home at EVA end
    const arrT = legLengthM(outPts) / mPerMin;
    const [lat, lon] = outPts.at(-1);
    back = toHome({ lat, lon }, M.computeLimits({ ...base, tau: tauAt(arrT), sepActive: false }, C));
    sepT = Math.max(arrT, end - legLengthM(back) / mPerMin);
  }
  return Object.freeze({
    scenario, mPerMin, outPts, outOk: out.ok, custom: Boolean(targetOverride), target: targetOverride || null, outLen: legLengthM(outPts), back, backLen: legLengthM(back), sepT, endT: end,
    hourMin: C.mars_hour_min ?? MARS_HOUR_MIN
  });
}

// Dust arrives gradually, not in one step (real storms build over sols: Gale 2018 peaked near tau 8.5,
// Jezero Jan 2022 went ~0.3 -> ~2 over about 4 sols; Guzewich 2019, Lemmon 2022). The demo compresses that into DUST_RAMP_MIN of EVA time,
// with gusty bursts on the way up (Perseverance saw 21 dust-lifting events in 25 min: 14 dust devils, 4 gusts, 3 indeterminate). Visual pacing, not a forecast.
// An event with rampMin: 0 (e.g. the dust slider) applies at once.
export const DUST_RAMP_MIN = 20;
const GUST = 0.18; // up to ±18 % gust bursts while the dust is rising
function tauWithRamp(scenario, tt, base) {
  let tau = base;
  for (const e of eventsUpTo(scenario, tt)) {
    if (e.type !== 'tau') continue;
    const ramp = e.rampMin ?? DUST_RAMP_MIN;
    const f = ramp > 0 ? Math.min(1, (tt - e.tMin) / ramp) : 1;
    const s = f * f * (3 - 2 * f);                                       // smooth start and finish
    const gust = f < 1 && e.value > tau ? GUST * Math.sin(Math.PI * f) * (Math.sin(tt * 1.7) * 0.6 + Math.sin(tt * 4.3 + 1) * 0.4) : 0;
    tau = (tau + (e.value - tau) * s) * (1 + gust);
  }
  return Math.round(tau * 100) / 100;
}

/** Pure: inputs patch for scenario time t (Earth minutes). */
export function stateAt(prep, t, skylineResults = {}) {
  const { scenario, mPerMin, outPts, outLen, back, backLen, sepT } = prep;
  const tt = Math.max(0, Math.min(t, prep.endT));
  const patch = {
    scenarioT: tt, evaMin: tt, sol: scenario.sol,
    ltst: scenario.startLtst + tt / prep.hourMin,
    tau: DEFAULT_INPUTS.tau, sepActive: false, fixUncertaintyM: DEFAULT_INPUTS.fixUncertaintyM
  };
  patch.tau = tauWithRamp(scenario, tt, DEFAULT_INPUTS.tau);
  let fixT = 0;
  for (const e of eventsUpTo(scenario, tt)) {
    if (e.type === 'sep_onset') patch.sepActive = true;
    if (e.type === 'sep_end') patch.sepActive = false; // user ticked the storm off: movement is unchanged
    if (e.type === 'skyline_fix') {
      fixT = e.tMin;
      patch.fixUncertaintyM = skylineResults[e.site]?.uncertaintyM ?? 100;
    }
  }
  // distance walked is a pure function of time
  const walkedAt = time => {
    if (sepT === null || time <= sepT) return Math.min(mPerMin * time, outLen);
    return Math.min(mPerMin * sepT, outLen) + Math.min(mPerMin * (time - sepT), backLen);
  };
  const pos = (sepT === null || tt <= sepT)
    ? pointAlong(outPts, mPerMin * tt)
    : pointAlong(back, mPerMin * (tt - sepT));
  patch.astronaut = pos;
  // custom target only: null = heading home, so no orange line to the abandoned target
  if (prep.target) patch.target = (sepT === null || tt <= sepT) ? prep.target : null;
  patch.distSinceFixM = Math.max(0, walkedAt(tt) - walkedAt(fixT));
  return patch;
}
