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
const ROUTE_STEP_M = 15, ROUTE_W_M = 5, ROUTE_W_STORM_M = 9, ROUTE_LIFT_M = 1, POST_EVERY_M = 75, MAX_ROUTE_PTS = 5000;
const OFFSCREEN_X = 0.92;

const inIframe = window.parent !== window;
const params = new URLSearchParams(location.search);

let meta = null, terrain = null, landmarks = [], constants = null;
let pending = null;               // latest valid state message
let current = null;               // state applied to the scene
let haveState = false, fatal = null;
let stormShown = false;
let homeInfo = { distM: 0, bearing: 0, hidden: false, beyondVis: false };
const lmEls = [];                 // { lm, label, pole }
let routeKey = '', routeObj = null, constP = Promise.resolve();

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
let THREE = null, overlayGroup = null, routeHolder = null, beaconEl = null;
const tmpV = new (window.AFRAME ? AFRAME.THREE.Vector3 : Object)();

function setFog(visKm) {
  const far = Math.min(FOG_FAR_MAX_M, Math.max(FOG_NEAR_M + 50, visKm * 1000));
  sceneEl.setAttribute('fog', `type: linear; color: #c9a27e; near: ${FOG_NEAR_M}; far: ${Math.round(far)}`);
}

function makeBeacon() {
  beaconEl = document.createElement('a-cylinder');
  beaconEl.setAttribute('radius', BEACON_R_M);
  beaconEl.setAttribute('height', BEACON_H_M);
  beaconEl.setAttribute('position', `0 ${BEACON_H_M / 2} 0`);
  beaconEl.setAttribute('material', 'color: #56d4ff; shader: flat; transparent: true; opacity: 0.6; depthTest: false; fog: false');
  beaconEl.addEventListener('loaded', () => { const m = beaconEl.getObject3D('mesh'); if (m) m.renderOrder = 999; });
  sceneEl.appendChild(beaconEl);
}

function makeLandmarks() {
  const holder = $('landmark-labels');
  for (const lm of landmarks) {
    if (lm.id === 'home' || !fin(lm.lat) || !fin(lm.lon)) continue;
    const p = terrain.toWorld(lm.lat, lm.lon);
    const pole = document.createElement('a-cylinder');
    pole.setAttribute('radius', 1.5); pole.setAttribute('height', 60);
    pole.setAttribute('position', `${p.x} ${p.y + 30} ${p.z}`);
    pole.setAttribute('material', 'color: #fff3d6; shader: flat');
    sceneEl.appendChild(pole);
    const label = document.createElement('div');
    label.className = 'mark';
    label.hidden = true;
    holder.appendChild(label);
    lmEls.push({ lm, label, pole, pos: { x: p.x, y: p.y + 70, z: p.z } });
  }
}

