<!-- Written with AI assistance (Claude / GitHub Copilot) -->
# Prompt for Jojo: the Details sheet + crew-model check

```
Repo monek825/sightline (NASA Space Apps, feature freeze Sun 16:00 WIB). Read CLAUDE.md, ARCHITECTURE.md, map/panels.js, index.html (#drawer-more), styles.css (.more), crew/budget.js. Branch feat/details-sheet, PR to main. Rules: no npm/build, no runtime APIs, textContent only, no NASA logos, house rules (no small labels above headings, no "01 ·" numbering, no ↗ arrows).

Context: the bottom-left "Details" button opens a glass sheet (#drawer-more). Right now it's a raw dump: a long "Every factor" list + a "Change conditions" form. A judge who opens it should understand in 10 seconds WHY the app says GO / TURN BACK / RETURN NOW, and be able to play "what if".

1. Redesign the sheet (edit index.html inside #drawer-more, the .more rules in styles.css, and the matching render code in map/panels.js). Keep these ids, the code depends on them: alerts, vis-stat, c-sol, c-ltst, c-tau, c-sep, c-sans, o-sol, o-ltst, o-tau, btn-sources.
   - Top: one sentence that explains the verdict in plain English, built from the worst factor (e.g. "Return now: a solar storm started and home is 34 min away."). 
   - "What's limiting the walk": the factors as a short ranked list, worst first, each with its number, a one-line plain explanation and the NASA data / estimate tag. Green factors collapsed under "Also checked (all fine)".
   - "What if…": the condition controls as clear labelled sliders/toggles with the current value, e.g. "Dust (τ) 0.4 → clear sky … 10 → global storm", "Time of day", "Days on Mars (balance recovery)", "Solar storm", "Vision changes (SANS)". Moving one must update the verdict live (it already does through setInputs).
   - Bottom: "How we know: every number and its source" button (btn-sources) + the imagery credit line.
   - Frosted style like the rest (rgba(30,18,11,.72) + blur, no borders, radius 20 px), fonts Clash Display (headers), Switzer (text), Geist Mono (numbers). Sheet must scroll inside itself, never the page. Esc closes it.
2. Crew-model sanity check (crew/budget.js is yours): with the conditions panel, try the extremes (τ 10, 19:00, sol 0, solar storm on at home, SANS on). Every combination must give a sensible verdict and readable numbers (no NaN, no negative minutes, no "0 min" while RETURN NOW unless already home). Fix anything odd in budget.js and add the case to scripts/test_demo.mjs.
3. Test at 1440 and 375 px (on a phone the sheet is part of the page flow). `bash scripts/check_all.sh` must pass. PR with before/after screenshots.
```
