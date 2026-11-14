// Written with AI assistance (Claude / GitHub Copilot)
// Map renderer: Leaflet 2D view plus a lazily loaded A-Frame 3D view. Reads the store; the only writes are
// user clicks → onPickTarget (an action, not a subscriber). The 2D/3D toggle is local view state.

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/';
const TILE_PATH = '/1.0.0/default/default028mm/{z}/{y}/{x}.png';
const AFRAME_SRC = 'https://aframe.io/releases/1.6.0/aframe.min.js';
const TERRAIN_SRC = 'lib/terrain.js';
const MODELS_SRC = 'lib/models.js';
const MODEL_SCALE = 30; // rover/habitat drawn 30x real size so they read from km away (labelled on screen)
const ROVER_PARK_M = [14, 6]; // support rover parked beside the habitat [east, south], model metres
const EXAGGERATE = 2;
const ASTRO_R = 25, BEACON_H = 400, LIFT_M = 15, ROUTE_R = 10, STEP_M = 60;
const PITCH_MIN = 0.08, PITCH_MAX = 1.5, CAM_CLEARANCE_M = 40;
// 3D look (visual only; terrain tint + ground grain live in lib/terrain.js): sun placed from local solar time, slow idle orbit.
const SUN_DIST = 30000, IDLE_MS = 5000, IDLE_YAW_PER_S = 0.035;
const ZENITH_CLEAR = [128, 86, 62], LANDMARK_H = 180;
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
const M_PER_DEG = 2 * Math.PI * 3396190 / 360;
const DEVIL_SVG = '<svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="15"/><path d="M0-16A16 16 0 0 1 14 8M0 16A16 16 0 0 1-14-8"/><path d="M0-9A9 9 0 0 1 8 4M0 9A9 9 0 0 1-8-4"/></svg>';

// Moving dust devils: one rAF loop, runs only while visible (devil hours, 2D map shown, tab visible).
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
        .bindTooltip(`Dust-devil hours (illustrative, not a forecast). Drifting with the wind at ~${speedMs} m/s, shown ${DEVIL_TIMELAPSE}× faster.`)
        .addTo(layer);
      return { m, off };
    });
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const step = speedMs * DEVIL_TIMELAPSE * dt;
    for (const it of items) {
      const ll = it.m.getLatLng();
      let [lat, lon] = place(ll.lat, ll.lng, [Math.sin(rad) * step, Math.cos(rad) * step]);
      const dE = (lon - anchor.lon) * M_PER_DEG * Math.cos(anchor.lat * Math.PI / 180), dN = (lat - anchor.lat) * M_PER_DEG;
      if (Math.hypot(dE, dN) > DEVIL_RESPAWN_M) [lat, lon] = place(anchor.lat, anchor.lon, [-Math.sin(rad) * 2500 + it.off[1] * 0.5, -Math.cos(rad) * 2500 + it.off[0] * 0.5]);
      it.m.setLatLng([lat, lon]);
    }
    raf = requestAnimationFrame(frame);
  }
  const run = () => {
    cancelAnimationFrame(raf);
    if (on && !reduce && !document.hidden && !$('map').hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
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
    refresh: run
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

  L.control.layers(
    { 'Orbital imagery': ctx },
    { 'HiRISE close-up': hirise, 'Blind zones': blindLayer, 'Perseverance route': traverse, 'Landmarks': landmarkLayer, 'Science targets': targetLayer },
    { collapsed: true, position: 'topright' }
  ).addTo(map);
  L.control.scale({ metric: true, imperial: false }).addTo(map);
  return blindLayer;
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
    schema: { minDist: { default: 500 }, maxDist: { default: 25000 } },
    init() {
      this.o = { yaw: 0.6, pitch: 0.3, dist: 5200, x: 0, y: 0, z: 0 };
      this.lastInput = 0;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.heightAt = null;
      this.el.object3D.rotation.order = 'YXZ';
      const scene = this.el.sceneEl, pts = new Map();
      let pinch = 0;
      const span = () => { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
      const touched = () => { this.lastInput = performance.now(); };
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
    setTarget(x, y, z) { Object.assign(this.o, { x, y, z }); },
    tick(time, dt) {
      if (!this.reduced && time - this.lastInput > IDLE_MS && dt < 100) this.o.yaw += IDLE_YAW_PER_S * dt / 1000;
      const { yaw, pitch, dist, x, y, z } = this.o;
      const h = dist * Math.cos(pitch);
      const cx = x + h * Math.sin(yaw), cz = z + h * Math.cos(yaw);
      let cy = y + dist * Math.sin(pitch);
      const ground = this.heightAt?.(cx, cz);
      if (Number.isFinite(ground)) cy = Math.max(cy, ground + CAM_CLEARANCE_M);
      this.el.object3D.position.set(cx, cy, cz);
      this.el.object3D.rotation.set(-Math.atan2(cy - y, h), yaw, 0);
    }
  });
}

function mk(tag, attrs, parent) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.append(e);
  return e;
}

