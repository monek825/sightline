// Written with AI assistance (Claude / GitHub Copilot)
// Helmet view: overlays on top of the shared terrain (lib/terrain.js). Reads state only; never computes science.
// World: x = east m, z = south m, y = up, home = (0,0,0). All lat/lon placement goes through terrain.toWorld.
import { deg2rad, bearingDeg, distM } from '../lib/geo.js';

const $ = (id) => document.getElementById(id);
const STATE_V = 1;
// Rendering constants (not science): README "Scene" and "Overlays".
const FOG_NEAR_M = 200, FOG_FAR_MAX_M = 30000;
const BEACON_H_M = 200, BEACON_R_M = 3, BEACON_LABEL_Y = 60;
const LOS_STEP_M = 20;
const ROUTE_STEP_M = 15, ROUTE_W_M = 1.5, ROUTE_W_STORM_M = 2.5, ROUTE_LIFT_M = 0.25, POST_EVERY_M = 75, MAX_ROUTE_PTS = 5000;
const OFFSCREEN_X = 0.92;
// Visual-only constants (colours, sizes, animation times). No science numbers here.
const HABITAT_CLEAR_M = 16;       // the habitat model is ~14 m wide: start views stand just outside it, facing it
const ROVER_PARK_M = [14, 6];     // support rover beside the habitat [east, south], metres (same as the main 3D view)
const ROUTE_FADE_M = 10;          // route ribbon fades in over its first metres so it is not huge at the feet
const CAM_SMOOTH_S = 0.25, CAM_SNAP_M = 400, MAX_DT_S = 0.1;
const BEACON_PULSE_S = 3.2;
const NEAR_HOME_M = 60;           // visual: this close to the habitat you can see it, so the beacon pillar and HOME label are hidden
const SKY_CLEAR = [227, 167, 106], SKY_DUSTY = [168, 120, 84], ZENITH_CLEAR = [128, 86, 62], TAU_DUSTY = 8, SUN_DIST = 30000;
const LTST_DEFAULT = 9.0;
// Realism layer (visual only). Rocks: instanced dodecahedra scattered around the camera, hashed per world-grid cell so they stay put.
const ROCK_COUNT = 1500, ROCK_RADIUS_M = 60, ROCK_CELL_M = 5, ROCK_RESCATTER_M = 25, ROCK_CLEAR_HOME_M = 20;
const ROCK_MIN_M = 0.08, ROCK_MAX_M = 0.7, ROCK_COLOR = 0x8a6a52;
// Sun shadows (rocks + models cast, terrain receives). One switch; auto-off if frames are slow.
const SHADOWS = true;
const SHADOW_MAP = 1024, SHADOW_HALF_M = 110, SHADOW_STEP_M = 35, SHADOW_SNAP_M = 20, SHADOW_LIGHT_DIST_M = 1500;
const SHADOW_WARMUP_MS = 2500, SHADOW_PROBE_MS = 4000, SHADOW_MAX_AVG_MS = 22;
// Compass tape: 3 turns of 360 deg at TAPE_PX_PER_DEG px per degree (must match the 4320 px width in helmet.css)
const TAPE_PX_PER_DEG = 4, TAPE_TURNS = 3;
const BEACON_DASH_REPEAT = 24;     // dashes along the pillar when home is hidden behind terrain
const LABEL_H = 22, LABEL_CHAR_W = 7.4, LABEL_PAD = 14, LABEL_STAGGER = [0, -24, 24];

const inIframe = window.parent !== window;
const params = new URLSearchParams(location.search);

let meta = null, terrain = null, landmarks = [], constants = null;
let pending = null;               // latest valid state message
let current = null;               // state applied to the scene
let haveState = false, fatal = null;
let homeInfo = { distM: 0, bearing: 0, hidden: false, beyondVis: false };
const lmEls = [];                 // { lm, label, pole, ... }
let lmOrder = [];                 // visible landmarks, nearest first (for label de-cluttering)
let boxX = new Float32Array(2), boxY = new Float32Array(2), boxW = new Float32Array(2), boxH = new Float32Array(2);
let routeKey = '', routeObj = null, constP = Promise.resolve(), traverseP = Promise.resolve(null);
const reduceMotionQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
// camera target (smoothed towards in frame())
const camT = { x: 0, z: 0, yaw: 0, eye: 1.7, snap: true };
let envKey = '', lastLevel = null, homeTxtKey = '', homeCls = '';
let skyCtx = null, skyTex = null, skyMesh = null, beacon = null, beaconMat = null, lmPoleGeo = null, lmPoleMat = null;
let sunEl = null, hemiEl = null, terrainEl = null;
let rocks = null, rockCx = 1e9, rockCz = 1e9, beaconDash = null, dashMat = null;
let shadowOn = false, shadowCx = 1e9, shadowCz = 1e9, shadowDirty = true, shadowLight = null, shadowTarget = null, shadowT0 = -1, shadowSum = 0, shadowN = 0;
const sunDir = [0.5, 0.7, 0.5];
let stripW = 600, tapeX = NaN, headTxt = -1, homeTapeX = NaN, homeTapeCls = '';
let fpsEl = null, fpsT = new Float32Array(512), fpsD = new Float32Array(512), fpsI = 0, fpsNext = 0;
let vw = innerWidth, vh = innerHeight;
addEventListener('resize', () => { vw = innerWidth; vh = innerHeight; const s = $('strip'); if (s) stripW = s.clientWidth; });

// ---------- state card (waiting / loading / error) ----------
function renderCard() {
  const card = $('state-card');
  let title = '', detail = '', err = false;
  if (fatal) { title = 'Helmet view error'; detail = fatal; err = true; }
  else if (!meta || !terrain) { title = 'Loading terrain…'; detail = 'Reading data/heightgrid.json and data/meta.json'; }
  else if (!haveState) {
    title = 'Waiting for data from the main app…';
    detail = inIframe ? 'No state received yet. If this stays, close and reopen the helmet view.' : '';
  }
  card.hidden = !title;
  card.classList.toggle('error', err);
  $('state-title').textContent = title;
  $('state-detail').textContent = detail;
}
function fail(msg) { fatal = msg; renderCard(); }
function note(text) {
  const d = document.createElement('div');
  d.textContent = text;
  $('notes').appendChild(d);
}

