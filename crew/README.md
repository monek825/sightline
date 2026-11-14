# Feature: CREW — crew condition model + Walk Budget + alerts

**Owner:** Jojo · **Paste into Claude together with the root `README.md`.**

## Purpose
Turn everything that can hurt an astronaut on a Mars walk into **one answer**: *can they still get home safely, and how much margin is left?* Output = a **Walk Budget** (status + minutes + a list of reasons with sources). The map panel, the alerts, the route planner and the helmet HUD all read this one object.

This is the "very complex, very detailed, one simple purpose" part. Every factor must be traceable to a row in `data/crew_constants.json` with `isEstimate` true/false — that is how we win **Validity**.

## Files to create
```
/crew/budget.js        export function computeLimits(inputs, C) and computeBudget(inputs, limits, routeHomeKm, C) — pure, no DOM, no fetch
/crew/budget.test.html open in browser: runs console.assert checks with fixed inputs, shows PASS/FAIL list
```
**No wiring file.** `lib/pipeline.js` (Brayden) calls your two functions in this order (ARCHITECTURE.md §5):
`computeLimits` → visibility → route planner → `computeBudget`. This order breaks the circle "budget needs route length / route needs budget's slope limit". **Never subscribe to the store or call `setInputs` from crew code.**

`C` = constants keyed by `key`: build it with
`const C = Object.fromEntries(rows.map(r => [r.key, r.value]))` (the pipeline passes it in; keep `rows` around only for the UI tags).

## `computeLimits(inputs, C)` → `{ speedKmh, maxSlopeDeg, visibilityKm }`
Needs no route. Implements factor 1 (speed + slope limit, flat-ground speed — no slope factor here) and factor 4 (visibility). The route planner and the blind-zone map use this.

