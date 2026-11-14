<!-- Written with AI assistance (Claude / GitHub Copilot) -->
# Fable prompt: backend hardening + integration checks

Paste everything in the code block into a new Claude (Fable) session.

```
Use the frugal-fable skill. You ORCHESTRATE ONLY: plan, review diffs, decide. Every build task goes to a Sonnet subagent; every check/read-only sweep goes to a Haiku subagent. Never read whole large files yourself; ask a subagent for file:line summaries.

Repo: /Users/brayden/Documents/Hackathon/sightline (public, github monek825/sightline). Read CLAUDE.md, then ARCHITECTURE.md §5 (signatures) and ROADMAP.md. Rules: no npm/build step, no runtime APIs, don't change function signatures or data contracts, don't touch helmet/ (Edward) or the UI layout (index.html/styles.css/panels.js). Work on branch `feat/backend-hardening`, small commits, open a PR at the end. Hackathon deadline Sun 23:59 WIB; finish this in ~2 hours.

Goal: make the model/data side bulletproof and honest for judges, and give Brayden a one-command bug finder for tonight's integration.

1. Demo integrity test (Sonnet): `scripts/test_demo.mjs`, plain Node ESM, zero dependencies. Load data/*.json + heightgrid via fs (don't use lib/data.js fetch), build the pipeline exactly like map/app.js does with crew/budget.js and route/route.js, then step the demo scenario t = 0..endT every 1 min with stateAt(). Assert at every step: no NaN/undefined in derived, status is one of the allowed values, route arrays are [lat,lon] inside meta bounds, evaMin is monotonic. Assert the story beats: GO at t=0, warnings after τ rises, RETURN NOW (or the shelter state) once the SEP starts at t=60, smaller visibility at τ 6 (t=75). Print the time per derive() and fail if any single derive takes >50 ms. `node scripts/test_demo.mjs` should exit 0. If a real bug turns up, fix it in the owning module with the smallest change and note it in the PR.

2. Edge-case sweep (Haiku finds, Sonnet fixes): computeLimits/computeBudget at extremes (τ 0.2 and 10, evaMin past suit time, sepActive at home, SANS on). planRoute with a goal on the grid edge, an unreachable goal, start = goal. Each must return a valid object and never throw (ARCHITECTURE says planRoute never throws). Add those cases to test_demo.mjs.

3. Skyline honesty (Sonnet, scripts/skyline.py is Sean's: put changes behind a flag, don't change the JSON shape): the test positions sit exactly on the 100 m search grid, so the 0 m errors are partly by construction. Add an `--offgrid` run (truth offset by a random 0–50 m, fixed seed). Record the off-grid errorM per site in a new small file data/skyline/offgrid_summary.json, and add one line to skyline/README.md. Don't overwrite the existing site files. Needs raw/dtm.tif; if it's missing, stop this task and report it.

4. Tile 404 noise (Sonnet, tiny): in map/map.js give the HiRISE tile layer a `bounds` option for its coverage (and CTX too if it 404s) so the console is clean. That's the only map.js change.

5. Close out (Haiku): run `python3 scripts/check_data.py` and `node scripts/test_demo.mjs`, both clean. Update ROADMAP.md status rows plus a "Known issues" list (what's fixed, what's left).

6. Integration check script (Sonnet): `scripts/check_all.sh` that does: git pull, then python3 scripts/check_data.py, then node scripts/test_demo.mjs, then opens each feature's *.test.html headlessly if possible (else lists them to open by hand). Print one summary table: check | pass/fail | first error line. Brayden runs this after every teammate push tonight. Document it in ROADMAP.md Phase 2.

Finish: push the branch, open the PR, and report back in under 15 lines: what changed, test output, anything that needs a human decision.
```