// ---------- helpers ----------
const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const fetchJSON = (url) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.json();
});

function validState(m) {
  const a = m.inputs && m.inputs.astronaut;
  if (!a || !fin(a.lat) || !fin(a.lon)) return false;
  const lim = m.derived && m.derived.limits;
  if (!lim || !fin(lim.visibilityKm)) return false;
  return true;
}

// "NASA data" / "Estimate" for a list of constant keys (from data/crew_constants.json isEstimate flags)
function sourceTag(keys) {
  if (!constants || !Array.isArray(keys) || !keys.length) return '';
  const rows = keys.map((k) => constants.get(k)).filter(Boolean);
  if (!rows.length) return '';
  if (rows.every((r) => r.isEstimate === false)) return 'NASA data';
  if (rows.every((r) => r.isEstimate === true)) return 'Estimate';
  return 'NASA data + estimate';
}

// ---------- scene setup ----------
const sceneEl = $('scene'), rig = $('rig'), camEl = $('cam');
let THREE = null, routeHolder = null;
const tmpV = new (window.AFRAME ? AFRAME.THREE.Vector3 : Object)();

// Sun from local solar time (same simple model as the main 3D view): rises east 06:00, highest at noon, sets west 18:00.
function sunPosition(ltst) {
  const day = Math.min(1, Math.max(0, (ltst - 6) / 12));
  const el = Math.max(4, 72 * Math.sin(Math.PI * day)) * Math.PI / 180;
  const az = (90 + 180 * day) * Math.PI / 180; // from north, clockwise
  return [Math.sin(az) * Math.cos(el) * SUN_DIST, Math.sin(el) * SUN_DIST, -Math.cos(az) * Math.cos(el) * SUN_DIST];
}

// Sky sphere (own three.js mesh: one canvas texture redrawn when dust changes; no A-Frame material schema involved).
function makeSky() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  skyCtx = c.getContext('2d');
  skyTex = new THREE.CanvasTexture(c);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(50000, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -1;
  sceneEl.object3D.add(skyMesh);
}

// Dust look from tau, sun from ltst, fog from visibility. Only redone when the rounded inputs change.
function setEnv(tau, ltst, visKm) {
  const t = fin(tau) ? Math.round(tau * 10) / 10 : 0.4;
  const l = fin(ltst) ? Math.round(ltst * 4) / 4 : LTST_DEFAULT;
  const v = Math.round(visKm * 10) / 10;
  const key = t + '|' + l + '|' + v;
  if (key === envKey) return;
  envKey = key;
  const f = Math.min(1, t / TAU_DUSTY);
  const hor = SKY_CLEAR.map((c, i) => Math.round(c + (SKY_DUSTY[i] - c) * f));
  const zen = ZENITH_CLEAR.map((c, i) => Math.round(c + (hor[i] - c) * f));
  const horCss = `rgb(${hor.join(',')})`;
  if (skyCtx) {
    const g = skyCtx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, `rgb(${zen.join(',')})`); g.addColorStop(0.5, horCss); g.addColorStop(1, horCss);
    skyCtx.fillStyle = g; skyCtx.fillRect(0, 0, 2, 256);
    skyTex.needsUpdate = true;
  }
  if (sunEl) {
    const sp = sunPosition(l);
    sunEl.setAttribute('position', sp.map(Math.round).join(' '));
    for (let i = 0; i < 3; i++) sunDir[i] = sp[i] / SUN_DIST;
    shadowDirty = true;
    sunEl.setAttribute('light', 'intensity', (1.6 * Math.exp(-t / 5) + 0.25).toFixed(2));
  }
  if (hemiEl) hemiEl.setAttribute('light', 'intensity', (0.7 + 0.25 * f).toFixed(2));
  const far = Math.min(FOG_FAR_MAX_M, Math.max(FOG_NEAR_M + 50, v * 1000));
  const near = Math.min(FOG_NEAR_M, Math.round(far * 0.15));
  sceneEl.setAttribute('fog', `type: linear; color: ${horCss}; near: ${near}; far: ${Math.round(far)}`);
}

// Home beacon: plain three.js mesh so fog:false / depthTest:false really apply (A-Frame warned about material props set too early).
function makeBeacon() {
  beaconMat = new THREE.MeshBasicMaterial({ color: 0x56d4ff, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
  beacon = new THREE.Mesh(new THREE.CylinderGeometry(BEACON_R_M, BEACON_R_M, BEACON_H_M, 16, 1, true), beaconMat);
  beacon.position.set(0, terrain.heightAt(0, 0) + BEACON_H_M / 2, 0);
  beacon.renderOrder = 999;
  beacon.frustumCulled = false;
  sceneEl.object3D.add(beacon);
  // hidden-behind-terrain variant: same pillar, dimmer, striped alpha so it reads as dashed
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 4, 64);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, BEACON_DASH_REPEAT);
  dashMat = new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.3, alphaMap: tex, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
  beaconDash = new THREE.Mesh(beacon.geometry, dashMat);
  beaconDash.position.copy(beacon.position);
  beaconDash.renderOrder = 999;
  beaconDash.frustumCulled = false;
  beaconDash.visible = false;
  sceneEl.object3D.add(beaconDash);
}

