# Written with AI assistance (Claude / GitHub Copilot)
"""Simulated skyline-matching position fix -> data/skyline/<site>.json (spec: skyline/README.md, Part A).

For each target: horizon profile from the CTX DTM at the true position (eye 2 m, Mars curvature),
+ 0.15 deg noise = "observed" skyline, rotated by an unknown (seeded random) heading.
Matched against horizons of a 61x61 grid (100 m step) centred on a prior guess 1-2 km from the truth.
Score = RMS minimised over all circular shifts (heading). Also a 96 deg field-of-view variant.

Run from repo root:  python scripts/skyline.py
"""
from __future__ import annotations

import json
import math
import sys
import time

import numpy as np

from dtm import DATA, EW_M, PX_M, R_MARS, latlon_to_px, load_dtm, px_to_latlon

EYE_M = 2.0
AZ_STEP = 2
AZ = np.deg2rad(np.arange(0, 360, AZ_STEP))          # 180 azimuths, 0 = north, clockwise
NAZ = len(AZ)
DIST = np.arange(40.0, 15000.0 + 1, 40.0)             # 375 sample distances (m)
CURV = DIST ** 2 / (2 * R_MARS)
NOISE_DEG = 0.15
GRID_N, GRID_STEP = 61, 100
UNC_MARGIN_DEG, UNC_MIN_M = 0.05, 50
FOV96_N = 48                                          # 48 * 2 deg = 96 deg
BATCH = 60
SEED = 2020
OFFGRID_SEED, OFFGRID_MAX_M = 4040, 50.0   # --offgrid: truth moved 0-50 m so it is not a search-grid node


