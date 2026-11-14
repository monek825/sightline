// Written with AI assistance (Claude / GitHub Copilot)
// Intro: thin line → second line swings up to 30° (quadratic ease-out) → SL logo appears in the wedge →
// eye-blink reveal of the app (mechanism from the component hub's eye-blink transition: SVG mask ellipse
// scaleY 0→1, 500 ms cubic-bezier(.7,0,.2,1), then a 180 ms overlay fade).
// Timing lives in CSS; this file only steps the phases. Skipped under prefers-reduced-motion.

const PHASES = [
  ['line', 0],      // 1. baseline draws
  ['angle', 550],   // 2. second line swings to 30°
  ['logo', 1150],   // 3. SL appears in the wedge
  ['open', 2000]    // 4. mark fades, eye opens
];
const OPEN_MS = 250 + 500, FADE_MS = 180; // mark fades 250 ms, then the eye opens over 500 ms
const MAX_WAIT_MS = 6000; // never hold the app longer than this, even if boot is slow

const intro = document.getElementById('intro');
const later = ms => new Promise(r => setTimeout(r, ms));

function done() {
  intro.remove();
  document.body.classList.remove('intro-on');
}

async function run() {
  if (!intro) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
  const booted = new Promise(r => {
    if (window.sightlineReady) r();
    else window.addEventListener('sightline:ready', r, { once: true });
  });
  // the app opens in 3D: also wait for the terrain mesh (A-Frame events bubble to document)
  const terrain = new Promise(r => document.addEventListener('terrain-loaded', r, { once: true }));
  const ready = Promise.all([booted, terrain]);
  void intro.offsetHeight; // commit the closed state before the first phase (hub gotcha: double rAF)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t0 = performance.now();
  for (const [phase, at] of PHASES) {
    if (phase === 'open') await Promise.race([ready, later(MAX_WAIT_MS)]); // hold on the logo until the app has booted
    await later(Math.max(0, at - (performance.now() - t0)));
    intro.classList.add(`is-${phase}`);
  }
  await later(OPEN_MS);
  intro.classList.add('is-gone');
  await later(FADE_MS);
  done();
}

run().catch(done);
