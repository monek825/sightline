# Feature: Python precompute scripts

**Owners:** Sean (terrain + data) and Brayden (viewsheds + Skyline Fix) · **Paste into Claude together with the root `README.md`.**

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

Error / uncertainty radius in metres (min RMS in deg). Prior offset 1757 m in every test, so ~50 m is the best a 100 m grid can give. "Single" = one frame (the legacy frame for development, the earliest usable frame for held-out). All four rows use the new truth, attitude and scoring; "legacy" is the old single-frame JSON (sol-level truth, no offset, no near-field rule).

| Test | Set | Frames / valid az | legacy single | (i) single, CTX | (ii) single + MOLA | (iii) pano, CTX | (iv) pano + MOLA (full) |
|---|---|---|---|---|---|---|---|
| site 7 / drive 1716 (sol 203/204) | development | 5 / 100% | 2951 / 2474 | 4082 / 3124 (0.357) | 2039 / 2786 (0.099) | 1631 / 1476 (0.855) | **497 / 1304 (0.515)** |
| site 90 / drive 5110 (sol 1946) | development | 5 / 100% | 1263 / 1965 | 2203 / 50 (0.379) | 2203 / 50 (0.379) | 240 / 224 (0.691) | **240 / 200 (0.659)** |
| site 33 / drive 4752 (sol 714) | held-out | 5 / 98% | - | 4800 / 3883 (0.377) | 4800 / 3883 (0.377) | 51 / 50 (0.807) | **1600 / 1581 (0.782)** |
| site 45 / drive 0 (sol 911) | held-out | 4 / 94% | - | 2853 / 1044 (0.620) | 2085 / 1044 (0.649) | 51 / 50 (0.952) | **51 / 50 (0.950)** |

Reading (honest): the panorama is what matters (single frame 2.0-4.8 km off in all four; panorama 51-1631 m). MOLA helped a lot where the skyline is formed outside the DTM (site 7: 1631 -> 497 m) and did nothing at sites 90 and 45; at held-out site 33 it made the result worse (51 -> 1600 m). Development results were used to debug (including the 50% scoring guard); the two held-out results were run once each with frozen code (the only edit between freezing and running was a missing `LAT_MID` import in the selection function, fixed before any held-out position was chosen). Even the best fits leave 0.5-0.95 deg RMS and the site 7 uncertainty is 1.3 km, so "tens of metres" is not demonstrated: 3 of 4 full-method results are 51-497 m with uncertainties of 50-1304 m, on four positions, not statistics. Remaining residuals (site 90: +1.6 to +1.9 deg at az 300-312; site 7: +1.4 to +5 deg at az 0-72) are tall terrain absent from CTX and MOLA.
Held-out rule (ascending sol; >= 3 km from both development positions and each other; >= 2 km inside the DTM; usable daytime frames whose greedy-selected footprint covers >= 270 deg): 325 site+drive positions examined, 323 skipped (all by the 3 km rule: the rover stayed within 3 km of the development sites until sol 714, and within 3 km of the first held-out site until sol 911), 2 chosen; log in `data/skyline_real/heldout_selection.json`. Coverage is judged from frame metadata before tracing; the traced valid fractions are in the table.
Reproduce (needs `raw/dtm.tif`; downloads NASA metadata/frames/MOLA rows on first run, 19 images in total):
```
python scripts/skyline_real.py --dev                  # development set, both positions (writes site007_..., site090_...)
python scripts/skyline_real.py --heldout              # selects the two held-out positions (ascending-sol rule) and runs each once
python scripts/skyline_real.py --pano 33 4752 --set held-out   # one position by hand
```
