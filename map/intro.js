// Written with AI assistance (Claude / GitHub Copilot)
// Loader: the SL logo fills from grey to white as the app loads (quadratic ease-out), then eyelids open.
// Progress is real: each loading milestone sets a target; CSS animates toward it on the compositor.
//   start → creeps to 60 % over a few seconds (so it always moves)
//   app booted (data + store) → 75 %
//   terrain mesh built → 92 %
//   terrain drawn on screen (3 frames later) → 100 %, then open
// Eyelid reveal adapted from the component hub's eye-blink transition (650 ms cubic-bezier(.7,0,.2,1)).

const MAX_WAIT_MS = 15000;      // after the data is in, wait at most this long for the 3D terrain
const SLOW_MS = 9000;           // then say the connection is slow
const FILL_MS = 600, OPEN_MS = 150 + 650, FADE_MS = 200;

const intro = document.getElementById('intro');
const later = ms => new Promise(r => setTimeout(r, ms));
const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
let shown = 0;
const QUAD_OUT = 'cubic-bezier(.5, 1, .89, 1)';
const set = (p, ms, ease = QUAD_OUT) => {
  intro.style.setProperty('--dur', `${ms}ms`);
  intro.style.setProperty('--ease', ease);
  intro.style.setProperty('--p', String(p));
};
// Milestone: a quick quadratic-ease-out jump. Between milestones: linear creep segments, each covering a third of the
// remaining gap to 99 % over 2.5 s, so the bar keeps moving, slower and slower, and never fully stops.
let creepTimer = 0, at = 0;
const SEG_MS = 2500, CAP = 0.99;
function creep() {
  at += (CAP - at) / 3 * (at < 0.9 ? 1 : 0.5);
  set(at, SEG_MS, 'linear');
  creepTimer = setTimeout(creep, SEG_MS);
}
const progress = (p, ms = FILL_MS) => {
  if (p <= shown) return;
  shown = p; at = Math.max(at, p); // never move backwards if the creep already passed this milestone
  clearTimeout(creepTimer);
  set(at, ms);
  if (p < 1) creepTimer = setTimeout(creep, ms);
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
  progress(0.12, 400);
  // never open before the data has loaded (an empty app is worse than a longer wait); only the 3D terrain wait is capped
  const slow = setTimeout(() => {
    const lines = intro.querySelector('.intro-lines');
    if (!lines) return;
    const msg = document.createElement('span');
    msg.className = 'slow';
    msg.textContent = 'Slow connection: still downloading the NASA terrain (about 8 MB)…';
    lines.replaceChildren(msg);
  }, SLOW_MS);
  await Promise.all([booted, Promise.race([drawn, failed, later(MAX_WAIT_MS)])]);
  clearTimeout(slow);
  progress(1);
  await later(FILL_MS);
  intro.classList.add('is-open');
  await later(OPEN_MS);
  intro.classList.add('is-gone');
  await later(FADE_MS);
  done();
}

run().catch(done);
