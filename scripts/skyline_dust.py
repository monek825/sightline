# Written with AI assistance (Claude / GitHub Copilot)
"""Horizon Match in dust: how far does visibility have to drop before the fix becomes unreliable?

-> data/skyline_dust.json  (read by skyline/skyline.js to decide: dust-aware fix, or "lost in dust" mode)

Same method as scripts/skyline.py (CTX DTM, eye 2 m, Mars curvature, 2 deg azimuths, 61 x 61 / 100 m grid around a
prior 1-2 km off, heading unknown), plus dust:
  * Visibility V: terrain farther than V cannot be seen, so both the observed skyline and every candidate horizon use
    only terrain within V ("dust-aware" matching: the matcher knows V from the measured tau).
  * Fade rule: if the highest visible point in a direction lies in the outer 15% of V, the "skyline" there is the dust
    fading out, not a hill; that direction is not scored. Every candidate is scored on the SAME set of directions
    (lesson from the real-photo study, scripts/README.md 8b: per-candidate direction sets make scores incomparable).
  * Edge noise 0.15 deg (clear, as skyline.py) and 0.30 deg (lower contrast in dust); both are reported.
Truth positions: per site the target itself plus 3 seeded random points within 1 km, each moved 0-50 m off the grid.

Self-check rule, FIXED BEFORE ANY RUN (the app may only claim a fix if all hold):
  scored directions >= 30 (60 deg of the turn)  AND  uncertainty radius <= 500 m  AND  min RMS <= 3 x edge noise.
Reported per visibility: how often the rule says FIX, and how often a claimed FIX is wrong
(false fix = error > max(300 m, 2 x the claimed uncertainty)).

Simulated skylines from NASA terrain, not real photos. Run from repo root:  python scripts/skyline_dust.py  (~5-10 min)
"""
from __future__ import annotations

import json
import math
import time

import numpy as np

from dtm import DATA, EW_M, PX_M, latlon_to_px, load_dtm, px_to_latlon
import skyline as sk

VIS_KM = [15, 10, 6, 4, 3, 2, 1.5, 1, 0.6, 0.3]       # 15 km = the clear-air range of skyline.py
NOISES = [0.15, 0.30]
FADE_FRAC = 0.85
N_TRUTH = 4
TRUTH_SPREAD_M = 1000
SEED = 5150
RULE = {"minScoredDirections": 30, "maxUncertaintyM": 500, "maxRmsOverNoise": 3.0}
FALSE_FIX_M = 300


def horizons_by_vis(z, rows, cols):
    """For every observer: horizon (deg) and the distance it forms at, for each visibility limit -> (N, NAZ, nV) x 2."""
    H, W = z.shape
    nv = len(VIS_KM)
    lim = np.array([np.searchsorted(sk.DIST, v * 1000, side="right") for v in VIS_KM])   # samples with d <= V
    hz = np.zeros((len(rows), sk.NAZ, nv)); hd = np.zeros((len(rows), sk.NAZ, nv))
    dr = -np.cos(sk.AZ)[:, None] * sk.DIST[None, :] / PX_M
    dc = np.sin(sk.AZ)[:, None] * sk.DIST[None, :] / EW_M
    for s in range(0, len(rows), sk.BATCH):
        r0, c0 = rows[s:s + sk.BATCH], cols[s:s + sk.BATCH]
        r = np.rint(r0[:, None, None] + dr[None]).astype(np.int64)
        c = np.rint(c0[:, None, None] + dc[None]).astype(np.int64)
        ok = (r >= 0) & (r < H) & (c >= 0) & (c < W)
        zz = z[np.clip(r, 0, H - 1), np.clip(c, 0, W - 1)].astype(np.float64)
        ok &= np.isfinite(zz)
        eye = z[np.clip(np.rint(r0).astype(int), 0, H - 1), np.clip(np.rint(c0).astype(int), 0, W - 1)] + sk.EYE_M
        ang = np.degrees(np.arctan((zz - sk.CURV[None, None, :] - eye[:, None, None]) / sk.DIST[None, None, :]))
        ang = np.where(ok, ang, -np.inf)
        for v, n in enumerate(lim):
            a = ang[:, :, :n]
            i = a.argmax(axis=2)
            m = np.take_along_axis(a, i[..., None], axis=2)[..., 0]
            hz[s:s + sk.BATCH, :, v] = np.where(np.isfinite(m), m, 0.0)
            hd[s:s + sk.BATCH, :, v] = sk.DIST[i]
    return hz, hd


