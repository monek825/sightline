// Written with AI assistance (Claude / GitHub Copilot)
// Graphics quality preference shared by the main 3D view (map/map.js) and the helmet view (helmet/helmet.js).
// One setting for both: 'auto' | 'low' | 'medium' | 'high', kept in localStorage (same origin, so the helmet iframe
// sees it too; it also gets the browser's 'storage' event when the main page changes it). Visual only.

export const GFX_KEY = 'sightline-gfx';
export const GFX_LEVELS = ['low', 'medium', 'high'];
export const GFX_CHOICES = ['auto', ...GFX_LEVELS];

// Phones, tablets and machines with <= 4 cores or <= 4 GB RAM start on Low when the choice is Auto.
export const LOW_END = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || (navigator.hardwareConcurrency ?? 8) <= 4 || (navigator.deviceMemory ?? 8) <= 4;

export function gfxChoice() {
  try {
    const v = localStorage.getItem(GFX_KEY);
    return GFX_CHOICES.includes(v) ? v : 'auto';
  } catch { return 'auto'; }  // storage blocked (private mode): Auto
}

export function setGfxChoice(v) {
  if (!GFX_CHOICES.includes(v)) return;
  try { localStorage.setItem(GFX_KEY, v); } catch { /* not saved; still applied for this page */ }
  window.dispatchEvent(new CustomEvent('sightline-gfx', { detail: v }));
}

/** The level Auto starts on before any frame-time measurement. */
export const autoStartLevel = () => (LOW_END ? 'low' : 'medium');

/** One step down, for Auto when frames are slow. */
export const stepDown = level => GFX_LEVELS[Math.max(0, GFX_LEVELS.indexOf(level) - 1)];
