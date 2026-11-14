// Written with AI assistance (Claude / GitHub Copilot)
// Intro: line → 30° wedge → SL logo (pure CSS keyframes, compositor-only, start at parse) → eyelids open.
// This file only decides WHEN to open: after the logo has shown, the app has booted, and the 3D terrain
// has been drawn at least once. Eyelid reveal adapted from the component hub's eye-blink transition
// (650 ms cubic-bezier(.7,0,.2,1)), rebuilt as two transform-animated lids so it never janks.

const MIN_SHOW_MS = 1900;   // let the line → wedge → logo sequence finish
const MAX_WAIT_MS = 15000;  // never hold the app longer than this (slow network)
const OPEN_MS = 200 + 650, FADE_MS = 200;

const intro = document.getElementById('intro');
const later = ms => new Promise(r => setTimeout(r, ms));
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });

function done() {
  intro?.remove();
  document.body.classList.remove('intro-on');
}

async function run() {
  if (!intro) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
  const t0 = performance.now();
  const booted = new Promise(r => {
    if (window.sightlineReady) r();
    else window.addEventListener('sightline:ready', r, { once: true });
  });
  // A-Frame events bubble to document; wait 3 frames after so the texture upload + shader compile are done
  const terrainDrawn = new Promise(r => document.addEventListener('terrain-loaded', r, { once: true })).then(() => frames(3));
  // if the user is on the 2D map (3D failed), don't wait for terrain
  const failed = new Promise(r => document.addEventListener('terrain-error', r, { once: true }));
  await Promise.race([Promise.all([booted, Promise.race([terrainDrawn, failed])]), later(MAX_WAIT_MS)]);
  await later(Math.max(0, MIN_SHOW_MS - (performance.now() - t0)));
  intro.classList.add('is-open');
  await later(OPEN_MS);
  intro.classList.add('is-gone');
  await later(FADE_MS);
  done();
}

run().catch(done);
