// Written with AI assistance (Claude / GitHub Copilot)
// Panels: frosted category panel (3 question tabs), bottom drawer (timeline + details), clock, banner,
// sources modal, data badge. Renders from the store; control events call setInputs (user actions only).

import { toCell } from '../lib/geo.js';

const $ = id => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmtLtst = h => {
  const t = ((h % 24) + 24) % 24;
  return `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 60)).padStart(2, '0')}`;
};
const fmtMin = m => {
  if (!Number.isFinite(m)) return '–';
  return m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;
};
const fmtNum = (v, digits = 0, unit = '') => (Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : '–');
const fmtKm = v => (Number.isFinite(v) ? `${v.toFixed(v < 10 ? 1 : 0)} km` : '–');

// Which category tab a budget factor belongs to (by its id; crew/README.md factor ids).
const GROUPS = [
  ['dust', /dust|vis|tau|devil|storm/i],
  ['pos', /pos|fix|sky|lost/i],
  ['pos', /route|path|slope/i],
  ['home', /.*/] // suit time, walking, radiation, body: all answer "can I get home?"
];
const groupOf = f => GROUPS.find(([, re]) => re.test(f.id))[0];
const ADVANCED_IDS = new Set(['vision', 'body_clock', 'bone', 'cooling']); // GREEN ones go in Details > Advanced
const SEVERITY = { RED: 0, AMBER: 1, GREEN: 2 };

const EVENT_LABELS = { eva_start: 'EVA start', sep_onset: 'Solar storm', return_home: 'Return home', skyline_fix: 'Horizon Match', eva_end: 'EVA end' };
const eventLabel = ev => (ev.type === 'tau' ? `Dust (τ) ${ev.value}` : EVENT_LABELS[ev.type] ?? ev.type);

function buildTimeline(events) {
  if (!events.length) { $('t-track').replaceChildren(); return []; }
  const end = (events.find(e => e.type === 'eva_end') ?? events[events.length - 1]).tMin; // fixed end: markers do not jump
  const cps = events.map(ev => {
    const cp = el('li', 'cp');
    cp.style.left = `${end > 0 ? (ev.tMin / end) * 100 : 0}%`;
    cp.title = eventLabel(ev);
    cp.append(el('span', 'cp-dot'), el('span', 'cp-label', eventLabel(ev)));
    return { tMin: ev.tMin, cp };
  });
  $('t-track').replaceChildren(...cps.map(c => c.cp));
  return cps;
}

function markCheckpoints(cps, t) {
  let current = -1;
  cps.forEach((c, i) => {
    const passed = t !== null && c.tMin <= t;
    c.cp.classList.toggle('passed', passed);
    if (passed) current = i;
  });
  cps.forEach((c, i) => {
    c.cp.classList.toggle('current', i === current);
    if (i === current) c.cp.setAttribute('aria-current', 'step'); else c.cp.removeAttribute('aria-current');
  });
}

function tagFor(keys, byKey) {
  const rows = keys.map(k => byKey[k]).filter(Boolean);
  if (!rows.length) return null;
  const est = rows.some(r => r.isEstimate), nasa = rows.some(r => !r.isEstimate);
  if (nasa && est) return ['NASA data and estimate', 'tag tag-nasa'];
  return nasa ? ['NASA data', 'tag tag-nasa'] : ['Estimate', 'tag tag-est'];
}

function buildSources(data) {
  $('src-rows').replaceChildren(...data.constantsRows.map(r => {
    const tr = el('tr');
    tr.id = `src-${r.key}`;
    tr.append(el('td', '', r.label), el('td', '', `${r.value} ${r.unit}`));
    const type = el('td');
    type.append(el('span', r.isEstimate ? 'tag tag-est' : 'tag tag-nasa', r.isEstimate ? 'Estimate' : 'NASA data'));
    const src = el('td', '', r.source);
    if (typeof r.url === 'string' && r.url.startsWith('https://')) {
      const a = el('a', '', ' source');
      a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      src.append(a);
    }
    tr.append(type, src);
    return tr;
  }));
}

function openSources(key) {
  const dlg = $('dlg-sources');
  if (!dlg.open) dlg.showModal();
  document.querySelectorAll('.src-table tr.flash').forEach(r => r.classList.remove('flash'));
  const row = key && document.getElementById(`src-${key}`);
  if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'center' }); }
}

