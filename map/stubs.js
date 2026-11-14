// Written with AI assistance (Claude / GitHub Copilot)
// TEMPORARY stand-ins with the exact signatures from ARCHITECTURE.md §5.
// Used only until crew/budget.js (Jojo) and route/route.js (Jojo) exist.
// app.js loads the real modules first; these are the fallback, and the UI says so.

import { distM } from '../lib/geo.js';

export const STUB = true;

export function computeLimits(inputs, C) {
  const ramp = Math.min(1, inputs.sol / C.sensorimotor_recovery_days);
  const speedKmh = C.walk_speed_kmh * (C.arrival_speed_factor_sol0 + (1 - C.arrival_speed_factor_sol0) * ramp);
  const maxSlopeDeg = inputs.sol < C.sensorimotor_recovery_days ? C.max_slope_early_deg : C.max_slope_deg;
  let visibilityKm = Math.min(150, 3.912 / (inputs.tau / C.vis_dust_scale_height_km));
  if (inputs.sansAffected) visibilityKm *= C.sans_range_factor;
  return { speedKmh, maxSlopeDeg, visibilityKm };
}

const RANK = { RED: 0, AMBER: 1, GREEN: 2 };

export function computeBudget(inputs, limits, routeHomeKm, C) {
  const f = [];
  const suitMinLeft = C.eva_design_hours * 60 - inputs.evaMin - C.eva_reserve_min;
  const returnMin = routeHomeKm / limits.speedKmh * 60 * C.walkback_pad;
  const marginMin = suitMinLeft - returnMin;
  f.push({ id: 'suit_time', level: marginMin <= 0 ? 'RED' : marginMin < 30 ? 'AMBER' : 'GREEN', label: 'Suit time',
    message: `${Math.round(suitMinLeft)} min usable; home is ${Math.round(returnMin)} min away at today's pace (+20% margin).`,
    keys: ['eva_design_hours', 'eva_reserve_min', 'walk_speed_kmh', 'walkback_pad'] });

  if (inputs.sepActive) {
    f.push({ id: 'radiation', level: 'RED', label: 'Solar particle event',
      message: `Curiosity measured ${C.may2024_sep_dose_ugy.toLocaleString()} µGy in the May 2024 event. Get to shelter now.`,
      keys: ['may2024_sep_dose_ugy', 'terrain_shielding_pct'] });
  }
  const tauLevel = inputs.tau > C.tau_red ? 'RED' : inputs.tau > C.tau_amber ? 'AMBER' : 'GREEN';
  f.push({ id: 'dust', level: tauLevel, label: 'Dust visibility',
    message: `τ ${inputs.tau.toFixed(1)}: landmarks beyond ~${Math.round(limits.visibilityKm)} km are lost.`,
    keys: ['vis_dust_scale_height_km', 'tau_amber', 'tau_red', ...(inputs.sansAffected ? ['sans_range_factor'] : [])] });

  if (inputs.ltst >= C.dust_devil_peak_start_ltst && inputs.ltst <= C.dust_devil_peak_end_ltst) {
    f.push({ id: 'dust_devil', level: 'AMBER', label: 'Dust-devil hours',
      message: `Peak dust-devil time. Winds up to ${C.dust_devil_max_wind_ms} m/s push like ~${C.mars_wind_earth_equiv_ms} m/s on Earth; the risk is sudden zero visibility.`,
      keys: ['dust_devil_peak_start_ltst', 'dust_devil_max_wind_ms', 'mars_wind_earth_equiv_ms'] });
  }
  const marginPa = C.evap_cooler_max_pressure_pa - inputs.pressurePa;
  f.push({ id: 'cooling', level: marginPa <= 0 ? 'RED' : marginPa < 100 ? 'AMBER' : 'GREEN', label: 'Suit cooling',
    message: `${inputs.pressurePa} Pa outside vs ${C.evap_cooler_max_pressure_pa} Pa evaporator cooler test limit (a sublimator needs < ${C.water_triple_point_pa} Pa).`,
    keys: ['evap_cooler_max_pressure_pa', 'water_triple_point_pa', 'jezero_pressure_pa'] });

  f.sort((a, b) => RANK[a.level] - RANK[b.level]);
  const status = f[0]?.level ?? 'GREEN';
  return {
    status, headline: { GREEN: 'GO', AMBER: 'CAUTION', RED: 'RETURN NOW' }[status],
    suitMinLeft, returnMin, marginMin, turnBackInMin: Math.max(0, marginMin),
    extraOutKm: Math.max(0, marginMin) / 60 * limits.speedKmh / 2 / C.walkback_pad,
    ...limits, factors: f, stub: true
  };
}

// Straight line, no terrain. Real A* lives in route/route.js.
export function planRoute(grid, bounds, vis, start, goal, opts) {
  const lengthKm = distM(start.lat, start.lon, goal.lat, goal.lon) / 1000;
  return { ok: true, mode: opts.mode, points: [[start.lat, start.lon], [goal.lat, goal.lon]], lengthKm,
    etaMin: lengthKm / opts.speedKmh * 60, maxSlopeDeg: null, blindFraction: null, stub: true };
}
