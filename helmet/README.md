# Feature: Helmet view (3D, A-Frame) — the AR concept

**Owner:** Edward (remote) · **Paste into Claude / GitHub Copilot together with the root `README.md`.**

## Purpose
Show what the astronaut sees: real Jezero terrain in first person, with a **home beacon that you can see even when a hill hides it**, a route line on the ground, and the Walk Budget as a HUD. This is our "future AR helmet" concept — today a 3D view, tomorrow see-through AR in a real helmet (NASA is already working on AR for suits: Joint AR at JSC, NASA SUITS).

It must work **standalone** (`helmet/index.html` opened directly) and **inside the main app** (iframe receiving live state).

## Scope (changed): overlays only
The terrain is already built. `lib/terrain.js` (shared with the main app's 3D view) registers the A-Frame component `heightgrid-terrain`: real Jezero mesh from `data/heightgrid.json` with the CTX image `data/terrain_texture.jpg` draped on it. **Do not write your own terrain or edit `lib/terrain.js`** — you build what sits on top: beacon, HUD, walk mode.

## Files to create
```
/helmet/index.html     A-Frame scene, loads ../lib/terrain.js then helmet.js
/helmet/helmet.js      beacon, route line, landmarks, HUD, walk-along mode, postMessage listener
```
A-Frame from CDN: `<script src="https://aframe.io/releases/1.6.0/aframe.min.js"></script>`, then `<script src="../lib/terrain.js"></script>` (classic script, not a module). No build step. Run from the repo root with `python3 -m http.server 8000` → http://localhost:8000/helmet/ (paths to data are `../data/...`).

## Start now (real data is in the repo)
Not needed any more: `data/heightgrid.json`, `data/meta.json` and `data/terrain_texture.jpg` are real and in the repo. Open `helmet/index.html` with the terrain entity above and start on the overlays.

## World coordinates
- Origin (0,0,0) = **home** (meta.home), at home's ground height.
- x = east (metres), z = **south** (A-Frame/three.js: north = −z), y = up (metres, elevation − home elevation).
- Lat/lon → x/z: `x = deg2rad(lon − home.lon) * cos(deg2rad(home.lat)) * R`, `z = −deg2rad(lat − home.lat) * R` (R = 3,396,190). Use `lib/geo.js` (`import { deg2rad, R } from '../lib/geo.js'`).
- Vertical scale 1× (true). Optional `?exaggerate=2` for drama — label it on screen if used.

## Terrain component (`lib/terrain.js`, already written — use it, don't change it)
```html
<a-entity id="terrain" heightgrid-terrain="src: ../data/heightgrid.json; meta: ../data/meta.json; texture: ../data/terrain_texture.jpg"></a-entity>
```
```js
document.querySelector('#terrain').addEventListener('terrain-loaded', e => {
  const terrain = e.detail;                 // the component instance
  terrain.toWorld(lat, lon);                // → {x, y, z}, y = ground height there
  terrain.heightAt(x, z);                   // → ground y (use it to glue the camera: y = heightAt(x, z) + 1.7)
  terrain.sizeM;                            // {ew, ns} extent in metres
});
// 'terrain-error' (detail.message) fires if the grid cannot be loaded — show it in the HUD.
```
Schema: `src`, `meta`, `texture` (paths relative to the page), `step` (use `2` if a phone struggles: every 2nd vertex), `exaggerate` (vertical scale, default 1 — label it on screen if you change it). If the texture is missing the mesh falls back to a flat Mars colour. Use `toWorld` for every lat/lon you place (beacon, route points, landmarks) so the helmet and the main 3D view always agree.

## Scene
- Sky: daytime Mars butterscotch `#c9a27e` → horizon `#e0c49a`; light: one directional "sun" + soft ambient.
- **Fog from dust:** `fog="type: linear; color: #c9a27e; near: 200; far: <visibilityKm*1000>"`, where `visibilityKm` comes from the Walk Budget state. As the dust storm rises in the demo, the far landmarks literally disappear — this links the 3D view to the map's blind zones. Clamp far to 30 km max for rendering.
- Camera: at the astronaut position, y = ground height there + 1.7 m. Use `look-controls` (mouse/touch drag) and `wasd-controls` with acceleration tuned to walking speed. Keep the camera glued to the ground (raycast down or sample the grid each tick).

### Realism layer (visual only, no science)
- **Ground** (`lib/ground.js`, shared with the main 3D view): world-space detail on the terrain material — grain, sandy patches with wind ripples, rocky patches — fading out by ~400 m. Three instanced rock layers (gravel to 24 m, rocks to 75 m, boulders to 280 m), clumped, sparse on the sand patches, re-scattered around the view.
- **Models** at true size: 8 m habitat dome on a 20 m pad (1.8 m airlock door), 3 m rovers. Start views stand 30 m from the habitat.
- **Zoom** (binoculars): mouse wheel, pinch, `+` / `-`, `0` resets. Up to ~24×; drag-to-look slows down with zoom.
- **Sun**: 0.35° disc (Mars sees it 2/3 the size of Earth's), dimmed by `exp(-tau / sin(elevation))`, with a dust halo that turns blue near sunset.
- **Dust**: blowing grains + drifting dust sheets, from τ ≈ 0.6 up to full at τ = 4. Wind direction matches the map's dust-devil drift. Not a wind measurement.
- **Dust devils**: during the dust-devil hours in `data/crew_constants.json`, three spinning columns 0.7–2.6 km away drift at `dust_devil_drift_ms`. Illustrative, not forecast positions.

## Overlays (the "AR" layer)
- **Home beacon:** a tall thin cylinder (e.g. 200 m high, 3 m radius, emissive cyan `#56d4ff`) at home + a label "HOME 2.4 km". Render it with `material="depthTest: false; transparent: true; opacity: 0.6"` so it shows **through hills** — like AR. Change label to "HOME (hidden behind terrain)" when the line of sight is blocked (raycast from camera to beacon base against the terrain mesh).
- **Direction arrow:** fixed in the HUD (bottom centre), rotates to the bearing of home relative to the camera heading.
- **Route:** a line on the ground following `route.points` (from state, or `../data/route_demo.json`), 0.5 m above terrain, amber.
- **Landmarks:** small labelled markers from `../data/landmarks.json`; hide those beyond `visibilityKm`.
- **HUD** (HTML overlay on top of the canvas, not 3D text — easier to read): status word + colour (GO / CAUTION / RETURN NOW), suit minutes left, minutes to home, dust τ and visibility km, position uncertainty ± m, distance + bearing home. Big readable mono font. No NASA logos.

## Live state from the main app (protocol: ARCHITECTURE.md §9)
```js
// on load, tell the parent you're ready (only when inside an iframe)
if (window.parent !== window) window.parent.postMessage({ type: 'sightline:hello', v: 1 }, location.origin);

window.addEventListener('message', (e) => {
  // security: same origin, from our parent, known type only
  if (e.origin !== location.origin || e.source !== window.parent) return;
  const m = e.data;
  if (!m || m.type !== 'sightline:state' || m.v !== 1) return;
  const { inputs, derived } = m;   // inputs: ARCHITECTURE §4; derived: { limits, budget, routeHome, posUncertaintyM }
  // camera → inputs.astronaut (unless user is walking manually); fog far → derived.limits.visibilityKm*1000;
  // HUD ← derived.budget; route line ← derived.routeHome.points; beacon label ← distance/bearing to meta.home
});
```
Never use `innerHTML` for HUD text — `textContent` only.
Standalone mode: read query params `?lat=&lon=&tau=&status=` with sensible defaults (home, τ 0.4, GREEN), so the page works alone for Edward's testing.

## Walk-along mode
Button "Walk route": camera moves along `route.points` at ~1.3 m/s (or faster ×20 for the video), facing the direction of travel, with the HUD updating distance to home.

## Acceptance checklist
- [ ] Real Jezero terrain renders (delta, rim visible) through `lib/terrain.js` — no terrain code in `helmet/`.
- [ ] Camera starts at home at eye height, can look around (mouse + touch).
- [ ] Beacon visible through terrain; label changes when hidden.
- [ ] HUD arrow points home correctly (test: walk 1 km north → arrow points back/south).
- [ ] Fog follows dust τ (τ 0.4 → clear; τ 2 → far hills gone).
- [ ] Works inside the main app's iframe and standalone. 30+ fps on a normal laptop.

## Stretch
- Sun position from LTST (shadows).
- Dust-devil particle effect around 12:00 LTST.
- WebXR "Enter VR" button (A-Frame has it built in) — nice for the pitch photo.