// ---------- rocks: one InstancedMesh, deterministic per world-grid cell ----------
const rockDummy = { o: null, c: null };
function hash01(ix, iz, salt) {      // integer hash -> [0,1)
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function makeRocks() {
  const cap = Math.ceil(ROCK_COUNT * 1.2);
  const mat = new THREE.MeshStandardMaterial({ color: ROCK_COLOR, roughness: 1, metalness: 0, flatShading: true });
  rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat, cap);
  rocks.frustumCulled = false;      // instances move on re-scatter; bounding sphere would go stale
  rocks.count = 0;
  rocks.castShadow = true; rocks.receiveShadow = true;
  rockDummy.o = new THREE.Object3D();
  rockDummy.c = new THREE.Color();
  rocks.setColorAt(0, rockDummy.c.setRGB(1, 1, 1));   // allocates the colour buffer once
  sceneEl.object3D.add(rocks);
}
function scatterRocks(cx, cz) {
  rockCx = cx; rockCz = cz;
  const cap = rocks.instanceMatrix.count;
  const perCell = ROCK_COUNT / (Math.PI * ROCK_RADIUS_M * ROCK_RADIUS_M / (ROCK_CELL_M * ROCK_CELL_M));
  const i0 = Math.floor((cx - ROCK_RADIUS_M) / ROCK_CELL_M), i1 = Math.floor((cx + ROCK_RADIUS_M) / ROCK_CELL_M);
  const j0 = Math.floor((cz - ROCK_RADIUS_M) / ROCK_CELL_M), j1 = Math.floor((cz + ROCK_RADIUS_M) / ROCK_CELL_M);
  const o = rockDummy.o, col = rockDummy.c, r2 = ROCK_RADIUS_M * ROCK_RADIUS_M, clr2 = ROCK_CLEAR_HOME_M * ROCK_CLEAR_HOME_M;
  let n = 0;
  for (let j = j0; j <= j1 && n < cap; j++) for (let i = i0; i <= i1 && n < cap; i++) {
    const k = Math.floor(perCell + hash01(i, j, 1));
    for (let q = 0; q < k && n < cap; q++) {
      const x = (i + hash01(i, j, 10 + q * 9)) * ROCK_CELL_M, z = (j + hash01(i, j, 11 + q * 9)) * ROCK_CELL_M;
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > r2 || x * x + z * z < clr2) continue;
      const u = hash01(i, j, 12 + q * 9), sz = ROCK_MIN_M + (ROCK_MAX_M - ROCK_MIN_M) * u * u;   // many pebbles, few boulders
      const sq = hash01(i, j, 13 + q * 9), sq2 = hash01(i, j, 14 + q * 9);
      const sy = sz * (0.45 + 0.4 * sq);
      const g = terrain.heightAt(x, z);
      o.position.set(x, (fin(g) ? g : 0) + sy * 0.25, z);     // slightly sunk
      o.rotation.set(hash01(i, j, 15 + q * 9) * 6.283, hash01(i, j, 16 + q * 9) * 6.283, hash01(i, j, 17 + q * 9) * 6.283);
      o.scale.set(sz * (0.8 + 0.5 * sq2), sy, sz * (0.8 + 0.5 * (1 - sq)));
      o.updateMatrix();
      rocks.setMatrixAt(n, o.matrix);
      const v = 0.7 + 0.4 * hash01(i, j, 18 + q * 9);
      rocks.setColorAt(n, col.setRGB(v, v * 0.97, v * 0.94));
      n++;
    }
  }
  rocks.count = n;
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  shadowDirty = true;
}

