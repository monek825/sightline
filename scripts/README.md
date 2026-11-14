# Feature: Python precompute scripts

**Owners:** Sean (terrain + data) and Brayden (viewsheds + Horizon Match) · **Paste into Claude together with the root `README.md`.**

## Purpose
The website has no server, so all heavy maths runs **once, offline, in Python**, and the results are saved into `data/` as small JSON/PNG files the browser loads. Each script is run by hand: `python3 scripts/<name>.py`.

Setup (use Python 3.11–3.13):
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install numpy pillow
```
Raw downloads go in `raw/` (git-ignored; share them via Google Drive).

## Input: the CTX DTM
Download (9.7 MB):
```bash
mkdir -p raw && curl -L -o raw/dtm.tif "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif"
```
- 1596 × 1512 float32, 20 m posting, equirectangular, standard parallel 0°, Mars radius 3,396,190 m.
- Bounds: lat 18.2110273909634–18.7211944818728, lon 77.1604654592237–77.6989751662947.
- No-data values are < −10000 → set to NaN. Pillow can open it: `np.array(Image.open('raw/dtm.tif'), dtype=np.float32)`.
- Ground metres per pixel: north–south 20.0; east–west 20.0 × cos(lat).

## Status (Sat 14 Nov)
| Script | Status |
|---|---|
| `dtm.py` (shared helpers) | ✅ done |
| `make_grid.py` | ✅ done → meta, heightgrid, heightmap, basemap committed |
| `landmarks.py` | ✅ done → 13 landmarks (home + 9 buttes + 3 rim points). **Sean: check names on Mars Trek** |
| `viewsheds.py` | ✅ done → 13 PNGs. Home visible within 1/2/3/5 km: 57/40/26/24% (prototype 54/37/25/22%) |
| `check_data.py` | ✅ done |
| `fetch_nasa.py` | ✅ done → traverse (708 waypoints), 5 targets, DONKI May 2024 (14 events), scenario. Note: DONKI's list ends 13 May, so the replay trigger is the GOES >100 MeV event of 11 May; Curiosity's 8,100 µGy was the 20 May event |
| `skyline.py` | ⏳ Brayden + Sean |

Re-run all terrain outputs (about 30 s), with numpy + Pillow installed:
```bash
python3 scripts/make_grid.py && python3 scripts/landmarks.py && python3 scripts/viewsheds.py && python3 scripts/check_data.py
```

## Scripts to write

### 1. `scripts/make_grid.py` → `data/meta.json`, `data/heightgrid.json`, `data/heightmap.png`, `data/basemap.png` (Sean — FIRST, others are waiting)
- Downsample ×4 by block mean (ignore NaN) → 399 × 378 (crop the extra rows/cols: 1596/4 = 399, 1512/4 = 378).
- **Fill no-data (NaN) with the nearest valid value first** (`scipy`-free: repeat a 3×3 nan-mean fill until none left). `json.dump` would otherwise write `NaN`, which is invalid JSON.
- Write `heightgrid.json` exactly as root README section 6 (values rounded to 0.1 m, row 0 = north).
- Write `basemap.png`: hillshade of the full 20 m DTM (sun azimuth 315°, altitude 30°), grayscale, 1596 × 1512 — offline fallback under the map tiles.
- Write `heightmap.png` 8-bit grayscale scaled min→0, max→255.
- Write `meta.json` exactly as root README.
- Print min/max and the height at home (expect ≈ −2567 m).

### 2. `scripts/landmarks.py` → `data/landmarks.json` (Sean)
- Always include `home` (lat 18.4447, lon 77.4508, heightM 5, kind habitat).
- Auto-pick ~12 natural landmarks: local maxima on the 20 m DTM with **prominence ≥ 40 m** within a 1.5 km window, spread out (min 1.5 km apart), inside 8 km of home first. Name them by type + direction, e.g. "Delta butte NW 3.1 km". `heightM: 0`.
- Add the crater rim high point(s) (kind `rim`).
- Sean: open them in Mars Trek (trek.nasa.gov/mars) and rename any that match a real named feature (e.g. "Kodiak" butte). Mark `"source": "auto-picked from CTX DTM"` or `"named feature, verified on Mars Trek"`.

### 3. `scripts/viewsheds.py` → `data/viewsheds/<id>.png` (Brayden)
For each landmark: for every cell of the 399 × 378 working grid, is the landmark's top visible from an astronaut's eyes (1.7 m) standing in that cell?
- Use the **full 20 m DTM** for the line of sight, output on the 80 m grid.
- Line of sight from observer O (ground + 1.7 m) to target T (ground + heightM, or + 2 m for natural landmarks so a peak top counts):
  - sample every 20 m along the line; at distance d from O (total D), the terrain blocks if
    `terrain(d) + d*(D-d)/(2R) > line_height(d)` (the `d*(D-d)/(2R)` term = Mars curvature bulge).
- Vectorise with numpy: for each landmark, loop over grid cells in numpy batches (all cells × ~N samples). ~150k cells × up to ~1500 samples is heavy → limit to cells within **20 km** of the landmark (beyond that, mark 0), and step 40 m for d > 5 km. Should run in minutes.
- Save PNG: 255 visible, 0 hidden.
- Print: "home visible from X% of ground within 1/2/3/5 km". Earlier prototype result for the habitat: **54% / 37% / 25% / 22%** — sanity-check against that.
- Reference prototype logic (from our research session): horizon + LOS with curvature on the same DTM.

### 4. `scripts/skyline.py` → `data/skyline/<site>.json` (Brayden + Sean) — see `skyline/README.md` for the full spec

### 6. `scripts/check_data.py` — the gate (already written)
Validates every contract in ARCHITECTURE.md §7. Run before every push of data and before submitting:
```bash
python3 scripts/check_data.py
```
Exit code 0 = all good. It lists every problem otherwise.

### 5. `scripts/fetch_nasa.py` → `data/traverse.json`, `data/targets.json`, `data/donki_sep_may2024.json` (Sean) — see `data/README.md`

## Rules
- Every script prints what it wrote and key numbers (for our notes / the video).
- Header line `# Written with AI assistance (Claude / GitHub Copilot)`.
- Keep downloaded files in `raw/` and never run code from there; our scripts only read them as data.
- Commit the **outputs in `data/`**, not the raw `.tif`.

