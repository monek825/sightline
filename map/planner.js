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
const fmtH = m => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`);
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
  const st = { sol: 9, start: 9, end: 12, weather: 'calm', stops: places[0] ? [{ id: places[0].id, stay: 30 }] : [], randomEvs: null, center: 10.5, vehicle: 'walk', customEvs: null };
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
    const W = world.offsetWidth, H = world.offsetHeight;
    const mx = W * (view.s - 1) / 2 + W * 0.2, my = H * (view.s - 1) / 2 + H * 0.2;   // keep the map under the box (no empty edge)
    view = { ...view, x: Math.min(mx, Math.max(-mx, view.x)), y: Math.min(my, Math.max(-my, view.y)) };
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
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
  const HM = C.mars_hour_min ?? 61.65;
  // Weather is pinned to the Mars clock: a storm at 10:30 stays at 10:30 whatever time you leave. Event times are minutes
  // after `anchor` (the leave time they were made for); weather already under way at the leave time starts at minute 0.
  const weatherNow = () => st.weather === 'story' ? { evs: data.scenario.events, anchor: data.scenario.startLtst }
    : st.weather === 'random' ? (st.randomEvs ??= { evs: ctx.randomEvents(), anchor: st.start })
    : st.weather === 'custom' && st.customEvs ? st.customEvs
    : { evs: [...ctx.fixed(data.scenario.events), { tMin: 5, type: 'tau', value: C.tau_typical }], anchor: st.start };
  const eventsFor = (start, end) => {
    const { evs, anchor } = weatherNow(), shift = (start - anchor) * HM;
    const weather = e => e.type === 'tau' || e.type === 'sep_onset' || e.type === 'sep_end';
    const moved = evs.filter(e => e.type !== 'eva_end').map(e => (weather(e) ? { ...e, tMin: e.tMin - shift } : e));
    const before = moved.filter(e => weather(e) && e.tMin < 0);
    const lastTau = before.filter(e => e.type === 'tau').pop();
    const sepOn = before.filter(e => e.type.startsWith('sep_')).pop();
    const carried = [lastTau && { ...lastTau, tMin: 0, rampMin: 0 }, sepOn?.type === 'sep_onset' && { ...sepOn, tMin: 0 }].filter(Boolean);
    const evaEnd = Math.round(Math.min(end - start, C.eva_design_hours) * HM);
    return [...moved.filter(e => !(weather(e) && e.tMin < 0)), ...carried, { tMin: evaEnd, type: 'eva_end' }].sort((a, c) => a.tMin - c.tMin);
  };
  const sceneFor = (stops, start = st.start, end = st.end) => {
    const pts = stops.map(s => { const p = places.find(q => q.id === s.id); return { lat: p.lat, lon: p.lon, id: p.id, stayMin: s.stay }; });
    const last = pts.at(-1);
    return { sc: { ...data.scenario, sol: st.sol, startLtst: start, events: eventsFor(start, end) }, target: { lat: last.lat, lon: last.lon, id: 'plan', stops: pts, vehicle: st.vehicle } };
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
  const storm = (h, label, ev) => {
    const r = KNOB.r - BAND + 22, [x, y] = polar(h, r);   // on the band's top edge, clear of the band labels
    const dot = sv('circle', { cx: x, cy: y, r: 16, class: 'pl-stormdot' });
    dot.ev = ev; plan.append(dot);
    text(h, r, 'pl-stormbang', '!');
    if (label) text(h, KNOB.r - 88, 'pl-stormlab', label);
  };
  const bar = (h, cls) => {
    const [x0, y0] = polar(h, KNOB.r - BAND - 30), [x1, y1] = polar(h, KNOB.r - BAND + 30);
    plan.append(sv('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: cls }));
  };
  let drag = null, lastPr = null;
  // pointer -> hour on the dial (the face is turned by -center)
  const hourAt = e => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(knob.getScreenCTM().inverse());
    return st.center + Math.atan2(p.x - KNOB.cx, KNOB.cy - p.y) * 180 / Math.PI / DEG_PER_H;
  };
  knob.addEventListener('pointerdown', e => {
    e.preventDefault(); knob.setPointerCapture(e.pointerId);
    const dot = e.target.closest?.('.pl-stormdot');
    drag = dot?.ev ? { dot, ev: dot.ev, h: hourAt(e) } : { x: e.clientX, c: st.center };
  });
  knob.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.dot) {   // move the storm dot along the band; re-plan on release
      drag.h = Math.min(st.end, Math.max(st.start, Math.round(hourAt(e) * 12) / 12));
      const [x, y] = polar(drag.h, KNOB.r - BAND + 22);
      drag.dot.setAttribute('cx', x); drag.dot.setAttribute('cy', y);
      $('pl-now').textContent = hh(drag.h);
      return;
    }
    const pxPerH = knob.getBoundingClientRect().width * DEG_PER_H / 60;   // ~60° of the knob spans the box
    st.center = Math.round((drag.c - (e.clientX - drag.x) / pxPerH) * 4) / 4; turn();
  });
  knob.addEventListener('pointerup', () => {
    if (drag?.dot && lastPr) {   // a moved storm makes this a custom run, pinned to the clock from now on
      const tMin = Math.round((drag.h - st.start) * HM);
      st.customEvs = { evs: lastPr.scenario.events.filter(x => x.type !== 'eva_end').map(x => (x === drag.ev ? { ...x, tMin } : x)), anchor: st.start };
      st.weather = 'custom'; flash = `Storm moved to ${hh(drag.h)}.`;
      update();
    }
    drag = null;
  });
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
    st.weather = w.dataset.weather;
    if (st.weather === 'random') { st.randomEvs = null; flash = 'New weather rolled.'; }
    if (st.weather === 'custom' && !st.customEvs) {   // start from clear weather with one dust storm mid-trip, at the turn-back level
      const mid = Math.round((st.end - st.start) * HM / 2);
      st.customEvs = { evs: [...ctx.fixed(data.scenario.events), { tMin: 5, type: 'tau', value: C.tau_typical }, { tMin: mid, type: 'tau', value: C.tau_red }], anchor: st.start };
      flash = 'Drag the red dot to move the storm; set its strength.';
    }
    update(w);
  });
  const TAU_STEP = 0.5, TAU_MAX = 10;
  const stormTau = () => Math.max(0, ...(st.customEvs?.evs ?? []).filter(e => e.type === 'tau').map(e => e.value));
  const setTau = d => {   // custom: change every storm-level dust event (above normal dust) together
    if (!st.customEvs) return;
    const evs = st.customEvs.evs.map(e => (e.type === 'tau' && e.value > C.tau_typical * 1.5 ? { ...e, value: Math.min(TAU_MAX, Math.max(C.tau_amber, +(e.value + d).toFixed(1))) } : e));
    st.customEvs = { ...st.customEvs, evs }; update(d < 0 ? $('pl-tau-dn') : $('pl-tau-up'));
  };
  $('pl-tau-dn').addEventListener('click', () => setTau(-TAU_STEP));
  $('pl-tau-up').addEventListener('click', () => setTau(TAU_STEP));
  $('pl-rule').textContent = `Turn back if dust passes τ ${C.tau_red} or any solar storm starts. Normal dust here is about τ ${C.tau_typical}.`;
  // speeds on the buttons, from data/crew_constants.json (walking slows on early sols; this is the recovered pace)
  for (const v of document.querySelectorAll('[data-vehicle]')) {
    const kmh = v.dataset.vehicle === 'rover' ? C.rover_speed_kmh : C.walk_speed_kmh;
    if (Number.isFinite(kmh)) v.append(el('small', { className: 'pl-kmh', textContent: `${kmh} km/h` }));
  }
  for (const v of document.querySelectorAll('[data-vehicle]')) v.addEventListener('click', () => { st.vehicle = v.dataset.vehicle; update(v); });
  // Best time: try every leave hour with the same stops and weather (pinned to the clock) and keep the safest, earliest
  $('pl-best').addEventListener('click', () => {
    if (!st.stops.length) return;
    const btn = $('pl-best'), score = r => (!r.pr.outOk ? 99 : r.strand ? 60 : r.late ? 50 : r.turned ? 30 : RANK[r.v.level] * 10) + r.home / 1000;
    btn.classList.add('busy'); btn.disabled = true;
    const hours = []; for (let h = 6; h <= 15; h++) hours.push(h);
    let best = null;
    const step = () => {   // one leave hour per tick, so the spinner keeps turning
      const h = hours.shift();
      if (h !== undefined) {
        const r = evaluate(h, h + C.eva_design_hours);
        if (!best || score(r) < score(best.r)) best = { h, r };
        setTimeout(step, 0); return;
      }
      btn.classList.remove('busy'); btn.disabled = false;
      if (!best?.r.pr.outOk) { flash = 'No leave time works for these stops on this sol.'; update(); return; }
      st.start = best.h; st.end = Math.min(st.start + C.eva_design_hours, Math.ceil(st.start + best.r.home / HM + 0.25));
      $('pl-start').value = st.start; fillEnd();
      flash = best.r.late || best.r.turned || best.r.v.level === 'RED' ? 'Best leave time found, but no hour is fully safe.' : `Best: leave ${hh(st.start)}, back by ${hh(st.end)}.`;
      update();
    };
    setTimeout(step, 30);
  });

  // ---------- update: lock steep places, draw route + knob, verdict ----------
  let timer = 0, flash = '';
  const MIN_SPIN_MS = 350;   // the pressed button spins at least this long, so a quick re-plan still shows it worked
  const update = busyBtn => {
    $('pl-sol').textContent = `Sol ${st.sol}`;
    for (const w of document.querySelectorAll('[data-weather]')) w.setAttribute('aria-pressed', String(w.dataset.weather === st.weather));
    for (const v of document.querySelectorAll('[data-vehicle]')) v.setAttribute('aria-pressed', String(v.dataset.vehicle === st.vehicle));
    $('pl-tau-row').hidden = st.weather !== 'custom';
    if (st.weather === 'custom') $('pl-tau').textContent = stormTau().toFixed(1);
    const t0 = performance.now();
    busyBtn?.classList?.add('busy');
    clearTimeout(timer);
    timer = setTimeout(() => {   // let the click paint first; planning the routes takes a moment
      compute();
      if (busyBtn?.classList) setTimeout(() => busyBtn.classList.remove('busy'), Math.max(0, MIN_SPIN_MS - (performance.now() - t0)));
    }, 30);
  };
  // one plan, fully checked: legs, times, turn-back, too late, verdict
  const evaluate = (start, end) => {
    const { sc, target } = sceneFor(st.stops, start, end);
    const pr = prepareScenario(sc, data, M, target, 'safest');
    if (!pr.outOk) return { pr };
    const tArr = pr.outLen / pr.mPerMin + pr.waits.reduce((a, w) => a + w.min, 0), home = pr.sepT + pr.backLen / pr.mPerMin;
    const turned = pr.sepT < tArr - 1, late = home > pr.endT + 1;
    // rover: if it breaks at the far end, can the crew still walk home on what is left in the suit? (Apollo walk-back rule)
    const walkMPerMin = C.walk_speed_kmh * 1000 / 60, suitMin = C.eva_design_hours * 60 - C.eva_reserve_min;
    const walkBackMin = pr.backLen / walkMPerMin * C.walkback_pad, suitLeftThere = suitMin - Math.min(tArr, pr.sepT);
    const strand = pr.vehicle === 'rover' && walkBackMin > suitLeftThere;
    const base = verdict(pr, Math.min(tArr, pr.endT));
    // warnings, never blocks: the crew can still choose to go (the crater rim may be worth it)
    const v = strand ? { level: 'RED', word: 'RISK', why: `if the rover breaks out there, the walk home takes ${fmtH(walkBackMin)}, more than the ${fmtH(Math.max(0, suitLeftThere))} of suit time left` }
      : late ? { level: 'AMBER', word: 'OVER TIME', why: `home ${fmtH(home - pr.endT)} after your back-by time` }
      : base;
    return { pr, tArr, home, turned, late, strand, v };
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
    const ev = evaluate(st.start, st.end), pr = ev.pr;
    lastPr = pr;
    if (!pr.outOk) {
      const lim = st.sol < C.sensorimotor_recovery_days ? C.max_slope_early_deg : C.max_slope_deg;
      chip.textContent = 'NO-GO'; chip.dataset.level = 'RED'; go.disabled = true;
      $('pl-msg').textContent = `Too steep on sol ${st.sol} (over ${lim}°).`;
      turn(); return;
    }
    const hm = pr.hourMin, H = m => st.start + m / hm;
    const { tArr, home, turned, late, v } = ev;
    // route on the map: walked part of the way out, then the way home
    const line = (pts, cls) => { const n = sv('polyline', { points: pts.map(([la, lo]) => xy(la, lo).map(v => v * 1000).join(',')).join(' ') }); n.setAttribute('class', cls); route.append(n); };
    line(pr.outPts, 'plan');   // the whole planned way out, faint, so a turn-back never hides the plan
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
    const storms = pr.scenario.events.filter(e => e.tMin <= pr.endT && (e.type === 'sep_onset' || (e.type === 'tau' && e.value >= C.tau_amber)))
      .map(e => ({ h: H(e.tMin), kind: e.type === 'sep_onset' ? 'Solar' : 'Dust', e }));
    const groups = storms.reduce((g, s) => { const last = g.at(-1); if (last && s.h - last.at(-1).h < 0.75) last.push(s); else g.push([s]); return g; }, []);
    for (const grp of groups) {
      const kinds = [...new Set(grp.map(s => s.kind))];
      grp.forEach(s => storm(s.h, '', s.e));
      text((grp[0].h + grp.at(-1).h) / 2, KNOB.r - 88, 'pl-stormlab', kinds.length > 1 ? 'Solar + dust storm' : `${kinds[0]} storm`);
    }
    chip.textContent = v.word; chip.dataset.level = v.level; go.disabled = false;
    $('pl-msg').textContent = `${hh(st.start)} leave · ${turned ? `${hh(H(pr.sepT))} turn back` : `${st.stops.length} stop${st.stops.length > 1 ? 's' : ''}`} · ${hh(H(home))} home${v.why ? ` · ${st.vehicle === 'rover' && v.why === 'Suit time' ? 'walk back if the rover breaks' : v.why}` : ''}`;
    if (flash) { $('pl-msg').textContent = `${flash} ${$('pl-msg').textContent}`; flash = ''; }
    $('pl-msg').classList.remove('pop'); void $('pl-msg').offsetWidth; $('pl-msg').classList.add('pop');
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
