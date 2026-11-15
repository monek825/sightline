// Written with AI assistance (Claude / GitHub Copilot)
// "How it works": what the map colours mean, how visibility, speed, slopes and turn-back are worked out, with the live
// numbers from data/crew_constants.json (through the same computeLimits the app uses). Text only via textContent.
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

export function setupHowto(data, M) {
  const dlg = document.getElementById('dlg-howto'), body = document.getElementById('howto-body'), btn = document.getElementById('btn-howto');
  if (!dlg || !body || !btn) return;
  const C = data.C;
  const lim = (over) => M.computeLimits({ sol: 12, tau: C.tau_typical, sansAffected: false, ...over }, C);
  const km = v => (v >= 10 ? `${Math.round(v)} km` : `${v.toFixed(1)} km`);
  const sec = (title, text, rows) => {
    const s = el('section', { className: 'howto-sec' }, el('h3', { textContent: title }), el('p', { textContent: text }));
    if (rows) s.append(el('dl', { className: 'howto-rows' }, ...rows.map(([k, v]) => el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: v })))));
    return s;
  };
  const build = () => body.replaceChildren(
    sec('The map: where you lose sight of home',
      `From NASA's Jezero elevation model we computed, for every patch of ground, what an astronaut standing there (eyes ${C.eye_height_m} m up, with Mars' curvature) can see.`,
      [['Red', 'no landmark in sight: nothing to steer by'], ['Yellow', 'the habitat is hidden behind terrain'], ['Clear', 'home or a landmark is in view']]),
    sec('Dust and how far you can see',
      'Dust is measured as optical depth τ (Perseverance measures it at Jezero). More dust, shorter sight lines, so the red zones grow.',
      [[`τ ${C.tau_typical} (normal)`, km(lim({}).visibilityKm)], [`τ ${C.tau_amber} (caution)`, km(lim({ tau: C.tau_amber }).visibilityKm)], [`τ ${C.tau_red} (turn back)`, km(lim({ tau: C.tau_red }).visibilityKm)]]),
    sec('Speed and slopes',
      `The body needs about ${C.sensorimotor_recovery_days} sols to readapt to gravity after landing, so early walks are slower and avoid steep ground.`,
      [['Walking, landing day', `${lim({ sol: 0 }).speedKmh.toFixed(1)} km/h`], ['Walking, recovered', `${lim({}).speedKmh.toFixed(1)} km/h`],
        ['Rover (Apollo average)', `${C.rover_speed_kmh} km/h`], [`Steepest slope, before sol ${C.sensorimotor_recovery_days}`, `${C.max_slope_early_deg}°`], ['Steepest slope, after', `${C.max_slope_deg}°`]]),
    sec('When to turn back',
      'The status card turns RETURN NOW at the first of these. The walk home is padded by 20 %, like Apollo did.',
      [['Dust', `τ above ${C.tau_red}`], ['Solar storm', 'any solar particle event: head for shelter'], ['Suit time', `${C.eva_design_hours} h minus a ${C.eva_reserve_min} min reserve, including the walk home`],
        ['Rover', 'never further than you could walk back if it breaks']]),
    sec('Position without GPS',
      `Counting steps drifts by about ${C.dead_reckoning_drift_pct} % of the distance walked. Horizon Match compares the hill outline you see with outlines from NASA terrain and pulls the position guess back in.`),
    sec('Where the numbers come from', 'Every number has a source, marked NASA data or team estimate.')
  );
  const src = el('button', { type: 'button', className: 'btn btn-accent', textContent: 'Sources for every number' });
  src.addEventListener('click', () => { dlg.close(); document.getElementById('btn-sources')?.click(); });
  btn.addEventListener('click', () => { if (!body.childElementCount) { build(); body.append(src); } dlg.showModal(); });
}
