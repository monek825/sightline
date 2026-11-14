# Roadmap: what to do, in what order

**Deadline: Sunday 15 Nov, 23:59 WIB.** Times below are WIB.

## Status (Sat 11:00)
| Piece | Owner | State |
|---|---|---|
| Architecture, docs, data checker | Brayden | ✅ done |
| Real terrain, landmarks, viewsheds, NASA data | Brayden | ✅ done |
| Main app UI v2 + 3D terrain engine (`lib/terrain.js`) | Brayden | ✅ done |
| Crew model `crew/budget.js` | Jojo | ✅ merged with tests (app loads it instead of the stub) |
| Route planner `route/route.js` | Jojo | ✅ merged with tests (A*, three modes) |
| Horizon Match maths `scripts/skyline.py` | Sean | ✅ done → `data/skyline/` for all 5 sites |
| Missing sources (3 constants) | Sean | ✅ done. `terrain_shielding_pct` is now 4 (paper says 4%, not 5%); `walkback_pad` is an estimate (no source found) |
| `python3 scripts/check_data.py` | all | ✅ 0 problems |
| Demo integrity + edge-case test `node scripts/test_demo.mjs` | Brayden | ✅ 78 checks pass (demo stepped every minute, 61 edge cases); no bugs found in crew, route, pipeline or store |
| Integration check `bash scripts/check_all.sh` | Brayden | ✅ pull + data check + demo test + both `*.test.html` in headless Chrome, one table |
| Skyline off-grid honesty run | Brayden | ✅ `data/skyline/offgrid_summary.json`: median error 32.0 m, max 44.6 m with truth off the 100 m grid |
| Horizon Match panel `skyline/skyline.js` | Brayden | ✅ done: button picks nearest site; demo pauses at t=55 and plays it |
| Helmet overlays (beacon, HUD, walk) | Edward | ✅ merged (`helmet/helmet.js`): beacon (dashed when hidden), visor HUD with compass strip, habitat and rover models, walks `data/route_demo.json` |
| Demo controls (Jojo) | Jojo | ✅ merged: click 2D/3D to pick a target and the walk follows the orange route; safest vs shortest comparison; Change conditions edit the run; solar event on/off per run; speed slider; Return home button |
| Landmark names on Mars Trek | Sean | ⏳ gazetteer check found no match; still needs a look on Trek by eye (`peak_02` may be Kodiak butte) |
| `sources.md` "Challenge resources used" | Sean | ⏳ copy the list from the challenge Resources tab |
| Video + submission page | Brayden + Sean | ⏳ Sunday |

