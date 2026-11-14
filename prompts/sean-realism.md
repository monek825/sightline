<!-- Written with AI assistance (Claude / GitHub Copilot) -->
# Prompts for Sean: Mars realism round 2

Two prompts. They touch different files, so they can run in two Claude sessions at the same time.
Prompt A (sharp close-up ground) helps both views; Prompt B (rocks and sand) is the helmet view.

## Prompt A: sharp ground when zoomed in (HiRISE detail patch)

```
Repo monek825/sightline (NASA Space Apps, freeze Sun 16:00 WIB). Read CLAUDE.md, ARCHITECTURE.md, lib/terrain.js, scripts/make_texture.py, map/map.js (createView3D). Branch feat/hirise-patch, PR to main. Rules: no npm/build, no runtime API calls (fetch tiles ONCE in a script, commit the result), no NASA logos, new files start with the AI-assistance comment.

Problem: zoomed in, the 3D ground is blurry because the whole crater uses one CTX texture (~20 m per pixel). Real Mars has HiRISE imagery at 25 cm.
Fix, without lag:
1. scripts/make_hirise_patch.py (model it on make_texture.py, curl fallback, SSL verify ON): download HiRISE orthomosaic tiles (layer JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd, Mars Trek WMTS, zoom 16) for a 3 km x 3 km box centred on meta.home, plus a second box around three_forks (targets.json). Stitch, crop to the exact lat/lon box, save data/hirise_home.jpg and data/hirise_three_forks.jpg (max 4096 px each, JPEG q80) and data/hirise_patches.json [{id, file, latMin, latMax, lonMin, lonMax}]. Missing tiles = transparent edge, count them. Credit in data/sources.md: "HiRISE orthomosaic NASA/JPL-Caltech/UArizona via NASA Mars Trek".
2. lib/terrain.js: optional schema prop `patches` (url of hirise_patches.json, default ''). For each patch, build a small mesh from the same heightgrid covering only that box (subdivide 4x with bilinear heights so it isn't blocky), textured with the HiRISE image, same tint, polygonOffset so it sits on top of the CTX mesh without z-fighting. Load patches AFTER the main terrain (never delay first render). Expose nothing new except an optional 'patches-loaded' event.
3. map/map.js + helmet: pass `patches: data/hirise_patches.json` (helmet: ../data/...). Nothing else changes.
4. Check: zoom into home in the 3D view: rocks/ridges in the HiRISE image should be sharp; fps stays smooth (DevTools Performance, no long frames). File sizes: total new images < 6 MB.
5. `bash scripts/check_all.sh` passes; PR with before/after screenshots at the closest zoom.
```

## Prompt B: rockier, sandier ground in the helmet view

```
Repo monek825/sightline. Read CLAUDE.md, helmet/README.md, helmet/helmet.js (your current rocks + ground). Branch feat/helmet-ground, PR to main. Edit only helmet/*. One WebGL scene, keep 60 fps on a laptop.

The helmet view is better but not Mars yet: real Jezero ground (look at Perseverance Navcam/Mastcam-Z photos) is MUCH rockier and sandier: thousands of small pebbles, rocks half-buried in sand, sand ripples and drifts, colour variation, sharp-edged dark basalt boulders here and there.
1. Rocks with a realistic size mix: a power law (many pebbles, few boulders). Three InstancedMeshes (pebbles 2-8 cm ~6000, cobbles 10-40 cm ~1500, boulders 0.5-1.5 m ~60), dense near the camera, thinning with distance (~200 m). Sink each rock 20-50% into the ground (half-buried). Randomise colour per instance between dusty tan, reddish brown and dark grey basalt (instanceColor). Flatten some (scale y 0.4-0.7) so they read as slabs. Use a slightly deformed icosahedron (displace vertices once with seeded noise) instead of a clean dodecahedron.
2. Sand: a ground detail layer near the camera: a 400 m x 400 m plane that follows the camera, draped on terrain.heightAt (subdivided), with a procedural sand texture (canvas noise + fine ripples, tiled) blended over the terrain (transparent edges by alpha in the texture, not CSS fades). Add a few low wind-shaped sand drifts (stretched, smooth humps) in the lee of the boulders.
3. Light: low sun angle makes rocks pop; give rocks a darker ambient (hemisphere ground colour) and, only near the camera, sun shadows (1024 map) if fps allows; otherwise fake contact shadows with a dark blob decal under each boulder.
4. Dust: keep the fog tied to tau; at tau 6 the near rocks should stay visible and the hills disappear.
5. Measure fps while walking (DevTools Performance). If it drops, cut pebble count first. `bash scripts/check_all.sh`, PR with a clear-day and a storm screenshot.
```