function dataBadge(data, usingStubs) {
  const mocks = Object.entries(data.status).filter(([, s]) => s !== 'real').map(([k, s]) => `${k} (${s})`);
  if (usingStubs.length) mocks.push(...usingStubs.map(s => `${s} (placeholder)`));
  if (!mocks.length) return;
  const b = el('p', 'mock-badge');
  b.setAttribute('role', 'status');
  b.append(el('strong', '', 'MOCK DATA'), document.createTextNode(` ${mocks.join(', ')}`));
  $('drawer-more').prepend(b);
  $('notch').classList.add('has-mock');
}

function factorItem(f, byKey, keyNum) {
  const li = el('li', f.level);
  li.dataset.key = f.keys?.[0] || '';
  li.tabIndex = 0;
  const text = el('div');
  text.append(el('strong', '', f.label));
  if (keyNum) text.append(el('span', 'keynum', keyNum));
  const tag = tagFor(f.keys || [], byKey);
  if (tag) text.append(el('span', tag[1], tag[0]));
  text.append(el('div', '', f.message));
  li.append(el('span', 'dot'), text);
  return li;
}

// Icons for the factor tiles (24x24 stroke paths, drawn with createElementNS, no innerHTML).
const ICONS = {
  mobility: 'M13 4a1.5 1.5 0 1 0 0 .01M10 21l2-6 3 3v3M8 12l3-4 3 2 3 1M11 8l-1 5',
  suit_time: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2',
  radiation: 'M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M12 3a9 9 0 0 1 7.8 4.5L14 11M4.2 7.5A9 9 0 0 1 12 3M12 21a9 9 0 0 1-7.8-4.5L10 13M19.8 16.5A9 9 0 0 1 12 21',
  dust: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8',
  dust_devil: 'M4 5h16M6 9h12M8 13h8M10 17h4M11 21h2',
  cooling: 'M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0M12 10v7',
  cold: 'M12 2v20M4 6l16 12M20 6 4 18',
  vision: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  body_clock: 'M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10',
  bone: 'M7 17l10-10M5.5 15.5a2 2 0 1 0 3 3M15.5 5.5a2 2 0 1 1 3 3M5.5 15.5a2 2 0 1 1 2-2.5M18.5 8.5a2 2 0 1 1-2.5 2',
  post_eva: 'M3 18V8M3 14h18v4M7 11h4M21 14v-2a3 3 0 0 0-3-3h-6v5',
  warning: 'M12 3 2 20h20zM12 10v4M12 17v.01'
};
function icon(id) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', ICONS[id] ?? 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0');
  svg.append(path);
  return svg;
}
const LEVEL_WORD = { GREEN: 'OK', AMBER: 'Watch', RED: 'Act now' };
function factorTile(f, keyNum, wide) {
  const li = el('li', `tile ${f.level}${wide ? ' wide' : ''}`);
  li.dataset.key = f.keys?.[0] || '';
  li.tabIndex = 0;
  if (!wide) li.title = f.message;
  const ic = el('span', 'tile-icon');
  ic.append(icon(f.id));
  const head = el('div', 'tile-head');
  head.append(el('strong', '', f.label), el('span', 'tile-level', LEVEL_WORD[f.level] ?? ''));
  li.append(ic, head);
  if (keyNum) li.append(el('span', 'tile-num', keyNum));
  if (wide) {
    li.append(el('p', 'tile-msg', f.message));
    const tag = tagFor(f.keys || [], data_byKey);
    if (tag) li.append(el('span', tag[1], tag[0]));
  }
  return li;
}
let data_byKey = {};

// The key number of a limiting factor, from the budget (or the first number in its message).
function keyNumber(f, bdg, inputs) {
  if (f.id === 'suit_time') return bdg.marginMin <= 0 ? `home ${fmtMin(bdg.returnMin)}` : `turn back in ${fmtMin(bdg.turnBackInMin)}`;
  if (f.id === 'radiation' && f.level === 'RED') return `home ${fmtMin(bdg.returnMin)}`;
  if (f.id === 'radiation') return fmtNum(bdg.careerPct, 1, '% of career dose');
  if (f.id === 'dust') return `τ ${fmtNum(inputs.tau, 1)}, ${fmtKm(bdg.visibilityKm)}`;
  if (f.id === 'mobility') return fmtNum(bdg.speedKmh, 1, ' km/h');
  return f.message.match(/\d[\d.,]*\s?(?:min|km|%|Pa|°C|h)\b/)?.[0] ?? '';
}