## Acceptance checklist
- [ ] `data/meta.json`, `heightgrid.json`, `heightmap.png` exist and match the contract.
- [ ] `landmarks.json` has home + ~12 landmarks.
- [ ] One viewshed PNG per landmark; home stats printed and close to the prototype.
- [ ] Skyline results for at least 3 sites.

### 7. `scripts/make_texture.py` → `data/terrain_texture.jpg`
Stitches the NASA Mars Trek CTX orthomosaic (WMTS, EPSG:4326, zoom 12, 182 tiles) and crops it exactly to `meta.json` bounds (left = lonMin, top = latMax) for use as the 3D terrain texture. 3137 × 2972 RGB JPEG, ~1.7 MB. Missing tiles are left black and reported. Run: `python3 scripts/make_texture.py` (needs Pillow).

### 8. `scripts/skyline_real.py` → `data/skyline_real/sol204.json`, `sol1946.json` (+ `.jpg` copies) — real-photo checks (stretch)
Each test takes ONE real Perseverance Navcam-Left horizon strip (NASA/JPL-Caltech; downloaded to git-ignored `raw/navcam/`), traces its skyline (first bright-to-dark step per column, sigma 1.5 px / threshold 4, never tuned), converts pixels to azimuth/elevation with the frame's own CAHVORE camera model and attitude quaternion, compares with the DTM horizon at the `traverse.json` waypoint for that sol (horizon function imported from `skyline.py`), then runs the ±3 km / 100 m grid search with heading limited to ±10°. Run: `python scripts/skyline_real.py [sol204|sol1946]`; `--screen` prints the geometry ranking used to pick test 2.
- **Test 1, sol 204 (failed, by construction):** the mountains forming the skyline are outside the DTM (40 km DTM horizon peaks at -0.05°, photo skyline +0.2° to +2.5°). Grid search lands 2951 m off, uncertainty 2474 m.
- **Test 2, sol 1946 (fair test, geometry-screened):** window/waypoint ranked by DTM geometry only (horizon 0.5–8° above level, terrain ≥1 km inside the DTM); first ranked candidate with a usable frame was #7 (6 skipped, reasons in the JSON). Quaternion convention fixed independently (rover drive bearings on 20 sols), not by the fit. Unfitted RMS 1.01°, fitted 0.52° (elevation offset +0.84°, azimuth shift -7°); 100% of traced azimuths have their horizon terrain inside the DTM. **Grid search lands 1263 m from the waypoint, uncertainty 1965 m: a failed fix.** The skyline shape agrees with the DTM within ~0.5° over most of the span, so the DTM and camera model are sensible, but one smooth skyline does not pin the position down to better than ~km.
Both are single images, not statistics. Also: `skyline.py --offgrid` (the default run is unchanged) moves the true position 0–50 m off the search grid and writes only `data/skyline/offgrid_summary.json` (errors 5–23 m at 360°); `fov96.estimate` is not written.

