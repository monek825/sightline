# Feature: DATA — NASA data, science numbers, sources

**Owner:** Sean · **Paste into Claude together with the root `README.md`** (and `scripts/README.md` for the terrain scripts).

## Purpose
Everything in Sightline must stand on real NASA data. Sean owns the files in `data/` and the **sources list** — this is what makes the project pass **Validity** and qualify for global awards (≥ 1 NASA resource from the challenge Resources tab is required).

## Priority order (others are waiting on the first ones)
1. **Check the challenge Resources tab** on spaceappschallenge.org (Jezero / Martian Map challenge). Write down which listed NASA resources we use, word for word, in `data/sources.md` → section "Challenge resources used". Tell Brayden.
2. `meta.json`, `heightgrid.json`, `heightmap.png` → run `scripts/make_grid.py` (spec in `scripts/README.md`). **Send to Edward and Jojo as soon as done.**
3. `landmarks.json` → `scripts/landmarks.py`.
4. `traverse.json`, `targets.json`, `donki_sep_may2024.json` → `scripts/fetch_nasa.py` (below).
5. `scenario_demo.json` (below).
6. Verify `crew_constants.json` (already filled in) — fix any TODO sources.
7. `sources.md` complete for the submission page.
8. Stretch: MEDA pressure/temperature for one real sol.

## `scripts/fetch_nasa.py` (spec)

### Perseverance traverse + science targets
```
https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json
```
GeoJSON, 708 features. `properties` has `sol, lat, lon, site, drive, dist_total_m, Note, images`.
- `data/traverse.json`: `[{sol, lat, lon}]` for every feature, sorted by sol.
- `data/targets.json`: rover position at these sols (pick the feature with the nearest sol):

| id | name | sol | approx lat, lon (checked in the waypoints file) |
|---|---|---|---|
| `landing` | Octavia E. Butler Landing | 13 (first waypoint) | 18.44463, 77.45089 |
| `three_forks` | Three Forks sample depot (approx., rover position during depot sols) | 648 | 18.45252, 77.40720 |
| `cheyava_falls` | Cheyava Falls / "Sapphire Canyon" sample area (approx.) | 1174 | 18.49500, 77.30628 |
| `delta_top` | Upper delta | 1320 | 18.46776, 77.29101 |
| `crater_rim` | Crater rim | 2022 | 18.43560, 77.23313 |

Mark them "approx." in names — they are rover positions near the feature, not survey points.

### DONKI solar particle events (May 2024)
```
https://api.nasa.gov/DONKI/SEP?startDate=2024-05-01&endDate=2024-05-31&api_key=DEMO_KEY
```
Save the raw JSON to `data/donki_sep_may2024.json` (14 events expected). Pick the event around **20 May 2024** (the big flare whose particles hit Mars) and put its `sepID` into `scenario_demo.json`. DEMO_KEY is rate-limited — fetch once, commit the file. (Get your own free key at api.nasa.gov if needed; never commit a personal key.)

Context for the UI: Curiosity's RAD measured **8,100 µGy** at Gale crater during that event (NASA/JPL, June 2024). DONKI events are observed near Earth — we use them as a **replay trigger**, and say so.

### Raw Navcam images (stretch, for Horizon Match real-photo check)
```
https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=50&search=NAVCAM_LEFT
```
Each image has `extended.mastAz`, `extended.mastEl`, `camera.camera_vector`, `image_files.full_res`. Panorama mosaics under `/mmgis-maps/M20/Layers/mosaics/` return 403 — use single Navcam frames instead.

## `data/scenario_demo.json`
Use the shape in root README section 6. Suggested timeline (sol 12 → crew still recovering, short slope limit — good drama):
- t=0 EVA start at home, LTST 9:00, target `three_forks` (~2.5 km WNW).
- t=60 τ 0.5. t=120 SEP onset (DONKI id). t=135 τ 2.0. t=150 Horizon Match at site `landing` (or whichever skyline site exists). t=200 EVA end.
Brayden may tune the times for the video.

## `data/crew_constants.json` — already filled in
Every number the crew model uses, with `source`, `url`, `isEstimate`. Your job:
- Open each `url`, confirm the number. Fix or flag anything wrong.
- Rows with `"url": "TODO"` need a proper source found (search NTRS: ntrs.nasa.gov).
- **Never upgrade an estimate to NASA data without a source.**

## `data/sources.md` — the references list for the submission
Everything we used: NASA datasets (with URLs), papers, NASA reports, software libraries (Leaflet, A-Frame, numpy, Pillow), AI tools (Claude, GitHub Copilot), fonts. Hackathon rule: **cite everything, even open-source**. A starter version is already in the file.

## Stretch: MEDA (Perseverance weather station)
PDS Atmospheres node:
```
https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/
```
Example pressure file (sol 1):
```
https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/sol_0000_0089/sol_0001/WE__0001___________DER_PS__________________P02.CSV
```
Columns: `SCLK, LMST, LTST, PRESSURE, ...`. Browse the same sol folder for the air-temperature product (file name contains `ATS`) — verify the name before scripting. Output `data/meda_sol.json`: `[{ltst, pressurePa, tempC}]` for one sol → the demo player can use real pressure/temperature by time of day.

## Gate
Run `python3 scripts/check_data.py` after every data change. It checks every contract (ARCHITECTURE.md §7) and fails on missing files, NaN, wrong sizes, swapped lat/lon, duplicate ids, and constants marked NASA data without a source.

## Acceptance checklist
- [ ] Challenge Resources tab checked, used resources listed word for word.
- [ ] All files in root README section 6 exist with the right shape.
- [ ] `crew_constants.json` rows checked; TODOs resolved or clearly marked estimate.
- [ ] `sources.md` complete enough to paste into the submission page.

`terrain_texture.jpg` — CTX orthomosaic (NASA Mars Trek) cropped to the `meta.json` bounds, made by `scripts/make_texture.py`.
