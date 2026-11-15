// Written with AI assistance (Claude / GitHub Copilot)
// Runs the live Horizon Match (skyline/livematch.js) off the main thread, so the map and the panel animation stay
// smooth while ~3,800 horizons are computed. Loads and parses the 40 m grid itself, once.
import { liveMatchSteps } from './livematch.js';

let gridP = null;
const loadGrid = () => (gridP ??= fetch(new URL('../data/heightgrid40.json', import.meta.url))
  .then(r => (r.ok ? r.json() : null))
  .then(g => (g && Number.isInteger(g.w) && Number.isInteger(g.h) && g.data?.length === g.w * g.h ? { ...g, data: Float32Array.from(g.data) } : null))
  .catch(() => null));

self.onmessage = async e => {
  const { id, o, fallbackGrid } = e.data;
  try {
    const grid = (await loadGrid()) ?? fallbackGrid;
    if (!grid) throw new Error('no elevation grid');
    const it = liveMatchSteps({ ...o, grid });
    for (;;) {
      const st = it.next();
      if (st.done) { self.postMessage({ id, result: st.value }); return; }
      self.postMessage({ id, progress: st.value });
    }
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
