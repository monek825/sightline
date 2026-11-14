# Sightline — the Mars map with no blue dot

**NASA Space Apps Challenge 2026 · Jakarta · Challenge: "Interplanetary Survival Guide: Martian Map" (Jezero Crater)**
Team: Brayden, Jojo, Sean, Edward

> **How to use this file with Claude:** paste `CONTEXT_BUNDLE.md` (everything in one file) into Claude, or open the repo in Claude Code — it reads `CLAUDE.md`. This README = concept, data formats, file layout, rules. **`ARCHITECTURE.md` = how the system fits together (state, pipeline, function signatures, failure handling, security).** Your feature README = the detailed build spec. Priority if they disagree: ARCHITECTURE.md → README.md → feature README. Tell the team.

---

## 1. The idea in one sentence

Mars has no GPS. **Sightline answers one question at every step of a spacewalk: "Can this astronaut still find their way home safely?"**

Every hazard feeds that one answer — dust, radiation, a body weakened by the trip, vision changes, the suit's clock. Not a pile of separate alerts: one **Walk Budget** and one map.

### The three parts

| Part | What it does | Folder |
|---|---|---|
| **SEE** | Map of where the astronaut **cannot see home or any landmark** ("blind zones"). On real Jezero terrain, home is hidden from ~75% of the ground within 3 km. Dust shrinks visibility → blind zones grow live. Routes that stay in sight. | `map/`, `route/`, `scripts/` |
| **LOCATE** | **Horizon Match**: astronaut turns 360°, helmet camera skyline is matched against skylines computed from NASA elevation data → position estimate + uncertainty circle. No GPS needed. | `skyline/`, `scripts/` |
| **CREW** | Body + suit model on NASA numbers: radiation (Curiosity RAD + DONKI solar storms), weakness after landing, vision changes (SANS), suit time, suit cooling vs air pressure (MEDA), cold, dust devils, dust storms, body-clock drift → one **Walk Budget** with GREEN / AMBER / RED. | `crew/`, `data/` |
| **+ Helmet view** | 3D first-person view from the real terrain with an arrow/beacon to home and the walk budget as a HUD (AR concept for future helmets). | `helmet/` |

### Demo story (this is what the 30-second video shows)
EVA on sol 12 → a solar storm hits (replay of the real May 2024 event that Curiosity measured) → walk budget turns RED "shelter now" → dust optical depth rises → far landmarks disappear → blind zones grow on the map → route planner gives a new way home along close landmarks → astronaut does a 360° turn → Horizon Match confirms position → helmet view shows the arrow home.

---

## 2. Hackathon rules that affect the build

- **Deadline: Sunday 15 Nov 2026, 23:59 WIB.** Feature freeze Sunday 16:00. First "Submit for Judging" Sunday 21:00.
- Judges know apps won't be finished: **show the blueprint + reasoning** for parts not built.
- Judging: **Impact, Creativity, Validity, Relevance, Presentation.** Validity = label every number as *NASA data* or *our estimate* (the `isEstimate` flag in `data/crew_constants.json`).
- Must use **at least one NASA resource listed in the challenge's Resources tab** (Sean confirms which).
- **Cite everything** (libraries too) → `data/sources.md`.
- **No NASA logos / meatball / mission patches** anywhere in the app or video.
- AI-generated images/video need a visible **"SI-generated"** watermark. AI-written code: keep the header comment `// Written with AI assistance (Claude / GitHub Copilot)` at the top of each file.
- All text in **English**. No person under 18 in any media.
- Everything must work from a **public static link** (GitHub Pages). **No backend server.** Heavy maths is precomputed in Python (`scripts/`) and saved as files in `data/`.

---

## 3. Tech stack (no build step)

