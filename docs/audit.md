# Sightline site audit, 14 Nov 2026

Audited `main` at `c0069f2` on `http://localhost:8000/` (same files as the live site) at 1440×900 and 375×812. Fixes are on branch `fix/audit`.

How to read "fixed?": **yes** means changed on `fix/audit` and re-checked in the browser, with the measured proof given. **no** means reported only. Owners: `skyline/` is Jayden's, `helmet/` is Edward's, so nothing there was changed except a one-line AI header.

Limits of this audit:
- Desktop layout was only judged after fix 1, because before it the status card was missing.
- Helmet drag, wheel zoom and its Show list were not exercised. Eye-menu behaviour in 3D comes from reading the code, not from pixels.
- Reduced motion was checked by reading the CSS and JS, not by emulation.
- fps was measured in Chrome on an M1 (Metal, hardware GPU) with a 1440×660 viewport, while a second browser was also running. Treat the numbers as ±20%.
- No console errors appeared in any flow.

## Findings

| # | area | severity | what happens | where | fix | fixed? (proof) |
|---|---|---|---|---|---|---|
| 1 | Layout, desktop | blocker | At 1024 px and wider the Walk status card (GO, suit time, tabs content, hide button) is missing. A stray `}` makes the browser drop the `.panel` rule, so the card sits under the 3D canvas. The live site has it too. | `styles.css:109` | Delete the `}`. | **yes.** `#panel` went from `position: static`, 1408 px wide, to `absolute`, 374×764 at x=1034. Screenshot shows the card. |
| 2 | Citations | blocker | "Challenge resources used" in the references file is still a TODO for Sean. `SUBMISSION.md` says to paste this file into the submission. | `data/sources.md:6-8` | Fill in by hand from the challenge Resources tab. | no (needs Sean) |
| 3 | Layout, phone | high | In 3D at 375 px the note under the map is 20 px wide and runs one word per line over the brand bar. Its max-width goes negative. | `styles.css:101` | Give it the full width below 1024 px. | **yes.** Note is now 319×96 px, no horizontal scroll. Screenshot. |
| 4 | Lag | high | The main 3D scene keeps drawing at 60 Hz while the 2D map is shown. `scene.pause()` does not stop the render loop. | `map/map.js:804` | Stop the loop in `hide()`, restart in `show()`. | **yes.** Frames drawn in 2 s: 117 in 3D, 3 in 2D, 116 back in 3D. |
| 5 | Lag, helmet | high | The helmet runs at 13–17 fps (Low) while the main 3D scene is alive next to it, and 60 fps (High) once that scene's context is gone. Per-frame script time is 2 ms, so the cost is GPU memory shared by two scenes (2.7 M triangles and a 4096×3880 texture in the main one). | `map/app.js:244-248`, `map/map.js:26-29` | Free or shrink the main renderer while the helmet is open. | no (bigger change, team decision) |
| 6 | Lag, 3D | high | The main 3D view lost its WebGL context about 11 s after load in 3 of 4 loads in the test Chrome. The handler then switches to 2D and saves graphics = Low in `localStorage` for good. | `map/map.js:783-792` | Do not persist Low after a context loss, and lighten the first frames (#8). | no (team decision) |
| 7 | Lag, helmet | high | High preset uses device pixel ratio 2 with shadows and antialiasing. 2880×1320 gave 29–38 fps; a bigger Retina window costs more. | `helmet/helmet.js:54-56`, `helmet/index.html:21` | Cap total pixels. | no (Edward) |
| 8 | Lag, load | med | First load of 3D stalls the page: long tasks of 6.7 s, 3.2 s and 2.8 s. Switching 2D→3D stalls 2.6 s. First helmet open stalls about 5 s. Playing the story drops 3D to about 15 fps. | `map/map.js:26-29,302` | Use the 3k texture and the coarser grid on Medium. | no |
| 9 | Reset | high | With the Horizon Match panel open at minute 55, pressing Reset leaves the panel open. Closing it later starts the story by itself. Pressing Play while the panel is open also queues a second resume. | `map/app.js:127-151` | Reset closes the panel; a pause only resumes if nothing happened since. | **yes.** After Reset: panel closed, t = 0, play button paused, nothing restarts. |
| 10 | Reset | high | "Restart demo" keeps the user's edits: a triggered dust or solar storm, the day, the solar-storm and SANS boxes, a clicked target, route mode and speed. Example: Dust storm, then Reset, and the storm is still in the run. | `map/app.js:147-151` | Either restore `data.scenario` and the default controls, or rename the button "Replay". | no (team decision) |
| 11 | Markup, a11y | high | `id="t-home"` is on both the Turn back button and the Walk status tab. The tab panel is announced as "Turn back to the habitat". | `index.html:174,190`, `map/app.js:98` | Rename the button to `t-turnback`. | **yes.** No duplicate ids; the panel's label resolves to "Walk status". |
| 12 | Keyboard | high | The Horizon Match and Lost in dust panel never takes focus, so Escape does nothing until you click inside it. Focus is not returned to the button afterwards. | `skyline/skyline.js:119,379` | Focus the close button on open, restore focus on close. | no (Jayden) |
| 13 | Story | med | At minute 55 the story stops for Horizon Match and waits for the panel to be closed. Nothing says so, and the caption is hidden. At 375 px the panel is cut off (589 px of content in 383 px). | `map/app.js:127-130`, `styles.css:403` | Add "Close to continue" or a Continue button. | **partly** (`fix/audit-2`). Caption now reads "Close the Horizon Match panel to continue the demo." and stays visible beside the panel; closing resumes. The panel is still cut off at 375 px (Jayden). |
| 14 | Story end | low | From minute 107 the headline says AT SHELTER while the red banner still says "return to shelter" and the caption says "Dust is rising". The banner stays after the story ends. | `map/app.js` captions, `map/panels.js` banner | Clear the banner once at shelter; add an end caption. | **yes** (`fix/audit-2`). At minute 150: headline AT SHELTER, banner "Solar storm: the astronaut is in the shelter…". Banner still shows after the story ends. |
| 15 | Event buttons | med | Dust storm and Solar storm show nothing while the story is paused, and nothing at all at t = 0. On phones the Details sheet opens below the fold without scrolling to it. | `map/app.js:208-213` | Start playing on press, or say "starts when you press play". | **yes** (`fix/audit-2`). Solar storm pressed while paused at t = 0: story plays, t = 5 after 2.5 s. Phone sheet still opens below the fold. |
| 16 | Event buttons | med | "Astronaut is lost" runs Horizon Match and does not change the astronaut's state. It reads as if it would run "Can't see the hills". | `map/app.js:214` | Rename to "Find position", or open Lost in dust. | no (team decision) |
| 17 | Horizon Match | med | Starting a manual Horizon Match while the story's panel is open fires the old close handler: the view flips to 3D and the story resumes behind the new panel. Fix 9 stops the resume; the flip to 3D remains. | `map/app.js:293-301`, `skyline/skyline.js:379-381` | Drop the old handler before reopening. | partly (resume fixed by #9) |
| 18 | Horizon Match | med | A live fix writes the estimated position into `inputs.astronaut`, which the next live match treats as the true position. Repeated fixes drift. Only visible when the story is not playing. | `skyline/skyline.js:473-484` | Keep the true and the estimated position apart. | no (Jayden) |
| 19 | Eye menu | med | "Home beacon" does nothing in 2D. "Perseverance route" does nothing in 3D. "Visibility ring" hides two circles in 2D and the position-uncertainty ring in 3D. | `map/map.js:618-626,870-886` | Hide rows that do nothing in the current view; split the ring label. | **yes** (`fix/audit-2`). 3D menu has no "Perseverance route"; 2D menu has no "Home beacon"; the ring row is "Range and position rings". |
| 20 | Phone | med | The colour legend is hidden below 1024 px, so red, amber and the rings have no key once the welcome card is gone. | `styles.css:338` | Show a compact legend. | **yes** (`fix/audit-2`). At 375 px the legend sits under the caption (351×65 px), not over the map, no horizontal scroll. |
| 21 | Phone | med | The view dropdown and eye button sit on top of the brand card and cover the EVA clock. | `styles.css:765` | Move the buttons below the card. | **yes** (`fix/audit-2`). At 375 px the view buttons start at y=112, below the brand card (ends y=101); the storm banner moved down and does not touch them. |
| 22 | Phone, helmet | med | The helmet's graphics bar covers the third row of the reasons list. | `helmet/helmet.css` | Pad the list or move the bar. | no (Edward) |
| 23 | Phone | low | Details sheet open: page is 4 px wider than the screen. Play, Reset and Turn back are 38×38 px. Tab order differs from the visual order. Tabs are icons only. | `styles.css:585-600`, `index.html:186-196` | Small CSS changes. | no |
| 24 | Jargon | med | A first-time judge meets "LTST", "EVA", "τ", "SANS", "fix", "micrograys" and "AT SHELTER" without explanation. The welcome card explains the colours well but shows once. | `index.html:51-53,131,207,232` | Plain labels ("Local solar time", "Dust thickness") with the symbol in a tooltip. | **partly** (`fix/audit-2`). Tooltips on Sol, LTST, EVA and Dust (τ). Visible labels unchanged; tooltips do not show on touch screens. |
| 25 | Rule 7, numbers | med | Numbers written into UI text, not read from data: "100-second" and "200-minute" (wrong at speeds above 1×), "about 30 chest X-rays", "within 3 km", `TAU_STORM = 3` (copy of `tau_red`), and six status thresholds in `crew/budget.js:16-26` that the Sources dialog cannot show. Default `tempC: -40` is not in the constants file and differs from `jezero_mean_temp_c = -55`. | `map/app.js:14-23,112`, `map/panels.js:376,409`, `crew/budget.js:16-26`, `lib/store.js:6-21` | Move to `crew_constants.json` as estimate rows. | no (touches Jojo's module) |
| 26 | Rule 5, origins | med | Fonts load from `api.fontshare.com`, which is not on the allowed list (map tiles, two CDN libraries, Google Fonts). No CDN file has an integrity hash. Versions are pinned. No keys or runtime API calls found. | `index.html:11-14,19-20`, `helmet/index.html:7-13`, `map/map.js:218-220` | Add Fontshare to the list in ARCHITECTURE §1 or self-host; add SRI. | no (team decision) |
| 27 | Rule 8, text | med | Leaflet `bindTooltip(string)` renders landmark and target names from data files as HTML. No other `innerHTML` use. | `map/map.js:194,197,203,210` | Pass an element built with `textContent`. | no |
| 28 | Citations | med | `data/sources.md` is not linked from the app. A-Frame and the fonts are credited nowhere in the UI. | `index.html:244`, `map/panels.js:73` | Add a References link in the Details footer. | no |
| 29 | Rule 10, AI header | low | Three files lacked the "Written with AI assistance" line. | `helmet/index.html`, `helmet/helmet.css`, `crew/budget.test.html` | Add it. | **yes.** Helmet still opens and draws (canvas present, context not lost). |
| 30 | Load | low | The preload for the 3 MB terrain texture had no `crossorigin`, so Chrome ignored it and fetched the image twice. | `index.html:18` | Add `crossorigin="anonymous"`. | **yes** (attribute added; the double fetch was not re-measured) |
| 31 | Helmet | low | After the helmet closed, the main 3D loop restarted even when the 2D map was showing. | `map/app.js:247` | Only restart when the 3D view is visible. | **yes.** Main scene drew 0 frames while the helmet was open and resumed in 3D after close. |
| 32 | Helmet | low | The iframe is never unloaded, so its WebGL context stays in memory while closed. No leak: heap stayed 84–89 MB over 5 open/close cycles and no context was lost. The HUD's `backdrop-filter` costs about 25% fps. | `map/app.js:271-279`, `helmet/helmet.css` | Leave, or use solid backgrounds. | no |
| 33 | Keyboard | low | Escape inside the helmet iframe does not close the dialog (from the code, not tested). Escape closes a popover and the Details sheet together. | `helmet/helmet.js:504-510`, `map/map.js:816` | Forward Escape from the iframe. | no |
| 34 | Banner | low | After a 3D context loss the banner hides after 6 s even when a solar storm is active. | `map/map.js:792` | Use `!sepActive`, as `app.js:305` does. | no |
| 35 | 2D map | low | Any slider change pulls a panned 2D map back to the astronaut, even when paused. | `map/map.js:904` | Only pan while playing. | no |
| 36 | Loading | low | The loading screen needs animation frames, so it never finishes in a background tab. It recovers when the tab is shown. | `map/intro.js:23-60` | Leave. | no |
| 37 | Docs | low | `SUBMISSION.md` and `README.md` say "SI-generated". The logo's origin is not stated; `SUBMISSION.md` declares no AI images. | `SUBMISSION.md:27,47`, `README.md:38` | Fix the typo if it is one; state who made the logo. | no |

Checked and clean: no renderer writes state; no API keys; `postMessage` checks origin and source both ways; the only link set from data is guarded by `https://`; all 42 rows of `crew_constants.json` have a source and an estimate flag and all appear in the Sources dialog; no NASA logo or patch (`assets/logo.svg` is an "SL" mark); AI use is declared in `SUBMISSION.md`; no eyebrow text, "01 ·" numbering, ↗ arrows or sticky page elements. One fade exists: a `mask-image` gradient on the helmet tape (`helmet/helmet.css:31`).

## Why the helmet may run at 2–4 fps on the lead's M1

Not reproduced. Ranked by fit:

1. **Chrome is drawing in software.** Not tested on the lead's machine. Finding 6 shows the main scene loses its context on load; repeated GPU resets can make Chrome fall back to software, and 2–4 fps matches that. Check `chrome://gpu` for "WebGL: Software only", and whether hardware acceleration is on.
2. **Two scenes on one GPU** (finding 5, measured): 60 → 13–17 fps here.
3. **High preset saved in `localStorage`** on a large Retina window (finding 7, measured 29–38 fps). Ask the lead to clear the `sightline-gfx` key.
4. HUD `backdrop-filter`: about 25%, not a factor of ten.

Ruled out as the main cause: script time (2 ms per frame), message traffic from the map (13 per second), geometry and texture size in the helmet (hiding terrain or rocks changed nothing). Energy Saver was not tested; a 30 fps cap would not give 2–4 fps.

## Measurements

| scenario | fps | note |
|---|---|---|
| 3D terrain, idle, settled | 60 | 188 draw calls, 2.69 M triangles, 2112×942 px |
| 3D terrain, first 40 s | 20–26 | still loading |
| 3D terrain, story playing | 15 | 67 frames over 50 ms in 5 s |
| Helmet in dialog, main 3D alive, Low | 13–17 | 30 on one quiet run |
| Helmet in dialog, story playing | 13 | |
| Helmet in dialog, main 3D context gone, Low / Medium / High | 60 / 60 / 60 | |
| Helmet alone, Low / Medium / High | 52 / 54 / 39 | High = 2880×1320 px with shadows |

## Science check

| claim | app says | source says | verdict |
|---|---|---|---|
| Dust at Jezero | `tau_typical` 0.4, Jan 2022 storm 2.0, caution at 1.0, red at 3.0 (the last two marked as team estimates) | Lemmon et al. 2022: about 0.3 before the storm, about 0.4 after, peak about 2. Guzewich et al. 2019: 8.5 at Gale in the 2018 global storm. | Correct. Opportunity's 10.8 was not confirmed (only "near 11"). |
| Solar-storm radiation limit | `short_term_limit_mgyeq` 250 (30 days, blood-forming organs), `career_limit_msv` 600. The 250 mSv figure appears only in `data/sources.md`. | NASA-STD-3001 Volume 1 **Revision C** (approved 15 Sep 2023) is current; no Revision D was found. Table 4.8-1: 250 mGy-Eq in 30 days for blood-forming organs. [V1 4030]: career dose below 600 mSv. [V1 4031]: protect crew from the design-reference solar particle event to below 250 mSv effective dose. | **Both teammates are right.** They quote two requirements in the same volume. 250 mSv is a design target for one reference storm; 250 mGy-Eq per 30 days is an organ limit. They are different quantities and must not be swapped or added. The constants are correct. `data/sources.md` cites the Revision B brief; update it to Revision C. |
| Visibility from dust | `3.912 / (τ / 10.5 km)`, capped at 150 km, marked as an estimate | Lemmon 2022: 1.3 per 10.5 km when a hill 36 km away was "faintly visible"; the formula gives 31.6 km. Guzewich 2019: 2.7 km at Gale; the formula gives 4.8 km for τ 8.5. | Defensible estimate. It is up to 1.8× optimistic when dust is near the ground, which the app already says. The 3.912 constant was not looked up. |
| Suited walking speed | `walk_speed_kmh` 3.3, marked as an estimate, citing the Apollo Lunar Surface Journal gaits page | That page gives 3.6 km/h for a one-hour walkback and 2.7 km/h for longer ones. It does not contain 3.3. The Bellcomm memo the number likely comes from could not be opened. | Defensible, but the cited page does not show the number. Cite the memo after checking it, or use 2.7 km/h, which is on the page and fits a long walk home. |
| Horizon Match accuracy | "typically about 100 m, at best about 10 m (Nash et al., ICRA 2024)"; "4 of 5 positions within 51–143 m, one 2.8 km off" | Nash et al. 2024 say this about horizon methods in general, in their related-work section; their own method reaches 0.36 m. Vander Hook et al.: about 10 m in the best regions, over 100 m in the worst. | Correct, with two wording gaps. The line is JPL's summary of the literature, not that paper's result. And 3 of the 5 test sites were used during development; `scripts/README.md` says the one clean held-out result should not be read as proof. Suggested: "Tested on 5 real Perseverance panoramas (3 used while developing): 4 were within 51–143 m, one was 2.8 km off. Five is too few to quote an error rate." (`skyline/skyline.js:109-110`, Jayden) |

Hackathon rules:
- **Citations:** the 2026 participant terms say "You must cite every source that is used in the creation of your project". See findings 2 and 28.
- **AI disclosure and labelling of AI images:** no rule text found on spaceappschallenge.org in two searches. Not verified; check the submission form.
- **NASA branding:** only a search snippet of the 2025 brand guide ("DON'T use NASA official branding"). The 2026 version was not read. The app uses none.

Sources:
- NASA-STD-3001 Volume 1 Revision C, 15 Sep 2023: https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf
- NASA-STD-3001 Volume 2 Revision F, 14 Jul 2026 ([V2 6095] points back to Volume 1 §4.8): https://www.nasa.gov/wp-content/uploads/2025/05/nasa-std-3001-vol-2.pdf
- NASA OCHMO standards page: https://www.nasa.gov/ochmo/human-spaceflight-and-aviation-standards
- Lemmon et al. 2022, JGR Planets: https://pmc.ncbi.nlm.nih.gov/articles/PMC9540647/
- Guzewich et al. 2019, GRL: https://ntrs.nasa.gov/api/citations/20190001691/downloads/20190001691.pdf
- Nash et al. 2024, ICRA (JPL): https://www-robotics.jpl.nasa.gov/media/documents/2024_Global_Localization_ICRA.pdf
- Vander Hook et al., JPL: https://www-robotics.jpl.nasa.gov/media/documents/Topographical_Landmarks_for_Ground-Level_Terrain_Relative_Navigation_on_Mars.pdf
- Apollo 11 Lunar Surface Journal, gaits: https://www.nasa.gov/wp-content/uploads/static/history/alsj/a11/a11.gaits.html
- 2026 NASA Space Apps participant terms: https://www.spaceappschallenge.org/legal/