// ---------- route on the ground ----------
function clearRoute() {
  if (!routeHolder) return;
  routeHolder.object3D.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
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
  const pos = new Float32Array(dense.length * 6), idx = [];
  dense.forEach((p, i) => {
    const p0 = dense[Math.max(0, i - 1)], p1 = dense[Math.min(dense.length - 1, i + 1)];
    let tx = p1.x - p0.x, tz = p1.z - p0.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    pos.set([p.x - tz * half, p.y, p.z + tx * half, p.x + tz * half, p.y, p.z - tx * half], i * 6);
    if (i < dense.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const color = storm ? 0xff4d4d : 0xffb020;
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, mat));
  // posts so the line stays readable at eye height (a flat strip is nearly edge-on from 1.7 m)
  const posts = [];
  let acc = 0;
  for (let i = 0; i < dense.length; i++) {
    if (i > 0) acc += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
    if (i === 0 || acc >= POST_EVERY_M) { posts.push(dense[i]); acc = 0; }
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 8, 1.5), new THREE.MeshBasicMaterial({ color, fog: false }), posts.length);
  const m4 = new THREE.Matrix4();
  posts.forEach((p, i) => { m4.setPosition(p.x, p.y + 4, p.z); inst.setMatrixAt(i, m4); });
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
  rig.object3D.position.set(p.x, p.y + eye, p.z);
  rig.object3D.rotation.y = -deg2rad(fin(a.headingDeg) ? a.headingDeg : 0);
  setFog(derived.limits.visibilityKm);

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

function hud(inputs, derived) {
  const b = derived.budget, lim = derived.limits;
  const panel = $('panel-status');
  if (b) {
    panel.dataset.level = b.status;
    $('hud-headline').textContent = b.headline;
    $('hud-sub').textContent = `${Math.round(b.suitMinLeft)} min suit time left\n${Math.round(b.returnMin)} min to walk home`
      + (fin(b.turnBackInMin) && b.status !== 'RED' ? `\nTurn back in ${Math.round(b.turnBackInMin)} min` : '');
    const suit = (b.factors || []).find((f) => f.id === 'suit_time');
    const tag = suit ? sourceTag(suit.keys) : '';
    $('hud-tag').textContent = tag ? 'Suit-time figures: ' + tag : '';
    const list = $('factors'); list.textContent = '';
    (b.factors || []).slice(0, 3).forEach((f) => {
      const li = document.createElement('li');
      const l = document.createElement('span'); l.className = 'lvl ' + f.level; l.textContent = f.level;
      const t = document.createElement('span'); t.textContent = ' ' + f.label + ': ' + f.message;
      const s = document.createElement('span'); s.className = 'src';
      const tg = sourceTag(f.keys); s.textContent = tg ? ' [' + tg + ']' : '';
      li.append(l, t, s); list.appendChild(li);
    });
    $('panel-factors').hidden = false;
  } else {
    panel.dataset.level = 'none';
    $('hud-headline').textContent = 'PREVIEW';
    $('hud-sub').textContent = 'Standalone view: no live walk budget.\nOpen from the main app for status.';
    $('hud-tag').textContent = '';
    $('panel-factors').hidden = true;
  }
  const storm = !!inputs.sepActive;
  const banner = $('storm');
  banner.hidden = !storm;
  if (storm) banner.textContent = 'SOLAR PARTICLE EVENT — follow the red route to the habitat';
  if (storm !== stormShown) stormShown = storm;

  $('env-home').textContent = (homeInfo.distM / 1000).toFixed(1) + ' km @ ' + Math.round(homeInfo.bearing) + '°';
  $('env-tau').textContent = fin(inputs.tau) ? inputs.tau.toFixed(1) : '—';
  $('env-vis').textContent = Math.round(lim.visibilityKm) + ' km';
  $('env-unc').textContent = fin(derived.posUncertaintyM) ? '± ' + Math.round(derived.posUncertaintyM) + ' m' : '—';
  const r = derived.routeHome;
  $('env-route').textContent = r && r.ok === false ? 'No safe route: ' + (r.reason || 'unknown reason') : '';
  $('compass-text').textContent = 'HOME ' + (homeInfo.distM / 1000).toFixed(1) + ' km';
}

function landmarkVisibility(a, visKm) {
  for (const e of lmEls) {
    const d = distM(a.lat, a.lon, e.lm.lat, e.lm.lon) / 1000;
    e.km = d;
    e.show = d <= visKm;
    e.pole.setAttribute('visible', e.show);
    e.label.textContent = e.lm.name + ' ' + d.toFixed(1) + ' km';
  }
}

// ---------- per-frame: heading arrow, label projection ----------
function placeMark(el, v, rel, text, extraClass) {
  el.textContent = text;
  el.className = 'mark' + (extraClass ? ' ' + extraClass : '');
  const onScreen = v.z < 1 && Math.abs(v.x) < OFFSCREEN_X && Math.abs(v.y) < 1;
  if (onScreen) {
    el.style.left = ((v.x + 1) / 2 * innerWidth) + 'px';
    el.style.top = ((1 - v.y) / 2 * innerHeight) + 'px';
    el.hidden = false;
    return true;
  }
  return false;
}

function frame() {
  if (!current || !terrain || !sceneEl.camera) return;
  const cam = sceneEl.camera;
  cam.getWorldDirection(tmpV);
  const viewHeading = (Math.atan2(tmpV.x, -tmpV.z) * 180 / Math.PI + 360) % 360;
  const rel = ((homeInfo.bearing - viewHeading + 540) % 360) - 180;
  $('compass-arrow').style.transform = `rotate(${rel.toFixed(1)}deg)`;

  const homeLabel = $('home-label');
  const hm = fin(meta.home.heightM) ? meta.home.heightM : 0;
  tmpV.set(0, Math.max(BEACON_LABEL_Y, hm), 0).project(cam);
  const km = (homeInfo.distM / 1000).toFixed(1);
  let txt = 'HOME ' + km + ' km';
  if (homeInfo.hidden) txt += ' (hidden behind terrain)';
  else if (homeInfo.beyondVis) txt += ' (beyond dust visibility)';
  const cls = 'home' + (homeInfo.hidden ? ' hidden-home' : '');
  if (!placeMark(homeLabel, tmpV, rel, txt, cls)) {
    // out of view: pin to the screen edge on the side the habitat is
    const right = rel > 0;
    homeLabel.textContent = right ? txt + ' ▶' : '◀ ' + txt;
    homeLabel.className = 'mark ' + cls + (right ? ' edge-r' : ' edge-l');
    homeLabel.style.left = right ? (innerWidth - 16) + 'px' : '16px';
    homeLabel.style.top = '50%';
    homeLabel.hidden = false;
  }

  for (const e of lmEls) {
    if (!e.show) { e.label.hidden = true; continue; }
    tmpV.set(e.pos.x, e.pos.y, e.pos.z).project(cam);
    const name = e.lm.name + ' ' + e.km.toFixed(1) + ' km';
    if (!placeMark(e.label, tmpV, 0, name, '')) e.label.hidden = true;
  }
}

// ---------- boot ----------
function onTerrain(t) {
  terrain = t;
  THREE = AFRAME.THREE;
  routeHolder = document.createElement('a-entity');
  sceneEl.appendChild(routeHolder);
  makeBeacon();
  makeLandmarks();
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
    inputs: { astronaut: { lat, lon, headingDeg: heading }, tau, sepActive: false },
    derived: { limits: { visibilityKm: visKm }, budget: null, routeHome: null, posUncertaintyM: null } });
}