- Plain **HTML + CSS + JavaScript ES modules** (`<script type="module">`). No npm, no bundler, no framework. Open with any static server.
- **Leaflet 1.9.4** (2D map): `https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js` + `.css`
- **A-Frame 1.6.0** (3D helmet view): `https://aframe.io/releases/1.6.0/aframe.min.js`
- **Python 3** (`scripts/`): numpy, Pillow, (optional) rasterio. Outputs JSON/PNG into `data/`.
- Hosting: **GitHub Pages** from `main` branch root.

Run locally from the repo root:
```bash
python3 -m http.server 8000
```
Then open http://localhost:8000 (main app) and http://localhost:8000/helmet/ (helmet view).

---

## 4. Repo layout and owners

```
/README.md            this file (everyone)
/CLAUDE.md            short rules for Claude Code
/SUBMISSION.md        video script, project page text, final checklist (Brayden + Sean)
/index.html           main app entry (Brayden)
/styles.css           main app styles (Brayden)
/lib/geo.js           shared coordinate helpers (Brayden, first hour)
/lib/store.js         shared app state (Brayden, first hour)
/map/                 2D map, blind zones, panels, scenario player (Brayden)   → map/README.md
/route/               route planner (Jojo)                                   → route/README.md
/crew/                crew model + walk budget + alerts (Jojo)               → crew/README.md
/skyline/             Horizon Match UI (Brayden + Sean)                        → skyline/README.md
/helmet/              A-Frame helmet view (Edward)                           → helmet/README.md
/scripts/             Python precompute (Brayden + Sean)                     → scripts/README.md
/data/                all data files + sources (Sean)                        → data/README.md
```

**Rule: only edit files in your own folder.** Need something from another folder? Ask in WhatsApp, or agree to change the contract in this README.

Until real data arrives, **every feature must run on mock data** that follows the contracts below — never block on a teammate.

---

## 5. Coordinates and the terrain grid (everyone must follow this)

- Area = the **CTX DTM of Jezero** (NASA/USGS Mars 2020 terrain relative navigation product, 20 m/pixel, 1596 × 1512 px, equirectangular, Mars radius 3,396,190 m).
- Bounds: **lat 18.2110273909634 → 18.7211944818728 N, lon 77.1604654592237 → 77.6989751662947 E.**
- Elevations: −2710.7 m to −1515.5 m (relative to Mars areoid). Home elevation ≈ −2567 m.
- **Home / habitat** = the Perseverance landing site ("Octavia E. Butler Landing"): **lat 18.4447, lon 77.4508**.
- Working grid = DTM downsampled ×4 → **399 cols × 378 rows, 80 m per cell (projected)**.
  - Row 0 = north edge (latMax). Col 0 = west edge (lonMin). Row-major.
  - North–south ground metres per cell = 80. East–west ground metres per cell = 80 × cos(lat) ≈ 76 (the projection uses standard parallel 0°, so east–west must be multiplied by cos(lat)).

### `lib/geo.js` (Brayden writes this in the first hour — everyone imports it)
```js
// Written with AI assistance
export const R = 3396190;
export function deg2rad(d) { return d * Math.PI / 180; }
// meters between two lat/lon points (equirectangular approximation, fine at <50 km)
export function distM(lat1, lon1, lat2, lon2) {
  const x = deg2rad(lon2 - lon1) * Math.cos(deg2rad((lat1 + lat2) / 2)) * R;
  const y = deg2rad(lat2 - lat1) * R;
  return Math.hypot(x, y);
}
// bearing in degrees, 0 = north, 90 = east
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const x = deg2rad(lon2 - lon1) * Math.cos(deg2rad((lat1 + lat2) / 2));
  const y = deg2rad(lat2 - lat1);
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}
// grid <-> lat/lon (grid = data/heightgrid.json, bounds = meta.bounds)
export function toCell(grid, b, lat, lon) {
  return { r: Math.floor((b.latMax - lat) / (b.latMax - b.latMin) * grid.h),
           c: Math.floor((lon - b.lonMin) / (b.lonMax - b.lonMin) * grid.w) };
}
export function toLatLon(grid, b, r, c) {
  return { lat: b.latMax - (r + 0.5) / grid.h * (b.latMax - b.latMin),
           lon: b.lonMin + (c + 0.5) / grid.w * (b.lonMax - b.lonMin) };
}
export function heightAt(grid, r, c) { return grid.data[r * grid.w + c]; }
```

