// Written with AI assistance (Claude / GitHub Copilot)
// Helmet mini-map: the Map button pops up a small 2D map (orbital basemap) with where you are (orange arrow + the
// position-guess ring), home (white) and the route home. It listens to the same sightline:state messages as the HUD
// and draws only while open.
const $ = (id) => document.getElementById(id);
const PAD = 0.18;            // share of the map kept around you and home
const MIN_SPAN_M = 1500;     // never zoom in closer than this across
const R = 3396190;           // Mars radius (m), as in data/meta.json

let meta = null, state = null, img = null;
const btn = $('map-btn'), card = $('map-card'), cv = $('map-cv');

function draw() {
  if (!card || card.hidden || !meta || !state || !img?.complete) return;
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, b = meta.bounds;
  const a = state.inputs.astronaut, home = meta.home;
  // metres per degree here, so the view box is square in metres
  const mLat = Math.PI / 180 * R, mLon = mLat * Math.cos(a.lat * Math.PI / 180);
  const unc = Number.isFinite(state.derived.posUncertaintyM) ? state.derived.posUncertaintyM : 0;
  const spanM = Math.max(MIN_SPAN_M, Math.abs(a.lat - home.lat) * mLat, Math.abs(a.lon - home.lon) * mLon, unc * 2.4) * (1 + 2 * PAD);
  const cLat = (a.lat + home.lat) / 2, cLon = (a.lon + home.lon) / 2;
  const px = (lat, lon) => [W / 2 + (lon - cLon) * mLon / spanM * W, H / 2 - (lat - cLat) * mLat / spanM * H];
  // basemap crop: image pixels cover meta.bounds
  const ix = (lon) => (lon - b.lonMin) / (b.lonMax - b.lonMin) * img.naturalWidth;
  const iy = (lat) => (b.latMax - lat) / (b.latMax - b.latMin) * img.naturalHeight;
  const halfLat = spanM / 2 / mLat, halfLon = spanM / 2 / mLon;
  ctx.fillStyle = '#7a5a40'; ctx.fillRect(0, 0, W, H);
  const sx = ix(cLon - halfLon), sy = iy(cLat + halfLat);
  ctx.drawImage(img, sx, sy, ix(cLon + halfLon) - sx, iy(cLat - halfLat) - sy, 0, 0, W, H);
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#e0a272'; ctx.fillRect(0, 0, W, H);   // Mars tint (works in Safari too)
  ctx.globalCompositeOperation = 'source-over';
  // route home
  const r = state.derived.routeHome;
  if (r?.ok && Array.isArray(r.points) && r.points.length > 1) {
    ctx.beginPath();
    r.points.forEach(([la, lo], i) => { const [x, y] = px(la, lo); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.setLineDash([7, 5]); ctx.stroke(); ctx.setLineDash([]);
  }
  // home
  const [hx, hy] = px(home.lat, home.lon);
  ctx.beginPath(); ctx.arc(hx, hy, 7, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1a110c'; ctx.stroke();
  label(ctx, 'Home', hx, hy - 14);
  // you: position-guess ring + arrow
  const [x, y] = px(a.lat, a.lon), ur = unc / spanM * W;
  if (ur > 4) { ctx.beginPath(); ctx.arc(x, y, ur, 0, 2 * Math.PI); ctx.fillStyle = 'rgba(255,138,61,.16)'; ctx.fill(); ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2; ctx.stroke(); }
  ctx.save(); ctx.translate(x, y); ctx.rotate((a.headingDeg || 0) * Math.PI / 180);
  ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 8); ctx.lineTo(0, 4); ctx.lineTo(-8, 8); ctx.closePath();
  ctx.fillStyle = '#ff8a3d'; ctx.fill(); ctx.strokeStyle = '#1a110c'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  label(ctx, ur > 4 ? `You (±${Math.round(unc)} m)` : 'You', x, y + 26);
}

function label(ctx, text, x, y) {
  ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 14;
  x = Math.min(ctx.canvas.width - w / 2 - 4, Math.max(w / 2 + 4, x));   // keep it inside the card
  ctx.fillStyle = 'rgba(20,12,8,.82)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 11, w, 22, 11); ctx.fill();
  ctx.fillStyle = '#f6ebdf'; ctx.fillText(text, x, y);
}

function toggle(open = card.hidden) {
  card.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) draw();
}

export function setupMinimap() {
  if (!btn || !card || !cv) return;
  fetch('../data/meta.json').then((r) => (r.ok ? r.json() : null)).then((m) => { meta = m; draw(); }).catch(() => {});
  img = new Image(); img.onload = draw; img.src = '../data/basemap.png';
  btn.addEventListener('click', () => toggle());
  card.querySelector('button')?.addEventListener('click', () => toggle(false));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !card.hidden) toggle(false); });
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    const m = e.data;
    if (m?.type !== 'sightline:state' || !Number.isFinite(m.inputs?.astronaut?.lat) || !Number.isFinite(m.inputs?.astronaut?.lon)) return;
    state = m; draw();
  });
}
setupMinimap();
