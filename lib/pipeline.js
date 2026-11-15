// Written with AI assistance (Claude / GitHub Copilot)
// The only place derived state is computed (ARCHITECTURE.md §5).
// Fixed order: computeLimits → visibility → routes → computeBudget.
// Expensive steps are cached by key so movement ticks stay cheap.

import { distM } from './geo.js';

const STRAIGHT_LINE_FACTOR = 1.3; // ponytail: fallback when no route exists; real route replaces it

// Remaining length (km) along a route from the point nearest to `p`.
export function remainingKm(route, p) {
  if (!route?.ok || route.points.length < 2) return null;
  const pts = route.points;
  let best = 0, bestD = Infinity;
  pts.forEach(([lat, lon], i) => {
    const d = distM(p.lat, p.lon, lat, lon);
    if (d < bestD) { bestD = d; best = i; }
  });
  let m = bestD;
  for (let i = best; i < pts.length - 1; i++) m += distM(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  return m / 1000;
}

function safePlan(M, data, vis, start, goal, opts) {
  try {
    return M.planRoute(data.grid, data.bounds, vis, start, goal, opts);
  } catch (err) {
    // planRoute must never throw (contract) — guard anyway so one bug can't kill the app
    return { ok: false, reason: `route planner error: ${err.message}`, points: [] };
  }
}

// Route cache bucket: ~100 m when you move the astronaut by hand; ~300 m while the demo plays, because the
// time-lapse walk crosses a 100 m bucket almost every frame and each re-plan (A*) blocks the page, the helmet included.
// Cost: during playback the route home may start up to ~150 m behind the astronaut until the next bucket.
const cellKey = (p, playing) => {
  const k = playing ? 1 / 0.003 : 1000;
  return `${Math.round(p.lat * k)},${Math.round(p.lon * k)}`;
};

/**
 * @param {{computeLimits:Function, computeBudget:Function, planRoute:Function, visibilityArrays:Function}} M
 * @returns {(inputs:object, data:object, prev:object) => object} derive
 */
const visBucket = km => {
  const k = Math.max(1, km), step = k < 8 ? 1 : k < 20 ? 2 : k < 50 ? 5 : 10;
  return Math.max(1, Math.floor(k / step) * step);
};

export function createPipeline(M) {
  return function derive(inputs, data, prev) {
    const warnings = [];
    const { C, meta } = data;

    // 1. limits (needs no route)
    const limits = M.computeLimits(inputs, C);

    // 2. position uncertainty grows with distance walked since the last fix
    const posUncertaintyM = inputs.fixUncertaintyM + (C.dead_reckoning_drift_pct / 100) * inputs.distSinceFixM;

    // 3. visibility, cached by a coarse key: 1 km steps up close, wider steps far out (where a few km change nothing on
    // the map). Rounded DOWN, so blind zones are never drawn smaller than they are. A dust ramp used to change the key
    // ~100 times in a few seconds, re-planning the route and redrawing the overlays every time (the story lag).
    const visKey = visBucket(limits.visibilityKm);
    const vis = prev.visKey === visKey && prev.vis ? prev.vis : M.visibilityArrays(visKey);

    // 4. routes, cached by route key
    const base = [inputs.routeMode, limits.maxSlopeDeg, visKey, inputs.sepActive,
      Math.floor(inputs.evaMin / 10), cellKey(inputs.astronaut, inputs.scenarioT !== null && inputs.scenarioT !== undefined)].join('|');
    const opts = { mode: inputs.routeMode, maxSlopeDeg: limits.maxSlopeDeg, speedKmh: limits.speedKmh, cellMaxSlopeDeg: data.slopeMax };

    const homeKey = `${base}|home`;
    const routeHome = prev.homeKey === homeKey && prev.routeHome
      ? prev.routeHome
      : safePlan(M, data, vis, inputs.astronaut, meta.home, opts);

    const outKey = inputs.target ? `${base}|${cellKey(inputs.target)}` : null;
    const routeOut = !inputs.target ? null
      : prev.outKey === outKey && prev.routeOut ? prev.routeOut
        : safePlan(M, data, vis, inputs.astronaut, inputs.target, opts);

    // comparison route for the Route tab / 2D map: the same walk in the other mode (safest <-> shortest)
    const altMode = inputs.routeMode === 'shortest' ? 'safest' : 'shortest';
    const altKey = outKey ? `${outKey}|alt${altMode}` : null;
    const routeAlt = !inputs.target ? null
      : prev.altKey === altKey && prev.routeAlt ? prev.routeAlt
        : safePlan(M, data, vis, inputs.astronaut, inputs.target, { ...opts, mode: altMode });

    // 5. remaining distance home
    let routeHomeKm = remainingKm(routeHome, inputs.astronaut);
    if (routeHomeKm === null) {
      routeHomeKm = distM(inputs.astronaut.lat, inputs.astronaut.lon, meta.home.lat, meta.home.lon) / 1000 * STRAIGHT_LINE_FACTOR;
      if (routeHome && !routeHome.ok && routeHome.reason) warnings.push(`No route home: ${routeHome.reason}. Using straight line × ${STRAIGHT_LINE_FACTOR}.`);
    }

    // 6. budget
    const budget = M.computeBudget(inputs, limits, routeHomeKm, C);

    return Object.freeze({
      limits, posUncertaintyM, vis, visKey,
      routeHome, homeKey, routeOut, outKey, routeAlt, altKey, routeHomeKm,
      budget, warnings
    });
  };
}