### Next up (in this order)
1. ~~**Brayden:** `skyline/skyline.js`~~ done (see the status table).
2. ~~**Edward:** helmet overlays on `lib/terrain.js`~~ done (merged in #11).
3. **Sean:** Resources tab → `sources.md` (needed for Global Award eligibility), then the Mars Trek name check.
4. ~~**Jojo:** check the crew tests against `terrain_shielding_pct` = 4~~ done: 11/11 pass, no test hard-codes 5.
5. ~~Skyline off-grid~~ done: re-run with truth 0-50 m off the grid gives median 32 m, max 45 m error (the matcher finds the nearest 100 m grid node every time). Say "within about 50 m" in the pitch, not "0 m".

## Known issues (Sat evening)
**Fixed**
- HiRISE tiles outside the mosaic gave 404s in the console at zoom 15+. The layer is now limited to its real coverage.
- Horizon Match 0 m errors were partly by construction. Off-grid numbers are in `data/skyline/offgrid_summary.json`.

**Left**
- Route replan on a storm or SEP event takes 20-60 ms on a quiet laptop and up to ~500 ms when the machine is busy. The test allows 300 ms (ARCHITECTURE §5). If `test_demo` fails only on "replan derive", re-run it with nothing else running.
- Horizon Match accuracy is limited by the 100 m search grid (about 50 m worst case). A finer grid would need a `scripts/skyline.py` change by Sean.
- The edge-case test does not cover NaN inputs passed straight to `computeLimits`/`computeBudget`; the store clamps inputs before they get there.
- Landmark names and `sources.md` resources list: see the status table.
- The demo controls have only been tried with mouse and emulated touch, not on a real phone or tablet.
- At phone (390×844) and tablet (820×1180) widths the answer card, tab bar and player cover the whole map/3D view: 0 of 20 sample points on it can be tapped, so a target cannot be picked there. Player buttons and the Change conditions controls work; no horizontal scroll. Layout fix needed in `styles.css`.

## How to decide what to work on next
When you finish something, pick the **first** item that is true:
1. **Something breaks the demo** (console error, blank map, demo stops) → fix it now, whoever owns it.
2. **Your feature isn't done** → keep building it.
3. **Someone is blocked waiting on you** → unblock them.
4. **The demo story path looks bad** (anything visible in the 30-second video) → polish it.
5. **Anything else** (UX outside the demo path, stretch goals) → only if 1–4 are empty.

Never start a stretch goal while a teammate's feature is unfinished. Ask in the group chat first.

## Phases

### Phase 1: Build (Sat until 18:00)
Everyone builds their own piece **in parallel**, in their own folder, on top of the current app. Push every hour.
- Jojo: ~~`crew/budget.js`, then `route/route.js`~~ both merged. Left: confirm the MOCK DATA / stub banner is gone in the running app.
- Sean: ~~`scripts/skyline.py` (≥ 3 sites), the 3 missing sources~~ done. Left: Resources tab in `sources.md`, landmark names on Mars Trek.
- Brayden: `skyline/skyline.js` (real `data/skyline/*.json` is in the repo now), and answer questions.
- Edward: helmet overlays on `lib/terrain.js`.

**Gate:** each feature passes its own README acceptance checklist **before** it's called done.

### Phase 2: Integrate (Sat 18:00 → 23:59)
- After every teammate push run **`bash scripts/check_all.sh`** (pulls, runs the data check, the demo test and both feature test pages, prints one pass/fail table; `--no-pull` skips the pull). Fix any FAIL row before merging the next thing.
- Brayden pulls everything and runs the full demo after **every** merge.
- MOCK DATA badge must be gone (no placeholders left).
- `python3 scripts/check_data.py` → 0 problems.
- **23:59 checkpoint:** the whole demo story plays end to end on real modules. Sleep after.

### Phase 3: Fix + polish (Sun 07:00 → 14:00)
In this order, no skipping:
1. **Bugs** that break or confuse the demo.
2. **UX on the demo path:** what the judge sees in the video (answer card, storm moment, blind zones growing, new route, Horizon Match, helmet).
3. Mobile check (375 px), keyboard focus, reduced motion.
4. Stretch (beacon placement, real Navcam skyline check), only if 1–3 are done.

### Phase 4: Freeze (Sun 14:00 → 16:00)
- Run the slop-judge review on the live site, and fix only what it flags on the demo path.
- Test the live GitHub Pages link in an incognito window.
- **16:00 FEATURE FREEZE.** After this: bug fixes only, no new features.

### Phase 5: Ship (Sun 16:00 → 23:00)
- 16:00–19:00 Brayden: record + edit the 30-second video (`SUBMISSION.md` script, English subtitles, press `v` for video mode).
- 16:00–19:00 Sean: paste the project page text from `SUBMISSION.md` + `data/sources.md`.
- 19:00–21:00: everyone tests all links in incognito.
- **21:00 first Submit for Judging.** Fix anything → **final re-submit by 23:00.**

## Communication
- Group chat message when you **start**, **push** and **get blocked**. One line each.
- Contract change (function signature, data format)? Ask Brayden first. Don't change it alone.
- Edward: 15-minute call at 13:00 and 20:00 on Saturday to sync.
