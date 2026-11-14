// Written with AI assistance (Claude / GitHub Copilot)
// Map renderer: Leaflet 2D view plus a lazily loaded A-Frame 3D view. Reads the store; the only writes are
// user clicks → onPickTarget (an action, not a subscriber). The 2D/3D toggle is local view state.
import { LOW_END, gfxChoice, setGfxChoice, autoStartLevel, stepDown } from '../lib/gfx.js';

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/';
const TILE_PATH = '/1.0.0/default/default028mm/{z}/{y}/{x}.png';
const AFRAME_SRC = 'https://aframe.io/releases/1.6.0/aframe.min.js';
const TERRAIN_SRC = 'lib/terrain.js';
const MODELS_SRC = 'lib/models.js';
const GROUND_SRC = 'lib/ground.js';
// 3D is to scale: vertical ×1 (true), rover and habitat always true size. Terrain: 40 m cells, falls back to the 20 m grid.
const TERRAIN_DATA = 'data/heightgrid40.json', TERRAIN_FALLBACK = 'data/heightgrid.json';
const MIN_DIST_M = 25;  // closest zoom: about standing height above the astronaut's area
// Close-up rocks (lib/ground.js), hidden once the camera is high enough that they would be sub-pixel.
const MAP_ROCK_LAYERS = [
  { count: 5000, radius: 30, cell: 1.2, min: 0.02, max: 0.1, rescatter: 8, detail: 0, color: 0x7d5f4c, clumpM: 6, maxCamH: 70, clearHome: 11 },
  { count: 2000, radius: 110, cell: 5, min: 0.1, max: 0.6, rescatter: 25, detail: 1, color: 0x6f5444, clumpM: 25, maxCamH: 450, clearHome: 11 },
  { count: 400, radius: 450, cell: 30, min: 0.5, max: 2.8, rescatter: 90, detail: 1, color: 0x6a4f40, clumpM: 90, maxCamH: 2500, clearHome: 14 }
];
// Graphics levels for the 3D view (shared choice with the helmet view, lib/gfx.js). Visual only.
//   dpr: render resolution cap (phones are 2-3x; this is the biggest cost). rocks: which MAP_ROCK_LAYERS are drawn.
//   texture/step/patches are chosen when the 3D view first loads (rebuilding the terrain live would stutter):
//   Low = half-size CTX image (fits a 4096 px phone GPU), every 2nd grid point, no HiRISE close-up images.
const MAP_GFX = {
  low:    { dpr: 1,    rocks: [false, false, true], texture: 'data/terrain_texture_3k.jpg', step: 2, patches: false },
  medium: { dpr: 1.5,  rocks: [false, true, true],  texture: 'data/terrain_texture.jpg',    step: LOW_END ? 2 : 1, patches: true },
  high:   { dpr: 2,    rocks: [true, true, true],   texture: 'data/terrain_texture.jpg',    step: 1, patches: true }
};
const GFX_WARMUP_MS = 2500, GFX_PROBE_MS = 3000, GFX_SLOW_MS = 30;   // Auto: average frame > 30 ms (< ~33 fps) -> one level down
const ROVER_PARK_M = [12, 6]; // support rover parked beside the habitat [east, south], real metres
const EXAGGERATE = 1;  // true vertical scale
// Astronaut sphere, home beacon, uncertainty ring and route tubes are markers, not to scale.
const ASTRO_R = 25, BEACON_H = 400, LIFT_M = 15, ROUTE_R = 10, STEP_M = 60;
const PITCH_MIN = 0.08, PITCH_MAX = 1.5, CAM_CLEARANCE_M = 40;
// 3D look (visual only; terrain tint + ground grain live in lib/terrain.js): sun placed from local solar time, slow idle orbit.
const SUN_DIST = 30000, IDLE_MS = 5000, IDLE_YAW_PER_S = 0.035;
// Opening shot: close on the habitat so the base reads in detail; when the story plays, ease out to see the walk.
const START_DIST_M = 140, START_PITCH = 0.32, PLAY_DIST_M = 2600, ZOOM_EASE_S = 1.6;
const ZENITH_CLEAR = [128, 86, 62], LANDMARK_H = 180, SITE_H = 90;
const PICK_SLOP_PX = 6, PICK_INSET_DEG = 1e-5; // 3D click-vs-drag threshold; keep picks just inside the bounds
const COLORS = { blind: [248, 81, 73, 120], homeHidden: [210, 153, 34, 32] };
const CREAM = '#fff4e0', INK = '#1a110c', ACCENT = '#ff8a3d', DUST = '#c98a55';
// Dust look (visual only, driven by τ): haze opacity and sky colour. Not a measured haze map.
const HAZE_PER_TAU = 0.06, HAZE_MAX = 0.6;
const SKY_CLEAR = [227, 167, 106], SKY_DUSTY = [168, 120, 84], TAU_DUSTY = 8;
// Dust devils (illustrative, not forecast positions). Spawn offsets in metres [east, north] around the astronaut.
const DEVIL_SPAWN_M = [[900, 300], [-700, 1200], [400, -1100], [-1500, -500]];
const DEVIL_TIMELAPSE = 30;        // shown 30x faster than real time so the drift is visible
const DEVIL_WIND_DEG = 60;         // drift direction (towards ENE); illustrative
const DEVIL_RESPAWN_M = 3500;      // a devil that drifts this far away is replaced upwind
const DEVIL_WIDTH_M = 150;         // drawn width; Newman et al. 2022 saw devils up to ~270 m wide
const DEVIL_HEIGHT_M = 800;        // 3D column height; illustrative (Perseverance measured devils from ~120 m to an estimated ~2 km tall)
const DEVIL_NOTE = 'Dust devils are illustrative, not a forecast.';
const M_PER_DEG = 2 * Math.PI * 3396190 / 360;
const DEVIL_SVG = '<svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="15"/><path d="M0-16A16 16 0 0 1 14 8M0 16A16 16 0 0 1-14-8"/><path d="M0-9A9 9 0 0 1 8 4M0 9A9 9 0 0 1-8-4"/></svg>';

