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
const HABITAT_SCALE = 1;          // true size (lib/models.js: 8 m dome on a 20 m pad)
const HABITAT_CLEAR_M = 30;       // start views stand back from the habitat so it fits in view, facing it
const ROVER_PARK_M = [12, 6];     // support rover beside the habitat pad [east, south], metres (same as the main 3D view)
const ROUTE_FADE_M = 10;          // route ribbon fades in over its first metres so it is not huge at the feet
const CAM_SMOOTH_S = 0.25, CAM_SNAP_M = 400, MAX_DT_S = 0.1;
const BEACON_PULSE_S = 3.2;
const NEAR_HOME_M = 60;           // visual: this close to the habitat you can see it, so the beacon pillar and HOME label are hidden
const SKY_CLEAR = [227, 167, 106], SKY_DUSTY = [168, 120, 84], ZENITH_CLEAR = [128, 86, 62], TAU_DUSTY = 8, SUN_DIST = 30000;
const LTST_DEFAULT = 9.0;
// Realism layer (visual only, lib/ground.js). Three rock layers around the view, hashed per world cell so they stay put:
// gravel at your feet, rocks out to 75 m, boulders out to 280 m. Clumped, and sparse on the sand patches the ground shader draws.
const ROCK_LAYERS = [
  { count: 9000, radius: 24, cell: 1, min: 0.012, max: 0.09, rescatter: 6, detail: 0, color: 0x7d5f4c, cast: false, sandAvoid: 0.6, clumpM: 6, clearHome: 11 },
  { count: 2400, radius: 75, cell: 4, min: 0.1, max: 0.6, rescatter: 15, detail: 1, color: 0x6f5444, cast: true, sandAvoid: 0.85, clumpM: 25, clearHome: 11 },
  { count: 320, radius: 280, cell: 20, min: 0.5, max: 2.8, rescatter: 50, detail: 1, color: 0x6a4f40, cast: true, sandAvoid: 0.9, clumpM: 90, clearHome: 14 }
];
const GROUND_NEAR_M = 40, GROUND_FAR_M = 400;     // close-up grain and ripples fade out over this range
// Zoom (binocular view): mouse wheel, pinch, + / - keys, 0 resets. 80 deg = normal, 4 deg = 20x.
const FOV_DEFAULT = 80, FOV_MIN = 4, ZOOM_SMOOTH_S = 0.12;
// Sun disc: Mars sees the sun ~0.35 deg wide (2/3 of Earth's). Halo = forward scattering by dust, stronger with tau.
const SUN_SPRITE_D = 40000, SUN_ANG_DEG = 0.35, HALO_ANG_DEG = 34;
// Blowing dust (visual): count and wind scale with tau. Not a wind measurement; the app has no wind data.
const DUST_N = 14000, DUST_BOX_M = 50, DUST_H_M = 14, DUST_TAU_FULL = 4, DUST_WIND_DEG = 60;
// Dust devils during the dust-devil hours from data/crew_constants.json (illustrative, not forecast positions).
const DEVIL_N = 3, DEVIL_MIN_M = 700, DEVIL_MAX_M = 2600, DEVIL_RESPAWN_M = 3200;
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
let rocks = null, groundU = null, beaconDash = null, dashMat = null;
let sunDisc = null, sunHalo = null, sunVis = { disc: 1, halo: 0.3, blue: 0 };
let veil = null, veilU = null, veilWind = 0;
let dust = null, dustU = null, devils = [], devilU = null, devilHours = [11, 14], tauNow = 0.4, ltstNow = LTST_DEFAULT;
let fov = FOV_DEFAULT, fovT = FOV_DEFAULT, lookPrev = null, zoomEl = null;
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
  tauNow = t; ltstNow = l;
  sunLook(t);
  dustLook(t);
  if (devilU) devilU.uFar.value = Math.min(8000, far);
  // shader materials write their colour as-is (no colour-space conversion), so these are sRGB 0..1 values
  if (dustU) dustU.uColor.value.setRGB(hor[0] / 255 * 1.05, hor[1] / 255, hor[2] / 255 * 0.95);
  if (devilU) devilU.uColor.value.setRGB(hor[0] / 255 * 0.95, hor[1] / 255 * 0.86, hor[2] / 255 * 0.8);
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

