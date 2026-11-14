// Written with AI assistance (Claude / GitHub Copilot)
// Micro-interactions that CSS can't do alone. Read-only: never touches state.
// - value glow: a number that changes gets a short .bump (panels.js sets textContent every frame, so compare text)
// - magnetic pull on [data-magnetic] (ERA hover kit), fine pointers only
// Both are skipped under prefers-reduced-motion.

const BUMP_IDS = ['b-headline', 'b-return', 'b-suit', 'b-turn', 'd-vis', 'p-unc', 'r-km', 'c-sol-v'];
const MAGNET_PX = 6;
const BUMP_COOLDOWN_MS = 2500; // while the demo plays, numbers tick every frame: glow at most this often

function watchValues() {
  const last = new WeakMap();
  const lastBump = new WeakMap();
  const obs = new MutationObserver(records => {
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      const text = el.textContent;
      if (last.get(el) === text) continue;
      const had = last.has(el);
      last.set(el, text);
      if (!had || text === '–') continue; // first paint: no glow
      const now = performance.now();
      if (el.id !== 'b-headline' && now - (lastBump.get(el) ?? -Infinity) < BUMP_COOLDOWN_MS) continue;
      lastBump.set(el, now);
      el.classList.remove('bump');
      void el.offsetWidth; // restart the animation
      el.classList.add('bump');
    }
  });
  for (const id of BUMP_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    last.set(el, el.textContent);
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    el.addEventListener('animationend', () => el.classList.remove('bump'));
  }
}

function magnetic() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  for (const el of document.querySelectorAll('[data-magnetic]')) {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2 * MAGNET_PX;
      const y = ((e.clientY - r.top) / r.height - 0.5) * 2 * MAGNET_PX;
      el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    });
    el.addEventListener('pointerleave', () => { el.style.translate = ''; });
  }
}

export function initMotion() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  watchValues();
  magnetic();
}