// Moving dust devils: the single source of their positions (lat/lon, drawn on the 2D map and in the 3D view).
// One rAF loop, runs only while visible (devil hours, 2D map or 3D view shown, tab visible).
function createDevils(map, C) {
  const layer = L.layerGroup().addTo(map);
  const speedMs = C.dust_devil_drift_ms ?? 5;
  const rad = DEVIL_WIND_DEG * Math.PI / 180;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let items = [], raf = 0, last = 0, anchor = null, on = false;

  const sizePx = () => {
    const degPerPx = 180 / (256 * 2 ** map.getZoom());
    return Math.max(40, Math.round(DEVIL_WIDTH_M / (degPerPx * M_PER_DEG)));
  };
  const icon = () => { const px = sizePx(); return L.divIcon({ className: 'devil', html: DEVIL_SVG, iconSize: [px, px] }); };
  const place = (lat, lon, [dx, dy]) => [lat + dy / M_PER_DEG, lon + dx / (M_PER_DEG * Math.cos(lat * Math.PI / 180))];

  function spawn() {
    layer.clearLayers();
    items = DEVIL_SPAWN_M.map(off => {
      const m = L.marker(place(anchor.lat, anchor.lon, off), { icon: icon(), keyboard: false, interactive: true })
        .bindTooltip(`Dust devil (illustrative, not a forecast). Drifts with the wind at ~${speedMs} m/s, shown ${DEVIL_TIMELAPSE}× faster.`)
        .addTo(layer);
      const [lat, lon] = place(anchor.lat, anchor.lon, off);
      return { m, off, lat, lon };
    });
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const step = speedMs * DEVIL_TIMELAPSE * dt;
    for (const it of items) {
      let [lat, lon] = place(it.lat, it.lon, [Math.sin(rad) * step, Math.cos(rad) * step]);
      const dE = (lon - anchor.lon) * M_PER_DEG * Math.cos(anchor.lat * Math.PI / 180), dN = (lat - anchor.lat) * M_PER_DEG;
      if (Math.hypot(dE, dN) > DEVIL_RESPAWN_M) [lat, lon] = place(anchor.lat, anchor.lon, [-Math.sin(rad) * 2500 + it.off[1] * 0.5, -Math.cos(rad) * 2500 + it.off[0] * 0.5]);
      it.lat = lat; it.lon = lon;
      it.m.setLatLng([lat, lon]);
    }
    raf = requestAnimationFrame(frame);
  }
  const run = () => {
    cancelAnimationFrame(raf);
    if (on && !reduce && !document.hidden && (!$('map').hidden || !$('view3d').hidden)) { last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  map.on('zoomend', () => { const ic = icon(); items.forEach(it => it.m.setIcon(ic)); });
  document.addEventListener('visibilitychange', run);

  return {
    update(active, a) {
      if (active && !on) { anchor = { lat: a.lat, lon: a.lon }; spawn(); }
      if (!active && on) layer.clearLayers();
      if (active) anchor = { lat: a.lat, lon: a.lon };
      on = active;
      run();
    },
    refresh: run,
    active: () => on,
    positions: () => items   // live [{lat, lon}, …]; read-only for callers
  };
}
const $ = id => document.getElementById(id);

// ---------- 2D (Leaflet) ----------

function astronautIcon(heading) {
  return L.divIcon({
    className: 'astro-icon', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<svg width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true">
      <g transform="rotate(${Math.round(heading)})"><path d="M0,-13 L6,2 L-6,2 Z" fill="${CREAM}" stroke="${INK}" stroke-width="1.5"/></g>
      <circle r="5" fill="${CREAM}" stroke="${INK}" stroke-width="2"/></svg>`
  });
}

const drawOverlay = vis => drawOverlayCanvas(vis).toDataURL();
// Blind-zone canvas, one pixel per grid cell, row 0 = north: same layout as the terrain UVs, so the 3D view drapes it directly.
function drawOverlayCanvas(vis) {
  const cv = document.createElement('canvas');
  cv.width = vis.w; cv.height = vis.h;
  const g = cv.getContext('2d');
  const img = g.createImageData(vis.w, vis.h);
  for (let i = 0; i < vis.blind.length; i++) {
    const c = vis.blind[i] ? COLORS.blind : vis.homeHidden[i] ? COLORS.homeHidden : null;
    if (c) img.data.set(c, i * 4);
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// A route line with a dark casing underneath so it reads over orange-brown terrain.
// Routes are re-planned every few hundred metres (lib/pipeline.js), so between re-plans the line starts behind the
// astronaut. Draw it from the astronaut instead: drop the points already passed (nearest point, within 500 m).
const TRIM_MAX_M = 500;
function fromHere(points, a) {
  if (!points?.length || !a) return points ?? [];
  const k = Math.cos(a.lat * Math.PI / 180);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = (points[i][0] - a.lat) ** 2 + ((points[i][1] - a.lon) * k) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (Math.sqrt(bestD) * M_PER_DEG > TRIM_MAX_M) return points;
  return [[a.lat, a.lon], ...points.slice(best + 1)];
}

function routeLine(map, color, weight, dashArray) {
  const casing = L.polyline([], { color: INK, weight: weight + 4, opacity: 0.85 }).addTo(map);
  const line = L.polyline([], { color, weight, opacity: 1, dashArray }).addTo(map);
  return pts => { casing.setLatLngs(pts); line.setLatLngs(pts); };
}

// HiRISE coverage, from the layer's WMTSCapabilities.xml WGS84BoundingBox (trek.nasa.gov); lies inside `box`
const HIRISE_BOUNDS = [[18.3067994, 77.2229331], [18.669315, 77.583964]];

function addLayers(map, data, box, onPickTarget) {
  // Offline fallback UNDER the NASA tiles (image overlays default to above tiles, which hid the real imagery)
  if (data.hasBasemap) {
    map.createPane('basemap').style.zIndex = 150; // tilePane is 200
    L.imageOverlay('data/basemap.png', box, { opacity: 1, interactive: false, pane: 'basemap' }).addTo(map);
  }
  const ctx = L.tileLayer(`${TREK}JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0${TILE_PATH}`, {
    maxNativeZoom: 13, maxZoom: 18, bounds: box,
    attribution: 'CTX mosaic: NASA/JPL-Caltech/MSSS · via NASA Mars Trek'
  }).addTo(map);
  const hirise = L.tileLayer(`${TREK}JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd${TILE_PATH}`, {
    // ponytail: HiRISE pyramid shows 1-px seams at z13–14 (NASA tile artifact); only use it close up
    minZoom: 15, maxNativeZoom: 17, maxZoom: 18, bounds: HIRISE_BOUNDS,
    attribution: 'HiRISE mosaic: NASA/JPL-Caltech/UArizona'
  }).addTo(map);

  const blindLayer = L.imageOverlay('data:,', box, { className: 'blind-overlay', interactive: false }).addTo(map);
  const traverse = L.polyline(data.traverse.map(p => [p.lat, p.lon]), { color: '#ffffff', weight: 2, opacity: 0.6, dashArray: '2 4' });
  traverse.bindTooltip('Real Perseverance route (NASA waypoints)', { sticky: true });
  traverse.addTo(map);

  const landmarkLayer = L.layerGroup(data.landmarks.filter(l => l.id !== 'home').map(l =>
    L.marker([l.lat, l.lon], { icon: L.divIcon({ className: 'lm-icon', html: '▲', iconSize: [14, 14] }), keyboard: false })
      .bindTooltip(l.name))).addTo(map);
  const targetLayer = L.layerGroup(data.targets.map(t =>
    L.circleMarker([t.lat, t.lon], { radius: 6, color: ACCENT, weight: 2, fillOpacity: 0.3 })
      .bindTooltip(`${t.name} (Perseverance, sol ${t.sol})`)
      .on('click', e => { L.DomEvent.stop(e); onPickTarget({ lat: t.lat, lon: t.lon, id: t.id }); }))).addTo(map);

  L.marker([data.meta.home.lat, data.meta.home.lon], {
    icon: L.divIcon({ className: '', html: '<div class="home-icon"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    keyboard: false
  }).bindTooltip(data.meta.home.name).addTo(map);

  L.control.scale({ metric: true, imperial: false }).addTo(map);
  // names on: always-on labels; off: name on hover only
  const setNames = on => [landmarkLayer, targetLayer].forEach(g => g.eachLayer(m => {
    const t = m.getTooltip(), txt = t?.getContent();
    if (!txt) return;
    m.unbindTooltip().bindTooltip(txt, on ? { permanent: true, direction: 'right', offset: [8, 0], className: 'lm-name' } : {});
  }));
  return { blindLayer, hirise, traverse, landmarkLayer, targetLayer, setNames };
}

// ---------- 3D (A-Frame, lazy) ----------

const loadScript = src => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src; s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
});

function registerOrbit() {
  if (AFRAME.components['orbit-camera']) return;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  AFRAME.registerComponent('orbit-camera', {
    schema: { minDist: { default: MIN_DIST_M }, maxDist: { default: 25000 } },
    init() {
      this.o = { yaw: 0.6, pitch: START_PITCH, dist: START_DIST_M, x: 0, y: 0, z: 0 };
      this.distT = null;   // eased zoom target (zoomTo); any user input cancels it
      this.lastInput = 0;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.heightAt = null;
      this.el.object3D.rotation.order = 'YXZ';
      const scene = this.el.sceneEl, pts = new Map();
      let pinch = 0;
      const span = () => { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
      const touched = () => { this.lastInput = performance.now(); this.distT = null; };
      for (const ev of ['pointerdown', 'wheel']) scene.addEventListener(ev, touched, { passive: true });
      scene.addEventListener('pointerdown', e => {
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        scene.setPointerCapture(e.pointerId);
        pinch = pts.size === 2 ? span() : 0;
      });
      scene.addEventListener('pointermove', e => {
        const p = pts.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p[0], dy = e.clientY - p[1];
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2) { const d = span(); this.zoom(pinch / d); pinch = d; return; }
        this.o.yaw -= dx * 0.005;
        this.o.pitch = clamp(this.o.pitch + dy * 0.005, PITCH_MIN, PITCH_MAX);
      });
      for (const ev of ['pointerup', 'pointercancel']) scene.addEventListener(ev, e => pts.delete(e.pointerId));
      scene.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });
    },
    zoom(f) { this.o.dist = clamp(this.o.dist * f, this.data.minDist, this.data.maxDist); },
    zoomTo(d) { this.distT = clamp(d, this.data.minDist, this.data.maxDist); },
    setTarget(x, y, z) { Object.assign(this.o, { x, y, z }); },
    tick(time, dt) {
      if (!this.reduced && time - this.lastInput > IDLE_MS && dt < 100) this.o.yaw += IDLE_YAW_PER_S * dt / 1000;
      if (this.distT !== null) {
        const k = this.reduced ? 1 : 1 - Math.exp(-Math.min(dt, 100) / 1000 / (ZOOM_EASE_S / 4));
        this.o.dist *= Math.pow(this.distT / this.o.dist, k);      // ease in log space: even feel from 140 m to 2.6 km
        if (Math.abs(this.o.dist / this.distT - 1) < 0.005) { this.o.dist = this.distT; this.distT = null; }
      }
      const { yaw, pitch, dist, x, y, z } = this.o;
      const h = dist * Math.cos(pitch);
      const cx = x + h * Math.sin(yaw), cz = z + h * Math.cos(yaw);
      let cy = y + dist * Math.sin(pitch);
      const ground = this.heightAt?.(cx, cz);
      if (Number.isFinite(ground)) cy = Math.max(cy, ground + Math.min(CAM_CLEARANCE_M, 1.5 + dist * 0.08));
      this.el.object3D.position.set(cx, cy, cz);
      this.el.object3D.rotation.set(-Math.atan2(cy - y, h), yaw, 0);
      this.onTick?.(dist, cx, cy, cz, Number.isFinite(ground) ? cy - ground : cy - y);
    }
  });
}

function mk(tag, attrs, parent) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.append(e);
  return e;
}

// tint warms the greyscale CTX/HiRISE images to Mars colour (HiRISE patches inherit it, lib/terrain.js)
// Terrain detail by graphics level (MAP_GFX): Low / phones get every 2nd grid point (4x fewer triangles) and the
// half-size image; patches = HiRISE close-up images (~0.7 m/px) near home and Three Forks (lib/terrain.js).
const loadLevel = () => (gfxChoice() === 'auto' ? autoStartLevel() : gfxChoice());
const terrainAttr = src => {
  const g = MAP_GFX[loadLevel()];
  return `src: ${src}; exaggerate: ${EXAGGERATE}; tint: #f0b483; step: ${g.step}; texture: ${g.texture}; patches: ${g.patches ? 'data/hirise_patches.json' : ''}`;
};

function buildScene() {
  const scene = document.createElement('a-scene');
  scene.setAttribute('embedded', '');
  scene.setAttribute('xr-mode-ui', 'enabled: false');
  // log depth: the camera can now come within 25 m of the ground while the far plane stays at 80 km
  scene.setAttribute('renderer', 'antialias: true; logarithmicDepthBuffer: true');
  scene.setAttribute('background', 'color: #e3a76a');
  const flat = color => `color: ${color}; shader: flat; side: double`;
  const hemi = mk('a-entity', { light: 'type: hemisphere; color: #ffd9b0; groundColor: #4a2a18; intensity: 0.75' }, scene);
  const sun = mk('a-entity', { light: 'type: directional; color: #fff1dc; intensity: 1.5', position: '-4000 5000 3000' }, scene);
  const sky = mk('a-sky', { radius: 60000, material: 'shader: flat; fog: false; color: #fff' }, scene);
  const astro = mk('a-entity', {}, scene);
  mk('a-cone', { 'radius-bottom': 0, 'radius-top': ASTRO_R, height: ASTRO_R * 2.4, position: `0 ${ASTRO_R * 1.2} 0`, material: flat(ACCENT) }, astro);
  mk('a-sphere', { radius: ASTRO_R * 0.9, position: `0 ${ASTRO_R * 3} 0`, material: flat(ACCENT) }, astro);
  return {
    scene, hemi, sun, sky, landmarks: mk('a-entity', {}, scene), sites: mk('a-entity', {}, scene),
    terrain: mk('a-entity', { 'heightgrid-terrain': terrainAttr(TERRAIN_DATA) }, scene),
    cam: mk('a-entity', { camera: 'fov: 55; near: 0.5; far: 80000', 'orbit-camera': '' }, scene),
    home: mk('a-cylinder', { radius: 6, height: BEACON_H, material: flat(CREAM) }, scene),
    astro,
    ring: mk('a-entity', { rotation: '-90 0 0', geometry: 'primitive: ring; radiusInner: 1; radiusOuter: 2', material: flat(ACCENT) }, scene),
    routes: mk('a-entity', {}, scene)
  };
}

// Straight lat/lon legs resampled every STEP_M so the line follows the ground instead of cutting through hills.
function drape(terrain, points) {
  const out = [terrain.toWorld(points[0][0], points[0][1])];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const end = terrain.toWorld(b[0], b[1]), prev = out[out.length - 1];
    const n = Math.min(200, Math.max(1, Math.ceil(Math.hypot(end.x - prev.x, end.z - prev.z) / STEP_M)));
    for (let k = 1; k <= n; k++) out.push(terrain.toWorld(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n));
  }
  return out;
}

// Inverse of terrain.toWorld (x linear in lon, z linear in lat), from two opposite corners of the bounds; clamped inside.
function worldToLatLon(terrain, b, x, z) {
  const nw = terrain.toWorld(b.latMax, b.lonMin), se = terrain.toWorld(b.latMin, b.lonMax);
  const lon = b.lonMin + (x - nw.x) / (se.x - nw.x) * (b.lonMax - b.lonMin);
  const lat = b.latMax + (z - nw.z) / (se.z - nw.z) * (b.latMin - b.latMax);
  const fit = (v, lo, hi) => Math.min(hi - PICK_INSET_DEG, Math.max(lo + PICK_INSET_DEG, v));
  return { lat: fit(lat, b.latMin, b.latMax), lon: fit(lon, b.lonMin, b.lonMax) };
}

// k shrinks the tube and its lift when zoomed in close (1 = far view)
function setRoute(s, terrain, name, route, color, k = 1) {
  const old = s.routes.getObject3D(name);
  old?.geometry.dispose();
  if (!route?.ok || route.points.length < 2) { if (old) s.routes.removeObject3D(name); return; }
  const T = AFRAME.THREE;
  const pts = drape(terrain, route.points).map(p => new T.Vector3(p.x, p.y + LIFT_M * k, p.z));
  const segs = Math.min(pts.length * 2, 1200);
  const geo = new T.TubeGeometry(new T.CatmullRomCurve3(pts), segs, ROUTE_R * k, 5, false);
  const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ color }));
  mesh.userData.trim = { pts, segs, radial: 5 };
  s.routes.setObject3D(name, mesh);
}
// start the 3D route at the astronaut: skip the tube segments before the nearest sample (index buffer is segment-major)
function trimRoute(s, name, p) {
  const m = s.routes.getObject3D(name), t = m?.userData.trim;
  if (!t) return;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < t.pts.length; i++) { const d = (t.pts[i].x - p.x) ** 2 + (t.pts[i].z - p.z) ** 2; if (d < bestD) { bestD = d; best = i; } }
  const start = Math.sqrt(bestD) > TRIM_MAX_M ? 0 : Math.floor(best / (t.pts.length - 1) * t.segs);
  m.geometry.setDrawRange(start * t.radial * 6, Infinity);
}

