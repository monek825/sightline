// Written with AI assistance (Claude / GitHub Copilot)
// Single source of state (ARCHITECTURE.md §4–§5).
// Only setInputs() changes state. It re-derives everything once, then notifies.
// Subscribers are read-only: calling setInputs while notifying throws.

export const DEFAULT_INPUTS = Object.freeze({
  sol: 12,
  ltst: 9.0,
  evaMin: 0,
  astronaut: Object.freeze({ lat: 18.4447, lon: 77.4508, headingDeg: 0 }),
  distSinceFixM: 0,
  fixUncertaintyM: 30,
  tau: 0.4,
  sepActive: false,
  pressurePa: 718,
  tempC: -40,
  sansAffected: true,
  routeMode: 'safest',
  target: null,
  scenarioT: null,
  vehicle: 'walk'   // 'walk' | 'rover' (planned rover ride; the suit-time check still assumes walking home)
});

const RANGES = {
  sol: [0, 1000], ltst: [0, 24], evaMin: [0, 2000], distSinceFixM: [0, 1e6],
  fixUncertaintyM: [0, 1e5], tau: [0.1, 10], pressurePa: [100, 2000], tempC: [-140, 40]
};
const MODES = ['shortest', 'safest', 'homeInSight'];

let store = Object.freeze({ data: null, inputs: DEFAULT_INPUTS, derived: Object.freeze({}) });
let deriveFn = null;
let notifying = false;
const subs = new Set();

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

function inBounds(b, p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
    p.lat >= b.latMin && p.lat <= b.latMax && p.lon >= b.lonMin && p.lon <= b.lonMax;
}

// Validate a patch against the input schema. Returns a new object; never mutates.
function sanitize(patch, data) {
  const out = {};
  const b = data?.meta?.bounds;
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_INPUTS)) { console.warn(`setInputs: unknown key "${k}" ignored`); continue; }
    if (k in RANGES) {
      if (!Number.isFinite(v)) { console.warn(`setInputs: ${k} must be a number`); continue; }
      out[k] = clamp(v, RANGES[k]);
    } else if (k === 'routeMode') {
      if (MODES.includes(v)) out[k] = v; else console.warn(`setInputs: bad routeMode "${v}"`);
    } else if (k === 'astronaut' || k === 'target') {
      if (v === null && k === 'target') { out[k] = null; continue; }
      if (b && !inBounds(b, v)) { console.warn(`setInputs: ${k} outside map bounds ignored`); continue; }
      out[k] = Object.freeze({ ...v });
    } else if (k === 'vehicle') {
      if (v === 'walk' || v === 'rover') out[k] = v; else console.warn(`setInputs: bad vehicle "${v}"`);
    } else if (k === 'sepActive' || k === 'sansAffected') {
      out[k] = Boolean(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function notify() {
  notifying = true;
  try {
    for (const fn of subs) {
      try { fn(store); } catch (err) { console.error('renderer failed:', err); }
    }
  } finally {
    notifying = false;
  }
}

export function initStore(data, derive, initialPatch = {}) {
  deriveFn = derive;
  const inputs = Object.freeze({ ...DEFAULT_INPUTS, ...sanitize(initialPatch, data) });
  store = Object.freeze({ data, inputs, derived: deriveFn(inputs, data, {}) });
  notify();
}

export function setInputs(patch) {
  if (notifying) throw new Error('setInputs called from a subscriber: renderers must not write state');
  if (!deriveFn) throw new Error('setInputs before initStore');
  const inputs = Object.freeze({ ...store.inputs, ...sanitize(patch, store.data) });
  const derived = deriveFn(inputs, store.data, store.derived);
  store = Object.freeze({ data: store.data, inputs, derived });
  notify();
}

export function subscribe(fn) {
  if (store.data) {
    notifying = true;
    try { fn(store); } finally { notifying = false; } // a bad subscriber throws here and is never added
  }
  subs.add(fn);
  return () => subs.delete(fn);
}

export function getStore() { return store; }