// ---------- ground: close-up detail on the terrain + rock layers (lib/ground.js) ----------
function makeGround() {
  const G = window.SightlineGround;
  if (!G) { note('Ground detail unavailable (lib/ground.js not loaded).'); return; }
  const det = G.detail(THREE);
  const tm = terrainEl && terrainEl.getObject3D('mesh');
  if (tm && tm.material) {
    groundU = G.patchTerrain(THREE, tm.material, det, { near: GROUND_NEAR_M, far: GROUND_FAR_M });
    const maxA = sceneEl.renderer ? sceneEl.renderer.capabilities.getMaxAnisotropy() : 8;
    det.tex.anisotropy = maxA;
    if (tm.material.map) { tm.material.map.anisotropy = maxA; tm.material.map.needsUpdate = true; }
  }
  rocks = G.rocks(THREE, (x, z) => terrain.heightAt(x, z), det, ROCK_LAYERS);
  sceneEl.object3D.add(rocks.group);
}

// ---------- sun disc + dust halo (sprites that follow the camera, like the sky) ----------
function radialTex(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [t, col] of stops) gr.addColorStop(t, col);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeSun() {
  const disc = radialTex([[0, 'rgba(255,252,245,1)'], [0.42, 'rgba(255,250,238,1)'], [0.5, 'rgba(255,240,215,0.55)'], [0.75, 'rgba(255,225,190,0.12)'], [1, 'rgba(255,220,180,0)']]);
  const halo = radialTex([[0, 'rgba(255,255,255,1)'], [0.04, 'rgba(255,255,255,0.85)'], [0.15, 'rgba(255,255,255,0.4)'], [0.4, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
  const mk = (map, ang, add) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.scale.setScalar(2 * SUN_SPRITE_D * Math.tan(ang * Math.PI / 360));
    s.frustumCulled = false;
    s.renderOrder = -0.5;
    sceneEl.object3D.add(s);
    return s;
  };
  sunHalo = mk(halo, HALO_ANG_DEG, false);    // normal blend: it can tint the orange sky (blue at sunset)
  sunDisc = mk(disc, SUN_ANG_DEG * 2, true);  // texture disc is half the sprite width
}
// brightness from extinction along the slant path (exp(-tau / sin(elevation))); bluish halo near the horizon (Mars sunset)
function sunLook(tau) {
  const el = Math.max(0.02, sunDir[1]);
  const trans = Math.exp(-tau / el);
  sunVis.disc = Math.min(1, trans * 2.2);
  sunVis.halo = Math.min(0.85, 0.6 + 0.06 * tau);   // the aureole stays even when the disc itself is dimmed
  sunVis.blue = Math.max(0, 1 - el / 0.3);   // below ~17 deg the forward-scattered light near the sun turns blue
  if (sunDisc) sunDisc.material.opacity = sunVis.disc;
  if (sunHalo) {
    sunHalo.material.opacity = sunVis.halo;
    const b = sunVis.blue;
    sunHalo.material.color.setRGB(1 - 0.45 * b, 0.97 - 0.2 * b, 0.9 - 0.02 * b, THREE.SRGBColorSpace);
  }
}

// ---------- blowing dust: GPU-animated points in a box that wraps around the camera ----------
function makeDust() {
  const pos = new Float32Array(DUST_N * 3), seed = new Float32Array(DUST_N);
  const H = window.SightlineGround ? window.SightlineGround.hash01 : (a, b, c) => Math.random();
  for (let i = 0; i < DUST_N; i++) { pos[i * 3] = H(i, 1, 3); pos[i * 3 + 1] = H(i, 2, 3); pos[i * 3 + 2] = H(i, 3, 3); seed[i] = H(i, 4, 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  dustU = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uGround: { value: 0 },
    uWind: { value: new THREE.Vector2(1, 0) }, uBox: { value: DUST_BOX_M }, uH: { value: DUST_H_M },
    uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xd9a77a) }, uPx: { value: 500 }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: dustU, transparent: true, depthWrite: false, fog: false,
    vertexShader: `
      attribute float aSeed;
      uniform float uTime, uGround, uBox, uH, uPx; uniform vec3 uCam; uniform vec2 uWind;
      varying float vA;
      void main() {
        float h = pow(position.y, 2.4) * uH;                       // most grains stay near the ground
        float sp = (0.6 + 0.8 * aSeed) * (1.2 - 0.5 * position.y);   // faster low down, slower aloft
        vec2 xz = position.xz * uBox + uWind * uTime * sp;
        xz += vec2(sin(uTime * 1.3 + aSeed * 37.0), cos(uTime * 1.1 + aSeed * 53.0)) * (0.4 + h * 0.08);
        vec2 lo = uCam.xz - 0.5 * uBox;
        xz = mod(xz - lo, uBox) + lo;
        float y = uGround + h + 0.15 * sin(uTime * 2.1 + aSeed * 19.0);
        vec4 mv = modelViewMatrix * vec4(xz.x, y, xz.y, 1.0);
        float d = length(xz - uCam.xz);
        vA = (1.0 - smoothstep(0.32 * uBox, 0.5 * uBox, d)) * smoothstep(0.8, 2.5, -mv.z);
        gl_PointSize = clamp(uPx * (0.03 + 0.09 * aSeed * aSeed) / -mv.z, 1.5, 10.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity; uniform vec3 uColor; varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - r * r) * vA * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }`
  });
  dust = new THREE.Points(g, mat);
  dust.frustumCulled = false;
  dust.renderOrder = 5;
  dust.visible = false;
  sceneEl.object3D.add(dust);
  // dust veil: a full-screen layer of drifting dust sheets (noise from the ground detail texture), slid by wind and view turn
  const det = window.SightlineGround ? window.SightlineGround.detail(THREE) : null;
  if (!det) return;
  veilU = { uTex: { value: det.tex }, uAmt: { value: 0 }, uOff: { value: new THREE.Vector2() }, uTime: { value: 0 },
    uAspect: { value: 1 }, uColor: { value: new THREE.Color() } };
  veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: veilU, transparent: true, depthTest: false, depthWrite: false, fog: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D uTex; uniform float uAmt, uTime, uAspect; uniform vec2 uOff; uniform vec3 uColor; varying vec2 vUv;
      void main() {
        vec2 p = vec2(vUv.x * uAspect, vUv.y);
        float a = texture2D(uTex, p * vec2(0.35, 0.6) + uOff * vec2(1.0, 0.15) + vec2(0.0, uTime * 0.004)).g;
        float b = texture2D(uTex, p * vec2(0.8, 1.3) + uOff * vec2(1.7, 0.3) + 0.37).b;
        float n = a * 0.6 + b * 0.4;
        float sheet = smoothstep(0.36, 0.7, n);
        float low = mix(1.0, 0.6, smoothstep(0.2, 0.9, vUv.y));         // denser near the ground
        float alpha = uAmt * (0.16 + 0.5 * sheet) * low;
        gl_FragColor = vec4(uColor * (0.92 + 0.16 * sheet), alpha);
      }`
  }));
  veil.frustumCulled = false;
  veil.renderOrder = 20;
  veil.visible = false;
  sceneEl.object3D.add(veil);
}
// amount 0..1 from tau: clear sky = none, regional storm (tau ~4+) = full blowing dust
let dustAmt = 0;
function dustLook(tau) {
  if (!dust) return;
  const amt = Math.min(1, Math.max(0, (tau - 0.6) / (DUST_TAU_FULL - 0.6)));
  dustAmt = amt;
  dust.visible = amt > 0.01;
  dust.geometry.setDrawRange(0, Math.round(DUST_N * (0.25 + 0.75 * amt)));
  dustU.uOpacity.value = 0.35 + 0.55 * amt;
  const w = 3 + 15 * amt, a = DUST_WIND_DEG * Math.PI / 180;   // m/s, towards DUST_WIND_DEG (same drift as the map's devils)
  dustU.uWind.value.set(Math.sin(a) * w, -Math.cos(a) * w);
  if (veil) { veil.visible = amt > 0.05; veilU.uAmt.value = amt; }
}
// per frame: slide the veil with the wind as seen across the view, and with the view heading so turning moves it
function updateVeil(dt, t, fx, fz) {
  if (!veil || !veil.visible) return;
  const fl = Math.hypot(fx, fz) || 1, rx = -fz / fl, rz = fx / fl;   // screen-right direction on the ground
  const wv = dustU.uWind.value;
  if (!reduceMotionQ.matches) veilWind -= (wv.x * rx + wv.y * rz) * dt * 0.012;
  // one full turn slides the layer ~2.5 screen widths, so turning your head moves the dust the right way
  veilU.uOff.value.set(veilWind + Math.atan2(fx, -fz) * 0.4 * vw / vh, 0);
  veilU.uTime.value = reduceMotionQ.matches ? 0 : t;
  veilU.uAspect.value = vw / vh;
  veilU.uColor.value.copy(dustU.uColor.value);
}

// ---------- dust devils: translucent spinning columns drifting with the wind ----------
function makeDevils() {
  devilU = { uTime: { value: 0 }, uFar: { value: 8000 }, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(0xc79a74) } };
  for (let i = 0; i < DEVIL_N; i++) {
    const g = new THREE.CylinderGeometry(1.9, 0.55, 1, 28, 24, true);
    g.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uSeed: { value: i * 7.3 } }, devilU), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: `
        uniform float uTime, uSeed; varying vec2 vUv; varying vec3 vW;
        void main() {
          vUv = uv;
          vec3 p = position;
          float sway = sin(p.y * 3.0 + uTime * 0.7 + uSeed) * 0.35 * p.y;   // the column leans and snakes
          p.x += sway; p.z += cos(p.y * 2.3 + uTime * 0.5 + uSeed) * 0.25 * p.y;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uTime, uSeed, uFar; uniform vec3 uCam, uColor; varying vec2 vUv; varying vec3 vW;
        void main() {
          float a = vUv.x * 6.2832, y = vUv.y;
          float sw = sin(a * 3.0 + y * 14.0 - uTime * 5.0 + uSeed) * 0.5 + 0.5;
          sw *= sin(a * 5.0 - y * 9.0 - uTime * 3.3) * 0.25 + 0.75;
          float prof = smoothstep(0.0, 0.05, y) * pow(1.0 - y, 1.4);         // dense at the base, thinning upward
          float d = length(vW.xz - uCam.xz);
          float alpha = (0.18 + 0.32 * sw) * prof * (1.0 - smoothstep(0.55 * uFar, uFar, d));
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(uColor * (0.85 + 0.25 * sw), alpha);
        }`
    });
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    m.visible = false;
    m.renderOrder = 4;
    sceneEl.object3D.add(m);
    devils.push({ m, x: 0, z: 0, live: false, i });
  }
}
function spawnDevil(dv, cx, cz, upwind) {
  const H = window.SightlineGround ? window.SightlineGround.hash01 : () => Math.random();
  const k = (Date.now() / 1000 | 0) + dv.i * 101;
  const wa = DUST_WIND_DEG * Math.PI / 180;
  // first spawn: anywhere around; respawn: upwind so it drifts back into view
  const ang = upwind ? wa + Math.PI + (H(k, 1, 9) - 0.5) * 1.6 : H(k, 2, 9) * 6.283;
  const r = DEVIL_MIN_M + (DEVIL_MAX_M - DEVIL_MIN_M) * H(k, 3, 9);
  dv.x = cx + Math.sin(ang) * r; dv.z = cz - Math.cos(ang) * r;
  const w = 6 + 30 * H(k, 4, 9) ** 2, h = 250 + 550 * H(k, 5, 9);   // tens of metres wide, a few hundred metres tall
  dv.m.scale.set(w, h, w);
  dv.live = true;
}
function updateDevils(dt, t, cx, cz) {
  if (!devils.length) return;
  const on = ltstNow >= devilHours[0] && ltstNow <= devilHours[1] && !reduceMotionQ.matches;
  devilU.uTime.value = t; devilU.uCam.value.set(cx, 0, cz);
  const speed = constants && constants.get('dust_devil_drift_ms') ? constants.get('dust_devil_drift_ms').value : 5;
  const wa = DUST_WIND_DEG * Math.PI / 180;
  for (const dv of devils) {
    if (!on) { dv.m.visible = false; dv.live = false; continue; }
    if (!dv.live) spawnDevil(dv, cx, cz, false);
    dv.x += Math.sin(wa) * speed * dt; dv.z -= Math.cos(wa) * speed * dt;
    if (Math.hypot(dv.x - cx, dv.z - cz) > DEVIL_RESPAWN_M) spawnDevil(dv, cx, cz, true);
    const g = terrain.heightAt(dv.x, dv.z);
    dv.m.position.set(dv.x, (fin(g) ? g : 0) - 2, dv.z);
    dv.m.rotation.y = t * 1.5 + dv.i;
    dv.m.visible = true;
  }
}

// ---------- zoom: wheel / pinch / keys change the field of view; look speed scales with it ----------
function setupZoom() {
  const clampF = (v) => Math.min(FOV_DEFAULT, Math.max(FOV_MIN, v));
  addEventListener('wheel', (e) => { e.preventDefault(); fovT = clampF(fovT * Math.exp(e.deltaY * 0.0015)); }, { passive: false });
  let pinch = 0;
  const span = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
  addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = span(e.touches); }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinch) return;
    const d = span(e.touches);
    fovT = clampF(fovT * pinch / d); pinch = d;
  }, { passive: true });
  addEventListener('touchend', () => { pinch = 0; }, { passive: true });
  addEventListener('keydown', (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === '+' || e.key === '=') fovT = clampF(fovT / 1.4);
    else if (e.key === '-' || e.key === '_') fovT = clampF(fovT * 1.4);
    else if (e.key === '0') fovT = FOV_DEFAULT;
  });
}
function updateZoom(dt) {
  const cam = sceneEl.camera;
  if (!cam) return;
  if (Math.abs(fovT - fov) > 0.01) {
    fov = reduceMotionQ.matches ? fovT : fov + (fovT - fov) * (1 - Math.exp(-dt / ZOOM_SMOOTH_S));
    if (Math.abs(fovT - fov) < 0.02) fov = fovT;
    cam.fov = fov; cam.updateProjectionMatrix();
    if (zoomEl) {
      const x = Math.tan(FOV_DEFAULT * Math.PI / 360) / Math.tan(fov * Math.PI / 360);
      zoomEl.hidden = x < 1.05;
      zoomEl.textContent = '×' + (x < 10 ? x.toFixed(1) : Math.round(x)) + '  ·  0 to reset';
    }
  }
  // drag-to-look moves the view by the same screen distance at any zoom: scale this frame's look change by fov/default
  const lc = camEl.components && camEl.components['look-controls'];
  if (!lc || !lc.pitchObject || !lc.yawObject) return;
  const p = lc.pitchObject.rotation, y = lc.yawObject.rotation, k = fov / FOV_DEFAULT;
  if (lookPrev && k < 0.999) { p.x = lookPrev.x + (p.x - lookPrev.x) * k; y.y = lookPrev.y + (y.y - lookPrev.y) * k; }
  if (!lookPrev) lookPrev = { x: 0, y: 0 };
  lookPrev.x = p.x; lookPrev.y = y.y;
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

function placeModel(name, x, y, z, rotY, scale = 1) {
  if (!AFRAME.components[name]) { note('Model ' + name + ' unavailable (lib/models.js not loaded).'); return; }
  const el = document.createElement('a-entity');
  el.setAttribute(name, 'scale: ' + scale);
  el.setAttribute('position', `${x} ${y} ${z}`);
  el.setAttribute('rotation', `0 ${rotY} 0`);
  sceneEl.appendChild(el);
  casterEls.push(el);
  [600, 2000, 5000].forEach((ms) => setTimeout(flagCasters, ms));   // model parts are child entities that attach a little later
}
function makeModels() {
  const h0 = terrain.heightAt(0, 0);
  placeModel('mars-habitat', 0, h0, 0, 0, HABITAT_SCALE);
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
  updateZoom(dt);
  const cp = rig.object3D.position;
  const cam = sceneEl.camera;
  cam.getWorldDirection(tmpV);
  const fwdX = tmpV.x, fwdZ = tmpV.z;
  if (rocks && rocks.update(cp.x, cp.z, fwdX, fwdZ, camT.eye)) shadowDirty = true;
  if (groundU) groundU.uGCam.value.set(cp.x, cp.y, cp.z);
  const tS = timeMs / 1000;
  if (sunDisc) {
    sunDisc.position.set(cp.x + sunDir[0] * SUN_SPRITE_D, cp.y + sunDir[1] * SUN_SPRITE_D, cp.z + sunDir[2] * SUN_SPRITE_D);
    sunHalo.position.copy(sunDisc.position);
  }
  if (dustU) {
    dustU.uTime.value = reduceMotionQ.matches ? 0 : tS;
    dustU.uCam.value.set(cp.x, cp.y, cp.z);
    dustU.uGround.value = cp.y - camT.eye;
    dustU.uPx.value = vh / (2 * Math.tan(fov * Math.PI / 360));
  }
  updateVeil(dt, tS, fwdX, fwdZ);
  updateDevils(dt, tS, cp.x, cp.z);
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
  makeSun();
  makeModels();
  makeBeacon();
  makeGround();
  makeDust();
  makeDevils();
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
  sunEl = $('sun'); hemiEl = $('hemi'); zoomEl = $('zoom');
  setupZoom();
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
    .then((rows) => {
      constants = new Map(rows.map((r) => [r.key, r]));
      const a = constants.get('dust_devil_peak_start_ltst'), b = constants.get('dust_devil_peak_end_ltst');
      if (a && b && fin(a.value) && fin(b.value)) devilHours = [a.value, b.value];
      if (current) hud(current.inputs, current.derived);
    })
    .catch((e) => note('Source tags unavailable: ' + e.message));
  traverseP = fetchJSON('../data/traverse.json').catch((e) => { note('Perseverance position unavailable: ' + e.message); return null; });
  fetchJSON('../data/landmarks.json')
    .then((l) => { landmarks = Array.isArray(l) ? l : []; if (terrain && !lmEls.length) { makeLandmarks(); if (current) landmarkVisibility(current.inputs.astronaut, current.derived.limits.visibilityKm); } })
    .catch((e) => note('Landmarks unavailable: ' + e.message));

  if (inIframe) window.parent.postMessage({ type: 'sightline:hello', v: STATE_V }, location.origin);
}

boot();