// Vertical sky gradient as a data URL: darker zenith, lighter horizon; dust flattens it.
function skyGradient(horizon, f) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 256);
  const zen = ZENITH_CLEAR.map((v, i) => Math.round(v + (horizon[i] - v) * f));
  grad.addColorStop(0, `rgb(${zen.join(',')})`);
  grad.addColorStop(0.5, `rgb(${horizon.join(',')})`);
  grad.addColorStop(1, `rgb(${horizon.join(',')})`);
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  return c.toDataURL();
}

// Sun from local solar time: sin(el) = cos(lat)·cos(hour angle); ignores the Mars season (declination ~0 at Ls ≈ 5°).
// East in the morning, west in the afternoon. The light keeps a 4° floor so the scene is not black; there is no sun disc here.
function sunPosition(ltst, lat) {
  const day = Math.min(1, Math.max(0, (ltst - 6) / 12));
  const trueEl = Math.asin(Math.cos(lat * Math.PI / 180) * Math.cos(15 * (ltst - 12) * Math.PI / 180));
  const el = Math.max(4 * Math.PI / 180, trueEl);
  const az = (90 + 180 * day) * Math.PI / 180; // from north, clockwise
  return [Math.sin(az) * Math.cos(el) * SUN_DIST, Math.sin(el) * SUN_DIST, -Math.cos(az) * Math.cos(el) * SUN_DIST];
}