async function boot() {
  renderCard();
  if (!window.AFRAME) { fail('A-Frame failed to load (CDN unreachable). Reload the page.'); return; }
  AFRAME.registerComponent('helmet-tick', { tick() { try { frame(); } catch (e) { /* keep rendering */ } } });
  sceneEl.setAttribute('helmet-tick', '');

  try { meta = await fetchJSON('../data/meta.json'); }
  catch (e) { fail('Could not load data/meta.json: ' + e.message); return; }
  if (!meta.home || !fin(meta.home.lat) || !fin(meta.home.lon)) { fail('data/meta.json has no valid home position.'); return; }

  const el = document.createElement('a-entity');
  el.id = 'terrain';
  el.addEventListener('terrain-error', (e) => fail('Terrain failed to load: ' + (e.detail && e.detail.message)));
  el.addEventListener('terrain-loaded', (e) => { onTerrain(e.detail); if (!inIframe) standalone(); });
  sceneEl.appendChild(el);
  el.setAttribute('heightgrid-terrain', { src: '../data/heightgrid.json', meta: '../data/meta.json', texture: '../data/terrain_texture.jpg' });

  // optional files: failure is shown as a note, not fatal
  constP = fetchJSON('../data/crew_constants.json')
    .then((rows) => { constants = new Map(rows.map((r) => [r.key, r])); if (current) hud(current.inputs, current.derived); })
    .catch((e) => note('Source tags unavailable: ' + e.message));
  fetchJSON('../data/landmarks.json')
    .then((l) => { landmarks = Array.isArray(l) ? l : []; if (terrain && !lmEls.length) { makeLandmarks(); if (current) landmarkVisibility(current.inputs.astronaut, current.derived.limits.visibilityKm); } })
    .catch((e) => note('Landmarks unavailable: ' + e.message));

  if (inIframe) window.parent.postMessage({ type: 'sightline:hello', v: STATE_V }, location.origin);
}

boot();