// ---------- sun shadows ----------
function setupShadows() {
  if (!SHADOWS || shadowOn || !sceneEl.renderer || !sceneEl.systems || !sceneEl.systems.shadow) return;
  const tm = terrain && terrainEl && terrainEl.getObject3D('mesh');
  if (!tm || !sunEl) return;                    // terrain mesh must be reachable, else no shadows
  try {
    sunEl.setAttribute('light', { castShadow: true, shadowMapWidth: SHADOW_MAP, shadowMapHeight: SHADOW_MAP,
      shadowCameraLeft: -SHADOW_HALF_M, shadowCameraRight: SHADOW_HALF_M, shadowCameraTop: SHADOW_HALF_M, shadowCameraBottom: -SHADOW_HALF_M,
      shadowCameraNear: 1, shadowCameraFar: SHADOW_LIGHT_DIST_M * 2, shadowBias: -0.0006 });
    shadowLight = sunEl.getObject3D('light');
    if (!shadowLight || !shadowLight.shadow) return;
    shadowLight.shadow.normalBias = 0.3;
    shadowTarget = new THREE.Object3D();
    sceneEl.object3D.add(shadowTarget);
    shadowLight.target = shadowTarget;
    tm.receiveShadow = true;                    // terrain only receives (it would be the costly caster)
    sceneEl.renderer.shadowMap.autoUpdate = false;   // re-render the map only when the sun or the camera step moves it
    sceneEl.systems.shadow.setShadowMapEnabled(true);  // also flags all materials for recompile
    shadowOn = true; shadowDirty = true; shadowCx = 1e9; shadowT0 = -1;
    flagCasters();
  } catch (e) { console.warn('helmet: shadows unavailable', e); disableShadows(); }
}
const casterEls = [];
function flagCasters() {
  if (!shadowOn) return;
  for (const el of casterEls) {
    el.object3D.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  shadowDirty = true;
}
function disableShadows() {
  if (!shadowOn && !shadowLight) return;
  shadowOn = false;
  try {
    if (sunEl) {
      sunEl.setAttribute('light', 'castShadow', false);
      sunEl.setAttribute('position', sunDir.map((v) => Math.round(v * SUN_DIST)).join(' '));
      sunEl.object3D.position.set(sunDir[0] * SUN_DIST, sunDir[1] * SUN_DIST, sunDir[2] * SUN_DIST);
    }
    if (shadowLight) shadowLight.castShadow = false;
    if (shadowTarget) shadowTarget.position.set(0, 0, 0);
    if (sceneEl.systems && sceneEl.systems.shadow) sceneEl.systems.shadow.setShadowMapEnabled(false);
  } catch (e) { /* keep rendering */ }
  console.info('helmet: shadows switched off (slow frames or unavailable)');
}
// per frame: cheap. Moves the shadow window in steps and re-renders the map only then; also watches frame time.
function updateShadows(cx, cy, cz, timeMs, dt) {
  if (!shadowOn) return;
  if (Math.hypot(cx - shadowCx, cz - shadowCz) > SHADOW_STEP_M || shadowDirty) {
    shadowDirty = false;
    shadowCx = Math.round(cx / SHADOW_SNAP_M) * SHADOW_SNAP_M; shadowCz = Math.round(cz / SHADOW_SNAP_M) * SHADOW_SNAP_M;
    const gy = terrain.heightAt(shadowCx, shadowCz);
    const ty = fin(gy) ? gy : cy;
    shadowTarget.position.set(shadowCx, ty, shadowCz);
    sunEl.object3D.position.set(shadowCx + sunDir[0] * SHADOW_LIGHT_DIST_M, ty + sunDir[1] * SHADOW_LIGHT_DIST_M, shadowCz + sunDir[2] * SHADOW_LIGHT_DIST_M);
    sceneEl.renderer.shadowMap.needsUpdate = true;
  }
  // auto-off: average frame time after a warm-up (compiles / texture uploads are slow)
  if (shadowT0 < 0) { shadowT0 = timeMs; shadowSum = 0; shadowN = 0; }
  const el = timeMs - shadowT0;
  if (el > SHADOW_WARMUP_MS && dt < 250) { shadowSum += dt; shadowN++; }
  if (el > SHADOW_WARMUP_MS + SHADOW_PROBE_MS) {
    if (shadowN > 20 && shadowSum / shadowN > SHADOW_MAX_AVG_MS) disableShadows();
    else shadowT0 = 1e12;     // verdict: keep them
  }
}

// ---------- ?fps=1 meter: average fps and worst frame over the last 2 s ----------
function fpsTick(timeMs, dt) {
  if (!fpsEl) return;
  fpsT[fpsI] = timeMs; fpsD[fpsI] = dt; fpsI = (fpsI + 1) & 511;
  if (timeMs < fpsNext) return;
  fpsNext = timeMs + 500;
  let sum = 0, n = 0, worst = 0;
  for (let i = 0; i < 512; i++) if (fpsT[i] > timeMs - 2000) { sum += fpsD[i]; n++; if (fpsD[i] > worst) worst = fpsD[i]; }
  if (n) fpsEl.textContent = (1000 * n / sum).toFixed(0) + ' fps  worst ' + worst.toFixed(0) + ' ms' + (shadowOn ? '  shadows' : '');
}

function placeModel(name, x, y, z, rotY) {
  if (!AFRAME.components[name]) { note('Model ' + name + ' unavailable (lib/models.js not loaded).'); return; }
  const el = document.createElement('a-entity');
  el.setAttribute(name, 'scale: 1');
  el.setAttribute('position', `${x} ${y} ${z}`);
  el.setAttribute('rotation', `0 ${rotY} 0`);
  sceneEl.appendChild(el);
  casterEls.push(el);
  [600, 2000, 5000].forEach((ms) => setTimeout(flagCasters, ms));   // model parts are child entities that attach a little later
}
function makeModels() {
  const h0 = terrain.heightAt(0, 0);
  placeModel('mars-habitat', 0, h0, 0, 0);
  const [rx, rz] = ROVER_PARK_M;
  placeModel('mars-rover', rx, terrain.heightAt(rx, rz), rz, -30);
  // Perseverance at its latest real position (last point of data/traverse.json)
  traverseP.then((tr) => {
    const q = Array.isArray(tr) && tr.length ? tr[tr.length - 1] : null;
    if (!q || !fin(q.lat) || !fin(q.lon)) return;
    const p = terrain.toWorld(q.lat, q.lon);
    if (fin(p.x) && fin(p.y) && fin(p.z)) placeModel('mars-rover', p.x, p.y, p.z, 120);
  });
}

function makeLandmarks() {
  const holder = $('landmark-labels');
  if (!lmPoleGeo) {
    lmPoleGeo = new THREE.CylinderGeometry(1.5, 1.5, 60, 8);
    lmPoleMat = new THREE.MeshBasicMaterial({ color: 0xfff3d6 });
  }
  for (const lm of landmarks) {
    if (lm.id === 'home' || !fin(lm.lat) || !fin(lm.lon)) continue;
    const p = terrain.toWorld(lm.lat, lm.lon);
    const pole = new THREE.Mesh(lmPoleGeo, lmPoleMat);
    pole.position.set(p.x, p.y + 30, p.z);
    pole.visible = false;
    sceneEl.object3D.add(pole);
    const label = document.createElement('div');
    label.className = 'mark';
    label.hidden = true;
    holder.appendChild(label);
    lmEls.push({ lm, label, pole, pos: { x: p.x, y: p.y + 70, z: p.z }, km: 0, show: false, vis: false, w: 60, text: '', px: -1, py: -1 });
  }
  const n = lmEls.length + 2;
  boxX = new Float32Array(n); boxY = new Float32Array(n); boxW = new Float32Array(n); boxH = new Float32Array(n);
}

// landmark names end with their distance from home ("Butte NE 3.0 km"); the label shows distance from the astronaut instead
const shortName = (n) => String(n).replace(/\s+\d+(\.\d+)?\s*km$/, '');

// ---------- route on the ground ----------
function clearRoute() {
  if (!routeHolder) return;
  routeHolder.object3D.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); if (o.isInstancedMesh) o.dispose(); });
  if (routeObj) routeHolder.removeObject3D('route');
  routeObj = null;
}
function buildRoute(points, storm) {
  clearRoute();
  if (!terrain || !routeHolder || !Array.isArray(points)) return;
  const raw = [];
  for (const q of points) if (Array.isArray(q) && fin(q[0]) && fin(q[1])) raw.push(terrain.toWorld(q[0], q[1]));
  if (raw.length < 2 || raw.length > MAX_ROUTE_PTS) return;
  const dense = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const a = raw[i], b = raw[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / ROUTE_STEP_M));
    for (let k = 0; k < n; k++) {
      const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n;
      dense.push({ x, z, y: terrain.heightAt(x, z) + ROUTE_LIFT_M });
    }
  }
  const e = raw[raw.length - 1];
  dense.push({ x: e.x, z: e.z, y: terrain.heightAt(e.x, e.z) + ROUTE_LIFT_M });
  const half = (storm ? ROUTE_W_STORM_M : ROUTE_W_M) / 2;
  const pos = new Float32Array(dense.length * 6), col = new Float32Array(dense.length * 8), idx = [];
  // the first ~10 m fade in (alpha) and taper (width): perspective makes the ribbon huge right at the feet
  let s = 0;
  dense.forEach((p, i) => {
    if (i > 0) s += Math.hypot(p.x - dense[i - 1].x, p.z - dense[i - 1].z);
    const t = Math.min(1, s / ROUTE_FADE_M), a = Math.min(1, Math.max(0, (s - 2) / (ROUTE_FADE_M - 2)));
    const w = half * (0.3 + 0.7 * t);
    const p0 = dense[Math.max(0, i - 1)], p1 = dense[Math.min(dense.length - 1, i + 1)];
    let tx = p1.x - p0.x, tz = p1.z - p0.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    pos.set([p.x - tz * w, p.y, p.z + tx * w, p.x + tz * w, p.y, p.z - tx * w], i * 6);
    col.set([1, 1, 1, a, 1, 1, 1, a], i * 8);
    if (i < dense.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));   // itemSize 4 = per-vertex alpha
  g.setIndex(idx);
  const color = storm ? 0xff4d4d : 0xffb020;
  const mat = new THREE.MeshBasicMaterial({ color, vertexColors: true, side: THREE.DoubleSide, fog: false, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, mat));
  // posts so the line stays readable at eye height (a flat strip is nearly edge-on from 1.7 m)
  const posts = [];
  let acc = POST_EVERY_M - 20;   // no post at the feet; the first one stands ~20 m ahead
  for (let i = 1; i < dense.length; i++) {
    acc += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
    if (acc >= POST_EVERY_M) { posts.push(dense[i]); acc = 0; }
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 3, 0.6), new THREE.MeshBasicMaterial({ color, fog: false }), posts.length);
  const m4 = new THREE.Matrix4();
  posts.forEach((p, i) => { m4.setPosition(p.x, p.y + 1.5, p.z); inst.setMatrixAt(i, m4); });
  group.add(inst);
  routeHolder.setObject3D('route', group);
  routeObj = group;
}