#### 8b. Second round: panorama + MOLA backdrop (`--dev`, `--heldout`, `--pano SITE DRIVE`) -> `data/skyline_real/site<SSS>_drive<DDDD>_pano.json` (+ `.jpg` plot)
Why: the single-frame tests failed because (1) the 96 deg skyline of one frame is ambiguous, (2) terrain beyond the CTX DTM edge was missing, (3) the truth was sol-level. Changes, all fixed from the brief before any result: truth position **and attitude** from NASA's `M20_waypoints.json` matched by site+drive (waypoint yaw/pitch/roll equals every frame's own quaternion); MOLA MEGDR 128 px/deg (`scripts/mola.py`, rows 21N-16N fetched by HTTP Range into git-ignored `raw/mola/`; label verified: 11520 x 5632, MSB int16, 128 px/deg, 44N-0N x 0E-90E, metres above areoid; CTX minus MOLA at 400 random points: mean -3.6 m, std 24.9 m, so no offset) used for samples outside the CTX footprint or beyond 15 km (250 m steps to 120 km); all Navcam-left strips of the same site+drive (full width, |mastEl| <= 8 deg, LTST 9-16 h; greedy subset with boresights >= 40 deg apart) traced with the unchanged edge settings (sigma 1.5, threshold 4) and merged by median on the 2 deg grid (NaN = not scored); heading +-10 deg, one elevation offset per candidate clipped to +-0.5 deg, azimuths whose predicted horizon forms < 150 m away are not scored for that candidate; 61 x 61 / 100 m grid, same 1-2 km prior (seed 2021), same uncertainty rule. One addition made after the first development run: a candidate must score >= 20 azimuths and >= 50% of the valid ones (otherwise the near-field rule let a single-frame candidate "win" on 20 of 48 azimuths).

**What went wrong at site 33 (v1 result 51 -> 1600 m when MOLA was added), and the v2 change.** Diagnosis at the true position and at the winning (wrong) cell, 2 deg azimuth bins, same traced profile: (1) MOLA is not wrong: inside the CTX footprint beyond 15 km MOLA and CTX horizons agree to -0.03 deg mean / 0.09 deg std (9 positions, 853 azimuths), CTX-minus-MOLA registration is best at zero shift (std 27 m; 1-cell shifts 34-40 m; a planetographic/centric swap 170-270 m), the 15 km hand-over coincides with the DTM edge at this site (15.1 km N and S) and MOLA-formed horizons come from 18-49 km, and the traced skyline follows MOLA to ~0.1-0.3 deg at az 160-200 (terrain 15-27 km away), so haze is not hiding it. (2) At the true position MOLA never forms the horizon on a traced azimuth (0 of 177), so CTX-only and CTX+MOLA scores are identical there (RMS 0.806). (3) The wrong cell (1600 m away) wins by scoring 92 of 177 azimuths: the DTM puts a 16-21 deg wall within 80 m of it over az 330-120, those 85 azimuths are excluded by the 150 m near-field rule, and they are exactly the ones it fits worst. MOLA only contributed there by raising the horizon on 31 azimuths (az 120-210, where the photo agrees with MOLA) from RMS 0.98 (CTX-only, loses to truth's 0.807) to 0.78 (beats truth's 0.802). On the 56 azimuths both score, truth is better (0.81 vs 0.89). Ablating the scorer on the unchanged data: no near-field rule -> 51 m with or without MOLA; elevation offset fixed at 0 -> still 1600 m (the +-0.5 deg offset is not the cause). Cause: candidate-dependent scored azimuth sets (a candidate is rewarded for excluding azimuths it cannot fit); MOLA was the trigger, not the culprit. Confidence: high for the mechanism (reproduced, and removed by ablation), moderate that this is the only weakness (RMS at truth is still 0.8 deg). A second observation: at the true position the CTX DTM forms the horizon 40-80 m away over az 142-200 at 2.5-4.5 deg while the photo (and MOLA) put it at 0.4-2.4 deg, i.e. the DTM invents a near ridge; the near-field rule exists for that. A faint second edge above the traced line was looked for (columns where the model line is >= 8 px above the trace, frame 144: 155-186 columns): the strongest downward gradient between the two lines has median 1.3 grey levels/px (threshold 4; sky control median 0.2, p90 0.4), p90 3.8, max 5.5 near the traced edge's own blur foot: no separate edge, the tracer did not skip a strong one. Overlays: `raw/navcam/diag/` (git-ignored).
**v2 change (stated before re-running, single change, no new parameter):** terrain closer than 150 m (unchanged value) is no longer allowed to form the predicted horizon (CTX samples >= 150 m and MOLA only), and every traced azimuth is scored for every candidate (identical azimuth set). Reason: a 20 m DTM cannot resolve the first 150 m, but dropping azimuths per candidate makes RMS values incomparable. Site 33 is therefore labelled development from now on (its JSON `setNote` says why); site 45 keeps its v1 held-out result, its v2 re-run is post-fix and not independent.

