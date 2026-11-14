// Written with AI assistance (Claude / GitHub Copilot)
// CREW model: computeLimits + computeBudget. Pure functions: no I/O, no state.
// Every science number comes from C (data/crew_constants.json); the literals below are
// unit conversions or thresholds stated in crew/README.md.

export const REQUIRED_KEYS = [
  'walk_speed_kmh', 'walkback_pad', 'arrival_speed_factor_sol0', 'sensorimotor_recovery_days',
  'max_slope_early_deg', 'max_slope_deg', 'eva_design_hours', 'eva_reserve_min',
  'cruise_dose_msv_per_day', 'transit_days', 'surface_dose_msv_per_sol', 'career_limit_msv',
  'may2024_sep_dose_ugy', 'terrain_shielding_pct', 'vis_dust_scale_height_km', 'sans_range_factor',
  'tau_amber', 'tau_red', 'tau_jan2022_storm', 'dust_devil_peak_start_ltst', 'dust_devil_peak_end_ltst',
  'dust_devil_max_wind_ms', 'mars_wind_earth_equiv_ms', 'sublimator_max_pressure_pa', 'cold_amber_c',
  'cold_return_ltst', 'sans_diopter_shift', 'sol_drift_min', 'bone_loss_pct_per_month', 'perchlorate_pct'
];

const MIN_PER_HOUR = 60;            // unit conversion
const PCT = 100;                    // unit conversion
const MIN_PER_EARTH_DAY = 1440;     // unit conversion
const KOSCHMIEDER = 3.912;          // visibility = 3.912 / extinction coefficient
const VIS_CAP_KM = 150;             // README: cap beyond the crater
const MARGIN_AMBER_MIN = 30;        // README: suit-time AMBER below 30 min margin
const COOLING_AMBER_PA = 100;       // README: cooling AMBER below 100 Pa margin
const CAREER_AMBER_PCT = 80;        // README: career dose GREEN unless > 80 %
const DRIFT_FROM_SOL = 3;           // README: body clock AMBER from sol 3 ...
const DRIFT_EARLY_LTST = 8;         // ... when ltst < 8
const BONE_UNTIL_SOL = 30;          // README: bone factor shown while sol < 30
const AT_HABITAT_KM = 0.05;         // route home shorter than this = back at the habitat
const RANK = { RED: 0, AMBER: 1, GREEN: 2 };
const HEADLINE = { GREEN: 'GO', AMBER: 'CAUTION', RED: 'RETURN NOW' };

function checkKeys(C) {
  const missing = REQUIRED_KEYS.filter(k => !(k in C));
  if (missing.length) throw new Error('crew/budget.js: missing constants: ' + missing.join(', '));
}

export function computeLimits(inputs, C) {
  checkKeys(C);
  const ramp = Math.min(1, inputs.sol / C.sensorimotor_recovery_days);
  const speedKmh = C.walk_speed_kmh * (C.arrival_speed_factor_sol0 + (1 - C.arrival_speed_factor_sol0) * ramp);
  const maxSlopeDeg = inputs.sol < C.sensorimotor_recovery_days ? C.max_slope_early_deg : C.max_slope_deg;
  const tau = Number.isFinite(inputs.tau) && inputs.tau > 0 ? inputs.tau : 0; // NaN/negative = clear air
  let visibilityKm = Math.min(VIS_CAP_KM, KOSCHMIEDER / (tau / C.vis_dust_scale_height_km)); // tau 0 -> Infinity -> cap
  if (inputs.sansAffected) visibilityKm = Math.min(VIS_CAP_KM, visibilityKm * C.sans_range_factor);
  return { speedKmh, maxSlopeDeg, visibilityKm };
}