// ---------- line of sight (camera eye -> habitat top, against terrain heights) ----------
function lineOfSightBlocked(ex, ey, ez, ty) {
  const d = Math.hypot(ex, ez);
  if (d < 5) return false;
  const n = Math.ceil(d / LOS_STEP_M);
  for (let i = 1; i < n; i++) {
    const t = i / n, x = ex * (1 - t), z = ez * (1 - t), y = ey + (ty - ey) * t;
    if (terrain.heightAt(x, z) > y) return true;
  }
  return false;
}

// ---------- apply state ----------
function apply(m) {
  current = m;
  const { inputs, derived } = m;
  const a = inputs.astronaut, eye = fin(meta.eyeHeightM) ? meta.eyeHeightM : 1.7;
  const p = terrain.toWorld(a.lat, a.lon);
  const hdg = fin(a.headingDeg) ? a.headingDeg : 0;
  // camera target. Standing on the habitat itself would put the eye inside the dome model, so within
  // HABITAT_CLEAR_M of home the view is pushed outward (away from home; opposite the heading at the very centre).
  let tx = p.x, tz = p.z;
  const dh = Math.hypot(p.x, p.z);
  if (dh < HABITAT_CLEAR_M) {
    const hr = deg2rad(hdg);
    const ux = dh > 0.5 ? p.x / dh : -Math.sin(hr), uz = dh > 0.5 ? p.z / dh : Math.cos(hr);
    tx += ux * (HABITAT_CLEAR_M - dh); tz += uz * (HABITAT_CLEAR_M - dh);
  }
  camT.x = tx; camT.z = tz; camT.yaw = -deg2rad(hdg); camT.eye = eye;
  setEnv(inputs.tau, inputs.ltst, derived.limits.visibilityKm);

  // home distance / bearing / line of sight
  const h = meta.home;
  const dm = distM(a.lat, a.lon, h.lat, h.lon);
  homeInfo = {
    distM: dm, bearing: bearingDeg(a.lat, a.lon, h.lat, h.lon),
    hidden: lineOfSightBlocked(p.x, p.y + eye, p.z, (fin(h.heightM) ? h.heightM : 0)),
    beyondVis: dm / 1000 > derived.limits.visibilityKm
  };

  hud(inputs, derived);
  landmarkVisibility(a, derived.limits.visibilityKm);

  // route
  const r = derived.routeHome;
  const storm = !!inputs.sepActive;
  const key = r && r.ok && Array.isArray(r.points)
    ? [r.points.length, r.points[0], r.points[r.points.length - 1], storm].join('|') : 'none|' + storm;
  if (key !== routeKey) { routeKey = key; if (r && r.ok) buildRoute(r.points, storm); else clearRoute(); }
}