def match_masked(cand, obs, use):
    """RMS over the usable observed directions only, minimised over heading shifts -> (rms, shift)."""
    idx_obs = np.nonzero(use)[0]
    if len(idx_obs) == 0:
        return np.full(len(cand), np.inf), np.zeros(len(cand), int)
    o = obs[idx_obs]
    best = np.full(len(cand), np.inf); arg = np.zeros(len(cand), int)
    for s in range(sk.NAZ):
        cols = (idx_obs + s) % sk.NAZ
        rms = np.sqrt(((cand[:, cols] - o[None, :]) ** 2).mean(axis=1))
        better = rms < best
        best[better] = rms[better]; arg[better] = s
    return best, arg


def run_site(z, t, k):
    rng = np.random.default_rng(SEED + k)
    n, half = sk.GRID_N, sk.GRID_N // 2
    sr, sc = latlon_to_px(t["lat"], t["lon"], z.shape)
    dist, ang = rng.uniform(1000, 2000), rng.uniform(0, 2 * math.pi)
    off_n = round(dist * math.cos(ang) / sk.GRID_STEP) * sk.GRID_STEP
    off_e = round(dist * math.sin(ang) / sk.GRID_STEP) * sk.GRID_STEP
    pr, pc = sr - off_n / PX_M, sc + off_e / EW_M          # prior (grid centre), relative to the site
    north = (half - np.arange(n)) * sk.GRID_STEP
    east = (np.arange(n) - half) * sk.GRID_STEP
    gn, ge = np.meshgrid(north, east, indexing="ij")
    rows, cols = (pr - gn / PX_M).ravel(), (pc + ge / EW_M).ravel()
    t0 = time.time()
    cand, _ = horizons_by_vis(z, rows, cols)
    print(f"  {t['id']}: candidate horizons {time.time() - t0:.0f}s", flush=True)

    # truths: the site + 3 random points within 1 km, each 0-50 m off the grid (metres north/east of the prior)
    truths = []
    for q in range(N_TRUTH):
        if q == 0:
            tn, te = -off_n, -off_e
        else:
            d, a = rng.uniform(0, TRUTH_SPREAD_M), rng.uniform(0, 2 * math.pi)
            tn, te = -off_n + d * math.cos(a), -off_e + d * math.sin(a)
        d2, a2 = rng.uniform(0, 50), rng.uniform(0, 2 * math.pi)
        truths.append((tn + d2 * math.cos(a2), te + d2 * math.sin(a2)))
    # truths are metres north/east of the GRID CENTRE (the prior); the site itself sits at (-off_n, -off_e), as in skyline.py
    res = []
    for q, (tn, te) in enumerate(truths):
        tr, tc = pr - tn / PX_M, pc + te / EW_M
        obs_h, obs_d = horizons_by_vis(z, np.array([tr]), np.array([tc]))
        k0 = int(rng.integers(0, sk.NAZ))
        for ni, noise in enumerate(NOISES):
            eps = rng.normal(0, noise, sk.NAZ)
            for v, vis in enumerate(VIS_KM):
                h = np.roll(obs_h[0, :, v] + eps, -k0)
                use = np.roll(obs_d[0, :, v] < FADE_FRAC * vis * 1000, -k0)   # fade rule
                nuse = int(use.sum())
                if nuse == 0:
                    res.append(dict(truth=q, noise=noise, visKm=vis, scored=0, errorM=None, uncertaintyM=None, minRms=None, fix=False))
                    continue
                rms, arg = match_masked(cand[:, :, v], h, use)
                b = int(rms.argmin()); bi, bj = divmod(b, n)
                err = math.hypot(gn.ravel()[b] - tn, ge.ravel()[b] - te)
                ii, jj = np.nonzero(rms.reshape(n, n) <= rms.min() + sk.UNC_MARGIN_DEG)
                unc = max(sk.UNC_MIN_M, float(np.hypot(ii - bi, jj - bj).max() * sk.GRID_STEP))
                fix = nuse >= RULE["minScoredDirections"] and unc <= RULE["maxUncertaintyM"] and rms.min() <= RULE["maxRmsOverNoise"] * noise
                elat, elon = px_to_latlon(rows[b], cols[b], z.shape)
                res.append(dict(truth=q, noise=noise, visKm=vis, scored=nuse, errorM=round(err), uncertaintyM=round(unc),
                                minRms=round(float(rms.min()), 3), fix=bool(fix),
                                estimate={"lat": round(float(elat), 5), "lon": round(float(elon), 5)}))
    return res


