<!-- Written with AI assistance (Claude / GitHub Copilot) -->
# Prompt for Sean: make the helmet view look real

Paste the code block into Claude Code with the repo open (use the frugal-fable skill if on Fable).

```
Repo: monek825/sightline (NASA Space Apps 2026, freeze Sun 16:00 WIB). Read CLAUDE.md, ARCHITECTURE.md §9 (postMessage v1), helmet/README.md, then map/map.js createView3D (the main 3D view: copy its look).
The helmet view works (helmet/index.html, helmet.js, helmet.css) but looks too simple: flat ground, flat light, plain boxes for the HUD. Goal: a judge opens it and thinks "that's Mars, through a helmet". POLISH, don't rewrite. Keep the postMessage protocol, line-of-sight logic and walk mode.

Rules: plain HTML/CSS/JS, A-Frame 1.6.0, no npm/build, no runtime APIs, edit only helmet/*. textContent only. No NASA logos. ONE WebGL scene; must stay at 60 fps on a laptop (check DevTools Performance: no long frames while walking). Branch feat/helmet-look, PR to main.

1. Scene realism (biggest win first)
   - Models: load ../lib/models.js after ../lib/terrain.js. Place `mars-habitat` (scale 1) at home (0, terrain.heightAt(0,0), 0), a `mars-rover` at (14, heightAt, 6) rotation 0 -30 0, and a second rover at the last point of ../data/traverse.json (Perseverance's real position) via terrain.toWorld. Standing at home you should see the dome, solar wings and rover up close.
   - Rocks: scatter ~1500 small rocks within 150 m of the camera with ONE THREE.InstancedMesh (low-poly dodecahedron, random scale 0.05–0.6 m, random rotation, dusty brown #8a6a52, roughness 1), each sitting on terrain.heightAt. Re-scatter around the camera when it moves > 80 m (walk mode). Seeded random so it's stable. This is what fixes "the close-up looks fake": the DTM is 20 m per point, so near ground needs rocks, not more texture.
   - Ground: tint + fine grain are already automatic in lib/terrain.js; check it no longer looks flat grey.
   - Light: replace the ambient light with a hemisphere light (sky #ffd9b0, ground #4a2a18, intensity .75) + a directional sun placed from inputs.ltst (rises east 06:00, highest at noon, sets west 18:00), intensity 1.6*exp(-tau/5)+0.25. Optional: enable shadows ONLY for the sun on rocks/models within 200 m (shadow map 1024, tight shadow camera); drop it if fps falls.
   - Sky + dust: a-sky with a vertical gradient (zenith #80563e → butterscotch horizon); under high tau both go dusty. Linear fog, colour = horizon, far = derived.limits.visibilityKm*1000. The tau 6 storm must visibly swallow the far hills; that's the video moment.

2. Helmet HUD (helmet.css + markup)
   - Fonts: Clash Display (headers) + Switzer (text) from https://api.fontshare.com/v2/css?f[]=clash-display@500,600&f[]=switzer@400,500,600&display=swap ; numbers in Geist Mono (Google Fonts). No monospace-everything, no cyan terminal look.
   - Panels: frosted, no border: rgba(30,18,11,.46), backdrop-filter blur(22px) saturate(1.5), radius 14–20 px, shadow 0 10px 36px rgba(0,0,0,.38). Colours: text #f6ebdf, accent #ff8a3d, green #4cc86a, amber #e2a73a, red #ff5f56.
   - Layout like a real visor: status (GO / TURN BACK / RETURN NOW) big top-centre; minutes home + suit time small top-left; dust/visibility top-right; a compass strip along the top edge (N/E/S/W ticks that scroll with heading, with a home marker on it); the home distance + "hidden behind terrain" state bottom-centre.
   - Visor frame: a thin curved dark rim around the screen edges (CSS border-radius on a full-screen overlay with an inset shadow ring), NOT a blurry vignette.
   - Home beacon: slow pulse; when line of sight is blocked, the beacon turns dashed/dimmer and the label says "hidden behind terrain".
   - Status change pops (scale .9→1, .5s); everything off under prefers-reduced-motion.
   - House rules: no small labels above headings, no "01 ·" numbering, no ↗ arrows.

3. Feel
   - Walk mode: lerp position and heading (no jumps), eye 1.7 m above terrain.heightAt.
   - Pause rendering when the tab is hidden; test standalone (http://localhost:8000/helmet/) and inside the app (Position tab → Open helmet view).
   - Test at 1440 and 375 px.

4. Before the PR: `bash scripts/check_all.sh` passes; play the main demo with the helmet open through the storm (t = 60–150); attach 2 screenshots (clear + dust storm) and the fps you measured. Report anything unfinished.
```