const LVL_RANK = { RED: 0, AMBER: 1, GREEN: 2 };
function hud(inputs, derived) {
  const b = derived.budget, lim = derived.limits;
  const panel = $('panel-status');
  const sub = $('hud-sub'), turnRow = $('row-turn');
  if (b) {
    panel.dataset.level = b.status;
    if (lastLevel !== null && lastLevel !== b.status) {      // short pop when GO / TURN BACK / RETURN NOW changes
      const hl = $('hud-headline');
      hl.classList.remove('pop'); void hl.offsetWidth; hl.classList.add('pop');
    }
    lastLevel = b.status;
    $('hud-headline').textContent = b.headline;
    sub.hidden = true;
    $('time-suit').textContent = Math.round(b.suitMinLeft) + ' min';
    $('time-home').textContent = Math.round(b.returnMin) + ' min';
    const showTurn = fin(b.turnBackInMin) && b.status !== 'RED';
    turnRow.hidden = !showTurn;
    if (showTurn) $('time-turn').textContent = Math.round(b.turnBackInMin) + ' min';
    const suit = (b.factors || []).find((f) => f.id === 'suit_time');
    const tag = suit ? sourceTag(suit.keys) : '';
    $('hud-tag').textContent = tag ? 'Suit-time figures: ' + tag : '';
    // at most 3 lines, worst level first (display order only)
    const fs = (b.factors || []).slice().sort((p, q) => (LVL_RANK[p.level] ?? 3) - (LVL_RANK[q.level] ?? 3)).slice(0, 3);
    const list = $('factors'); list.textContent = '';
    fs.forEach((f) => {
      const li = document.createElement('li');
      const l = document.createElement('span'); l.className = 'lvl ' + f.level; l.textContent = f.level;
      const t = document.createElement('span'); t.className = 'txt'; t.textContent = f.label + ': ' + f.message;
      li.title = f.label + ': ' + f.message;
      li.append(l, t);
      const tg = sourceTag(f.keys);
      if (tg) { const s = document.createElement('span'); s.className = 'src'; s.textContent = tg; li.appendChild(s); }
      list.appendChild(li);
    });
    $('panel-factors').hidden = !fs.length;
  } else {
    panel.dataset.level = 'none';
    lastLevel = null;
    $('hud-headline').textContent = 'PREVIEW';
    sub.textContent = 'No live walk budget. Open from the main app.';
    sub.hidden = false;
    $('time-suit').textContent = '—'; $('time-home').textContent = '—';
    turnRow.hidden = true;
    $('hud-tag').textContent = '';
    $('panel-factors').hidden = true;
  }
  const storm = !!inputs.sepActive;
  const banner = $('storm');
  banner.hidden = !storm;
  if (storm) banner.textContent = 'SOLAR PARTICLE EVENT — follow the red route to the habitat';

  $('env-tau').textContent = fin(inputs.tau) ? inputs.tau.toFixed(1) : '—';
  $('env-vis').textContent = Math.round(lim.visibilityKm) + ' km';
  $('env-unc').textContent = fin(derived.posUncertaintyM) ? '± ' + Math.round(derived.posUncertaintyM) + ' m' : '—';
  const r = derived.routeHome;
  $('env-route').textContent = r && r.ok === false ? 'No safe route: ' + (r.reason || 'unknown reason') : '';
  // bottom-centre card: distance + bearing, and why the habitat may not be visible
  $('home-dist').textContent = 'Home ' + (homeInfo.distM / 1000).toFixed(1) + ' km · ' + Math.round(homeInfo.bearing) + '°';
  const st = $('home-state');
  const stTxt = homeInfo.distM < NEAR_HOME_M ? '' : homeInfo.hidden ? 'hidden behind terrain' : homeInfo.beyondVis ? 'beyond dust visibility' : '';
  st.textContent = stTxt; st.hidden = !stTxt;
}

function landmarkVisibility(a, visKm) {
  const vis = [];
  for (const e of lmEls) {
    const d = distM(a.lat, a.lon, e.lm.lat, e.lm.lon) / 1000;
    e.km = d;
    e.show = d <= visKm;
    e.pole.visible = e.show;
    const text = shortName(e.lm.name) + ' ' + d.toFixed(1) + ' km';
    if (text !== e.text) { e.text = text; e.label.textContent = text; e.w = text.length * LABEL_CHAR_W + LABEL_PAD; }
    if (e.show) vis.push(e);
  }
  vis.sort((p, q) => p.km - q.km);   // nearest first: nearest wins when labels collide
  lmOrder = vis;
}

// ---------- per-frame: camera smoothing, beacon pulse, heading arrow, label placement ----------
const clamp01 = (v) => Math.min(1, Math.max(0, v));
function setMarkClass(el, cls) { if (el.className !== cls) el.className = cls; }

