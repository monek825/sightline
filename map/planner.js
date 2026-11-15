// Written with AI assistance (Claude / GitHub Copilot)
// Plan a walk: tap a place on the tilted map, set the sol, leave and back-by times and the weather in the bar.
// The knob only SHOWS the day (walk out, stay, walk home, storms, back-by line); dragging it scrolls the hours.
// Every check reuses the story engine: prepareScenario() for the legs, the pipeline for the verdict.
import { prepareScenario, stateAt } from './scenario.js';
import { createPipeline } from '../lib/pipeline.js';

const DEG_PER_H = 12;               // knob: one Mars hour = 12° of turn
const KNOB = { cx: 500, cy: 1060, r: 1000 };
const RANK = { GREEN: 0, AMBER: 1, RED: 2 };
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
  const st = { sol: 9, start: 9, end: 12, weather: 'calm', target: places[0]?.id, randomEvs: null, center: 10.5 };

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
    if (!home) btn.addEventListener('click', () => { st.target = p.id; update(); });
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
  const sceneFor = id => {
    const tg = places.find(p => p.id === id);
    return { sc: { ...data.scenario, sol: st.sol, startLtst: st.start, events: eventsFor() }, target: { lat: tg.lat, lon: tg.lon, id } };
  };
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
  const seg = (h0, h1, cls, label) => {
    if (h1 - h0 < 0.01) return;
    plan.append(sv('path', { d: arc(h0, h1, KNOB.r - 120), class: cls }));
    if (!label) return;
    const hm = (h0 + h1) / 2, [x, y] = polar(hm, KNOB.r - 168), t = sv('text', { x, y, class: 'pl-seglab', transform: `rotate(${hm * DEG_PER_H} ${x} ${y})` });
    t.textContent = label; plan.append(t);
  };
  const mark = (h, cls, label) => {
    const [x0, y0] = polar(h, KNOB.r - 150), [x1, y1] = polar(h, KNOB.r - 90);
    plan.append(sv('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: cls }));
    const [x, y] = polar(h, KNOB.r - 240), t = sv('text', { x, y, class: `pl-seglab ${cls}`, transform: `rotate(${h * DEG_PER_H} ${x} ${y})` });
    if (label) { t.textContent = label; plan.append(t); }
  };
  let drag = null;
  knob.addEventListener('pointerdown', e => { knob.setPointerCapture(e.pointerId); drag = { x: e.clientX, c: st.center }; });
  knob.addEventListener('pointermove', e => {
    if (!drag) return;
    const pxPerH = knob.getBoundingClientRect().width * DEG_PER_H / 60;   // ~60° of the knob spans the box
    st.center = Math.round((drag.c - (e.clientX - drag.x) / pxPerH) * 4) / 4; turn();
  });
  knob.addEventListener('pointerup', () => { drag = null; });
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
  const compute = () => {
    preps = new Map(places.map(p => { const { sc, target } = sceneFor(p.id); return [p.id, prepareScenario(sc, data, M, target, 'safest')]; }));
    for (const [id, btn] of pins) {
      btn.classList.toggle('locked', !preps.get(id).outOk);
      btn.classList.toggle('on', id === st.target);
      btn.setAttribute('aria-pressed', String(id === st.target));
    }
    const pr = preps.get(st.target), go = $('pl-go'), chip = $('pl-verdict');
    plan.replaceChildren(); route.replaceChildren();
    if (!pr?.outOk) {
      const lim = st.sol < C.sensorimotor_recovery_days ? C.max_slope_early_deg : C.max_slope_deg;
      chip.textContent = 'NO-GO'; chip.dataset.level = 'RED'; go.disabled = true;
      $('pl-msg').textContent = `Too steep on sol ${st.sol} (over ${lim}°).`;
      turn(); return;
    }
    const hm = pr.hourMin, H = m => st.start + m / hm;
    const tArr = pr.outLen / pr.mPerMin, home = pr.sepT + pr.backLen / pr.mPerMin;
    const name = places.find(p => p.id === st.target).name;
    // route on the map
    const line = pts => sv('polyline', { points: pts.map(([la, lo]) => xy(la, lo).map(v => v * 1000).join(',')).join(' ') });
    const turned = pr.sepT < tArr - 1;
    route.append(line(turned ? pr.outPts.slice(0, Math.max(2, Math.round(pr.outPts.length * pr.sepT / tArr))) : pr.outPts));
    route.lastChild.setAttribute('class', 'out');
    route.append(line(pr.back)); route.lastChild.setAttribute('class', 'back');
    // knob
    const late = home > pr.endT + 1;   // can't be home by the back-by time: too far for this day
    if (turned) { seg(H(0), H(pr.sepT), 'out', 'Walk'); seg(H(pr.sepT), H(home), 'back bad', 'Back'); }
    else { seg(H(0), H(tArr), 'out', 'Walk'); seg(H(tArr), H(pr.sepT), 'stay', name); seg(H(pr.sepT), H(home), late ? 'back bad' : 'back', 'Home'); }
    mark(H(pr.endT), 'limit', '');
    let lastStorm = -1;
    for (const e of pr.scenario.events) {
      const label = e.type === 'sep_onset' ? 'Solar storm' : e.type === 'tau' && e.value > C.tau_amber ? 'Dust storm' : null;
      if (!label) continue;
      mark(H(e.tMin), 'storm', H(e.tMin) - lastStorm < 0.75 ? '' : label);   // labels closer than 45 min would overlap
      lastStorm = H(e.tMin);
    }
    const v = late ? { level: 'RED', word: 'TOO FAR' } : verdict(pr, Math.min(tArr, pr.endT));
    chip.textContent = v.word; chip.dataset.level = v.level; go.disabled = late;
    $('pl-msg').textContent = `${hh(st.start)} leave · ${hh(H(Math.min(tArr, pr.sepT)))} ${turned ? 'turn back' : `at ${name}`} · ${hh(H(home))} home${late ? `, after ${hh(H(pr.endT))}` : ''}${v.why ? ` · ${v.why}` : ''}`;
    st.center = Math.round((st.start + (home / hm) / 2) * 4) / 4; turn();
  };

  $('pl-go').addEventListener('click', () => {
    const { sc, target } = sceneFor(st.target);
    if (ctx.run(sc, target)) dlg.close();
  });

  return () => {   // open: start from what the demo shows now
    const { scenario, prep } = ctx.current();
    st.sol = scenario.sol; st.start = Math.min(15, Math.max(6, Math.round(scenario.startLtst)));
    const id = prep.target?.id ?? scenario.target;
    if (places.some(p => p.id === id)) st.target = id;
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