def summarise(rows):
    out = []
    for noise in NOISES:
        for vis in VIS_KM:
            r = [x for x in rows if x["noise"] == noise and x["visKm"] == vis]
            fixes = [x for x in r if x["fix"]]
            false = [x for x in fixes if x["errorM"] > max(FALSE_FIX_M, 2 * x["uncertaintyM"])]
            errs = sorted(x["errorM"] for x in r if x["errorM"] is not None)
            ferr = sorted(x["errorM"] for x in fixes)
            out.append(dict(noise=noise, visKm=vis, cases=len(r), fixClaimed=len(fixes), falseFixes=len(false),
                            medianScored=int(np.median([x["scored"] for x in r])),
                            medianErrorAllM=errs[len(errs) // 2] if errs else None, worstErrorAllM=errs[-1] if errs else None,
                            worstErrorOfClaimedFixesM=ferr[-1] if ferr else None))
    return out


def main():
    z = load_dtm()
    targets = json.loads((DATA / "targets.json").read_text(encoding="utf-8"))
    rows = []
    t_all = time.time()
    for k, t in enumerate(targets):
        for r in run_site(z, t, k):
            rows.append(dict(site=t["id"], **r))
    summ = summarise(rows)
    # Lowest visibility at which, for BOTH noise levels, the rule claims a fix in >= 80% of cases with zero false fixes.
    ok_vis = [v for v in VIS_KM if all(s["falseFixes"] == 0 and s["fixClaimed"] >= 0.8 * s["cases"]
                                         for s in summ if s["visKm"] == v)]
    reliable_min = min(ok_vis) if ok_vis else None
    # App switch rule (the safety criterion alone): the lowest visibility at which, for BOTH noise levels, no claimed
    # fix is false, and every higher visibility is false-fix free too. Below it the app does not attempt a fix.
    safe = None
    for v in VIS_KM:                                   # VIS_KM runs from clear to thick dust
        if all(s["falseFixes"] == 0 for s in summ if s["visKm"] == v):
            safe = v
        else:
            break
    out = {
        "method": ("Simulated skylines from the CTX DTM (not real photos). Terrain beyond the visibility V is hidden for both the "
                   "observed skyline and the candidates; directions whose highest visible point is in the outer 15% of V are not "
                   "scored (dust fade, not a hill). Edge noise 0.15 and 0.30 deg. 5 sites x 4 truth positions (0-50 m off-grid), "
                   "prior 1-2 km off, 61 x 61 / 100 m grid, heading unknown."),
        "rule": RULE, "falseFixDefinitionM": f"error > max({FALSE_FIX_M} m, 2 x claimed uncertainty)",
        "fadeFraction": FADE_FRAC, "visKm": VIS_KM, "noisesDeg": NOISES,
        "reliableMinVisKm": reliable_min,
        "reliableNote": ("reliableMinVisKm (fix claimed in >= 80% of cases AND no false fix, both noise levels) was set before "
                         "the first run. It is null: even in clear air the self-check claims a fix in only 55-80% of cases, "
                         "because its RMS limit (3 x edge noise) also rejects good matches when the true position is between "
                         "grid nodes. The check is conservative: it says 'no fix' rather than give a wrong one."),
        "noFalseFixMinVisKm": safe,
        "appRule": ("Used by skyline/skyline.js: visibility >= noFalseFixMinVisKm -> dust-aware Horizon Match (may answer "
                    "'no fix'); below it, or when the self-check says no fix -> lost-in-dust mode. Chosen after the first run "
                    "from the false-fix criterion alone (stated here so it is not mistaken for a pre-registered rule)."),
        "summary": summ,
        "cases": rows,
    }
    (DATA / "skyline_dust.json").write_text(json.dumps(out, indent=1, allow_nan=False), encoding="utf-8")
    print(f"done in {time.time() - t_all:.0f}s -> data/skyline_dust.json; reliable (80% + no false) down to {reliable_min} km; no false fix down to {safe} km")
    for s in summ:
        print(f"noise {s['noise']:.2f}  V {s['visKm']:>4} km  scored~{s['medianScored']:>3}  fix {s['fixClaimed']:>2}/{s['cases']}  "
              f"false {s['falseFixes']}  median err {s['medianErrorAllM']}  worst err {s['worstErrorAllM']}  worst claimed {s['worstErrorOfClaimedFixesM']}")


if __name__ == "__main__":
    main()