function smoothCamera(dt) {
  const o = rig.object3D;
  const cur = o.position;
  let yaw = o.rotation.y;
  const jump = Math.hypot(camT.x - cur.x, camT.z - cur.z);
  if (camT.snap || reduceMotionQ.matches || jump > CAM_SNAP_M) {
    cur.x = camT.x; cur.z = camT.z; yaw = camT.yaw; camT.snap = false;
  } else {
    const k = 1 - Math.exp(-dt / CAM_SMOOTH_S);
    cur.x += (camT.x - cur.x) * k; cur.z += (camT.z - cur.z) * k;
    const TWO_PI = Math.PI * 2;
    const dy = ((camT.yaw - yaw + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
    yaw += dy * k;
  }
  const g = terrain.heightAt(cur.x, cur.z);
  cur.y = (fin(g) ? g : 0) + camT.eye;      // glued to the ground at eye height every frame
  o.rotation.y = yaw;
  if (skyMesh) skyMesh.position.set(cur.x, 0, cur.z);
}

function frame(timeMs, deltaMs) {
  if (!current || !terrain || !sceneEl.camera) return;
  const dt = Math.min(MAX_DT_S, (deltaMs || 16) / 1000);
  smoothCamera(dt);
  const cp = rig.object3D.position;
  if (rocks && Math.hypot(cp.x - rockCx, cp.z - rockCz) > ROCK_RESCATTER_M) scatterRocks(cp.x, cp.z);
  updateShadows(cp.x, cp.y, cp.z, timeMs, deltaMs || 16);
  const nearHome = homeInfo.distM < NEAR_HOME_M;
  if (beacon) {
    // line of sight clear: solid pulsing pillar. Blocked by terrain: dimmer, dashed pillar (still drawn through the hill).
    const hid = homeInfo.hidden;
    beacon.visible = !nearHome && !hid;
    if (beaconDash) beaconDash.visible = !nearHome && hid;
    if (beaconMat) {   // slow pulse (opacity + width); static under reduced motion
      if (reduceMotionQ.matches) { beaconMat.opacity = 0.6; beacon.scale.set(1, 1, 1); dashMat.opacity = 0.3; beaconDash.scale.set(1, 1, 1); }
      else {
        const w = 0.5 + 0.5 * Math.sin(timeMs / 1000 * 2 * Math.PI / BEACON_PULSE_S);
        beaconMat.opacity = 0.42 + 0.28 * w; const sc = 1 + 0.35 * w; beacon.scale.set(sc, 1, sc);
        dashMat.opacity = 0.22 + 0.12 * w; beaconDash.scale.set(sc, 1, sc);
      }
    }
  }
  const cam = sceneEl.camera;
  cam.getWorldDirection(tmpV);
  const viewHeading = (Math.atan2(tmpV.x, -tmpV.z) * 180 / Math.PI + 360) % 360;
  const rel = ((homeInfo.bearing - viewHeading + 540) % 360) - 180;
  // compass tape: one translate per frame, written only when the pixel offset changes (no layout reads)
  const tx = Math.round((stripW / 2 - (viewHeading + 360) * TAPE_PX_PER_DEG) * 2) / 2;
  if (tx !== tapeX) { tapeX = tx; tapeEl.style.transform = `translate3d(${tx}px,0,0)`; }
  const half = stripW / 2 - 16;
  const hx = Math.max(-half, Math.min(half, rel * TAPE_PX_PER_DEG));
  const hcls = Math.abs(rel * TAPE_PX_PER_DEG) > half ? (rel > 0 ? 'edge-r' : 'edge-l') : '';
  if (hcls !== homeTapeCls) { homeTapeCls = hcls; tapeHome.className = hcls; }
  const hxr = Math.round(hx + stripW / 2);
  if (hxr !== homeTapeX) { homeTapeX = hxr; tapeHome.style.left = hxr + 'px'; }

  // home label (own two-line box: name + hidden / beyond-visibility note)
  const homeLabel = $('home-label');
  const hm = fin(meta.home.heightM) ? meta.home.heightM : 0;
  tmpV.set(0, Math.max(BEACON_LABEL_Y, hm), 0).project(cam);
  const km = (homeInfo.distM / 1000).toFixed(1);
  const main = 'HOME ' + km + ' km';
  const sub = homeInfo.hidden ? 'hidden behind terrain' : homeInfo.beyondVis ? 'beyond dust visibility' : '';
  const onScreen = tmpV.z < 1 && Math.abs(tmpV.x) < OFFSCREEN_X && Math.abs(tmpV.y) < 1;
  const edge = onScreen ? '' : (rel > 0 ? ' edge-r' : ' edge-l');
  const mainTxt = onScreen ? main : (rel > 0 ? main + ' ▶' : '◀ ' + main);
  const cls = 'mark home' + (homeInfo.hidden ? ' hidden-home' : '') + edge;
  const key = mainTxt + '|' + sub;
  if (key !== homeTxtKey) {
    homeTxtKey = key;
    $('home-main').textContent = mainTxt;
    const se = $('home-sub'); se.textContent = sub; se.hidden = !sub;
  }
  setMarkClass(homeLabel, cls);
  let sx, sy;
  if (onScreen) { sx = (tmpV.x + 1) / 2 * vw; sy = (1 - tmpV.y) / 2 * vh; }
  else { sx = rel > 0 ? vw - 16 : 16; sy = vh / 2; }
  homeLabel.style.left = sx + 'px'; homeLabel.style.top = sy + 'px';
  homeLabel.hidden = nearHome;
  // reserve the home label's box so landmark labels keep clear of it
  const hw = Math.max(mainTxt.length, sub.length) * (LABEL_CHAR_W + 1) + LABEL_PAD * 2, hh = sub ? 2 * LABEL_H + 4 : LABEL_H + 6;
  let nb = 0;
  boxX[nb] = onScreen ? sx : (rel > 0 ? sx - hw / 2 : sx + hw / 2); boxY[nb] = sy; boxW[nb] = hw; boxH[nb] = hh; nb++;

  // landmark labels: nearest first; a colliding label is staggered up/down, else hidden
  for (const e of lmEls) if (!e.show && e.vis) { e.vis = false; e.label.hidden = true; }
  for (let i = 0; i < lmOrder.length; i++) {
    const e = lmOrder[i];
    tmpV.set(e.pos.x, e.pos.y, e.pos.z).project(cam);
    let placed = false;
    if (tmpV.z < 1 && Math.abs(tmpV.x) < OFFSCREEN_X && Math.abs(tmpV.y) < 1) {
      const lx = (tmpV.x + 1) / 2 * vw, ly = (1 - tmpV.y) / 2 * vh;
      for (let s = 0; s < LABEL_STAGGER.length && !placed; s++) {
        const cy = ly + LABEL_STAGGER[s];
        let clash = false;
        for (let b = 0; b < nb; b++) {
          if (Math.abs(lx - boxX[b]) < (e.w + boxW[b]) / 2 && Math.abs(cy - boxY[b]) < (LABEL_H + boxH[b]) / 2) { clash = true; break; }
        }
        if (clash) continue;
        boxX[nb] = lx; boxY[nb] = cy; boxW[nb] = e.w; boxH[nb] = LABEL_H; nb++;
        const px = Math.round(lx), py = Math.round(cy);
        if (px !== e.px) { e.px = px; e.label.style.left = px + 'px'; }
        if (py !== e.py) { e.py = py; e.label.style.top = py + 'px'; }
        placed = true;
      }
    }
    if (placed !== e.vis) { e.vis = placed; e.label.hidden = !placed; }
  }
}

// ---------- compass tape (built once) ----------
const tapeEl = $('tape'), tapeHome = $('tape-home');
function buildTape() {
  const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  const frag = document.createDocumentFragment();
  for (let k = 0; k < TAPE_TURNS; k++) {
    for (let d = 0; d < 360; d += 30) {
      const sp = document.createElement('span');
      const c = CARD[d];
      sp.className = 't' + (c ? ' c' : '') + (d === 0 ? ' n' : '');
      sp.textContent = c || String(d);
      sp.style.left = ((d + 360 * k) * TAPE_PX_PER_DEG) + 'px';
      frag.appendChild(sp);
    }
  }
  tapeEl.appendChild(frag);
  tapeHome.hidden = false;
  stripW = $('strip').clientWidth || stripW;
}

// ---------- boot ----------
function onTerrain(t) {
  terrain = t;
  THREE = AFRAME.THREE;
  routeHolder = document.createElement('a-entity');
  sceneEl.appendChild(routeHolder);
  makeSky();
  makeModels();
  makeBeacon();
  makeRocks();
  makeLandmarks();
  setupShadows();
  if (pending) { try { apply(pending); } catch (e) { console.error('helmet apply failed', e); note('Display error: ' + e.message); } }
  renderCard();
}

function receive(m) {
  pending = m; haveState = true;
  if (terrain && meta) { try { apply(m); } catch (e) { console.error('helmet apply failed', e); note('Display error: ' + e.message); } }
  renderCard();
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== window.parent) return;
  const m = e.data;
  if (!m || m.type !== 'sightline:state' || m.v !== STATE_V || !m.inputs || !m.derived) return;
  if (!validState(m)) { console.warn('helmet: ignoring malformed state message'); return; }
  receive(m);
});