function buildScene() {
  const scene = document.createElement('a-scene');
  scene.setAttribute('embedded', '');
  scene.setAttribute('xr-mode-ui', 'enabled: false');
  scene.setAttribute('background', 'color: #e3a76a');
  const flat = color => `color: ${color}; shader: flat; side: double`;
  const hemi = mk('a-entity', { light: 'type: hemisphere; color: #ffd9b0; groundColor: #4a2a18; intensity: 0.75' }, scene);
  const sun = mk('a-entity', { light: 'type: directional; color: #fff1dc; intensity: 1.5', position: '-4000 5000 3000' }, scene);
  const sky = mk('a-sky', { radius: 60000, material: 'shader: flat; fog: false; color: #fff' }, scene);
  const astro = mk('a-entity', {}, scene);
  mk('a-cone', { 'radius-bottom': 0, 'radius-top': ASTRO_R, height: ASTRO_R * 2.4, position: `0 ${ASTRO_R * 1.2} 0`, material: flat(ACCENT) }, astro);
  mk('a-sphere', { radius: ASTRO_R * 0.9, position: `0 ${ASTRO_R * 3} 0`, material: flat(ACCENT) }, astro);
  return {
    scene, hemi, sun, sky, landmarks: mk('a-entity', {}, scene),
    terrain: mk('a-entity', { 'heightgrid-terrain': `exaggerate: ${EXAGGERATE}` }, scene),
    cam: mk('a-entity', { camera: 'fov: 55; near: 10; far: 80000', 'orbit-camera': '' }, scene),
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

function setRoute(s, terrain, name, route, color) {
  const old = s.routes.getObject3D(name);
  old?.geometry.dispose();
  if (!route?.ok || route.points.length < 2) { if (old) s.routes.removeObject3D(name); return; }
  const T = AFRAME.THREE;
  const pts = drape(terrain, route.points).map(p => new T.Vector3(p.x, p.y + LIFT_M, p.z));
  const geo = new T.TubeGeometry(new T.CatmullRomCurve3(pts), Math.min(pts.length * 2, 1200), ROUTE_R, 5, false);
  s.routes.setObject3D(name, new T.Mesh(geo, new T.MeshBasicMaterial({ color })));
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

// Sun from local solar time: rises east at 06:00, highest at noon, sets west at 18:00 (simple model, Jezero ~18°N).
function sunPosition(ltst) {
  const day = Math.min(1, Math.max(0, (ltst - 6) / 12));
  const el = Math.max(4, 72 * Math.sin(Math.PI * day)) * Math.PI / 180;
  const az = (90 + 180 * day) * Math.PI / 180; // from north, clockwise
  return [Math.sin(az) * Math.cos(el) * SUN_DIST, Math.sin(el) * SUN_DIST, -Math.cos(az) * Math.cos(el) * SUN_DIST];
}

function createView3D(data, onPickTarget) {
  const host = $('view3d'), msg = $('v3-msg');
  $('v3-note').textContent = `Vertical scale ×${EXAGGERATE} · rover and habitat ×${MODEL_SCALE} size`;
  let s = null, starting = null, terrain = null, last = null, lastHome, lastOut, lastRadius = -1, lastTau = null, lastSun = null, lastVis = null, blind3d = null;
  const say = text => { msg.textContent = text; msg.hidden = !text; };

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

  function update() {
    if (!terrain?.ready || !last) return;
    updateBlind(last.derived.vis, last.derived.visKey);
    const { inputs: { astronaut: a }, derived: d } = last;
    const p = terrain.toWorld(a.lat, a.lon);
    s.astro.object3D.position.set(p.x, p.y, p.z);
    s.ring.object3D.position.set(p.x, p.y + LIFT_M, p.z);
    const r = Math.max(5, Math.round(d.posUncertaintyM));
    if (r !== lastRadius) {
      lastRadius = r;
      s.ring.setAttribute('geometry', `primitive: ring; radiusInner: ${r - Math.max(4, r * 0.05)}; radiusOuter: ${r}; segmentsTheta: 64`);
    }
    const orbit = s.cam.components['orbit-camera'];
    if (orbit) { orbit.setTarget(p.x, p.y, p.z); orbit.heightAt = (x, z) => terrain.heightAt(x, z); }
    if (d.routeHome !== lastHome) { lastHome = d.routeHome; setRoute(s, terrain, 'home', d.routeHome, CREAM); }
    if (d.routeOut !== lastOut) { lastOut = d.routeOut; setRoute(s, terrain, 'out', d.routeOut, ACCENT); }
    const ltst = Math.round(last.inputs.ltst * 4) / 4;
    if (ltst !== lastSun) { lastSun = ltst; s.sun.setAttribute('position', sunPosition(ltst).map(Math.round).join(' ')); }
    const tau = Math.round(last.inputs.tau * 10) / 10;
    if (tau !== lastTau) {
      lastTau = tau;
      const f = Math.min(1, tau / TAU_DUSTY);
      const sky = SKY_CLEAR.map((c, i) => Math.round(c + (SKY_DUSTY[i] - c) * f));
      const color = `rgb(${sky.join(',')})`;
      const far = Math.max(3000, d.limits.visibilityKm * 1000);
      s.scene.setAttribute('background', `color: ${color}`);
      s.sky.setAttribute('material', `shader: flat; fog: false; src: url(${skyGradient(sky, f)})`);
      s.sun.setAttribute('light', 'intensity', (1.6 * Math.exp(-tau / 5) + 0.25).toFixed(2));
      s.hemi.setAttribute('light', 'intensity', (0.7 + 0.25 * f).toFixed(2));
      s.scene.setAttribute('fog', `type: linear; color: ${color}; near: ${Math.round(far * 0.15)}; far: ${Math.round(far)}`);
      host.style.background = color;
    }
  }

  async function init() {
    say('Loading 3D terrain…');
    try {
      if (!window.AFRAME) await loadScript(AFRAME_SRC);
      await loadScript(TERRAIN_SRC);
      await loadScript(MODELS_SRC);
    } catch (err) { say(`3D view unavailable: ${err.message}`); starting = null; return; }
    registerOrbit();
    s = buildScene();
    s.terrain.addEventListener('terrain-loaded', e => {
      terrain = e.detail;
      say('');
      s.home.object3D.position.set(0, terrain.heightAt(0, 0) + BEACON_H / 2, 0);
      const h0 = terrain.heightAt(0, 0);
      mk('a-entity', { 'mars-habitat': `scale: ${MODEL_SCALE}`, position: `0 ${h0} 0` }, s.scene);
      const [rx, rz] = ROVER_PARK_M.map(v => v * MODEL_SCALE);
      mk('a-entity', { 'mars-rover': `scale: ${MODEL_SCALE}`, position: `${rx} ${terrain.heightAt(rx, rz)} ${rz}`, rotation: '0 -30 0' }, s.scene);
      const end = data.traverse?.at?.(-1); // Perseverance's latest position on its real traverse
      if (end) {
        const q = terrain.toWorld(end[0] ?? end.lat, end[1] ?? end.lon);
        if (Number.isFinite(q.y)) mk('a-entity', { 'mars-rover': `scale: ${MODEL_SCALE}`, position: `${q.x} ${q.y} ${q.z}`, rotation: '0 70 0' }, s.scene);
      }
      for (const lm of data.landmarks ?? []) {
        if (lm.id === 'home') continue;
        const q = terrain.toWorld(lm.lat, lm.lon);
        const pin = mk('a-entity', { position: `${q.x} ${q.y} ${q.z}` }, s.landmarks);
        mk('a-cylinder', { radius: 3, height: LANDMARK_H, position: `0 ${LANDMARK_H / 2} 0`, material: 'color: #fff4e0; shader: flat' }, pin);
        mk('a-sphere', { radius: 14, position: `0 ${LANDMARK_H} 0`, material: 'color: #fff4e0; shader: flat' }, pin);
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
    s.terrain.addEventListener('terrain-error', e => say(`3D terrain failed: ${e.detail?.message ?? 'unknown error'}`));
    s.scene.addEventListener('loaded', () => { if (host.hidden) s.scene.pause(); update(); });
    host.prepend(s.scene);
  }

  return {
    show() {
      host.hidden = false;
      if (s) { if (s.scene.hasLoaded) s.scene.play(); } else starting ??= init();
    },
    hide() { host.hidden = true; if (s?.scene.hasLoaded) s.scene.pause(); },
    render(store) { last = store; update(); }
  };
}

function setupToggle(map, view3d) {
  const b2 = $('v-2d'), b3 = $('v-3d');
  const set = is3d => {
    b2.setAttribute('aria-pressed', String(!is3d));
    b3.setAttribute('aria-pressed', String(is3d));
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

  const blindLayer = addLayers(map, data, box, onPickTarget);
  const setRouteAlt = routeLine(map, CREAM, 2, '4 6'); // comparison route, created first so orange stays on top
  const setRouteOut = routeLine(map, ACCENT, 4);
  const setRouteHome = routeLine(map, CREAM, 3, '8 6');
  const haze = L.rectangle(box, { stroke: false, fillColor: DUST, fillOpacity: 0, interactive: false }).addTo(map);
  const seeRing = L.circle([0, 0], { radius: 1000, color: DUST, weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
  const devils = createDevils(map, data.C);
  const uncertainty = L.circle([0, 0], { radius: 30, color: CREAM, weight: 1.5, fillColor: CREAM, fillOpacity: 0.12 }).addTo(map);
  const astro = L.marker([0, 0], { icon: astronautIcon(0), keyboard: false, zIndexOffset: 1000 }).addTo(map);
  map.on('click', e => onPickTarget({ lat: e.latlng.lat, lon: e.latlng.lng }));

  const view3d = createView3D(data, onPickTarget);
  setupToggle(map, view3d);
  for (const id of ['v-2d', 'v-3d']) $(id).addEventListener('click', () => devils.refresh()); // pause/resume the devil loop

  let lastVisKey = null, lastHeading = null;
  function renderWeather({ inputs, derived }) {
    const C = store0.data.C, a = inputs.astronaut;
    haze.setStyle({ fillOpacity: Math.min(HAZE_MAX, inputs.tau * HAZE_PER_TAU) });
    seeRing.setLatLng([a.lat, a.lon]).setRadius(derived.limits.visibilityKm * 1000);
    devils.update(inputs.ltst >= C.dust_devil_peak_start_ltst && inputs.ltst <= C.dust_devil_peak_end_ltst, a);
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
    setRouteHome(derived.routeHome?.ok ? derived.routeHome.points : []);
    setRouteAlt(derived.routeAlt?.ok ? derived.routeAlt.points : []);
    setRouteOut(derived.routeOut?.ok ? derived.routeOut.points : []);
    view3d.render(store);
  }
  return { map, render };
}
