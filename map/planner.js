// Written with AI assistance (Claude / GitHub Copilot)
// Plan a walk: tap places on the tilted map in the order to visit them (tap again to remove), set how long to stay at
// each, and the sol, leave and back-by times and weather in the bar. The knob only SHOWS the day (walks, stays,
// walk home, storms, turn-back, back-by line); dragging it scrolls the hours.
// Every check reuses the story engine: prepareScenario() for the legs, the pipeline for the verdict.
import { prepareScenario, stateAt, walkedOutM } from './scenario.js';
import { createPipeline } from '../lib/pipeline.js';

const DEG_PER_H = 12;               // knob: one Mars hour = 12° of turn
const KNOB = { cx: 500, cy: 1060, r: 1000 };
const RANK = { GREEN: 0, AMBER: 1, RED: 2 };
const MAX_STOPS = 4, STAY_STEP = 15, STAY_MAX = 180;   // stays in Earth minutes, like the EVA clock
const BAND = 130;   // knob: radius inset of the plan band
const hh = v => { const m = Math.round(v * 60), H = Math.floor(m / 60) % 24; return `${String(H).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

/** ctx: { data, M, getStore, sky, randomEvents, fixed, current() -> {scenario, prep}, run(sc, target) -> bool } */
export function setupPlanner(ctx) {
  const dlg = document.getElementById('dlg-plan');
  if (!dlg) return () => {};
  const { data, M } = ctx, C = data.C, $ = id => document.getElementById(id);
  const derive = createPipeline(M);
  const places = data.targets.filter(t => t.id !== 'landing').map(t => ({ ...t, name: t.name.replace(/ \(approx\.\)| sample (depot|area)/g, '') }));
  const st = { sol: 9, start: 9, end: 12, weather: 'calm', stops: places[0] ? [{ id: places[0].id, stay: 30 }] : [], randomEvs: null, center: 10.5 };
  const nameOf = id => places.find(p => p.id === id)?.name ?? id;

  // ---------- map: basemap + pins + route, tilted; drag pans, wheel / pinch zooms ----------
  const b = data.meta.bounds;
  const xy = (lat, lon) => [(lon - b.lonMin) / (b.lonMax - b.lonMin), (b.latMax - lat) / (b.latMax - b.latMin)];
  const world = $('pl-world'), route = $('pl-route'), pinLayer = $('pl-pins');
  const pins = new Map();
  const addPin = (p, home) => {
    const [x, y] = xy(p.lat, p.lon);
    const btn = el('button', { type: 'button', className: home ? 'pl-pin home' : 'pl-pin' });
    btn.dataset.x = x; btn.dataset.y = y;
    btn.append(el('i'), el('span', { textContent: home ? 'Home' : p.name }));
    if (!home) btn.addEventListener('click', () => toggleStop(p.id));
    pinLayer.append(btn);
    if (!home) pins.set(p.id, btn);
  };
  addPin(data.meta.home, true);
  places.forEach(p => addPin(p));
  let view = { x: 0, y: 0, s: 1 };
  const paint = () => {   // pins sit in an unscaled layer so their text stays sharp at any zoom
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    const W = world.offsetWidth, H = world.offsetHeight;
    for (const p of pinLayer.children) {
      p.style.left = `${W / 2 + (p.dataset.x - 0.5) * W * view.s + view.x}px`;
      p.style.top = `${H / 2 + (p.dataset.y - 0.5) * H * view.s + view.y}px`;
    }
  };
  const zoomBy = k => { view = { ...view, s: Math.min(6, Math.max(1, view.s * k)) }; paint(); };
  const ptrs = new Map();
  let pinch = 0;
  const mapEl = $('pl-map');
  mapEl.addEventListener('pointerdown', e => { if (e.target.closest('.pl-pin')) return; mapEl.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); });
  mapEl.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    if (ptrs.size === 2) {
      const [a, c] = [...ptrs.values()], d0 = Math.hypot(a[0] - c[0], a[1] - c[1]);
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      const [a2, c2] = [...ptrs.values()], d1 = Math.hypot(a2[0] - c2[0], a2[1] - c2[1]);
      if (pinch && d0) zoomBy(d1 / d0);
      pinch = 1;
      return;
    }
    view = { ...view, x: view.x + e.clientX - p[0], y: view.y + e.clientY - p[1] };
    ptrs.set(e.pointerId, [e.clientX, e.clientY]); paint();
  });
  const up = e => { ptrs.delete(e.pointerId); pinch = 0; };
  mapEl.addEventListener('pointerup', up); mapEl.addEventListener('pointercancel', up);
  mapEl.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });

  // ---------- plan: legs + verdict from the story engine ----------
  const evaMin = () => Math.min((st.end - st.start), C.eva_design_hours) * (C.mars_hour_min ?? 61.65);
  const eventsFor = () => {
    const base = st.weather === 'story' ? data.scenario.events : st.weather === 'random' ? (st.randomEvs ??= ctx.randomEvents())
      : [...ctx.fixed(data.scenario.events), { tMin: 5, type: 'tau', value: C.tau_typical }];
    return [...base.filter(e => e.type !== 'eva_end'), { tMin: Math.round(evaMin()), type: 'eva_end' }].sort((a, c) => a.tMin - c.tMin);
  };
  const sceneFor = stops => {
    const pts = stops.map(s => { const p = places.find(q => q.id === s.id); return { lat: p.lat, lon: p.lon, id: p.id, stayMin: s.stay }; });
    const last = pts.at(-1);
    return { sc: { ...data.scenario, sol: st.sol, startLtst: st.start, events: eventsFor() }, target: { lat: last.lat, lon: last.lon, id: 'plan', stops: pts } };
  };
  const toggleStop = id => {
    const i = st.stops.findIndex(s => s.id === id);
    st.stops = i >= 0 ? st.stops.filter((_, k) => k !== i) : st.stops.length < MAX_STOPS ? [...st.stops, { id, stay: 30 }] : st.stops;
    update();
  };
  const setStay = (i, d) => { st.stops = st.stops.map((s, k) => (k === i ? { ...s, stay: Math.min(STAY_MAX, Math.max(0, s.stay + d)) } : s)); update(); };
  const verdict = (pr, tArr) => {
    let worst = null;
    for (const tt of [tArr * 0.5, tArr, (tArr + pr.endT) / 2]) {
      const bud = derive({ ...ctx.getStore().inputs, ...stateAt(pr, tt, ctx.sky.skyResults) }, data, {}).budget;
      if (!worst || RANK[bud.status] > RANK[worst.status]) worst = bud;
    }
    const turned = pr.sepT !== null && pr.sepT < tArr - 1;
    const why = (worst.factors ?? []).find(f => f.level === worst.status)?.label ?? '';
    if (turned) return { level: 'AMBER', word: 'TURNS BACK', why };
    return { level: worst.status, word: worst.status === 'GREEN' ? 'GO' : worst.status === 'AMBER' ? 'CAUTION' : 'NO-GO', why: worst.status === 'GREEN' ? '' : why };
  };

  // ---------- knob ----------
  const knob = $('pl-knob'), face = $('pl-face');
  const polar = (h, r) => { const a = (h * DEG_PER_H) * Math.PI / 180; return [KNOB.cx + r * Math.sin(a), KNOB.cy - r * Math.cos(a)]; };
  const arc = (h0, h1, r) => { const [x0, y0] = polar(h0, r), [x1, y1] = polar(h1, r); return `M${x0} ${y0} A${r} ${r} 0 ${(h1 - h0) * DEG_PER_H > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
  const grooves = sv('g', { class: 'pl-grooves' });
  for (let q = 0; q < 24 * 4; q++) {
    const h = q / 4, [x0, y0] = polar(h, KNOB.r - (q % 4 ? 18 : 34)), [x1, y1] = polar(h, KNOB.r - 4);
    grooves.append(sv('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: q % 4 ? '' : 'hr' }));
    if (q % 4 === 0) {
      const [tx, ty] = polar(h, KNOB.r - 62), t = sv('text', { x: tx, y: ty, transform: `rotate(${h * DEG_PER_H} ${tx} ${ty})` });
      t.textContent = hh(h); grooves.append(t);
    }
  }
  const plan = sv('g');
  face.append(sv('circle', { cx: KNOB.cx, cy: KNOB.cy, r: KNOB.r, class: 'pl-disc' }), grooves, plan);
  const turn = () => {
    face.setAttribute('transform', `rotate(${-st.center * DEG_PER_H} ${KNOB.cx} ${KNOB.cy})`);
    $('pl-now').textContent = hh(st.center);
  };
  const text = (h, r, cls, label) => {
    const [x, y] = polar(h, r), t = sv('text', { x, y, class: cls, transform: `rotate(${h * DEG_PER_H} ${x} ${y})` });
    t.textContent = label; plan.append(t);
  };
  // a band piece; its label sits inside the band when it fits (~180 knob units per hour), else none
  const seg = (h0, h1, cls, label) => {
    if (h1 - h0 < 0.01) return;
    plan.append(sv('path', { d: arc(h0, h1, KNOB.r - BAND), class: `pl-band ${cls}` }));
    if (label && (h1 - h0) * 180 > label.length * 13 + 20) text((h0 + h1) / 2, KNOB.r - BAND, 'pl-inband', label);
  };
  // a stop: name and stay under the band, so short stays still read
  const stopLabel = (h0, h1, n, name, min) => {
    const hm = (h0 + h1) / 2;
    text(hm, KNOB.r - BAND - 48, 'pl-stoplab', `${n} ${name}`);
    text(hm, KNOB.r - BAND - 76, 'pl-staylab', `${min} min`);
  };
  // storms sit above the band with a warning dot on it; turn-back is a white bar across the band
  const storm = (h, label) => {
    const r = KNOB.r - BAND + 22, [x, y] = polar(h, r);   // on the band's top edge, clear of the band labels
    plan.append(sv('circle', { cx: x, cy: y, r: 13, class: 'pl-stormdot' }));
    text(h, r, 'pl-stormbang', '!');
    if (label) text(h, KNOB.r - 88, 'pl-stormlab', label);
  };
  const bar = (h, cls) => {
    const [x0, y0] = polar(h, KNOB.r - BAND - 30), [x1, y1] = polar(h, KNOB.r - BAND + 30);
    plan.append(sv('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: cls }));
  };
  let drag = null;
  knob.addEventListener('pointerdown', e => { e.preventDefault(); knob.setPointerCapture(e.pointerId); drag = { x: e.clientX, c: st.center }; });
  knob.addEventListener('pointermove', e => {
    if (!drag) return;
    const pxPerH = knob.getBoundingClientRect().width * DEG_PER_H / 60;   // ~60° of the knob spans the box
    st.center = Math.round((drag.c - (e.clientX - drag.x) / pxPerH) * 4) / 4; turn();
  });
  knob.addEventListener('pointerup', () => { drag = null; });
  knob.addEventListener('pointercancel', () => { drag = null; });
  knob.addEventListener('keydown', e => {
    const k = { ArrowLeft: -0.25, ArrowRight: 0.25 }[e.key];
    if (k) { e.preventDefault(); st.center += k; turn(); }
  });

  // ---------- bar ----------
  const opt = (sel, v, label) => sel.append(el('option', { value: v, textContent: label }));
  for (let h = 6; h <= 15; h++) opt($('pl-start'), h, hh(h));
  const fillEnd = () => {
    const s = $('pl-end'); s.replaceChildren();
    for (let h = st.start + 1; h <= st.start + C.eva_design_hours; h++) opt(s, h, hh(h));
    st.end = Math.min(Math.max(st.end, st.start + 1), st.start + C.eva_design_hours); s.value = st.end;
  };
  $('pl-sol-dn').addEventListener('click', () => { st.sol = Math.max(0, st.sol - 1); update(); });
  $('pl-sol-up').addEventListener('click', () => { st.sol = Math.min(30, st.sol + 1); update(); });
  $('pl-start').addEventListener('change', e => { st.start = Number(e.target.value); fillEnd(); update(); });
  $('pl-end').addEventListener('change', e => { st.end = Number(e.target.value); update(); });
  for (const w of document.querySelectorAll('[data-weather]')) w.addEventListener('click', () => {
    st.weather = w.dataset.weather; if (st.weather === 'random') st.randomEvs = null; update();
  });

  // ---------- update: lock steep places, draw route + knob, verdict ----------
  let preps = new Map(), timer = 0;
  const update = () => {
    $('pl-sol').textContent = `Sol ${st.sol}`;
    for (const w of document.querySelectorAll('[data-weather]')) w.setAttribute('aria-pressed', String(w.dataset.weather === st.weather));
    clearTimeout(timer);
    timer = setTimeout(compute, 0);   // let the click paint first; planning 4 routes takes a moment
  };
  const renderStops = () => {   // the stop chips: order, name, stay with - / +, remove
    const list = $('pl-stops');
    list.replaceChildren(...st.stops.map((s, i) => {
      const li = el('li'), dn = el('button', { type: 'button', textContent: '−' }), up = el('button', { type: 'button', textContent: '+' });
      const x = el('button', { type: 'button', className: 'pl-x', textContent: '×' });
      dn.setAttribute('aria-label', `Shorter stay at ${nameOf(s.id)}`); up.setAttribute('aria-label', `Longer stay at ${nameOf(s.id)}`); x.setAttribute('aria-label', `Remove ${nameOf(s.id)}`);
      dn.addEventListener('click', () => setStay(i, -STAY_STEP)); up.addEventListener('click', () => setStay(i, STAY_STEP)); x.addEventListener('click', () => toggleStop(s.id));
      li.append(el('b', { textContent: String(i + 1) }), el('span', { textContent: nameOf(s.id) }), dn, el('output', { textContent: `${s.stay} min` }), up, x);
      return li;
    }));
    if (!st.stops.length) list.append(el('li', { className: 'pl-hint', textContent: 'Tap places on the map, in the order to visit them.' }));
  };
  const compute = () => {
    renderStops();
    // each place on its own from home: greyed when no route is safe on this sol
    for (const [id, btn] of pins) {
      const { sc, target } = sceneFor([{ id, stay: 0 }]);
      const n = st.stops.findIndex(s => s.id === id);
      btn.classList.toggle('locked', !prepareScenario(sc, data, M, target, 'safest').outOk);
      btn.classList.toggle('on', n >= 0);
      btn.setAttribute('aria-pressed', String(n >= 0));
      btn.querySelector('span').textContent = n >= 0 ? `${n + 1}  ${nameOf(id)}` : nameOf(id);
    }
    const go = $('pl-go'), chip = $('pl-verdict');
    plan.replaceChildren(); route.replaceChildren();
    if (!st.stops.length) { chip.textContent = ''; chip.dataset.level = ''; go.disabled = true; $('pl-msg').textContent = ''; turn(); return; }
    const { sc, target } = sceneFor(st.stops);
    const pr = prepareScenario(sc, data, M, target, 'safest');
    if (!pr.outOk) {
      const lim = st.sol < C.sensorimotor_recovery_days ? C.max_slope_early_deg : C.max_slope_deg;
      chip.textContent = 'NO-GO'; chip.dataset.level = 'RED'; go.disabled = true;
      $('pl-msg').textContent = `Too steep on sol ${st.sol} (over ${lim}°).`;
      turn(); return;
    }
    const hm = pr.hourMin, H = m => st.start + m / hm;
    const tArr = pr.outLen / pr.mPerMin + pr.waits.reduce((a, w) => a + w.min, 0), home = pr.sepT + pr.backLen / pr.mPerMin;
    const turned = pr.sepT < tArr - 1, late = home > pr.endT + 1;
    // route on the map: walked part of the way out, then the way home
    const line = (pts, cls) => { const n = sv('polyline', { points: pts.map(([la, lo]) => xy(la, lo).map(v => v * 1000).join(',')).join(' ') }); n.setAttribute('class', cls); route.append(n); };
    line(turned ? pr.outPts.slice(0, Math.max(2, Math.round(pr.outPts.length * walkedOutM(pr, pr.sepT) / pr.outLen))) : pr.outPts, 'out');
    line(pr.back, 'back');
    // knob: walk, stay, walk, stay ... walk home; cut at the turn-back
    let tPrev = 0, done = 0;
    pr.waits.forEach((w, i) => {
      const arrive = w.atM / pr.mPerMin + done, leave = arrive + w.min;
      done += w.min;
      if (tPrev >= pr.sepT) return;
      seg(H(tPrev), H(Math.min(arrive, pr.sepT)), 'walk', 'Walk');
      if (arrive < pr.sepT) { seg(H(arrive), H(Math.min(leave, pr.sepT)), 'stay', ''); stopLabel(H(arrive), H(Math.min(leave, pr.sepT)), i + 1, nameOf(w.id), w.min); }
      tPrev = leave;
    });
    seg(H(pr.sepT), H(home), turned || late ? 'home bad' : 'home', turned ? 'Back' : 'Home');
    if (turned) bar(H(pr.sepT), 'pl-turn');
    bar(H(pr.endT), 'pl-limit');
    // storms within 45 min of each other share one label ("Solar + dust storm"), else the labels overlap
    const storms = pr.scenario.events.filter(e => e.tMin <= pr.endT && (e.type === 'sep_onset' || (e.type === 'tau' && e.value > C.tau_amber)))
      .map(e => ({ h: H(e.tMin), kind: e.type === 'sep_onset' ? 'Solar' : 'Dust' }));
    const groups = storms.reduce((g, s) => { const last = g.at(-1); if (last && s.h - last.at(-1).h < 0.75) last.push(s); else g.push([s]); return g; }, []);
    for (const grp of groups) {
      const kinds = [...new Set(grp.map(s => s.kind))];
      grp.forEach((s, i) => storm(s.h, ''));
      text((grp[0].h + grp.at(-1).h) / 2, KNOB.r - 88, 'pl-stormlab', kinds.length > 1 ? 'Solar + dust storm' : `${kinds[0]} storm`);
    }
    const v = late ? { level: 'RED', word: 'TOO FAR' } : verdict(pr, Math.min(tArr, pr.endT));
    chip.textContent = v.word; chip.dataset.level = v.level; go.disabled = late;
    $('pl-msg').textContent = `${hh(st.start)} leave · ${turned ? `${hh(H(pr.sepT))} turn back` : `${st.stops.length} stop${st.stops.length > 1 ? 's' : ''}`} · ${hh(H(home))} home${late ? `, after ${hh(H(pr.endT))}` : ''}${v.why ? ` · ${v.why}` : ''}`;
    st.center = Math.round((st.start + (home / hm) / 2) * 4) / 4; turn();
  };

  $('pl-go').addEventListener('click', () => {
    if (!st.stops.length) return;
    const { sc, target } = sceneFor(st.stops);
    if (ctx.run(sc, target)) dlg.close();
  });

  return () => {   // open: start from what the demo shows now
    const { scenario, prep } = ctx.current();
    st.sol = scenario.sol; st.start = Math.min(15, Math.max(6, Math.round(scenario.startLtst)));
    const id = prep.target?.id ?? scenario.target;
    if (prep.stops) st.stops = prep.stops.map(s => ({ id: s.id, stay: s.stayMin }));
    else if (places.some(p => p.id === id)) st.stops = [{ id, stay: 30 }];
    $('pl-start').value = st.start; fillEnd();
    if (!dlg.open) dlg.showModal();
    const all = [...places, data.meta.home].map(p => xy(p.lat, p.lon)), xs = all.map(a => a[0]), ys = all.map(a => a[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 2.2);
    view = { x: 0, y: 0, s: Math.min(4, Math.max(1, 0.8 / span)) };   // every place fits on screen
    view = { ...view, x: -((Math.max(...xs) + Math.min(...xs)) / 2 - 0.5) * world.offsetWidth * view.s, y: -((Math.max(...ys) + Math.min(...ys)) / 2 - 0.5) * world.offsetHeight * view.s };
    paint();
    update();
  };
}