// Translucent spinning dust-devil columns (illustrative). One lathe geometry (tapered, wider and fainter at the top,
// flared base skirt), uniforms shared by all columns. Copied and adapted from helmet/helmet.js makeDevils().
function makeDevilColumns(T, parent) {
  const U = { uTime: { value: 0 }, uFar: { value: 8000 }, uCam: { value: new T.Vector3() }, uColor: { value: new T.Color(0xc79a74) } };
  const prof = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; prof.push(new T.Vector2(0.55 + 0.45 * t + 0.9 * Math.exp(-t * 28), t)); }
  const geo = new T.LatheGeometry(prof, 32);   // unit height; radius 1 = half the width
  const meshes = [];
  for (let i = 0; i < DEVIL_SPAWN_M.length; i++) {
    const mat = new T.ShaderMaterial({
      uniforms: Object.assign({ uSeed: { value: i * 7.3 } }, U), transparent: true, depthWrite: false, side: T.DoubleSide, fog: false,
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform float uTime, uSeed; varying vec2 vUv; varying vec3 vW;
        void main() {
          vUv = uv;
          vec3 p = position;
          float lean = smoothstep(0.0, 1.0, p.y);
          p.x += sin(p.y * 3.0 + uTime * 0.7 + uSeed) * 0.3 * lean;   // the column leans and snakes
          p.z += cos(p.y * 2.3 + uTime * 0.5 + uSeed) * 0.2 * lean;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uTime, uSeed, uFar; uniform vec3 uCam, uColor; varying vec2 vUv; varying vec3 vW;
        void main() {
          #include <logdepthbuf_fragment>
          float a = vUv.x * 6.2832, y = vUv.y;
          float sw = sin(a * 3.0 + y * 14.0 - uTime * 5.0 + uSeed) * 0.5 + 0.5;
          sw *= sin(a * 5.0 - y * 9.0 - uTime * 3.3) * 0.25 + 0.75;
          float body = smoothstep(0.0, 0.03, y) * (1.0 - 0.7 * y);         // faint towards the top
          float skirt = exp(-y * 22.0) * 0.5;                              // soft base skirt of dust
          float d = length(vW.xz - uCam.xz);
          float alpha = ((0.24 + 0.36 * sw) * body + skirt * (0.5 + 0.5 * sw)) * (1.0 - smoothstep(0.55 * uFar, uFar, d));
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(uColor * (0.85 + 0.25 * sw), alpha);
          #include <colorspace_fragment>
        }`
    });
    const m = new T.Mesh(geo, mat);
    m.frustumCulled = false; m.visible = false; m.renderOrder = 4;
    parent.add(m);
    meshes.push(m);
  }
  return { U, meshes };
}

// Blowing dust over the 3D view (visual only): two layers of soft noise drifting with the wind, opacity from tau.
// CSS transform animation (compositor), so it costs no frame time; one 256 px noise texture, generated once.
const VEIL_PER_TAU = 0.075, VEIL_MAX = 0.75;
function dustNoise() {
  const N = 256, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  const rnd = (x, y, sx, sy) => { const k = ((x % sx + sx) % sx) * 7919 + ((y % sy + sy) % sy) * 104729; const v = Math.sin(k) * 43758.5453; return v - Math.floor(v); };
  const smooth = (x, y, sx, sy) => {   // value noise that wraps every sx (x) and sy (y) cells, so the tile has no seams
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (rnd(x0, y0, sx, sy) * (1 - u) + rnd(x0 + 1, y0, sx, sy) * u) * (1 - v) + (rnd(x0, y0 + 1, sx, sy) * (1 - u) + rnd(x0 + 1, y0 + 1, sx, sy) * u) * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let n = 0, amp = 0.6;
    for (const s of [4, 8, 16]) { n += amp * smooth(x * s / N, y * (s / 2) / N, s, s / 2); amp *= 0.5; } // half as many cells in y: wind streaks
    img.data.set([214, 160, 112, Math.round(Math.min(1, Math.max(0, n - 0.3) * 2.2) * 255)], (y * N + x) * 4); // dust colour baked in
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}
function addDustVeil(host) {
  const veil = document.createElement('div');
  veil.className = 'dust-veil';
  veil.setAttribute('aria-hidden', 'true');
  const url = `url(${dustNoise()})`;
  for (const cls of ['veil-a', 'veil-b']) {
    const layer = document.createElement('div');
    layer.className = `veil-layer ${cls}`;
    layer.style.setProperty('--noise', url);
    veil.append(layer);
  }
  host.append(veil);
}

function createView3D(data, onPickTarget, devils) {
  const host = $('view3d'), msg = $('v3-msg');
  let s = null, starting = null, terrain = null, last = null, lastHome, lastOut, lastRadius = -1, lastTau = null, lastSun = null, lastVis = null, blind3d = null;
  let routeK = 1, retried = false, groundU = null, rocks = null, wasPlaying = false;
  const say = text => { msg.textContent = text; msg.hidden = !text; };
  const noteBase = `Vertical scale ×${EXAGGERATE} (true). Rover and habitat are true size. The habitat is a concept, not a NASA design. The far rover is Perseverance at its latest traverse position.`;
  let noteDevils = null, dv3 = null, dvAff = null, dvT0 = performance.now();
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const setNote = on => { if (on === noteDevils) return; noteDevils = on; $('v3-note').textContent = on ? `${noteBase} ${DEVIL_NOTE}` : noteBase; };
  setNote(false);

  // Per frame: stand each column on the ground at the 2D map's devil position (affine lat/lon → world, no allocation).
  function updateDevils3D(cx, cy, cz) {
    if (!dv3) return;
    const act = devils.active(), pos = devils.positions(), hours = act && terrain?.ready && pos.length > 0;
    dv3.U.uTime.value = reduceMotion ? 0 : (performance.now() - dvT0) / 1000;
    dv3.U.uCam.value.set(cx, cy, cz);
    for (let i = 0; i < dv3.meshes.length; i++) {
      const m = dv3.meshes[i], it = pos[i];
      if (!hours || !it) { m.visible = false; continue; }
      const x = dvAff.x0 + (it.lon - dvAff.lon0) * dvAff.kx, z = dvAff.z0 + (it.lat - dvAff.lat0) * dvAff.kz, g = terrain.heightAt(x, z);
      if (!Number.isFinite(g)) { m.visible = false; continue; }
      m.position.set(x, g - 2, z);
      m.visible = true;
    }
  }

  // ---------- graphics level (MAP_GFX) ----------
  const loadedLevel = loadLevel();           // decided the texture / grid / HiRISE when the terrain was built
  let gfxLevel = loadedLevel, gfxT0 = -1, gfxLast = 0, gfxSum = 0, gfxN = 0;
  const gfxSel = $('v3-gfx'), gfxInfo = $('v3-gfx-info');
  function applyGfx() {
    const choice = gfxChoice();
    if (choice !== 'auto') gfxLevel = choice;
    const g = MAP_GFX[gfxLevel];
    const r = s?.scene.renderer;
    if (r) {
      const p = Math.min(g.dpr, window.devicePixelRatio || 1);
      if (Math.abs(r.getPixelRatio() - p) > 0.01) { r.setPixelRatio(p); s.scene.resize?.(); }
    }
    if (rocks) rocks.layers.forEach((l, i) => { l.off = !g.rocks[i]; });
    if (gfxSel) gfxSel.value = choice;
    if (gfxInfo) {
      const L0 = MAP_GFX[loadedLevel];
      const later = g.texture !== L0.texture || g.step !== L0.step || g.patches !== L0.patches;
      gfxInfo.textContent = (choice === 'auto' ? gfxLevel[0].toUpperCase() + gfxLevel.slice(1) : '') +
        (later ? `${choice === 'auto' ? ' · ' : ''}terrain detail updates on next load` : '');
    }
  }
  gfxSel?.addEventListener('change', () => {
    setGfxChoice(gfxSel.value);
    if (gfxSel.value === 'auto') gfxLevel = autoStartLevel();
    gfxT0 = -1;
  });
  window.addEventListener('sightline-gfx', applyGfx);
  window.addEventListener('storage', e => { if (e.key === 'sightline-gfx') { gfxT0 = -1; applyGfx(); } }); // changed in the helmet view
  // Auto: after a warm-up, average the frame time; if this device is slow, step down one level (and probe again).
  function gfxAutoTick() {
    if (gfxChoice() !== 'auto' || gfxLevel === 'low') return;
    const now = performance.now();
    if (gfxT0 < 0) { gfxT0 = now; gfxLast = now; gfxSum = 0; gfxN = 0; return; }
    const dt = now - gfxLast; gfxLast = now;
    if (now - gfxT0 > GFX_WARMUP_MS && dt < 500) { gfxSum += dt; gfxN++; }   // > 500 ms = paused / tab hidden, not slow
    if (now - gfxT0 > GFX_WARMUP_MS + GFX_PROBE_MS) {
      if (gfxN > 20 && gfxSum / gfxN > GFX_SLOW_MS) { gfxLevel = stepDown(gfxLevel); applyGfx(); gfxT0 = -1; }
      else gfxT0 = Infinity;   // fast enough: decided
    }
  }

  // Per frame from orbit-camera: marker size, route thickness, near plane and close-up ground follow the zoom.
  function onZoom(dist, cx, cy, cz, camH) {
    gfxAutoTick();
    const a = Math.min(1, Math.max(0.016, dist / 5200));      // astronaut cone 25 m tall from afar, ~0.4 m up close
    s.astro.object3D.scale.setScalar(a);
    s.home.object3D.scale.set(a, 1, a);
    const rk = Math.min(1, Math.pow(2, Math.round(Math.log2(Math.max(0.02, dist / 2500)))));   // power-of-2 steps: rebuild rarely
    if (rk !== routeK && last) {
      routeK = rk;
      setRoute(s, terrain, 'home', last.derived.routeHome, CREAM, rk);
      setRoute(s, terrain, 'out', last.derived.routeOut, ACCENT, rk);
      update();
    }
    const cam = s.scene.camera;
    const near = Math.min(10, Math.max(0.1, dist * 0.004));
    if (cam && Math.abs(cam.near - near) > near * 0.1) { cam.near = near; cam.updateProjectionMatrix(); }
    if (groundU) groundU.uGCam.value.set(cx, cy, cz);
    const o = s.cam.components['orbit-camera'].o;
    if (rocks) rocks.update(o.x, o.z, 0, 0, camH);
    updateDevils3D(cx, cy, cz);
    placeLabels(cam);
  }
  // place-name labels: HTML spans projected from 3D each frame (only transforms written)
  const labelBox = document.createElement('div'), labels = [];
  labelBox.className = 'v3-labels'; labelBox.setAttribute('aria-hidden', 'true');
  host.append(labelBox);
  let tmpL = null;
  function placeLabels(cam) {
    if (!cam || !labels.length) return;
    const on = vis('names');
    labelBox.hidden = !on;
    if (!on) return;
    tmpL ??= new AFRAME.THREE.Vector3();
    const w = host.clientWidth, h = host.clientHeight;
    for (const L of labels) {
      tmpL.copy(L.p).project(cam);
      const show = vis(L.kind) && tmpL.z < 1 && Math.abs(tmpL.x) < 1.05 && Math.abs(tmpL.y) < 1.05;
      if (L.el.hidden !== !show) L.el.hidden = !show;
      if (show) L.el.style.transform = `translate(${((tmpL.x + 1) / 2 * w).toFixed(0)}px, ${((1 - tmpL.y) / 2 * h).toFixed(0)}px) translate(-50%, -100%)`;
    }
  }

  // Blind zones draped on the terrain: a second mesh sharing the terrain geometry, transparent, drawn on top.
  function updateBlind(vis, key) {
    if (!vis?.blind || key === lastVis) return;
    lastVis = key;
    const T = AFRAME.THREE;
    if (!blind3d) {
      const tex = new T.CanvasTexture(drawOverlayCanvas(vis));
      tex.colorSpace = T.SRGBColorSpace;
      blind3d = new T.Mesh(terrain.geometry, new T.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      }));
      blind3d.renderOrder = 1;
      s.terrain.object3D.add(blind3d);
      return;
    }
    blind3d.material.map.image = drawOverlayCanvas(vis);
    blind3d.material.map.needsUpdate = true;
  }

  const show = {};   // layer menu: id → false hides it
  const vis = id => show[id] !== false;
  function applyLayers() {
    if (!s) return;
    if (blind3d) blind3d.visible = vis('blind');
    s.home.object3D.visible = vis('beacon');
    s.routes.object3D.visible = vis('routes');
    s.ring.object3D.visible = vis('ring');
    s.landmarks.object3D.visible = vis('landmarks');
    s.sites.object3D.visible = vis('sites');
    host.classList.toggle('no-dust', !vis('dust'));
  }
  function update() {
    if (!terrain?.ready || !last) return;
    applyLayers();
    updateBlind(last.derived.vis, last.derived.visKey);
    setNote(devils.active());
    if (!devils.active() && dv3) for (const m of dv3.meshes) m.visible = false;
    const { inputs: { astronaut: a }, derived: d } = last;
    const p = terrain.toWorld(a.lat, a.lon);
    s.astro.object3D.position.set(p.x, p.y, p.z);
    trimRoute(s, 'home', p); trimRoute(s, 'out', p);
    s.ring.object3D.position.set(p.x, p.y + Math.max(0.1, LIFT_M * routeK), p.z);
    const r = Math.max(5, Math.round(d.posUncertaintyM));
    if (r + routeK * 1e6 !== lastRadius) {      // line width follows the zoom (thin when close)
      lastRadius = r + routeK * 1e6;
      const w = Math.min(r * 0.5, Math.max(4 * routeK, r * 0.05 * routeK, 0.15));
      s.ring.setAttribute('geometry', `primitive: ring; radiusInner: ${r - w}; radiusOuter: ${r}; segmentsTheta: 96`);
    }
    const orbit = s.cam.components['orbit-camera'];
    if (orbit) { orbit.setTarget(p.x, p.y, p.z); orbit.heightAt = (x, z) => terrain.heightAt(x, z); }
    const playing = last.inputs.scenarioT !== null;
    if (orbit && playing && !wasPlaying && orbit.o.dist < PLAY_DIST_M * 0.6) orbit.zoomTo(PLAY_DIST_M);
    wasPlaying = playing;
    if (d.routeHome !== lastHome) { lastHome = d.routeHome; setRoute(s, terrain, 'home', d.routeHome, CREAM, routeK); }
    if (d.routeOut !== lastOut) { lastOut = d.routeOut; setRoute(s, terrain, 'out', d.routeOut, ACCENT, routeK); }
    const ltst = Math.round(last.inputs.ltst * 4) / 4;
    if (ltst !== lastSun) { lastSun = ltst; s.sun.setAttribute('position', sunPosition(ltst, data.meta.home.lat).map(Math.round).join(' ')); }
    const tau = Math.round(last.inputs.tau * 10) / 10;
    if (tau !== lastTau) {
      lastTau = tau;
      const f = Math.min(1, tau / TAU_DUSTY);
      const sky = SKY_CLEAR.map((c, i) => Math.round(c + (SKY_DUSTY[i] - c) * f));
      const color = `rgb(${sky.join(',')})`;
      const far = Math.max(3000, d.limits.visibilityKm * 1000);
      if (dv3) { dv3.U.uColor.value.set(`rgb(${sky.map(c => Math.round(c * 0.8)).join(',')})`); dv3.U.uFar.value = far; }
      s.scene.setAttribute('background', `color: ${color}`);
      s.sky.setAttribute('material', `shader: flat; fog: false; src: url(${skyGradient(sky, f)})`);
      s.sun.setAttribute('light', 'intensity', (1.6 * Math.exp(-tau / 5) + 0.25).toFixed(2));
      s.hemi.setAttribute('light', 'intensity', (0.7 + 0.25 * f).toFixed(2));
      // storms: haze starts right in front of the camera; clear days: only far away
      s.scene.setAttribute('fog', `type: linear; color: ${color}; near: ${Math.round(far * (0.15 - 0.15 * f))}; far: ${Math.round(far)}`);
      host.style.background = color;
      host.style.setProperty('--veil', String(Math.min(VEIL_MAX, tau * VEIL_PER_TAU).toFixed(2)));
    }
  }

  async function init() {
    addDustVeil(host);
    say('Loading 3D terrain…');
    try {
      if (!window.AFRAME) await loadScript(AFRAME_SRC);
      await loadScript(TERRAIN_SRC);
      await loadScript(MODELS_SRC);
    } catch (err) { say(`3D view unavailable: ${err.message}`); starting = null; return; }
    try { await loadScript(GROUND_SRC); } catch (err) { console.warn('3D view: close-up ground detail unavailable', err); }
    registerOrbit();
    s = buildScene();
    s.terrain.addEventListener('terrain-loaded', e => {
      terrain = e.detail;
      say('');
      s.home.object3D.position.set(0, terrain.heightAt(0, 0) + BEACON_H / 2, 0);
      const h0 = terrain.heightAt(0, 0);
      mk('a-entity', { 'mars-habitat': 'scale: 1', position: `0 ${h0} 0` }, s.scene);
      const [rx, rz] = ROVER_PARK_M;
      mk('a-entity', { 'mars-rover': 'scale: 1', position: `${rx} ${terrain.heightAt(rx, rz)} ${rz}`, rotation: '0 -30 0' }, s.scene);
      const end = data.traverse?.at?.(-1); // Perseverance's latest position on its real traverse
      if (end) {
        const q = terrain.toWorld(end[0] ?? end.lat, end[1] ?? end.lon);
        if (Number.isFinite(q.y)) mk('a-entity', { 'mars-rover': 'scale: 1', position: `${q.x} ${q.y} ${q.z}`, rotation: '0 70 0' }, s.scene);
      }
      const G = window.SightlineGround, tm = s.terrain.getObject3D('mesh');
      if (G && tm) {
        const det = G.detail(AFRAME.THREE);
        groundU = G.patchTerrain(AFRAME.THREE, tm.material, det, { near: 60, far: 900 });
        const maxA = s.scene.renderer?.capabilities.getMaxAnisotropy() ?? 8;
        det.tex.anisotropy = maxA;
        if (tm.material.map) { tm.material.map.anisotropy = maxA; tm.material.map.needsUpdate = true; }
        rocks = G.rocks(AFRAME.THREE, (x, z) => terrain.heightAt(x, z), det, MAP_ROCK_LAYERS);
        s.scene.object3D.add(rocks.group);
      }
      dv3 = makeDevilColumns(AFRAME.THREE, s.scene.object3D);
      for (const m of dv3.meshes) m.scale.set(DEVIL_WIDTH_M / 2, DEVIL_HEIGHT_M, DEVIL_WIDTH_M / 2);
      const bb = data.bounds, nw = terrain.toWorld(bb.latMax, bb.lonMin), se = terrain.toWorld(bb.latMin, bb.lonMax);
      dvAff = { lon0: bb.lonMin, lat0: bb.latMax, x0: nw.x, z0: nw.z, kx: (se.x - nw.x) / (bb.lonMax - bb.lonMin), kz: (se.z - nw.z) / (bb.latMin - bb.latMax) };
      lastTau = null;   // re-run the sky pass so the columns pick up the current colour
      const orbit = s.cam.components['orbit-camera'];
      if (orbit) orbit.onTick = onZoom;
      applyGfx();
      const addLabel = (name, q, h, kind) => {
        const el = document.createElement('span');
        el.className = `v3-label ${kind}`; el.textContent = name;
        labelBox.append(el);
        labels.push({ el, kind, p: new AFRAME.THREE.Vector3(q.x, q.y + h, q.z) });
      };
      for (const lm of data.landmarks ?? []) {
        if (lm.id === 'home') continue;
        const q = terrain.toWorld(lm.lat, lm.lon);
        const pin = mk('a-entity', { position: `${q.x} ${q.y} ${q.z}` }, s.landmarks);
        mk('a-cylinder', { radius: 3, height: LANDMARK_H, position: `0 ${LANDMARK_H / 2} 0`, material: 'color: #fff4e0; shader: flat' }, pin);
        mk('a-sphere', { radius: 14, position: `0 ${LANDMARK_H} 0`, material: 'color: #fff4e0; shader: flat' }, pin);
        addLabel(lm.name, q, LANDMARK_H + 30, 'landmarks');
      }
      for (const t of data.targets ?? []) {   // Perseverance science sites: short orange pins
        const q = terrain.toWorld(t.lat, t.lon);
        if (!Number.isFinite(q.y)) continue;
        const pin = mk('a-entity', { position: `${q.x} ${q.y} ${q.z}` }, s.sites);
        mk('a-cylinder', { radius: 2, height: SITE_H, position: `0 ${SITE_H / 2} 0`, material: `color: ${ACCENT}; shader: flat` }, pin);
        mk('a-sphere', { radius: 9, position: `0 ${SITE_H} 0`, material: `color: ${ACCENT}; shader: flat` }, pin);
        addLabel(t.name, q, SITE_H + 20, 'sites');
      }
      update();
    });
    // A click (one pointer, barely moves) picks a target; a drag orbits (orbit-camera) and a pinch zooms.
    const down = new Set();
    let press = null;
    function pick(e) {
      if (!terrain?.ready) return;
      const T = AFRAME.THREE, r = s.scene.canvas.getBoundingClientRect(), cam = s.scene.camera;
      cam.updateMatrixWorld();
      const ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), cam);
      const hit = ray.intersectObject(s.terrain.getObject3D('mesh'))[0]; // nearest first; sky → no hit
      if (hit) onPickTarget(worldToLatLon(terrain, data.bounds, hit.point.x, hit.point.z));
    }
    s.scene.addEventListener('pointerdown', e => {
      down.add(e.pointerId);
      press = down.size === 1 && e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    });
    s.scene.addEventListener('pointermove', e => {
      if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= PICK_SLOP_PX) press = null;
    });
    s.scene.addEventListener('pointerup', e => {
      down.delete(e.pointerId);
      const p = press;
      if (p?.id === e.pointerId) { press = null; if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < PICK_SLOP_PX) pick(e); }
    });
    s.scene.addEventListener('pointercancel', e => { down.delete(e.pointerId); press = null; });
    s.terrain.addEventListener('patches-loaded', e => {
      const maxA = s.scene.renderer?.capabilities.getMaxAnisotropy() ?? 8;
      for (const p of e.detail.patches) { p.tex.anisotropy = maxA; p.tex.needsUpdate = true; }
      rocks?.setDensity(e.detail.roughnessAt);
    });
    s.terrain.addEventListener('terrain-error', e => {
      if (!retried && !s.terrain.components['heightgrid-terrain']?.ready) {   // 40 m grid missing: retry once with the 20 m grid
        retried = true;
        s.terrain.removeAttribute('heightgrid-terrain');
        s.terrain.setAttribute('heightgrid-terrain', terrainAttr(TERRAIN_FALLBACK));
        return;
      }
      say(`3D terrain failed: ${e.detail?.message ?? 'unknown error'}`);
    });
    s.scene.addEventListener('loaded', () => {
      applyGfx();   // resolution cap before the first frames (A-Frame starts at the full device pixel ratio)
      if (host.hidden) s.scene.pause();
      update();
      // GPU ran out of memory or the driver reset: fall back to the 2D map instead of a dead white screen
      s.scene.canvas?.addEventListener('webglcontextlost', e => {
        e.preventDefault();
        if (gfxChoice() !== 'low') setGfxChoice('low');   // next load uses the small texture and no HiRISE images
        $('v-2d').click();
        say('3D view stopped (out of graphics memory). Showing the 2D map. Graphics are now set to Low. Reload to try 3D again.');
        const b = $('banner');
        b.textContent = '3D view stopped on this device, so the 2D map is shown. Graphics are now set to Low: reload to try 3D again.';
        b.hidden = false;
        setTimeout(() => { b.hidden = true; }, 6000);
      }, { once: true });
    });
    host.prepend(s.scene);
  }

  return {
    show() {
      host.hidden = false;
      if (s) { if (s.scene.hasLoaded) s.scene.play(); } else starting ??= init();
    },
    hide() { host.hidden = true; if (s?.scene.hasLoaded) s.scene.pause(); },
    render(store) { last = store; update(); },
    setLayer(id, on) { show[id] = on; applyLayers(); }
  };
}

// Small popover: button toggles it; outside click or Escape closes it.
function popover(btnId, popId) {
  const btn = $(btnId), pop = $(popId), wrap = btn.parentElement;
  const open = on => { pop.hidden = !on; btn.setAttribute('aria-expanded', String(on)); };
  btn.addEventListener('click', () => open(pop.hidden));
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !wrap.contains(e.target)) open(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { open(false); btn.focus(); } });
  return open;
}

// Eye: show / hide objects drawn on the map. Each item: on2 = 2D switch; setLayer(id, on) = 3D switch.
function setupLayerMenu(items, setLayer3D) {
  const list = $('layers-list');
  for (const it of items) {
    const lab = document.createElement('label'), box = document.createElement('input');
    box.type = 'checkbox'; box.checked = true;
    box.addEventListener('change', () => { it.on2?.(box.checked); setLayer3D(it.id, box.checked); });
    lab.append(box, document.createTextNode(it.label));
    list.append(lab);
  }
  popover('layers-btn', 'layers-list');
}

function setupToggle(map, view3d) {
  const b2 = $('v-2d'), b3 = $('v-3d');
  const openMenu = popover('view-btn', 'view-menu');
  $('view-menu').addEventListener('click', e => { if (e.target.closest('button')) openMenu(false); });
  const set = is3d => {
    b2.setAttribute('aria-pressed', String(!is3d));
    b3.setAttribute('aria-pressed', String(is3d));
    $('view-name').textContent = is3d ? '3D terrain' : '2D map';
    $('map').hidden = is3d;
    if (is3d) view3d.show(); else { view3d.hide(); map.invalidateSize(); }
  };
  b2.addEventListener('click', () => set(false));
  b3.addEventListener('click', () => set(true));
  set(true); // 3D by default: the terrain reads as Mars at a glance; 2D stays one click away
}

// ---------- entry ----------

export function createMapView(data, { onPickTarget }) {
  const store0 = { data };
  const b = data.bounds;
  const box = [[b.latMin, b.lonMin], [b.latMax, b.lonMax]];
  const map = L.map('map', { attributionControl: false, // imagery credits live in the Details drawer
    crs: L.CRS.EPSG4326, minZoom: 10, maxZoom: 18, zoomSnap: 1,
    maxBounds: L.latLngBounds(box).pad(0.05)
  }).setView([data.meta.home.lat, data.meta.home.lon], 13);

  const L2 = addLayers(map, data, box, onPickTarget), blindLayer = L2.blindLayer;
  const routesG = L.layerGroup().addTo(map);
  const setRouteAlt = routeLine(routesG, CREAM, 2, '4 6'); // comparison route, created first so orange stays on top
  const setRouteOut = routeLine(routesG, ACCENT, 4);
  const setRouteHome = routeLine(routesG, CREAM, 3, '8 6');
  const haze = L.rectangle(box, { stroke: false, fillColor: DUST, fillOpacity: 0, interactive: false }).addTo(map);
  const seeRing = L.circle([0, 0], { radius: 1000, color: DUST, weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
  const devils = createDevils(map, data.C);
  const uncertainty = L.circle([0, 0], { radius: 30, color: CREAM, weight: 1.5, fillColor: CREAM, fillOpacity: 0.12 }).addTo(map);
  const astro = L.marker([0, 0], { icon: astronautIcon(0), keyboard: false, zIndexOffset: 1000 }).addTo(map);
  map.on('click', e => onPickTarget({ lat: e.latlng.lat, lon: e.latlng.lng }));

  const view3d = createView3D(data, onPickTarget, devils);
  setupToggle(map, view3d);
  for (const id of ['v-2d', 'v-3d']) $(id).addEventListener('click', () => devils.refresh()); // pause/resume the devil loop
  const g2 = (...ls) => on => ls.forEach(l => (on ? l.addTo(map) : l.remove()));
  setupLayerMenu([
    { id: 'beacon', label: 'Home beacon' },
    { id: 'landmarks', label: 'Landmarks', on2: g2(L2.landmarkLayer) },
    { id: 'names', label: 'Place names', on2: on => L2.setNames(on) },
    { id: 'sites', label: 'Science sites', on2: g2(L2.targetLayer) },
    { id: 'perseverance', label: 'Perseverance route', on2: g2(L2.traverse) },
    { id: 'routes', label: 'Walking routes', on2: g2(routesG) },
    { id: 'blind', label: 'Blind zones', on2: g2(blindLayer) },
    { id: 'ring', label: 'Visibility ring', on2: g2(seeRing, uncertainty) },
    { id: 'dust', label: 'Dust haze', on2: g2(haze) }
  ], view3d.setLayer);
  L2.setNames(true);

  let lastVisKey = null, lastHeading = null;
  function renderWeather({ inputs, derived }) {
    const C = store0.data.C, a = inputs.astronaut;
    haze.setStyle({ fillOpacity: Math.min(HAZE_MAX, inputs.tau * HAZE_PER_TAU) });
    seeRing.setLatLng([a.lat, a.lon]).setRadius(derived.limits.visibilityKm * 1000);
    // no devils in a dust storm: Gale's stopped during the 2018 storm, so hide them above tau_red (2D and 3D both follow active())
    devils.update(inputs.ltst >= C.dust_devil_peak_start_ltst && inputs.ltst <= C.dust_devil_peak_end_ltst && inputs.tau <= C.tau_red, a);
  }
  function render(store) {
    const { inputs, derived } = store;
    if (derived.visKey !== lastVisKey) { blindLayer.setUrl(drawOverlay(derived.vis)); lastVisKey = derived.visKey; }
    const a = inputs.astronaut;
    astro.setLatLng([a.lat, a.lon]);
    // keep the astronaut in view while the demo plays (view change only, no state write)
    if (inputs.scenarioT !== null && !$('map').hidden) map.panInside([a.lat, a.lon], { padding: [120, 120], animate: false });
    const h = Math.round(a.headingDeg / 5) * 5;
    if (h !== lastHeading) { astro.setIcon(astronautIcon(h)); lastHeading = h; }
    uncertainty.setLatLng([a.lat, a.lon]).setRadius(derived.posUncertaintyM);
    renderWeather(store);
    setRouteHome(derived.routeHome?.ok ? fromHere(derived.routeHome.points, a) : []);
    setRouteAlt(derived.routeAlt?.ok ? fromHere(derived.routeAlt.points, a) : []);
    setRouteOut(derived.routeOut?.ok ? fromHere(derived.routeOut.points, a) : []);
    view3d.render(store);
  }
  return { map, render };
}
