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
| Skyline Fix maths `scripts/skyline.py` | Sean | ✅ done → `data/skyline/` for all 5 sites |
| Missing sources (3 constants) | Sean | ✅ done. `terrain_shielding_pct` is now 4 (paper says 4%, not 5%); `walkback_pad` is an estimate (no source found) |
| `python3 scripts/check_data.py` | all | ✅ 0 problems |
| Skyline Fix panel `skyline/skyline.js` | Brayden | ✅ done: button picks nearest site; demo pauses at t=55 and plays it |
| Helmet overlays (beacon, HUD, walk) | Edward | ⏳ `helmet/` only has the README |
| Landmark names on Mars Trek | Sean | ⏳ gazetteer check found no match; still needs a look on Trek by eye (`peak_02` may be Kodiak butte) |
| `sources.md` "Challenge resources used" | Sean | ⏳ copy the list from the challenge Resources tab |
| Video + submission page | Brayden + Sean | ⏳ Sunday |

### Next up (in this order)
1. **Brayden:** `skyline/skyline.js`. It is the only demo-path feature with no code yet, and the "Run Skyline Fix" button currently shows "not built yet".
2. **Edward:** helmet overlays on `lib/terrain.js`.
3. **Sean:** Resources tab → `sources.md` (needed for Global Award eligibility), then the Mars Trek name check.
4. **Jojo:** check the crew tests against `terrain_shielding_pct` = 4.
5. **Team decision:** Skyline Fix test positions sit exactly on the 100 m search grid, so the 0 m errors are partly by construction (off-grid would be up to ~70 m). Say so in the pitch or re-run off-grid.

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
- Brayden pulls everything and runs the full demo after **every** merge.
- MOCK DATA badge must be gone (no placeholders left).
- `python3 scripts/check_data.py` → 0 problems.
- **23:59 checkpoint:** the whole demo story plays end to end on real modules. Sleep after.

### Phase 3: Fix + polish (Sun 07:00 → 14:00)
In this order, no skipping:
1. **Bugs** that break or confuse the demo.
2. **UX on the demo path:** what the judge sees in the video (answer card, storm moment, blind zones growing, new route, Skyline Fix, helmet).
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