// One plain-English sentence on why the verdict is what it is: the worst factor plus the budget's numbers.
function verdictSentence(bdg) {
  const w = bdg.factors[0];
  const home = fmtMin(bdg.returnMin), back = fmtMin(bdg.turnBackInMin);
  const worstWords = { // [RED, AMBER] wording per factor id (null: that level cannot happen, fall back to the label)
    suit_time: [`only ${fmtMin(Math.max(0, bdg.suitMinLeft))} of suit time is left and home is ${home} away.`, `the suit-time margin is thin. Turn back in ${back}.`],
    radiation: [`a solar storm started and home is ${home} away.`, 'the career radiation dose is high.'],
    dust: [`dust hides landmarks beyond ${fmtKm(bdg.visibilityKm)}.`, `dust limits sight to about ${fmtKm(bdg.visibilityKm)}. Turn back in ${back}.`],
    dust_devil: [null, 'it is dust-devil hours and visibility can drop suddenly.'],
    cooling: ['the suit cannot cool at this air pressure.', 'the suit cooling margin is thin at this air pressure.'],
    cold: [null, 'the air is cooling fast. Head home soon.'],
    mobility: [null, `walking is slow (${fmtNum(bdg.speedKmh, 1, ' km/h')}) while balance recovers.`],
    body_clock: [null, 'an early start with a drifting body clock lowers alertness.']
  }[w.id];
  if (bdg.headline === 'AT SHELTER') {
    return w.id === 'radiation' ? 'At shelter: the astronaut is at the habitat during the solar storm.' : `At shelter: the astronaut is at the habitat and ${w.label.toLowerCase()} would stop a walk now.`;
  }
  if (bdg.status === 'RED') return `Return now: ${worstWords?.[0] ?? `${w.label}.`}`;
  if (bdg.status === 'AMBER') return `Caution: ${worstWords?.[1] ?? `${w.label}.`}${worstWords ? '' : ` Turn back in ${back}.`}`;
  return `Go: all factors are within limits. Turn back in ${back}.`;
}

// Clicking/pressing Enter on a factor opens its source row.
function wireFactorLists() {
  const open = e => {
    const li = e.target.closest('li[data-key]');
    if (!li || !li.dataset.key) return;
    if (e.type === 'keydown') { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); }
    openSources(li.dataset.key);
  };
  for (const list of document.querySelectorAll('.factors, .alerts')) {
    list.addEventListener('click', open);
    list.addEventListener('keydown', open);
  }
}

// WAI-ARIA tabs: click or arrow keys switch the category.
// The status card can be hidden to see the map; any tab brings it back.
function wirePanelHide() {
  const btn = $('panel-hide');
  const set = hidden => {
    document.body.classList.toggle('panel-hidden', hidden);
    btn.setAttribute('aria-expanded', String(!hidden));
    btn.setAttribute('aria-label', hidden ? 'Show status card' : 'Hide status card');
  };
  btn.addEventListener('click', () => set(!document.body.classList.contains('panel-hidden')));
  for (const t of document.querySelectorAll('[role="tab"]')) t.addEventListener('click', () => set(false));
}

function wireTabs() {
  wirePanelHide();
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = tab => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
  };
  for (const [i, t] of tabs.entries()) {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length];
      select(next); next.focus();
    });
  }
}

function wireDrawer() {
  const notch = $('notch'), more = $('drawer-more');
  const setOpen = open => {
    more.hidden = !open;
    notch.setAttribute('aria-expanded', String(open));
    $('drawer').classList.toggle('open', open);
  };
  notch.addEventListener('click', () => {
    if (more.hidden) document.querySelector('dialog.skyfix[open] .skyfix-head button')?.click();   // one panel at a time
    setOpen(more.hidden);
  });
  document.addEventListener('keydown', e => { // Esc closes the sheet and hands focus back to its button
    if (e.key !== 'Escape' || more.hidden || document.querySelector('dialog[open]')) return;
    setOpen(false);
    notch.focus();
  });
}

