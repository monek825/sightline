# Feature: LOCATE — Horizon Match (find your position from the horizon)

**Owners:** Brayden (UI) + Sean (precompute) · **Paste into Claude together with the root `README.md`.**

## Purpose
Mars has no GPS. If the astronaut is lost, they **turn slowly 360°**. A helmet camera traces the skyline (the line where ground meets sky). Every spot on the Jezero DTM has its own unique skyline, so we compare the observed skyline against skylines computed from NASA elevation data and find the best match → **position + uncertainty circle**.

### Why this is credible (say this in the pitch)
- Perseverance's Lander Vision System matched camera images to an orbital map during landing (requirement < 40 m; achieved a few metres).
- Today, rover **global localisation on Mars is still done partly by humans** matching images to orbital maps (JPL, ICRA 2024).
- JPL reports horizon-matching methods at **~10–100 m** accuracy.
- Our test on the real Jezero DTM (simulated skylines + 0.15° noise): **0 m error at all 5 test sites with a full 360° turn**; with only a 96° camera view: 0 m to 1.1 km → that's why the procedure is a **full turn**.
- Off-grid check (`python scripts/skyline.py --offgrid`: true position 0–50 m between search-grid nodes, same noise): full 360° turn error **5–23 m** across the 5 sites (uncertainty 50–141 m); the 96° view landed within 5–142 m in that run, but in another off-grid run with different starting guesses it was 2.9 km and 4.0 km off at two sites, so a single view is not reliable.
- Honest limit: **not yet tested on real photos.** Real cameras + dust + rover/suit tilt will be worse. We show "coarse fix + confidence", never a precise dot.

## Part A — precompute: `scripts/skyline.py` → `data/skyline/<site>.json`

Uses the full 20 m DTM (`raw/dtm.tif`, see `scripts/README.md`).

### Horizon profile at a point
For an observer at (lat, lon), eye height 2.0 m above ground:
- Azimuths 0, 2, 4 … 358° (180 values), 0 = north, clockwise.
- Along each azimuth, sample distance d = 40, 80, … 15,000 m.
- Elevation angle of terrain at d: `atan((z(d) − d²/(2R) − z_eye) / d)` (the `d²/(2R)` term = Mars curvature drop, R = 3,396,190 m).
- Horizon at that azimuth = max angle over all d (degrees).
- Remember east–west ground metres = projected metres × cos(lat).
- Vectorise with numpy: compute all candidate positions × azimuths × distances in batches.

### Matching
- "Observed" skyline = horizon at the true position + Gaussian noise σ = 0.15° (simulates camera/edge-detection error).
- Search grid: ±3,000 m around a **prior guess** (the last known position, offset by 1–2 km from the truth so it isn't cheating), step 100 m → 61 × 61 candidates.
- Score per candidate = **RMS difference** in degrees between observed and candidate horizon, minimised over heading (circular shift of the 180-value array → heading unknown).
- Estimate = lowest RMS cell. Uncertainty radius = distance from the estimate to the farthest candidate with RMS ≤ best + 0.05° (minimum 50 m).
- Also run a **96° field-of-view** variant (only 48 azimuths observed) to show why a full turn matters.

### Sites (use `data/targets.json`)
`landing`, `three_forks`, `cheyava_falls`, `delta_top`, `crater_rim` (at least 3).

### Output `data/skyline/<site>.json`
```json
{
  "site": "landing", "name": "Octavia E. Butler Landing",
  "truth": { "lat": 18.44463, "lon": 77.45089 },
  "prior": { "lat": 18.452, "lon": 77.440 },
  "estimate": { "lat": 18.44463, "lon": 77.45089 },
  "errorM": 0, "uncertaintyM": 100, "headingErrorDeg": 0,
  "fovDeg": 360, "noiseDeg": 0.15, "azStepDeg": 2,
  "observed": [0.75, 0.81, "... 180 values (deg)"],
  "best":     [0.74, 0.80, "... 180 values (deg)"],
  "grid": { "centerLat": 18.452, "centerLon": 77.440, "stepM": 100, "n": 61, "rmsDeg": ["... n*n values, row 0 = north"] },
  "fov96": { "errorM": 141, "uncertaintyM": 600 },
  "method": "Simulated skyline from CTX DTM + 0.15° noise; not a real photo."
}
```
Earlier prototype took ~4–5 min for 5 sites. Keep files small (round to 3 decimals).

## Part B — UI: `skyline/skyline.js`

```js
export async function openSkylineFix(siteId, map)   // loads data/skyline/<siteId>.json and runs the animation
```
Panel (modal or right-side drawer), in this order:
1. **"Turn 360°"** animation (~4 s): a compass ring sweeps around; below it a wide chart draws the **observed skyline** left→right (x = azimuth 0–360°, y = elevation angle, exaggerate y so a 2° horizon is visible).
2. **Search**: the candidate heat map fades onto the Leaflet map (`L.imageOverlay` built from `grid.rmsDeg`: low RMS = bright, high = transparent).
3. **Fix**: the best-match skyline is drawn over the observed one in the chart; map shows the estimate marker + uncertainty circle; `setState({ astronaut: {...estimate}, posUncertaintyM: uncertaintyM })`.
4. Result card: "Position fixed — error X m (simulated test). With only a 96° camera view: Y m. Real-camera accuracy expected ~10–100 m (JPL)." plus a "How it works" link (3 short lines + the credibility bullets above).

Chart: plain `<canvas>` or inline SVG, no chart library. Colours: observed = white, best match = amber, mismatch area shaded.

Respect `prefers-reduced-motion`: skip the sweep, show the final state.

## Acceptance checklist
- [ ] `data/skyline/` has ≥ 3 sites with 360° and 96° results.
- [ ] Panel plays the 3 steps and updates the astronaut + uncertainty circle on the map.
- [ ] Every result says "simulated skyline" — no overclaiming.
- [ ] Demo player event `skyline_fix` opens it automatically.

## Stretch (only if everything else works)
- **Real photo check:** take a Perseverance Navcam frame (raw images API, see `data/README.md`) with known `mastAz`/`mastEl`, trace the skyline by hand or by simple edge detection (sky is brighter: first row from the top where brightness drops), convert pixel rows to elevation angles using the camera's field of view, and match against the DTM horizon at the rover's waypoint position. Even one real image matching is a strong slide.
