<!-- Written with AI assistance (Claude / GitHub Copilot) -->
# Prompt for Sean: polish the helmet view (rover + habitat models are ready)

Paste the code block into Claude Code with the repo open (use the frugal-fable skill if on Fable).

```
Repo: monek825/sightline (NASA Space Apps 2026 hackathon, deadline Sun 15 Nov 23:59 WIB, feature freeze Sun 16:00).
First read CLAUDE.md, README.md, ARCHITECTURE.md §9 (postMessage protocol) and helmet/README.md.
The helmet view already works (helmet/index.html, helmet/helmet.js, helmet/helmet.css). Your job: POLISH it. Don't rewrite it.

Rules: plain HTML/CSS/JS, A-Frame 1.6.0 from CDN, no npm/build step, no runtime API calls. Only edit helmet/*. Don't edit lib/* or map/*. Insert data text with textContent, never innerHTML. No NASA logos/meatball/patches anywhere. New files start with: // Written with AI assistance (Claude / GitHub Copilot). Work on branch feat/helmet-polish, commit small, open a PR to main.

1. Models (already built, just place them): load ../lib/models.js after ../lib/terrain.js. It registers A-Frame components `mars-habitat` and `mars-rover` (original, primitives, metres at scale 1, origin = ground). In the helmet use scale 1 (real size):
   - habitat at home: position (0, terrain.heightAt(0,0), 0)
   - a support rover parked beside it: (14, heightAt(14,6), 6), rotation 0 -30 0
   - Perseverance at its latest real position: last point of ../data/traverse.json ({lat, lon}) via terrain.toWorld
   From the habitat start view the astronaut should see the dome, solar wings and rover up close.

2. Match the main app's 3D look (see map/map.js createView3D for reference values):
   - terrain tint + fine ground grain are now automatic in lib/terrain.js (no code needed); check the ground no longer looks flat grey
   - lights: a hemisphere light (sky #ffd9b0, ground #4a2a18) + a directional sun. Place the sun from inputs.ltst (rises east at 06:00, highest at noon, sets west at 18:00); dim it as tau rises
   - sky: an a-sky with a vertical gradient (darker zenith #80563e, lighter butterscotch horizon); under dust (high tau) both go the same dusty colour
   - fog: linear, colour = horizon colour, far = derived.limits.visibilityKm * 1000. This is the key "dust storm" moment in the video, so the fog must close in visibly when tau goes to 6

3. HUD polish (helmet/helmet.css):
   - fonts: headers "Clash Display" + text "Switzer" (Fontshare CSS: https://api.fontshare.com/v2/css?f[]=clash-display@500,600&f[]=switzer@400,500,600&display=swap), numbers "Geist Mono" (Google Fonts)
   - panels: frosted, no border: background rgba(30,18,11,.46), backdrop-filter blur(22px) saturate(1.5), radius 12–20 px, shadow 0 10px 36px rgba(0,0,0,.38). Colours: text #f6ebdf, accent #ff8a3d, green #4cc86a, amber #e2a73a, red #ff5f56
   - a subtle helmet visor frame around the edges (a thin curved dark rim, NOT a blurry vignette fade)
   - home beacon: slow pulse (scale/opacity), and the distance label shows "hidden behind terrain" clearly when line of sight is blocked
   - the status (GO / TURN BACK / RETURN NOW) changes with a short pop animation; under prefers-reduced-motion, no animations
   - no small labels above headings, no "01 ·" numbering, no ↗ arrows

4. Feel:
   - walk mode: smooth camera (lerp position/heading, no jumps), eye height 1.7 m above terrain.heightAt
   - one WebGL scene only; pause rendering when the tab is hidden
   - must work standalone (open helmet/index.html via `python3 -m http.server 8000` → http://localhost:8000/helmet/) AND inside the main app (Route tab → "Open helmet view"; it receives state by postMessage, protocol v1, same origin only)
   - test at 1440 px and 375 px wide

5. Before the PR: run `bash scripts/check_all.sh` (must pass), play the main demo with the helmet open through the storm (t = 60–150), and put 2 screenshots (normal + dust storm) in the PR description. Report anything you couldn't finish.
```