export function createPanels(data, { setInputs, usingStubs, onCondition, runHasSep, runEvents, onSpeed, getSpeed, speedBase }) {
  data_byKey = data.constantsByKey;
  buildSources(data);
  dataBadge(data, usingStubs);
  const eventsNow = () => runEvents?.() ?? data.scenario?.events ?? []; // the run's current events (condition edits replace them)
  let builtFor = eventsNow(), checkpoints = buildTimeline(builtFor);
  const speedLabel = $('c-speed').parentElement;
  speedLabel.hidden = !data.scenario; // nothing to play without a scenario file
  const showSpeed = k => { $('c-speed').value = k; $('o-speed').textContent = `${k}× (${(speedBase ?? 0) * k} min/s)`; };
  // speed is not in the store, so no render follows a change while paused: update the label here too
  $('c-speed').addEventListener('input', e => { onSpeed?.(Number(e.target.value)); showSpeed(getSpeed?.() ?? 1); });
  wireTabs();
  wireDrawer();
  wireFactorLists();
  $('btn-sources').addEventListener('click', () => openSources());
  // scale hints under the sliders: endpoints from the sliders themselves, recovery day from the constants
  const rng = id => [$(id).min, $(id).max];
  const hints = {
    'c-tau': `${rng('c-tau')[0]} is clear sky, ${rng('c-tau')[1]} is a global dust storm`,
    'c-ltst': `${fmtLtst(rng('c-ltst')[0])} is morning, ${fmtLtst(rng('c-ltst')[1])} is evening`,
    'c-sol': `Sol ${rng('c-sol')[0]} is landing day. Balance recovers by sol ${data.C.sensorimotor_recovery_days}.`,
    'c-speed': 'Changes the demo playback speed only.'
  };
  for (const h of document.querySelectorAll('[data-hint]')) h.textContent = hints[h.dataset.hint] ?? '';

  const sliders = [
    ['c-sol', 'o-sol', 'sol', v => `${v}`],
    ['c-ltst', 'o-ltst', 'ltst', fmtLtst],
    ['c-tau', 'o-tau', 'tau', v => Number(v).toFixed(1)]
  ];
  // with a running demo the edit goes through onCondition (it re-prepares the walk); otherwise straight to the store
  const setCond = (key, value) => { if (!onCondition?.(key, value)) setInputs({ [key]: value }); };
  for (const [id, , key] of sliders) {
    $(id).addEventListener('input', e => setCond(key, Number(e.target.value)));
  }
  $('c-sep').addEventListener('change', e => setCond('sepActive', e.target.checked));
  $('c-sans').addEventListener('change', e => setInputs({ sansAffected: e.target.checked }));
  $('c-mode').addEventListener('change', e => setInputs({ routeMode: e.target.value }));

  let lastSig = '';
  function renderFactors(bdg, derived, inputs) {
    const sig = JSON.stringify(bdg.factors.map(f => [f.id, f.level, f.message, keyNumber(f, bdg, inputs)])) + derived.warnings.join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    const sorted = [...bdg.factors].sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level]);
    for (const list of document.querySelectorAll('.factors[data-group]')) {
      // ponytail: tabs show only AMBER/RED (what needs attention); all factors stay in the Details drawer
      list.replaceChildren(...sorted.filter(f => groupOf(f) === list.dataset.group && f.level !== 'GREEN').map(f => factorItem(f, data.constantsByKey)));
    }
    // Details sheet: every factor as an icon tile in a bento grid, worst first.
    // Amber/red tiles are wide and carry the full explanation; green tiles are compact (full text on hover/focus).
    const quiet = f => f.level === 'GREEN' && ADVANCED_IDS.has(f.id); // fine, and not for the main list
    const tile = f => factorTile(f, keyNumber(f, bdg, inputs), f.level !== 'GREEN');
    const tiles = sorted.filter(f => !quiet(f)).map(tile);
    for (const w of derived.warnings) tiles.unshift(factorTile({ id: 'warning', level: 'AMBER', label: 'Data note', message: w }, '', true));
    $('alerts').replaceChildren(...tiles);
    $('alerts-adv').replaceChildren(...sorted.filter(quiet).map(tile));
    // a coloured dot on each tab shows its worst factor, so trouble is visible without opening it
    for (const t of document.querySelectorAll('[role="tab"]')) {
      const g = t.getAttribute('aria-controls').replace('tab-', '');
      const worst = sorted.find(f => groupOf(f) === g);
      t.dataset.level = worst ? worst.level : '';
    }
  }

  // Route comparison: chosen mode first (solid sample), the other dashed. Rebuilt only when its numbers change.
  let cmpSig = '';
  function renderCompare(inputs, derived) {
    const a = derived.routeOut, b = derived.routeAlt;
    const show = !!(a?.ok && inputs.target);
    $('r-cmp').hidden = !show;
    const sig = show ? JSON.stringify([a.mode, a.etaMin, a.lengthKm, a.homeHiddenFraction, b?.ok && [b.mode, b.etaMin, b.lengthKm, b.homeHiddenFraction]]) : '';
    if (sig === cmpSig) return;
    cmpSig = sig;
    if (!show) return;
    const label = m => $('c-mode').querySelector(`option[value="${m}"]`)?.textContent.replace(/\s*\(.*\)/, '') ?? m;
    const sight = r => Math.round((1 - r.homeHiddenFraction) * 100);
    const row = (r, dashed) => {
      const li = el('div', 'cmp-row');
      const nums = el('span', 'cmp-nums');
      nums.append(el('span', '', fmtMin(r.etaMin)), el('span', '', fmtKm(r.lengthKm)), el('span', '', `home in sight ${sight(r)}%`));
      li.append(el('span', dashed ? 'cmp-line dashed' : 'cmp-line'), el('span', 'cmp-mode', label(r.mode)), nums);
      return li;
    };
    const alt = b?.ok ? b : null;
    $('r-cmp-rows').replaceChildren(row(a, false), ...(alt ? [row(alt, true)] : []));
    let note = '';
    if (alt) {
      const same = Math.round(a.etaMin) === Math.round(alt.etaMin) && sight(a) === sight(alt);
      const dMin = Math.round(a.etaMin) - Math.round(alt.etaMin), dSight = sight(a) - sight(alt);
      const mins = n => `${n >= 0 ? '+' : '-'}${Math.abs(n)} min`;
      if (same) note = `Same path as the ${label(alt.mode)} route.`;
      else if (a.mode === 'shortest') // chosen is shortest: say what the safest route would cost and gain
        note = `The safest route ${dMin === 0 ? "takes the same time" : `takes ${Math.abs(dMin)} min longer`} and keeps home in sight ${sight(alt)}% of the way (${sight(a)}% on the shortest route).`;
      else if (dMin > 0 && dSight > 0) note = `${mins(dMin)}, but home stays in sight ${sight(a)}% of the way (${sight(alt)}% on the shortest route).`;
      else note = `${mins(dMin)} and home in sight ${sight(a)}% of the way (${sight(alt)}% on the shortest route).`;
    }
    $('r-cmp-note').textContent = note;
    $('r-cmp-note').hidden = !note;
  }

  // Line of sight from the astronaut's grid cell: home in sight / a landmark only / blind (cell index as in lib/geo.js toCell)
  function renderLos(inputs, derived, pct) {
    const vis = derived.vis, b = data.meta?.bounds, a = inputs.astronaut;
    let state = '';
    if (vis?.homeHidden && vis.blind && b && a && vis.w > 0 && vis.h > 0) {
      const { r, c } = toCell(vis, b, a.lat, a.lon);
      const i = Math.min(vis.h - 1, Math.max(0, r)) * vis.w + Math.min(vis.w - 1, Math.max(0, c));
      if (i < vis.homeHidden.length && i < vis.blind.length) state = vis.homeHidden[i] === 0 ? 'home' : vis.blind[i] === 0 ? 'landmark' : 'blind';
    }
    const los = $('b-los');
    los.hidden = !state;
    los.dataset.state = state;
    los.textContent = { home: 'Home in sight', landmark: 'Landmark only', blind: 'Blind' }[state] ?? '';
    $('b-los3').hidden = !Number.isFinite(pct);
    $('b-los3').textContent = Number.isFinite(pct) ? `Home visible from ${Math.round(pct)}% of ground within 3 km` : '';
  }

  function renderTabs(inputs, derived) {
    const bdg = derived.budget, C = data.C;
    document.querySelector('.panel').dataset.status = bdg.status;
    $('b-headline').textContent = bdg.headline;
    $('b-return').textContent = fmtMin(bdg.returnMin);
    $('b-km').textContent = fmtKm(derived.routeHomeKm);
    $('b-suit').textContent = fmtMin(Math.max(0, bdg.suitMinLeft));
    $('b-turn').textContent = bdg.marginMin <= 0 ? 'now' : fmtMin(bdg.turnBackInMin);

    $('d-vis').textContent = fmtKm(derived.limits.visibilityKm);
    $('d-tau').textContent = fmtNum(inputs.tau, 1);
    $('now-haze').style.width = `${Math.min(100, inputs.tau / 10 * 100)}%`;
    const pct = derived.vis.homeVisiblePct3km;
    $('d-home').textContent = Number.isFinite(pct) ? `${Math.round(pct)}% within 3 km` : '–';
    $('vis-stat').textContent = Number.isFinite(pct) ? `Home is visible from ${Math.round(pct)}% of the ground within 3 km.` : '';
    renderLos(inputs, derived, pct);
    $('now-devil').hidden = !(inputs.ltst >= C.dust_devil_peak_start_ltst && inputs.ltst <= C.dust_devil_peak_end_ltst);

    $('p-unc').textContent = Number.isFinite(derived.posUncertaintyM) ? `± ${Math.round(derived.posUncertaintyM)} m` : '–';
    $('p-since').textContent = fmtKm(inputs.distSinceFixM / 1000);
    $('p-acc').textContent = `± ${Math.round(inputs.fixUncertaintyM)} m`;

    const recovering = inputs.sol < C.sensorimotor_recovery_days;
    $('c-sol-v').textContent = `Sol ${inputs.sol}`;
    $('c-state').textContent = `${recovering ? 'balance still recovering' : 'balance recovered'}${inputs.sansAffected ? ', vision changes' : ''}`;
    $('c-walk').textContent = fmtNum(derived.limits.speedKmh, 1, ' km/h');
    $('c-slope').textContent = fmtNum(derived.limits.maxSlopeDeg, 0, '°');

    $('r-km').textContent = fmtKm(derived.routeHomeKm);
    renderCompare(inputs, derived);
  }

  return function render({ inputs, derived }) {
    $('clk-sol').textContent = inputs.sol;
    $('clk-ltst').textContent = fmtLtst(inputs.ltst);
    $('clk-eva').textContent = `${Math.round(inputs.evaMin)} min`;

    renderTabs(inputs, derived);
    renderFactors(derived.budget, derived, inputs);
    $('verdict').textContent = verdictSentence(derived.budget);
    $('verdict').dataset.status = derived.budget.status;
    const events = eventsNow();
    if (events !== builtFor) { builtFor = events; checkpoints = buildTimeline(events); } // the run changed: rebuild the markers (DOM only)
    markCheckpoints(checkpoints, inputs.scenarioT);

    const banner = $('banner');
    if (inputs.sepActive) {
      const txt = `Solar storm: ${derived.budget.headline === 'AT SHELTER' ? 'the astronaut is in the shelter' : 'return to shelter'}. Replay of May 2024: NASA says an astronaut at Gale would have received ${data.C.may2024_sep_dose_ugy.toLocaleString()} micrograys, about 30 chest X-rays.`;
      if (banner.textContent !== txt) banner.textContent = txt;   // only real changes restart the 10 s countdown
      if (banner.hidden) banner.hidden = false;
    } else banner.hidden = true;

    for (const [id, out, key, fmt] of sliders) {
      $(id).value = inputs[key];
      $(out).textContent = fmt(inputs[key]);
    }
    showSpeed(getSpeed?.() ?? 1);
    $('c-sep').checked = runHasSep?.() ?? inputs.sepActive; // run setting with a scenario file, else the live value
    $('c-sans').checked = inputs.sansAffected;
    $('c-mode').value = inputs.routeMode;
  };
}