def horizons(z: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """Horizon elevation (deg) for observers at fractional pixel positions -> (N, NAZ)."""
    H, W = z.shape
    out = np.zeros((len(rows), NAZ))
    # pixel offsets per sample: north = -row, east = +col; E-W metres scaled by cos(lat) via EW_M
    dr = -np.cos(AZ)[:, None] * DIST[None, :] / PX_M      # (NAZ, ND)
    dc = np.sin(AZ)[:, None] * DIST[None, :] / EW_M
    for s in range(0, len(rows), BATCH):
        r0, c0 = rows[s:s + BATCH], cols[s:s + BATCH]
        r = np.rint(r0[:, None, None] + dr[None]).astype(np.int64)
        c = np.rint(c0[:, None, None] + dc[None]).astype(np.int64)
        ok = (r >= 0) & (r < H) & (c >= 0) & (c < W)
        zz = z[np.clip(r, 0, H - 1), np.clip(c, 0, W - 1)].astype(np.float64)
        ok &= np.isfinite(zz)
        eye = z[np.clip(np.rint(r0).astype(int), 0, H - 1), np.clip(np.rint(c0).astype(int), 0, W - 1)] + EYE_M
        ang = np.degrees(np.arctan((zz - CURV[None, None, :] - eye[:, None, None]) / DIST[None, None, :]))
        ang = np.where(ok, ang, -np.inf)                  # outside DTM / NaN contributes nothing
        h = ang.max(axis=2)
        out[s:s + BATCH] = np.where(np.isfinite(h), h, 0.0)
    return out


def shifted(cand: np.ndarray, m: int) -> np.ndarray:
    """cand (N, NAZ) -> (N, NAZ, m): [:, s, i] = cand[:, (i + s) % NAZ]."""
    idx = (np.arange(NAZ)[:, None] + np.arange(m)[None, :]) % NAZ
    return cand[:, idx]


def match(cand: np.ndarray, obs: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """RMS of obs (m values) vs every candidate, minimised over circular shifts -> (rms, shift) per cand."""
    m = len(obs)
    best = np.full(len(cand), np.inf)
    arg = np.zeros(len(cand), dtype=int)
    for s0 in range(0, len(cand), 500):
        sh = shifted(cand[s0:s0 + 500], m)               # (n, NAZ shifts, m)
        rms = np.sqrt(((sh - obs[None, None, :]) ** 2).mean(axis=2))
        arg[s0:s0 + 500] = rms.argmin(axis=1)
        best[s0:s0 + 500] = rms.min(axis=1)
    return best, arg


def uncertainty(rms: np.ndarray, bi: int, bj: int) -> float:
    ii, jj = np.nonzero(rms <= rms.min() + UNC_MARGIN_DEG)
    return float(max(UNC_MIN_M, np.hypot(ii - bi, jj - bj).max() * GRID_STEP))


def r3(a) -> list[float]:
    return [round(float(v), 3) for v in np.asarray(a).ravel()]


def run_site(z: np.ndarray, t: dict, k: int, offgrid: bool = False) -> dict:
    rng = np.random.default_rng(SEED + k)
    lat, lon = t["lat"], t["lon"]
    tr, tc = latlon_to_px(lat, lon, z.shape)
    sh_n = sh_e = 0.0
    if offgrid:                                           # separate rng: default run's random stream is untouched
        r2 = np.random.default_rng(OFFGRID_SEED + k)
        d2, a2 = r2.uniform(0, OFFGRID_MAX_M), r2.uniform(0, 2 * math.pi)
        sh_n, sh_e = d2 * math.cos(a2), d2 * math.sin(a2)
        tr, tc = tr - sh_n / PX_M, tc + sh_e / EW_M
    # prior = truth offset 1-2 km in a random direction (snapped to the 100 m grid step)
    dist, ang = rng.uniform(1000, 2000), rng.uniform(0, 2 * math.pi)
    off_n = round(dist * math.cos(ang) / GRID_STEP) * GRID_STEP
    off_e = round(dist * math.sin(ang) / GRID_STEP) * GRID_STEP
    pr, pc = tr - off_n / PX_M, tc + off_e / EW_M
    prior_lat, prior_lon = px_to_latlon(pr, pc, z.shape)

    # observed skyline: true horizon + noise, then unknown heading (camera frame rotated by k0 samples)
    obs_true = horizons(z, np.array([tr]), np.array([tc]))[0]
    obs_true = obs_true + rng.normal(0, NOISE_DEG, NAZ)
    k0 = int(rng.integers(0, NAZ))
    obs = np.roll(obs_true, -k0)                          # obs[i] = obs_true[(i + k0) % NAZ]

    # candidate grid, row 0 = north, col 0 = west
    n = GRID_N
    half = n // 2
    north = (half - np.arange(n)) * GRID_STEP
    east = (np.arange(n) - half) * GRID_STEP
    gn, ge = np.meshgrid(north, east, indexing="ij")
    rows = (pr - gn / PX_M).ravel()
    cols = (pc + ge / EW_M).ravel()
    cand = horizons(z, rows, cols)

    def hdg_err(s: int) -> float:
        d = (s - k0) % NAZ
        return float(min(d, NAZ - d) * AZ_STEP)

    def locate(rms, arg):
        b = int(rms.argmin())
        bi, bj = divmod(b, n)
        err = float(math.hypot(gn.ravel()[b] - (-off_n + sh_n), ge.ravel()[b] - (-off_e + sh_e)))
        return b, bi, bj, err

    # full 360
    rms, arg = match(cand, obs)
    b, bi, bj, err = locate(rms, arg)
    rms2 = rms.reshape(n, n)
    unc = uncertainty(rms2, bi, bj)
    best_prof = cand[b][(np.arange(NAZ) + arg[b]) % NAZ]
    est_lat, est_lon = px_to_latlon(rows[b], cols[b], z.shape)

    # 96 degree variant: only 48 contiguous azimuths observed, heading still unknown
    rms96, arg96 = match(cand, obs[:FOV96_N])
    b96, bi96, bj96, err96 = locate(rms96, arg96)
    unc96 = uncertainty(rms96.reshape(n, n), bi96, bj96)

    return {
        "site": t["id"], "name": t["name"],
        "truth": {"lat": round(lat, 5), "lon": round(lon, 5)},
        "prior": {"lat": round(prior_lat, 5), "lon": round(prior_lon, 5)},
        "estimate": {"lat": round(est_lat, 5), "lon": round(est_lon, 5)},
        "errorM": round(err), "uncertaintyM": round(unc), "headingErrorDeg": round(hdg_err(int(arg[b]))),
        "fovDeg": 360, "noiseDeg": NOISE_DEG, "azStepDeg": AZ_STEP,
        "observed": r3(obs), "best": r3(best_prof),
        "grid": {"centerLat": round(prior_lat, 5), "centerLon": round(prior_lon, 5),
                 "stepM": GRID_STEP, "n": n, "rmsDeg": r3(rms2)},
        "fov96": {"errorM": round(err96), "uncertaintyM": round(unc96)},
        "method": "Simulated skyline from CTX DTM + 0.15° noise; not a real photo.",
    }, (round(float(rms.min()), 3), hdg_err(int(arg96[b96])), round(math.hypot(off_n, off_e)))


def main() -> None:
    offgrid = "--offgrid" in sys.argv[1:]
    z = load_dtm()
    targets = json.loads((DATA / "targets.json").read_text(encoding="utf-8"))
    out_dir = DATA / "skyline"
    out_dir.mkdir(exist_ok=True)
    t_all = time.time()
    summary = {}
    for k, t in enumerate(targets):
        t0 = time.time()
        res, (min_rms, h96, off) = run_site(z, t, k, offgrid)
        path = out_dir / f"{t['id']}.json"
        if offgrid:
            summary[t["id"]] = {"errorM": res["errorM"], "uncertaintyM": res["uncertaintyM"], "fov96": dict(res["fov96"])}
        else:
            path.write_text(json.dumps(res, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        f96 = res["fov96"]
        print(f"{t['id']:<14} {'(offgrid, not written)' if offgrid else 'wrote ' + str(path.relative_to(DATA.parent))} ({path.stat().st_size / 1024:.0f} kB, {time.time() - t0:.0f}s) "
              f"prior offset {off} m | 360: error {res['errorM']} m, uncertainty {res['uncertaintyM']} m, "
              f"heading err {res['headingErrorDeg']} deg, min RMS {min_rms} deg | "
              f"96: error {f96['errorM']} m, uncertainty {f96['uncertaintyM']} m, heading err {h96} deg")
    if offgrid:
        note = ("Simulated skyline (CTX DTM + 0.15 deg noise), not a real photo. True position moved a seeded random 0-50 m so it "
                "sits between the 100 m search-grid nodes; prior 1-2 km away as in the default run.")
        (out_dir / "offgrid_summary.json").write_text(json.dumps(
            {"note": note, "seed": OFFGRID_SEED, "noiseDeg": NOISE_DEG, "sites": summary}, indent=1, allow_nan=False), encoding="utf-8")
        print("wrote data/skyline/offgrid_summary.json")
    print(f"done in {time.time() - t_all:.0f}s")


if __name__ == "__main__":
    main()
