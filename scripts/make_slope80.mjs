// Written with AI assistance (Claude / GitHub Copilot)
// Steepest local slope in and around each 80 m planning cell, from the 40 m NASA CTX grid (data/heightgrid40.json).
// The route planner works on 80 m cells; averaging slope over 80 m hid butte sides that are much steeper on the
// 40 m terrain the 3D view shows. Output: data/slope80.json { w, h, cellM, note, data: [max slope in whole degrees] }.
// Run: node scripts/make_slope80.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const g40 = JSON.parse(readFileSync(new URL('../data/heightgrid40.json', import.meta.url)));
const g80 = JSON.parse(readFileSync(new URL('../data/heightgrid.json', import.meta.url)));
const meta = JSON.parse(readFileSync(new URL('../data/meta.json', import.meta.url)));
const { w: W, h: H, data: z } = g40;
if (W !== g80.w * 2 || H !== g80.h * 2) throw new Error(`grids don't nest: 40 m ${W}x${H}, 80 m ${g80.w}x${g80.h}`);

const b = meta.bounds, R = 3396190;
const dy = (b.latMax - b.latMin) * Math.PI / 180 * R / H;
const dx = (b.lonMax - b.lonMin) * Math.PI / 180 * R * Math.cos((b.latMin + b.latMax) / 2 * Math.PI / 180) / W;
const dd = Math.hypot(dx, dy);
const NB = [[-1, 0, dy], [1, 0, dy], [0, -1, dx], [0, 1, dx], [-1, -1, dd], [-1, 1, dd], [1, -1, dd], [1, 1, dd]];

// steepest slope from each 40 m cell to any of its 8 neighbours (deg)
const s40 = new Float32Array(W * H);
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
  const a = z[r * W + c];
  let m = 0;
  for (const [nr, nc, d] of NB) {
    const rr = r + nr, cc = c + nc;
    if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
    const t = Math.abs(z[rr * W + cc] - a) / d;
    if (t > m) m = t;
  }
  s40[r * W + c] = Math.atan(m) * 180 / Math.PI;
}
// 80 m cell = max over its 2 x 2 sub-cells plus the ring of 40 m cells around them (4 x 4): steps between 80 m cell
// centres, especially diagonals, cross that ring, so a steep butte edge next to the cell still counts
const w = g80.w, h = g80.h, out = new Array(w * h);
let steep10 = 0, steep15 = 0;
for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
  let m = 0;
  for (let rr = 2 * r - 1; rr <= 2 * r + 2; rr++) for (let cc = 2 * c - 1; cc <= 2 * c + 2; cc++) {
    if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
    if (s40[rr * W + cc] > m) m = s40[rr * W + cc];
  }
  out[r * w + c] = Math.round(m * 10) / 10;
  if (m > 10) steep10++;
  if (m > 15) steep15++;
}
writeFileSync(new URL('../data/slope80.json', import.meta.url), JSON.stringify({
  w, h, cellM: 80,
  note: 'Steepest 40 m slope (deg) inside each 80 m cell, from data/heightgrid40.json (NASA CTX DTM). Built by scripts/make_slope80.mjs.',
  data: out
}));
console.log(`slope80: ${w}x${h}; cells steeper than 10°: ${(100 * steep10 / out.length).toFixed(1)}%, than 15°: ${(100 * steep15 / out.length).toFixed(1)}%`);