---

## 6. Data contracts (file formats)

All files live in `data/`. Sean (and `scripts/`) produce them. Everyone else reads them. Mock versions are fine until the real ones land — **same shape**.

### `data/meta.json`
```json
{
  "bounds": { "latMin": 18.2110273909634, "latMax": 18.7211944818728,
              "lonMin": 77.1604654592237, "lonMax": 77.6989751662947 },
  "marsRadiusM": 3396190,
  "home": { "id": "home", "name": "Habitat (Octavia E. Butler Landing)", "lat": 18.4447, "lon": 77.4508, "heightM": 5 },
  "eyeHeightM": 1.7,
  "gridFile": "data/heightgrid.json"
}
```

### `data/heightgrid.json`
```json
{ "w": 399, "h": 378, "cellM": 80, "min": -2710.7, "max": -1515.5,
  "data": [ -2567.2, -2566.9, "... w*h numbers, metres, row-major, row 0 = north, 1 decimal" ] }
```

**No NaN / null allowed** — fill DTM no-data with the nearest valid value before writing (Python writes `NaN`, which is invalid JSON and kills the app).

### `data/basemap.png`
Hillshade image of the DTM (full working-grid extent, ≥ 1596 × 1512 px, grayscale). Drawn under the Mars Trek tiles as an offline fallback if the tile server is slow during judging.

### `data/heightmap.png`
Same grid as an 8-bit grayscale PNG (399 × 378). Pixel value v → elevation = min + v/255 × (max − min). For quick visuals only; use `heightgrid.json` for maths.

### `data/landmarks.json`
```json
[
  { "id": "home", "name": "Habitat", "lat": 18.4447, "lon": 77.4508, "heightM": 5, "kind": "habitat", "source": "Perseverance landing site" },
  { "id": "peak_01", "name": "Delta front butte", "lat": 18.47, "lon": 77.40, "heightM": 0, "kind": "peak", "source": "auto-picked from CTX DTM" }
]
```
`kind`: `habitat | peak | rim | beacon | science`. `heightM` = height of an object standing on the ground (0 for natural terrain).

### `data/viewsheds/<landmarkId>.png`
Grayscale PNG on the working grid (399 × 378): 255 = this landmark's top is visible from a standing astronaut's eyes (1.7 m) at that cell, 0 = hidden. Includes Mars curvature.

### `data/crew_constants.json`
Array of every number the crew model uses — **already filled in** with researched values:
```json
[{ "key": "surface_dose_msv_per_sol", "value": 0.67, "unit": "mSv/sol", "label": "...", "source": "...", "url": "...", "isEstimate": false, "note": "..." }]
```

### `data/targets.json` (science points, real Perseverance positions)
```json
[{ "id": "three_forks", "name": "Three Forks sample depot (approx.)", "lat": 18.4525, "lon": 77.4072, "sol": 648, "source": "M20_waypoints.json" }]
```

### `data/traverse.json` (real Perseverance path)
```json
[{ "sol": 13, "lat": 18.44463, "lon": 77.45089 }]
```

### `data/donki_sep_may2024.json`
Raw response of the NASA DONKI SEP API for May 2024 (see `data/README.md`).

### `data/scenario_demo.json` (the demo story timeline)
```json
{
  "name": "Sol 12 EVA — May 2024 storm replay",
  "sol": 12, "startLtst": 9.0, "start": { "lat": 18.4447, "lon": 77.4508 },
  "target": "three_forks",
  "events": [
    { "tMin": 0,   "type": "eva_start" },
    { "tMin": 60,  "type": "tau", "value": 0.5 },
    { "tMin": 120, "type": "sep_onset", "donkiId": "<id from donki file>", "note": "Replay of the May 2024 solar particle event" },
    { "tMin": 135, "type": "tau", "value": 2.0 },
    { "tMin": 150, "type": "skyline_fix", "site": "landing" },
    { "tMin": 200, "type": "eva_end" }
  ]
}
```

