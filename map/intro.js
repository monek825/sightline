// Written with AI assistance (Claude / GitHub Copilot)
// Loader: the SL logo fills from grey to white as the app loads (quadratic ease-out), then eyelids open.
// Progress is real: each loading milestone sets a target; CSS animates toward it on the compositor.
//   start → creeps to 60 % over a few seconds (so it always moves)
//   app booted (data + store) → 75 %
//   terrain mesh built → 92 %
//   terrain drawn on screen (3 frames later) → 100 %, then open
// Eyelid reveal adapted from the component hub's eye-blink transition (650 ms cubic-bezier(.7,0,.2,1)).

const MAX_WAIT_MS = 15000;      // never hold the app longer than this
const FILL_MS = 600, OPEN_MS = 150 + 650, FADE_MS = 200;
const CREEP = { to: 0.6, ms: 5000 };

const intro = document.getElementById('intro');
const later = ms => new Promise(r => setTimeout(r, ms));
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
let shown = 0;
const progress = (p, ms = FILL_MS) => {
  if (p <= shown) return;
  shown = p;
  intro.style.setProperty('--dur', `${ms}ms`);
  intro.style.setProperty('--p', String(p));
};

function done() {
  intro?.remove();
  document.body.classList.remove('intro-on');
}

async function run() {
  if (!intro) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
  const booted = new Promise(r => {
    if (window.sightlineReady) r();
    else window.addEventListener('sightline:ready', r, { once: true });
  }).then(() => progress(0.75));
  const built = new Promise(r => document.addEventListener('terrain-loaded', r, { once: true })).then(() => progress(0.92));
  const drawn = built.then(() => frames(3));
  const failed = new Promise(r => document.addEventListener('terrain-error', r, { once: true })); // 2D fallback: don't wait
  await frames(2); // commit the empty state before the first transition
  progress(CREEP.to, CREEP.ms);
  await Promise.race([Promise.all([booted, Promise.race([drawn, failed])]), later(MAX_WAIT_MS)]);
  progress(1);
  await later(FILL_MS);
  intro.classList.add('is-open');
  await later(OPEN_MS);
  intro.classList.add('is-gone');
  await later(FADE_MS);
  done();
}

run().catch(done);
