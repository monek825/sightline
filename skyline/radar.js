// Written with AI assistance (Claude / GitHub Copilot)
// Horizon Match "look around" on the 2D map: a radar line starts pointing north at the astronaut and sweeps once
// clockwise; behind it the outline of the hills the astronaut sees is drawn as a ring (further out = higher hill).
// Visual only: the outline is the skyline profile the match uses (s.observed, index 0 = north, clockwise).

const NS = 'http://www.w3.org/2000/svg';
const M_PER_DEG = 2 * Math.PI * 3396190 / 360;
const R_OUT_M = 900, R_IN_M = 380;   // ring size on the ground (drawn size only, not a distance the hills are at)

const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * @param {L.Map} map  Leaflet map
 * @param {{lat:number, lon:number}} c  astronaut position
 * @param {number[]} observed  horizon elevation (deg) per azimuth step, north first, clockwise
 * @param {number} ms  sweep duration
 * @param {boolean} reduced  prefers-reduced-motion: draw the finished outline at once
 * @returns {{ remove(): void }}
 */
export function radarSweep(map, c, observed, ms, reduced) {
  const dLat = R_OUT_M * 1.15 / M_PER_DEG, dLon = R_OUT_M * 1.15 / (M_PER_DEG * Math.cos(c.lat * Math.PI / 180));
  const W = 200, C = W / 2, k = (W / 2) / (R_OUT_M * 1.15);       // svg units per metre (square box, equal scale)
  const rIn = R_IN_M * k, rOut = R_OUT_M * k;
  const lo = Math.min(...observed), hi = Math.max(...observed), span = Math.max(0.5, hi - lo);
  const n = observed.length;
  const pt = i => {
    const az = i / (n - 1) * 2 * Math.PI, r = rIn + (observed[i] - lo) / span * (rOut - rIn);
    return [C + r * Math.sin(az), C - r * Math.cos(az)];
  };
  const root = el('svg', { viewBox: `0 0 ${W} ${W}`, class: 'radar', 'aria-hidden': 'true' });
  root.append(
    el('circle', { cx: C, cy: C, r: rOut, class: 'radar-ring' }),
    el('circle', { cx: C, cy: C, r: rIn, class: 'radar-ring' }),
    el('text', { x: C, y: C - rOut - 3, class: 'radar-n', 'text-anchor': 'middle' })
  );
  root.lastChild.textContent = 'N';
  const hills = el('path', { class: 'radar-hills', d: '' });
  const beam = el('line', { x1: C, y1: C, x2: C, y2: C - rOut, class: 'radar-beam' });
  root.append(hills, beam, el('circle', { cx: C, cy: C, r: 3.5, class: 'radar-me' }));
  const layer = L.svgOverlay(root, [[c.lat - dLat, c.lon - dLon], [c.lat + dLat, c.lon + dLon]], { interactive: false, className: 'radar-layer' }).addTo(map);

  const draw = f => {
    const m = Math.max(2, Math.round(f * n));
    let d = '';
    for (let i = 0; i < m; i++) { const [x, y] = pt(i); d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }
    if (f >= 1) d += 'Z';
    hills.setAttribute('d', d);
    beam.setAttribute('transform', `rotate(${(f * 360).toFixed(1)} ${C} ${C})`);
  };
  let raf = 0;
  if (reduced) draw(1);
  else {
    const t0 = performance.now();
    const tick = now => { const f = Math.min(1, (now - t0) / ms); draw(f); if (f < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }
  return { remove() { cancelAnimationFrame(raf); layer.remove(); } };
}