**Coordinate order everywhere in our files and functions: `[lat, lon]` or `{lat, lon}`.** GeoJSON's `[lon, lat]` is converted inside `scripts/fetch_nasa.py` only.

### `route.json` / route object (produced by `route/route.js`)
```json
{ "mode": "safest", "points": [[18.4447, 77.4508], [18.45, 77.44]], "lengthKm": 3.2,
  "maxSlopeDeg": 9.5, "blindFraction": 0.12, "etaMin": 74 }
```

### `data/skyline/<site>.json` (Horizon Match results, produced by `scripts/skyline.py`)
See `skyline/README.md`.

---

## 7. Shared app state — see `ARCHITECTURE.md` §4–§5

Summary (the full contract, function signatures and rules live in ARCHITECTURE.md):
- `lib/store.js` holds `{ data, inputs, derived }`. **Only `setInputs(patch)` changes state**; it runs the pipeline and notifies subscribers once.
- `lib/pipeline.js` computes, in this fixed order: `computeLimits` → visibility → `planRoute` (home + target) → `computeBudget`.
- Renderers `subscribe()` and **only read**. Calling `setInputs` inside a subscriber throws.
- Main app ↔ helmet iframe: same-origin `postMessage` with a `hello` handshake and versioned messages (ARCHITECTURE §9).

---

## 8. NASA data used (for the "NASA Data" field)

| Dataset | Used for |
|---|---|
| HiRISE 25 cm orthomosaic of Jezero (Mars Trek WMTS) | Base map (close zoom) |
| CTX 6 m orthomosaic of Jezero (Mars Trek WMTS) | Base map (wide) |
| CTX 20 m DTM (Mars 2020 TRN product, USGS Astrogeology) | Terrain, slopes, viewsheds, Horizon Match, 3D helmet terrain |
| Perseverance waypoints (`M20_waypoints.json`, mars.nasa.gov MMGIS) | Real traverse, science targets |
| Perseverance raw Navcam images (mars.nasa.gov raw images API) | Horizon Match real-photo check (stretch) |
| Curiosity RAD (Hassler et al. 2014; May 2024 event) | Radiation dose rates |
| DONKI SEP API (api.nasa.gov) | Solar storm replay |
| Perseverance MEDA (PDS Atmospheres node) | Pressure, temperature |
| NASA Human Research Program / NTRS reports | Body, vision, suit numbers |

Tile URLs (Leaflet, `L.CRS.EPSG4326`, `{z}/{y}/{x}`):
- CTX: `https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/default/default028mm/{z}/{y}/{x}.png` — tiles exist up to zoom **13**
- HiRISE: `https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm/{z}/{y}/{x}.png` — tiles exist up to zoom **17**

---

## 9. Timeline

**Saturday 14 Nov**
- First hour: repo cloned by all, `lib/geo.js` + `lib/store.js` + empty `index.html` pushed (Brayden); all 4 registered on the Space Apps project page.
- Sean → `meta.json`, `heightgrid.json`, `heightmap.png` **first** (Edward and Jojo need them).
- 23:59 checkpoint: every part shows *something* on the one page, even ugly.

**Sunday 15 Nov**
- Morning: wire the demo story (scenario player), Horizon Match panel, alerts, helmet linked.
- 16:00 **feature freeze** → deploy, test in incognito, record video.
- 21:00 first Submit for Judging → fixes → final re-submit by 23:00.

## 10. Git workflow (keep it simple)

```bash
git pull                      # before you start, every time
git add <your files>
git commit -m "feat(crew): walk budget v1"
git push
```
Commit at least every hour. If `git push` fails: `git pull --rebase` then push again. Never force-push. Big raw files (`.tif`, `.zip`) go to the shared Google Drive, not git (see `.gitignore`).
