// Written with AI assistance (Claude / GitHub Copilot)
// "Compare with Perseverance photo": the real-photo Horizon Match tests (scripts/skyline_real.py -> data/skyline_real/).
// For each of the 5 rover positions it shows the skyline traced from Perseverance's Navcam photos next to the skyline
// this app computes from NASA's 3D map (CTX + MOLA) at the spot where the rover really stood, and how far the match was off.
// Text from data files is inserted with textContent only.

const SVG_NS = 'http://www.w3.org/2000/svg';
const DIR = 'data/skyline_real/';
// best example first; `photo` = the single Navcam frame of that panorama kept as a .jpg (data/skyline_real/<photo>.json)
const POSITIONS = [
  { id: 'site090_drive5110', photo: 'sol1946' },
  { id: 'site061_drive1928' },
  { id: 'site045_drive0000' },
  { id: 'site033_drive4752' },
  { id: 'site007_drive1716', photo: 'sol204' }
];
const W = 720, H = 190, PAD = 12;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const svg = (tag, attrs) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const fmtDist = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const cache = new Map();
const load = name => {
  if (!cache.has(name)) cache.set(name, fetch(`${DIR}${name}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(name);
};
const setLabel = set => (String(set).startsWith('development') ? 'Used while developing'
  : String(set).includes('post-fix') ? 'Held out, re-run after a fix' : 'Held out');

let ui = null;

function build() {
  const dlg = el('dialog', 'dlg realcmp');
  dlg.setAttribute('aria-labelledby', 'rp-h');
  const head = el('div', 'dlg-head');
  const h = el('h2', null, 'Our skyline vs Perseverance photos');
  h.id = 'rp-h';
  const close = el('button', 'icon-btn');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close'); close.title = 'Close';
  const xs = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  xs.append(svg('path', { d: 'M6 6l12 12M18 6 6 18' }));
  close.append(xs);
  head.append(h, close);

  const body = el('div', 'dlg-body');
  const lead = el('p', 'rp-lead', 'A real test, not a simulation. Perseverance photographed the hills all the way round at 5 spots in Jezero. We traced the skyline in its photos and compared it with the skyline Sightline computes from NASA\'s 3D map at the spot where the rover really stood.');
  const picks = el('div', 'rp-picks');
  picks.setAttribute('role', 'group');
  picks.setAttribute('aria-label', 'Rover position');
  const view = el('div', 'rp-view');
  const foot = el('p', 'rp-note', 'Five spots are too few to quote an error rate, and 3 of them were used while developing the method. Photos: NASA/JPL-Caltech (Perseverance Navcam raw images). Terrain: CTX elevation model (USGS / NASA) with MOLA for far hills.');
  body.append(lead, picks, view, foot);
  dlg.append(head, body);
  document.body.append(dlg);

  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { const op = ui.opener; ui.opener = null; if (op?.isConnected) op.focus(); });
  return { dlg, picks, view, opener: null, token: 0 };
}

function chart(p, band) {
  const obs = p.observed, model = p.horizonAtWaypointFull, az = p.azimuthsDeg;
  const vals = obs.concat(model).filter(Number.isFinite);
  const lo = Math.floor(Math.min(...vals)) - 0.5, hi = Math.ceil(Math.max(...vals)) + 0.5;
  const x = a => PAD + a / 360 * (W - 2 * PAD);
  const y = v => H - PAD - (v - lo) / (hi - lo) * (H - 2 * PAD);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rp-chart', role: 'img',
    'aria-label': 'Skyline from the photos (dots) and from NASA\'s 3D map (line), all the way round' });
  if (band) { // the part of the circle that the photo above shows (may wrap past north)
    const a0 = ((band.center - band.fov / 2) % 360 + 360) % 360, a1 = a0 + band.fov;
    const rect = (from, to) => s.append(svg('rect', { x: x(from), y: PAD, width: x(to) - x(from), height: H - 2 * PAD, class: 'band' }));
    if (a1 <= 360) rect(a0, a1); else { rect(a0, 360); rect(0, a1 - 360); }
  }
  for (let v = Math.ceil(lo); v <= hi; v += 2) s.append(svg('line', { x1: PAD, x2: W - PAD, y1: y(v), y2: y(v), class: 'grid' }));
  let seg = [];
  const flush = () => { if (seg.length > 1) s.append(svg('polyline', { points: seg.join(' '), class: 'model' })); seg = []; };
  az.forEach((a, i) => { if (Number.isFinite(model[i])) seg.push(`${x(a).toFixed(1)},${y(model[i]).toFixed(1)}`); else flush(); });
  flush();
  az.forEach((a, i) => { if (Number.isFinite(obs[i])) s.append(svg('circle', { cx: x(a).toFixed(1), cy: y(obs[i]).toFixed(1), r: 2.6, class: 'obs' })); });
  return s;
}

function photoFigure(ph) {
  const fig = el('figure', 'rp-photo');
  const frame = el('div', 'rp-frame');
  const [w, h] = ph.imageSizePx;
  const img = el('img');
  img.src = `${DIR}${ph.id}.jpg`;
  img.alt = `Perseverance Navcam photo, sol ${ph.sol}, looking at the hills`;
  img.width = w; img.height = h;
  const over = svg('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  over.append(svg('polyline', { points: ph.traceXY.map(([px, py]) => `${px},${py}`).join(' '), class: 'trace' }));
  frame.append(img, over);
  fig.append(frame, el('figcaption', null, `One of the photos (sol ${ph.sol}, NASA/JPL-Caltech). Blue line: the skyline traced from it. It is the shaded part of the chart below.`));
  return fig;
}

async function show(i) {
  const token = ++ui.token;
  const pos = POSITIONS[i];
  ui.picks.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
  const [p, ph] = await Promise.all([load(`${pos.id}_pano`), pos.photo ? load(pos.photo) : null]);
  if (token !== ui.token) return;
  ui.view.replaceChildren();
  if (!p || !Array.isArray(p.observed) || !Array.isArray(p.horizonAtWaypointFull) || !Array.isArray(p.azimuthsDeg)) {
    ui.view.append(el('p', 'rp-result', 'Could not load this test.'));
    return;
  }
  const ok = p.errorM <= 500;
  const res = el('p', 'rp-result');
  res.append(el('strong', ok ? 'good' : 'bad', ok ? `${fmtDist(p.errorM)} off` : `${fmtDist(p.errorM)} off, no fix`),
    document.createTextNode(` · Horizon Match on these photos, sol ${p.waypoint?.sol ?? '?'} · ${setLabel(p.set)}`));
  ui.view.append(res);
  const frame = ph && Array.isArray(p.frames) ? p.frames.find(f => f.imageId === ph.imageId) : null;
  if (ph && Array.isArray(ph.imageSizePx) && Array.isArray(ph.traceXY)) ui.view.append(photoFigure(ph));
  const band = frame && Number.isFinite(frame.trueBoresightAzDeg) && Number.isFinite(ph.fovDeg) ? { center: frame.trueBoresightAzDeg, fov: ph.fovDeg } : null;
  ui.view.append(chart(p, band));
  const axis = el('p', 'skyfix-axis');
  axis.setAttribute('aria-hidden', 'true');
  for (const d of ['N', 'E', 'S', 'W', 'N']) axis.append(el('span', null, d));
  const legend = el('p', 'rp-legend');
  legend.append(el('span', 'k-photo', 'Skyline in Perseverance\'s photos'), el('span', 'k-model', 'Skyline from NASA\'s 3D map at the rover\'s real spot'));
  const scale = el('p', 'rp-scale', 'Height of the hills above level, in degrees (grid lines every 2°), all the way round.');
  ui.view.append(axis, legend, scale);
  if (!ok) ui.view.append(el('p', 'rp-explain', 'Here the two skylines differ too much, so the match landed far away. We show it because it really happened.'));
}

/** Opens the comparison as a modal dialog. opener gets focus back when it closes. */
export async function openRealPhoto(opener) {
  if (!ui) {
    ui = build();
    const metas = await Promise.all(POSITIONS.map(p => load(`${p.id}_pano`)));
    POSITIONS.forEach((pos, i) => {
      const m = metas[i];
      const b = el('button', 'btn', `Sol ${m?.waypoint?.sol ?? '?'}`);
      b.type = 'button';
      if (m && Number.isFinite(m.errorM)) b.append(el('span', 'sub', fmtDist(m.errorM)));
      b.addEventListener('click', () => show(i));
      ui.picks.append(b);
    });
  }
  ui.opener = opener ?? document.activeElement;
  if (!ui.dlg.open) ui.dlg.showModal();
  await show(0);
  ui.dlg.querySelector('.dlg-head .icon-btn')?.focus();
}
