// Written with AI assistance (Claude / GitHub Copilot)
// Panels: frosted category panel (3 question tabs), bottom drawer (timeline + details), clock, banner,
// sources modal, data badge. Renders from the store; control events call setInputs (user actions only).

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
const SEVERITY = { RED: 0, AMBER: 1, GREEN: 2 };

const EVENT_LABELS = { eva_start: 'EVA start', sep_onset: 'Solar storm', skyline_fix: 'Skyline fix', eva_end: 'EVA end' };
const eventLabel = ev => (ev.type === 'tau' ? `Dust τ ${ev.value}` : EVENT_LABELS[ev.type] ?? ev.type);

function buildTimeline(data) {
  const events = data.scenario?.events ?? [];
  if (!events.length) return [];
  const end = events[events.length - 1].tMin;
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
  if (nasa && est) return ['NASA data + estimate', 'tag tag-nasa'];
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

function factorItem(f, byKey) {
  const li = el('li', f.level);
  li.dataset.key = f.keys?.[0] || '';
  li.tabIndex = 0;
  const text = el('div');
  text.append(el('strong', '', f.label));
  const tag = tagFor(f.keys || [], byKey);
  if (tag) text.append(el('span', tag[1], tag[0]));
  text.append(el('div', '', f.message));
  li.append(el('span', 'dot'), text);
  return li;
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
function wireTabs() {
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
  notch.addEventListener('click', () => {
    const open = more.hidden;
    more.hidden = !open;
    notch.setAttribute('aria-expanded', String(open));
    $('drawer').classList.toggle('open', open);
  });
}

export function createPanels(data, { setInputs, usingStubs }) {
  buildSources(data);
  dataBadge(data, usingStubs);
  const checkpoints = buildTimeline(data);
  wireTabs();
  wireDrawer();
  wireFactorLists();
  $('btn-sources').addEventListener('click', () => openSources());

  const sliders = [
    ['c-sol', 'o-sol', 'sol', v => `${v}`],
    ['c-ltst', 'o-ltst', 'ltst', fmtLtst],
    ['c-tau', 'o-tau', 'tau', v => Number(v).toFixed(1)]
  ];
  for (const [id, , key] of sliders) {
    $(id).addEventListener('input', e => setInputs({ [key]: Number(e.target.value) }));
  }
  $('c-sep').addEventListener('change', e => setInputs({ sepActive: e.target.checked }));
  $('c-sans').addEventListener('change', e => setInputs({ sansAffected: e.target.checked }));
  $('c-mode').addEventListener('change', e => setInputs({ routeMode: e.target.value }));

  let lastSig = '';
  function renderFactors(bdg, derived) {
    const sig = JSON.stringify(bdg.factors.map(f => [f.id, f.level, f.message])) + derived.warnings.join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    const sorted = [...bdg.factors].sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level]);
    for (const list of document.querySelectorAll('.factors[data-group]')) {
      // ponytail: tabs show only AMBER/RED (what needs attention); all factors stay in the Details drawer
      list.replaceChildren(...sorted.filter(f => groupOf(f) === list.dataset.group && f.level !== 'GREEN').map(f => factorItem(f, data.constantsByKey)));
    }
    const all = sorted.map(f => factorItem(f, data.constantsByKey));
    for (const w of derived.warnings) {
      const li = el('li', 'AMBER');
      li.append(el('span', 'dot'), el('div', '', w));
      all.push(li);
    }
    $('alerts').replaceChildren(...all);
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
      if (same) note = `Same path as the ${label(alt.mode).toLowerCase()} route here.`;
      else if (a.mode === 'shortest') // chosen is shortest: say what the safest route would cost and gain
        note = `The safest route would be ${mins(-dMin)}, keeping home in sight ${sight(alt)}% of the way (${sight(a)}% on the shortest route).`;
      else if (dMin > 0 && dSight > 0) note = `${mins(dMin)}, but home stays in sight ${sight(a)}% of the way (${sight(alt)}% on the shortest route).`;
      else note = `${mins(dMin)} and home in sight ${sight(a)}% of the way (${sight(alt)}% on the shortest route).`;
    }
    $('r-cmp-note').textContent = note;
    $('r-cmp-note').hidden = !note;
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
    $('now-devil').hidden = !(inputs.ltst >= C.dust_devil_peak_start_ltst && inputs.ltst <= C.dust_devil_peak_end_ltst);

    $('p-unc').textContent = Number.isFinite(derived.posUncertaintyM) ? `± ${Math.round(derived.posUncertaintyM)} m` : '–';
    $('p-since').textContent = fmtKm(inputs.distSinceFixM / 1000);
    $('p-acc').textContent = `± ${Math.round(inputs.fixUncertaintyM)} m`;

    const recovering = inputs.sol < C.sensorimotor_recovery_days;
    $('c-sol-v').textContent = `Sol ${inputs.sol}`;
    $('c-state').textContent = `${recovering ? 'balance still recovering' : 'balance recovered'}${inputs.sansAffected ? ' · vision changes' : ''}`;
    $('c-speed').textContent = fmtNum(derived.limits.speedKmh, 1, ' km/h');
    $('c-slope').textContent = fmtNum(derived.limits.maxSlopeDeg, 0, '°');

    $('r-km').textContent = fmtKm(derived.routeHomeKm);
    renderCompare(inputs, derived);
  }

  return function render({ inputs, derived }) {
    const scenarioOn = inputs.scenarioT !== null;
    $('clk-sol').textContent = inputs.sol;
    $('clk-ltst').textContent = fmtLtst(inputs.ltst);
    $('clk-eva').textContent = `${Math.round(inputs.evaMin)} min`;

    renderTabs(inputs, derived);
    renderFactors(derived.budget, derived);
    markCheckpoints(checkpoints, inputs.scenarioT);

    const banner = $('banner');
    if (inputs.sepActive) {
      banner.textContent = `Solar storm: return to shelter. Replay of May 2024, when Curiosity measured ${data.C.may2024_sep_dose_ugy.toLocaleString()} µGy at Mars.`;
      banner.hidden = false;
    } else banner.hidden = true;

    for (const [id, out, key, fmt] of sliders) {
      $(id).value = inputs[key];
      $(out).textContent = fmt(inputs[key]);
      $(id).disabled = scenarioOn;
    }
    $('c-sep').checked = inputs.sepActive; $('c-sep').disabled = scenarioOn;
    $('c-sans').checked = inputs.sansAffected;
    $('c-mode').value = inputs.routeMode;
  };
}