async function standalone() {
  // Preview without the main app: position from ?lat=&lon=&heading=&tau=. No budget (that needs the main app's pipeline).
  const lat = fin(parseFloat(params.get('lat'))) ? parseFloat(params.get('lat')) : meta.home.lat;
  const lon = fin(parseFloat(params.get('lon'))) ? parseFloat(params.get('lon')) : meta.home.lon;
  const heading = fin(parseFloat(params.get('heading'))) ? parseFloat(params.get('heading')) : 0;
  const tau = fin(parseFloat(params.get('tau'))) ? parseFloat(params.get('tau')) : 0.4;
  const ltst = fin(parseFloat(params.get('ltst'))) ? parseFloat(params.get('ltst')) : LTST_DEFAULT;
  let visKm = FOG_FAR_MAX_M / 1000;
  await constP;
  try {
    const { computeLimits } = await import('../crew/budget.js');
    if (constants) {
      const C = Object.fromEntries([...constants].map(([k, r]) => [k, r.value]));
      visKm = computeLimits({ sol: 0, tau, sansAffected: false }, C).visibilityKm;
    } else note('Constants missing: fog uses the maximum range.');
  } catch (err) { note('Could not compute visibility (' + err.message + '): fog uses the maximum range.'); }
  haveState = true;
  receive({ type: 'sightline:state', v: STATE_V,
    inputs: { astronaut: { lat, lon, headingDeg: heading }, tau, ltst, sepActive: false },
    derived: { limits: { visibilityKm: visKm }, budget: null, routeHome: null, posUncertaintyM: null } });
}

// one WebGL scene: stop rendering while the tab is hidden or the iframe is not on screen
function setupPause() {
  let tabVisible = !document.hidden, inView = true;
  const sync = () => {
    if (!sceneEl.hasLoaded) return;
    const run = tabVisible && inView;
    if (run && !sceneEl.isPlaying) sceneEl.play();
    else if (!run && sceneEl.isPlaying) sceneEl.pause();
  };
  document.addEventListener('visibilitychange', () => { tabVisible = !document.hidden; sync(); });
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { inView = es[es.length - 1].isIntersecting; sync(); }).observe(sceneEl);
  sceneEl.addEventListener('loaded', sync);
}

async function boot() {
  renderCard();
  if (!window.AFRAME) { fail('A-Frame failed to load (CDN unreachable). Reload the page.'); return; }
  AFRAME.registerComponent('helmet-tick', { tick(t, dt) { fpsTick(t, dt); try { frame(t, dt); } catch (e) { /* keep rendering */ } } });
  buildTape();
  if (params.get('fps') === '1') { fpsEl = $('fps'); fpsEl.hidden = false; }
  sunEl = $('sun'); hemiEl = $('hemi');
  setupPause();
  sceneEl.setAttribute('helmet-tick', '');

  try { meta = await fetchJSON('../data/meta.json'); }
  catch (e) { fail('Could not load data/meta.json: ' + e.message); return; }
  if (!meta.home || !fin(meta.home.lat) || !fin(meta.home.lon)) { fail('data/meta.json has no valid home position.'); return; }

  const el = document.createElement('a-entity');
  el.id = 'terrain';
  terrainEl = el;
  el.addEventListener('terrain-error', (e) => fail('Terrain failed to load: ' + (e.detail && e.detail.message)));
  el.addEventListener('terrain-loaded', (e) => { onTerrain(e.detail); if (!inIframe) standalone(); });
  sceneEl.appendChild(el);
  el.setAttribute('heightgrid-terrain', { src: '../data/heightgrid.json', meta: '../data/meta.json', texture: '../data/terrain_texture.jpg' });

  // optional files: failure is shown as a note, not fatal
  constP = fetchJSON('../data/crew_constants.json')
    .then((rows) => { constants = new Map(rows.map((r) => [r.key, r])); if (current) hud(current.inputs, current.derived); })
    .catch((e) => note('Source tags unavailable: ' + e.message));
  traverseP = fetchJSON('../data/traverse.json').catch((e) => { note('Perseverance position unavailable: ' + e.message); return null; });
  fetchJSON('../data/landmarks.json')
    .then((l) => { landmarks = Array.isArray(l) ? l : []; if (terrain && !lmEls.length) { makeLandmarks(); if (current) landmarkVisibility(current.inputs.astronaut, current.derived.limits.visibilityKm); } })
    .catch((e) => note('Landmarks unavailable: ' + e.message));

  if (inIframe) window.parent.postMessage({ type: 'sightline:hello', v: STATE_V }, location.origin);
}

boot();
