# Feature: Route planner — routes that keep you in sight of home

**Owner:** Jojo · **Paste into Claude together with the root `README.md`** (and `crew/README.md` if you need the budget fields).

## Purpose
Normal route planners find the shortest or flattest path. Ours also asks: **"if I get lost on this path, can I still see home or a landmark?"** It avoids blind zones and slopes the crew can't handle today, and gives the time home that the Walk Budget uses.

Three modes:
| Mode | Meaning |
|---|---|
| `shortest` | Least walking time, only forbids too-steep cells |
| `safest` | Walking time + penalty for cells where **no landmark** is visible |
| `homeInSight` | Big penalty for any cell where **home itself** is not visible |

## Files to create
```
/route/route.js        export function planRoute(grid, bounds, vis, start, goal, opts) → route object
/route/heap.js         tiny binary min-heap for A* (or inline in route.js)
/route/route.test.html browser test page with console.assert checks + PASS/FAIL list
```

## Inputs
- `grid` = `data/heightgrid.json` (399 × 378, 80 m cells; row 0 north). Use `lib/geo.js` helpers.
- `bounds` = `meta.bounds`.
- `vis` = `{ blind: Uint8Array(w*h), homeHidden: Uint8Array(w*h), w, h }` — 1 = blind / home hidden. From `visibilityArrays(visKm)` in `map/visibility.js` (the pipeline passes it in). Tests: build one with all zeros. **Assert `vis.w === grid.w && vis.h === grid.h`**, else return `{ok:false, reason:'visibility grid size mismatch'}`.
- `start`, `goal` = `{lat, lon}`.
- `opts` = `{ mode, maxSlopeDeg, speedKmh, maxExpansions = 400000 }` — `maxSlopeDeg` and `speedKmh` come from `computeLimits()` (crew), **not** from the budget (that would be circular — ARCHITECTURE.md §5).
- Signature is fixed: `planRoute(grid, bounds, vis, start, goal, opts)`. Pure function, **never throws** — any failure returns `{ ok:false, reason }`. Start/goal outside the grid → `{ok:false, reason:'outside map'}`. Start cell itself too steep/blocked → start from the nearest allowed cell.

## Algorithm (A* on the grid)
- Nodes = grid cells; 8 neighbours.
- Step ground distance: north–south 80 m, east–west 80 × cos(lat) m, diagonals = hypot of both.
- Slope of a step = atan(|Δheight| / distance) in degrees. If slope > `maxSlopeDeg` → step not allowed.
- Step time (minutes) = distance / (speedKmh × tobler(slope)) with `tobler(s) = exp(-3.5 * |tan(s_signed) + 0.05|) / exp(-0.175)` (s_signed: uphill positive).
- Step cost = step time × penalty:
  - `shortest`: penalty 1
  - `safest`: 1 + 3 × blind[next]
  - `homeInSight`: 1 + 3 × blind[next] + 6 × homeHidden[next]
- Heuristic = straight-line distance / speedKmh. Admissible because penalties ≥ 1 and the Tobler factor is capped at 1.0 (no downhill bonus for a suited walker on loose regolith).
- Grid is 150k cells → A* runs in well under a second in the browser. If slow, stop searching after 400k node expansions and return "no route".
- After A*: simplify the path (drop points that are collinear within 1 cell) and convert to `[lat, lon]`.

## Output (route object — same shape as root README section 6)
```js
{ mode: 'safest', points: [[lat, lon], ...], lengthKm: 3.2, etaMin: 74,
  maxSlopeDeg: 9.5, blindFraction: 0.12, homeHiddenFraction: 0.40, ok: true, reason: null }
```
If no path: `{ ok: false, reason: 'All paths exceed 10° slope limit (sol 3 crew)' }` — show that reason in the UI, it's a useful safety message.

## How it's used
- Map click in Plan mode → `planRoute(start = astronaut, goal = clicked point)`. Draw `safest` solid and `shortest` dashed so judges see the trade-off ("+6 min, but home stays in sight 85% of the way").
- **When routes are re-planned is decided by `lib/pipeline.js`, not by route code** (route key: mode | target | maxSlope | visibility km | storm | every 10 EVA min — ARCHITECTURE.md §5). The pipeline turns `routeHome` into `routeHomeKm` for `computeBudget`. Route code never touches the store.
- Edward's helmet view walks along `points`.
- Save the demo route to `data/route_demo.json` (same shape) so the helmet view can use it standalone.

## Tests (`route.test.html`)
1. Flat mock grid, no blind cells: route length ≈ straight-line distance (±10%).
2. A wall of cells steeper than maxSlope across the middle with one gap → path goes through the gap.
3. `safest` avoids a blind block that `shortest` crosses.
4. Goal surrounded by steep cells → `ok: false` with a reason.

## Acceptance checklist
- [ ] Click → route drawn in < 1 s on the real grid.
- [ ] Two modes shown together with their minutes and % of route in sight.
- [ ] Storm / dust events re-plan the route home automatically.
- [ ] Route length feeds the Walk Budget.

## Stretch
- "Lost-recovery" mode: from the current uncertainty circle, route to the nearest cell where home is visible.
- Compare our route against the real Perseverance traverse (`data/traverse.json`) — % of the rover's path that keeps home in sight.