## `computeBudget(inputs, limits, routeHomeKm, C)` → budget object
`inputs` = the store inputs (ARCHITECTURE.md §4): `sol, ltst, evaMin, tau, sepActive, pressurePa, tempC, sansAffected, ...`.
`routeHomeKm` = remaining length of the route home, given by the pipeline (it already includes slope effects through the route's travel time; if the route failed, the pipeline passes straight-line × 1.3 and adds a warning).
`limits` = output of `computeLimits` (copy its fields into the budget output).

### Required constant keys
`computeLimits`/`computeBudget` must throw a clear error at load if any key is missing (the loader checks this list too):
`walk_speed_kmh, walkback_pad, arrival_speed_factor_sol0, sensorimotor_recovery_days, max_slope_early_deg, max_slope_deg, eva_design_hours, eva_reserve_min, cruise_dose_msv_per_day, transit_days, surface_dose_msv_per_sol, career_limit_msv, may2024_sep_dose_ugy, terrain_shielding_pct, vis_dust_scale_height_km, sans_range_factor, tau_amber, tau_red, tau_jan2022_storm, dust_devil_peak_start_ltst, dust_devil_peak_end_ltst, dust_devil_max_wind_ms, mars_wind_earth_equiv_ms, sublimator_max_pressure_pa, cold_amber_c, cold_return_ltst, sans_diopter_shift, sol_drift_min, bone_loss_pct_per_month, perchlorate_pct`

Export it: `export const REQUIRED_KEYS = [...]`.

## Output
```js
{
  status: 'GREEN' | 'AMBER' | 'RED',
  headline: 'GO' | 'CAUTION' | 'RETURN NOW' | 'AT SHELTER',   // AT SHELTER = RED while at the habitat
  suitMinLeft: 265,          // usable suit time left (after reserve), never below 0
  returnMin: 62,             // minutes needed to walk home incl. safety pad
  marginMin: 203,            // suitMinLeft - returnMin
  turnBackInMin: 203,        // same as margin, floored at 0
  extraOutKm: 3.1,           // how much further they could walk out and still come back
  speedKmh: 2.6,             // walking speed used
  maxSlopeDeg: 10,           // max allowed slope today (route planner reads this)
  visibilityKm: 117,         // usable landmark range (map blind zones read this)
  doseTodayMsv: 0.4,
  cumulativeMsv: 339,        // transit + surface so far
  careerPct: 56.5,           // cumulative / career limit
  factors: [                 // one per factor, worst first
    { id: 'suit_time', level: 'GREEN', label: 'Suit time', message: '265 min usable, home is 62 min away', keys: ['eva_design_hours', 'eva_reserve_min'] }
  ]
}
```
`keys` = which constants back this factor, so the UI can show "NASA data" vs "Estimate" and link sources.

## The model — factor by factor
All numbers come from `C` (crew_constants.json). Names below are the `key`s.

### 1. Walking speed (base for everything)
- `speed = walk_speed_kmh` (3.3 km/h, Apollo walk-back planning number — estimate for Mars).
- **Arrival weakness:** sensorimotor problems last about `sensorimotor_recovery_days` (7). Factor ramps linearly from `arrival_speed_factor_sol0` (0.6, estimate) on sol 0 to 1.0 on sol 7.
- **Slope:** not applied here — the route planner applies the Tobler hiking factor per step, so the route length/time already carries it. `computeBudget` uses `routeHomeKm` at the flat speed (keep it simple; note it in the factor message).
- `maxSlopeDeg` = `max_slope_early_deg` (10) before sol 7, else `max_slope_deg` (15). Both estimates. Route planner forbids steeper cells.

### 2. Suit time (the hard clock)
- `suitMinLeft = eva_design_hours*60 − evaMin − eva_reserve_min`
- `returnMin = routeHomeKm / speed * 60 * walkback_pad` (pad 1.2 = +20% like Apollo walk-back rule).
- `marginMin = suitMinLeft − returnMin`.
- RED if margin ≤ 0. AMBER if margin < 30. Else GREEN.
- `extraOutKm = max(0, marginMin) / 60 * speed / 2 / walkback_pad`.
- Message example: "Turn back in 41 min — home is 62 min away at today's pace."

### 3. Radiation
- `cumulativeMsv = cruise_dose_msv_per_day * transit_days + surface_dose_msv_per_sol * sol + todays EVA share`.
- `careerPct = cumulativeMsv / career_limit_msv * 100` (info, GREEN unless > 80%).
- **If `sepActive`** → RED, headline "RETURN NOW": "Solar particle event. Curiosity measured `may2024_sep_dose_ugy` µGy at Gale crater in the May 2024 event. Get to shelter: home is X min away." Shelter time = `returnMin`. Also add: "Terrain gives little cover (~`terrain_shielding_pct`% near a butte)."
- Note in UI: DONKI reports events seen near Earth; we use it as a **replay trigger** for the Mars event, not a live Mars forecast.

### 4. Dust storms → visibility (feeds blind zones)
- Horizontal visibility (Koschmieder): `visKm = 3.912 / (tau / vis_dust_scale_height_km)` (scale height 15 km = estimate: dust spread evenly through the lower atmosphere).
- If `sansAffected`: `visKm *= sans_range_factor` (0.8, estimate).
- Cap at 150 km (beyond the crater anyway).
- AMBER if tau > `tau_amber` (1.0); RED if tau > `tau_red` (3.0). Message: "Dust τ = 2.0 → landmarks beyond ~29 km lost. Blind zones growing."
- Context line: Jezero normal τ ≈ 0.3–0.5; the Jan 2022 regional storm pushed τ to ~1.7–2 (`tau_jan2022_storm`).

### 5. Dust devils
- If `ltst` within `dust_devil_peak_start_ltst`–`dust_devil_peak_end_ltst` (11–14 h) → AMBER: "Dust-devil peak hours (Perseverance saw >4 per sol, peak 12–13 h). Winds up to 32 m/s feel like a ~3.6 m/s breeze on Earth because the air is ~80× thinner — not a knock-down risk; risk is sudden zero visibility and dust on visor/joints. Keep a landmark in sight."

### 6. Suit cooling vs air pressure
- Suit water-sublimator cooling needs ambient pressure ≤ `sublimator_max_pressure_pa` (~933 Pa = 7 Torr).
- `marginPa = sublimator_max_pressure_pa − pressurePa`. RED if ≤ 0, AMBER if < 100, else GREEN with message "Cooling OK: 718 Pa vs 933 Pa limit (Perseverance MEDA)".

### 7. Cold
- AMBER if `tempC < cold_amber_c` (−70) or `ltst > cold_return_ltst` (16.5): "Air cools fast before dusk (Jezero swings ~50–60 °C per sol). Plan to be home by 17:00."

### 8. Vision (SANS)
- If `sansAffected`: info factor (level GREEN): "Spaceflight eye changes (+0.5 to +1.75 D far-sighted shift) make distant landmarks harder to recognise — landmark range reduced 20%." (keys `sans_diopter_shift`, `sans_range_factor`)

### 9. Body clock
- Info only: "Sol is 39.6 min longer than an Earth day → body clock drifts; after sol N the crew has shifted N×39.6 min." Level AMBER if `sol` ≥ 3 and ltst < 8 (early starts while drifting) — estimate rule.

### 10. Bone + fall risk (arrival)
- Info factor while sol < 30: "Bone loss in transit ~1–1.5% per month → avoid falls; max slope lowered to 10° until sol 7."

### 11. After the EVA (checklist, not a level)
- When `evaMin` reaches EVA end: show "Dust-off before entry: soil is ~0.5–1% perchlorate (thyroid risk)."
- Trigger: fires when `suitMinLeft <= 0`, or when the crew is at the habitat (route home < 0.05 km) with `evaMin > 0` and `distSinceFixM` (metres walked since the last fix, 0 if missing) greater than 100 m, so it does not show at the start of a walk.

### Combining
- `status` = worst level of all factors. `headline`: GREEN → "GO", AMBER → "CAUTION", RED → "RETURN NOW" (RED while at the habitat shows "AT SHELTER" instead).
- Sort `factors` RED → AMBER → GREEN.

## Tests (`budget.test.html`)
At least these, with `console.assert` and a visible PASS/FAIL list on the page:
1. Sol 30, evaMin 60, home 2 km, τ 0.4, no SEP, 718 Pa, −30 °C, ltst 10 → GREEN.
2. Same but `sepActive: true` → RED, headline "RETURN NOW".
3. evaMin 420, home 3 km → suit time RED (margin ≤ 0).
4. τ 2.0 → visibilityKm ≈ 29 (no SANS); with SANS ≈ 23.
5. Sol 0 → speed = 0.6 × base, maxSlopeDeg 10.
6. pressurePa 950 → cooling RED.

## Acceptance checklist
- [ ] `computeBudget` is pure, uses only `C` constants (no magic numbers), all tests pass.
- [ ] Map panel shows status, minutes, and factors with NASA/estimate tags.
- [ ] Turning the storm toggle flips to RED and the route planner re-plans home.
- [ ] τ slider changes `visibilityKm` and the blind zones grow.

## Stretch
- Dose-rate curve during the SEP replay using the DONKI event timing.
- Second crew member with different sol/SANS — budget for the pair = the worse of two.