export function computeBudget(inputs, limits, routeHomeKm, C) {
  checkKeys(C);
  const homeKm = Number.isFinite(routeHomeKm) && routeHomeKm >= 0 ? routeHomeKm : 0;
  const atHabitat = homeKm < AT_HABITAT_KM;
  const { sol, ltst, evaMin, sepActive, pressurePa, tempC, sansAffected } = inputs;
  const tau = Number.isFinite(inputs.tau) && inputs.tau > 0 ? inputs.tau : 0;
  const has = k => k in C;
  const r = Math.round;
  const factors = [];

  // 2. suit time
  const suitMinLeft = Math.max(0, C.eva_design_hours * MIN_PER_HOUR - evaMin - C.eva_reserve_min); // never negative
  const returnMin = homeKm / limits.speedKmh * MIN_PER_HOUR * C.walkback_pad;
  const marginMin = suitMinLeft - returnMin;
  const turnBackInMin = Math.max(0, marginMin);
  const extraOutKm = turnBackInMin / MIN_PER_HOUR * limits.speedKmh / 2 / C.walkback_pad;

  // 1. mobility
  const early = sol < C.sensorimotor_recovery_days;
  factors.push({ id: 'mobility', level: early ? 'AMBER' : 'GREEN', label: 'Walking speed',
    message: `Walking ${limits.speedKmh.toFixed(1)} km/h today, max slope ${r(limits.maxSlopeDeg)}°.` +
      (early ? ` Balance is still recovering until sol ${C.sensorimotor_recovery_days}.` : '') +
      ' Slope is handled by the route planner, so home time uses flat-ground speed.',
    keys: ['walk_speed_kmh', 'arrival_speed_factor_sol0', 'sensorimotor_recovery_days', 'max_slope_early_deg', 'max_slope_deg'] });

  factors.push({ id: 'suit_time', level: marginMin <= 0 ? 'RED' : marginMin < MARGIN_AMBER_MIN ? 'AMBER' : 'GREEN',
    label: 'Suit time',
    message: suitMinLeft <= 0
      ? (atHabitat ? 'Suit time is used up. You are at the habitat: go inside.' : `Suit time is used up and home is ${r(returnMin)} min away. Head home now.`)
      : atHabitat
        ? `At the habitat. ${r(suitMinLeft)} min of suit time usable.`
        : marginMin <= 0
          ? `No margin: ${r(suitMinLeft)} min usable, home is ${r(returnMin)} min away at today's pace. Head home now.`
          : `${r(turnBackInMin) > 0 ? `Turn back in ${r(turnBackInMin)} min` : 'Turn back now'}. ${r(suitMinLeft)} min usable, home is ${r(returnMin)} min away at today's pace.`,
    keys: ['eva_design_hours', 'eva_reserve_min', 'walk_speed_kmh', 'walkback_pad'] });

  // 3. radiation
  const doseTodayMsv = C.surface_dose_msv_per_sol * evaMin / (MIN_PER_EARTH_DAY + C.sol_drift_min);
  const cumulativeMsv = C.cruise_dose_msv_per_day * C.transit_days + C.surface_dose_msv_per_sol * sol + doseTodayMsv;
  const careerPct = cumulativeMsv / C.career_limit_msv * PCT;
  const radKeys = ['cruise_dose_msv_per_day', 'transit_days', 'surface_dose_msv_per_sol', 'career_limit_msv', 'sol_drift_min'];
  if (sepActive) {
    factors.push({ id: 'radiation', level: 'RED', label: 'Solar particle event',
      message: `Solar particle event. Curiosity measured ${C.may2024_sep_dose_ugy.toLocaleString('en-US')} µGy at Gale crater in the May 2024 event. ` +
        (atHabitat ? 'You are at the habitat: stay inside.' : `Get to shelter: home is ${r(returnMin)} min away.`) +
        ` Terrain gives little cover (~${C.terrain_shielding_pct}% near a butte).`,
      keys: [...radKeys, 'may2024_sep_dose_ugy', 'terrain_shielding_pct'] });
  } else {
    factors.push({ id: 'radiation', level: careerPct > CAREER_AMBER_PCT ? 'AMBER' : 'GREEN', label: 'Radiation',
      message: `Career dose so far ${careerPct.toFixed(1)}% of the ${C.career_limit_msv} mSv limit (${cumulativeMsv.toFixed(0)} mSv, ${doseTodayMsv.toFixed(2)} mSv from today's walk).`,
      keys: radKeys });
  }

  // 4. dust / visibility
  const dustLevel = tau > C.tau_red ? 'RED' : tau > C.tau_amber ? 'AMBER' : 'GREEN';
  factors.push({ id: 'dust', level: dustLevel, label: 'Dust visibility',
    message: `Dust τ = ${tau.toFixed(1)}: landmarks beyond ~${r(limits.visibilityKm)} km lost.` +
      (dustLevel === 'GREEN' ? '' : ' Blind zones growing. Mars dust storms are thin but tall, so you still see kilometres, but the hills you navigate by fade out.') +
      ` For context, the Jan 2022 Jezero storm reached τ ~${C.tau_jan2022_storm}.`,
    keys: ['vis_dust_scale_height_km', 'tau_amber', 'tau_red', 'tau_jan2022_storm', ...(sansAffected ? ['sans_range_factor'] : [])] });

  // 5. dust devils
  if (ltst >= C.dust_devil_peak_start_ltst && ltst <= C.dust_devil_peak_end_ltst) {
    factors.push({ id: 'dust_devil', level: 'AMBER', label: 'Dust-devil hours',
      message: `Dust-devil peak hours (${C.dust_devil_peak_start_ltst}-${C.dust_devil_peak_end_ltst} h). Winds up to ${C.dust_devil_max_wind_ms} m/s feel like ~${C.mars_wind_earth_equiv_ms} m/s on Earth because the air is far thinner: not a knock-down risk. The risk is sudden zero visibility and dust on visor and joints. Keep a landmark in sight.`,
      keys: ['dust_devil_peak_start_ltst', 'dust_devil_peak_end_ltst', 'dust_devil_max_wind_ms', 'mars_wind_earth_equiv_ms'] });
  }

  // 6. cooling
  const marginPa = C.sublimator_max_pressure_pa - pressurePa;
  const coolKeys = ['sublimator_max_pressure_pa'];
  if (has('jezero_pressure_pa')) coolKeys.push('jezero_pressure_pa');
  factors.push({ id: 'cooling', level: marginPa <= 0 ? 'RED' : marginPa < COOLING_AMBER_PA ? 'AMBER' : 'GREEN', label: 'Suit cooling',
    message: marginPa <= 0
      ? `Cooling fails: ${pressurePa} Pa outside is above the ${C.sublimator_max_pressure_pa} Pa sublimator limit.`
      : `${marginPa < COOLING_AMBER_PA ? 'Cooling margin thin' : 'Cooling OK'}: ${pressurePa} Pa vs ${C.sublimator_max_pressure_pa} Pa limit.`,
    keys: coolKeys });

  // 7. cold
  if (tempC < C.cold_amber_c || ltst > C.cold_return_ltst) {
    factors.push({ id: 'cold', level: 'AMBER', label: 'Cold',
      message: `Air cools fast before dusk (Jezero swings ~50-60 °C per sol). Be heading home by ${C.cold_return_ltst} h.`,
      keys: ['cold_amber_c', 'cold_return_ltst'] });
  }

  // 8. vision
  if (sansAffected) {
    factors.push({ id: 'vision', level: 'GREEN', label: 'Vision (SANS)',
      message: `Spaceflight eye changes (up to +${C.sans_diopter_shift} D far-sighted shift) make distant landmarks harder to recognise: landmark range reduced ${r((1 - C.sans_range_factor) * PCT)}%.`,
      keys: ['sans_diopter_shift', 'sans_range_factor'] });
  }

  // 9. body clock
  factors.push({ id: 'body_clock', level: sol >= DRIFT_FROM_SOL && ltst < DRIFT_EARLY_LTST ? 'AMBER' : 'GREEN', label: 'Body clock',
    message: `A sol is ${C.sol_drift_min} min longer than an Earth day, so the body clock drifts: after sol ${sol} the crew has shifted ${r(sol * C.sol_drift_min)} min.` +
      (sol >= DRIFT_FROM_SOL && ltst < DRIFT_EARLY_LTST ? ' Early start while drifting: expect lower alertness.' : ''),
    keys: ['sol_drift_min'] });

  // 10. bone
  if (sol < BONE_UNTIL_SOL) {
    factors.push({ id: 'bone', level: 'GREEN', label: 'Bone and fall risk',
      message: `Bone loss in transit ~${C.bone_loss_pct_per_month}% per month: avoid falls. Max slope lowered to ${C.max_slope_early_deg}° until sol ${C.sensorimotor_recovery_days}.`,
      keys: ['bone_loss_pct_per_month', 'max_slope_early_deg', 'sensorimotor_recovery_days'] });
  }

  // 11. after the EVA
  const walkedM = Number.isFinite(inputs.distSinceFixM) ? inputs.distSinceFixM : 0;
  if (suitMinLeft <= 0 || (atHabitat && evaMin > 0 && walkedM > 2 * AT_HABITAT_KM * 1000)) {
    factors.push({ id: 'post_eva', level: 'GREEN', label: 'After the EVA',
      message: `Dust-off before entry: soil is ~${C.perchlorate_pct}% perchlorate (thyroid risk).`,
      keys: ['perchlorate_pct'] });
  }

  // another alert says go home while the clock still has time: do not print a calm "turn back in N min"
  const su = factors.find(f => f.id === 'suit_time');
  if (!atHabitat && su.level !== 'RED' && factors.some(f => f.level === 'RED')) {
    su.message = `Suit time is not the limit: ${r(suitMinLeft)} min usable, home is ${r(returnMin)} min away at today's pace. Another alert says head home now.`;
  }
  factors.sort((a, b) => RANK[a.level] - RANK[b.level]); // stable
  const status = factors[0].level;
  return {
    status, headline: status === 'RED' && atHabitat ? 'AT SHELTER' : HEADLINE[status],
    suitMinLeft, returnMin, marginMin, turnBackInMin, extraOutKm,
    speedKmh: limits.speedKmh, maxSlopeDeg: limits.maxSlopeDeg, visibilityKm: limits.visibilityKm,
    doseTodayMsv, cumulativeMsv, careerPct, factors
  };
}
