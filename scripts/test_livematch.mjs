// Written with AI assistance (Claude / GitHub Copilot)
// Accuracy check of skyline/livematch.js (the browser's live Horizon Match) at seeded random positions in the crater.
// Run: node scripts/test_livematch.mjs [positions=40]   Prints error / uncertainty / fix-claimed / false-fix per visibility.
import fs from 'node:fs';
import { liveMatch, deadReckoningPrior, seedOf } from '../skyline/livematch.js';

const grid = JSON.parse(fs.readFileSync(new URL('../data/heightgrid40.json', import.meta.url)));
const meta = JSON.parse(fs.readFileSync(new URL('../data/meta.json', import.meta.url)));
const b = meta.bounds, N = Number(process.argv[2] || 40);
const mLat = 2 * Math.PI * 3396190 / 360;
let s = 12345;
const u = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const pts = [];
const margin = 4000 / mLat;                       // stay 4 km inside the DTM so the 3 km search fits
while (pts.length < N) pts.push({ lat: b.latMin + margin + u() * (b.latMax - b.latMin - 2 * margin), lon: b.lonMin + margin * 1.06 + u() * (b.lonMax - b.lonMin - 2.12 * margin) });

for (const vis of [Infinity, 6, 3, 1.5, 1]) {
  const t0 = Date.now();
  const rows = pts.map(p => {
    const prior = deadReckoningPrior(p, 1500, seedOf(p.lat, p.lon));          // 0.45-1.5 km dead-reckoning error
    return liveMatch({ grid, bounds: b, truth: p, prior, eyeM: 1.7, visKm: vis });
  });
  const ms = (Date.now() - t0) / rows.length;
  const err = rows.map(r => r.errorM).sort((a, c) => a - c);
  const fixes = rows.filter(r => r.fix);
  const falseF = fixes.filter(r => r.errorM > Math.max(300, 2 * Math.max(100, r.uncertaintyM)));
  const fe = fixes.map(r => r.errorM).sort((a, c) => a - c);
  console.log(`vis ${String(vis).padStart(8)} km | ${ms.toFixed(0)} ms/run | median err ${err[err.length >> 1]} m, 90% ${err[Math.floor(err.length * 0.9)]} m, worst ${err.at(-1)} m | ` +
    `fix claimed ${fixes.length}/${rows.length}, false ${falseF.length}, worst claimed ${fe.at(-1) ?? '-'} m, median claimed ${fe[fe.length >> 1] ?? '-'} m`);
}