Error / uncertainty radius in metres (min RMS in deg), v2 code. Prior offset 1757 m everywhere. v1 full-method values in brackets.

| Test | Set | Frames / valid az | (i) single, CTX | (ii) single + MOLA | (iii) pano, CTX | (iv) pano + MOLA (full) |
|---|---|---|---|---|---|---|
| site 7 / drive 1716 | development | 5 / 100% | 4082 / 1204 (0.357) | 494 / 5801 (0.187) | 3146 / 2915 (1.045) | **2770 / 2280 (0.980)** [v1 497 / 1304] |
| site 90 / drive 5110 | development | 5 / 100% | 69 / 50 (0.445) | 69 / 50 (0.445) | 69 / 50 (0.670) | **69 / 50 (0.677)** [v1 240 / 200] |
| site 33 / drive 4752 | development (was held-out) | 5 / 98% | 3583 / 50 (0.629) | 3583 / 100 (0.628) | 51 / 50 (0.830) | **51 / 50 (0.837)** [v1 1600 / 1581] |
| site 45 / drive 0 | held-out in v1; v2 re-run not independent | 4 / 94% | 4153 / 50 (0.958) | 4153 / 50 (0.958) | 51 / 50 (0.947) | **51 / 50 (0.946)** [v1 51 / 50] |
| site 61 / drive 1928 (sol 1311) | held-out, round 2, frozen v2, run once | 4 / 66% | 51 / 50 (0.259) | 51 / 50 (0.367) | 143 / 141 (1.528) | **143 / 141 (1.869)** |

Reading (honest): the v2 change fixed site 33 (1600 -> 51 m), improved site 90 (240 -> 69 m), left site 45 unchanged and **made site 7 much worse (497 -> 2770 m)**: at site 7 the v1 exclusion was discarding ~45 azimuths over az 0-90 where the traced skyline is 1-4 deg above both models (tall terrain absent from CTX and MOLA); scored now, they dominate the RMS. That was not tuned away. The fresh round-2 position (site 61) gives 143 m / 141 m, which meets the pre-set FIX rule, but with only 66% of azimuths traced, a poor fit (1.87 deg min RMS, 2.05 deg at the waypoint, worse with MOLA than without) and the single frame landing at 51 m, so it should not be read as evidence of a working method. In total: 4 of 5 full-method results are <= 143 m, one is 2770 m, three of the five positions were used in development or diagnosis. Selection found only ONE qualifying round-2 position (see below), so there is a single fresh result, not two.
Round-2 selection (`data/skyline_real/heldout_selection_round2.json`, `--heldout2`): scan after sol 911 with the 3 km exclusion applied to all four previous positions; 383 site+drive positions examined, 346 skipped by the 3 km rule, 20 by the 3 km rule vs the first chosen position, 16 by the coverage rule (c), 1 chosen (site 61 / drive 1928, sol 1311; 4 image downloads); the scan reached the end of the waypoint file without a second qualifying position.
Held-out rule (ascending sol; >= 3 km from both development positions and each other; >= 2 km inside the DTM; usable daytime frames whose greedy-selected footprint covers >= 270 deg): 325 site+drive positions examined, 323 skipped (all by the 3 km rule: the rover stayed within 3 km of the development sites until sol 714, and within 3 km of the first held-out site until sol 911), 2 chosen; log in `data/skyline_real/heldout_selection.json`. Coverage is judged from frame metadata before tracing; the traced valid fractions are in the table.
Reproduce (needs `raw/dtm.tif`; downloads NASA metadata/frames/MOLA rows on first run, 19 images in total):
```
python scripts/skyline_real.py --dev                  # development set, both positions (writes site007_..., site090_...)
python scripts/skyline_real.py --heldout              # selects the two held-out positions (ascending-sol rule) and runs each once
python scripts/skyline_real.py --pano 33 4752 --set held-out   # one position by hand
```
