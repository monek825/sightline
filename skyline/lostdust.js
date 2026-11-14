// Written with AI assistance (Claude / GitHub Copilot)
// LOST IN DUST: what to do when Horizon Match cannot give a reliable fix (dust hides the hills).
// Pure: no DOM, no store writes. skyline/skyline.js shows the plan; scripts/test_demo.mjs tests it.
//
// Why this mode exists (data/skyline/dust.json, scripts/skyline_dust.py): in simulated dust on the NASA terrain,
// Horizon Match's self-check never claimed a wrong fix down to noFalseFixMinVisKm (1.5 km); below that it did.
// The app's visibility comes from the column dust optical depth, but dust lifted near the ground (a storm front,
// a passing dust devil, dust settling after a storm) can make it much worse than that model (Curiosity saw 2.7 km
// at Gale in 2018 while the column model gives ~5 km), so the astronaut can also enter this mode by hand.

import { distM, bearingDeg, toLatLon } from '../lib/geo.js';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const AT_HABITAT_KM = 0.05;   // same rule as crew/budget.js: route home shorter than this = at the habitat
export const compass8 = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

/** Nearest grid cell (centre) where `flag[i] === 0`, from a position -> {lat, lon, distM, bearingDeg} or null. */
export function nearestClear(flag, grid, bounds, at) {
  if (!flag) return null;
  let best = -1, bestD = Infinity;
  for (let r = 0; r < grid.h; r++) for (let c = 0; c < grid.w; c++) {
    const i = r * grid.w + c;
    if (flag[i] !== 0) continue;
    const p = toLatLon(grid, bounds, r, c);
    const d = distM(at.lat, at.lon, p.lat, p.lon);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return null;
  const p = toLatLon(grid, bounds, Math.floor(best / grid.w), best % grid.w);
  return { lat: p.lat, lon: p.lon, distM: bestD, bearingDeg: bearingDeg(at.lat, at.lon, p.lat, p.lon) };
}

/**
 * @param {object} o
 * @param {{lat:number, lon:number}} o.astronaut   estimated position (dead reckoning)
 * @param {number} o.visKm             current visibility (the app's model, or the astronaut's own estimate)
 * @param {{blind:Uint8Array, homeHidden:Uint8Array}} o.vis  visibility arrays computed for visKm
 * @param {{w:number,h:number}} o.grid  @param {object} o.bounds
 * @param {number} o.posUncertaintyM   current position uncertainty (m)
 * @param {number} o.driftPct          dead-reckoning drift, % of distance walked (data/crew_constants.json)
 * @param {number} o.routeHomeKm       planned route home (km)
 * @param {{suitMinLeft:number, returnMin:number}|null} o.budget
 * @param {string} o.reason            'visibility' | 'no-fix' | 'manual'
 */
export function lostInDustPlan(o) {
  const unc = Math.max(0, o.posUncertaintyM || 0);
  const homeKm = Number.isFinite(o.routeHomeKm) ? o.routeHomeKm : null;
  // uncertainty when you reach the habitat's estimated spot after walking home on dead reckoning
  const endUncM = homeKm == null ? null : unc + (o.driftPct / 100) * homeKm * 1000;
  const visM = o.visKm * 1000;
  const sightHome = nearestClear(o.vis?.homeHidden, o.grid, o.bounds, o.astronaut);
  const sightAny = nearestClear(o.vis?.blind, o.grid, o.bounds, o.astronaut);
  const suit = o.budget?.suitMinLeft, ret = o.budget?.returnMin;
  const spareMin = Number.isFinite(suit) && Number.isFinite(ret) ? Math.max(0, suit - ret) : null;
  return {
    reason: o.reason, visKm: o.visKm, uncertaintyM: unc,
    atHabitat: homeKm != null && homeKm < AT_HABITAT_KM,
    // is the spot the planner thinks you are at even inside what you can see? (if not, landmarks "in view" may not be)
    uncertaintyExceedsVisibility: unc > visM,
    sightHome, sightAny,
    homeKm, endUncertaintyM: endUncM,
    // arriving with more uncertainty than you can see means you could walk past the habitat without seeing it
    mayMissHabitat: endUncM != null && endUncM > visM,
    spareMin, suitMinLeft: Number.isFinite(suit) ? suit : null, returnMin: Number.isFinite(ret) ? ret : null
  };
}
