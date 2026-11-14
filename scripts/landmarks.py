# Written with AI assistance (Claude / GitHub Copilot)
"""Auto-pick natural landmarks from the DTM → data/landmarks.json.

A landmark = a local high point (highest cell within ~1.5 km) that stands >= 30 m above
the lowest ground in that window. Picks ~10 within 8 km of home + 3 crater-rim high points.
Sean: check them on Mars Trek and rename any that match real named features.

Run from repo root:  python3 scripts/landmarks.py
"""
from __future__ import annotations

import json
import math

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from dtm import DATA, HOME, load_dtm, px_to_latlon
from make_grid import downsample

HALF = 9  # cells → ±720 m window on the 80 m grid (~1.5 km)
MIN_RELIEF_M = 30
MIN_SPACING_M = 1500
NEAR_M = 8000
N_NEAR, N_RIM = 10, 3
RIM_SPACING_M = 8000  # spread rim points around the crater
DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def window(a: np.ndarray, fn) -> np.ndarray:
    p = np.pad(a, HALF, mode="edge")
    return fn(sliding_window_view(p, (2 * HALF + 1, 2 * HALF + 1)), axis=(2, 3))


def dist_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> tuple[float, float]:
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)) * 3396190
    y = math.radians(lat2 - lat1) * 3396190
    return math.hypot(x, y), (math.degrees(math.atan2(x, y)) + 360) % 360


def main() -> None:
    g = downsample(load_dtm())
    is_peak = g >= window(g, np.max)
    relief = g - window(g, np.min)
    rows, cols = np.nonzero(is_peak & (relief >= MIN_RELIEF_M))

    cands = []
    for r, c in zip(rows, cols):
        lat, lon = px_to_latlon(r + 0.5, c + 0.5, g.shape)
        d, b = dist_bearing(HOME["lat"], HOME["lon"], lat, lon)
        cands.append({"lat": lat, "lon": lon, "z": float(g[r, c]), "relief": float(relief[r, c]), "d": d, "b": b})

    picked: list[dict] = []

    def take(pool, n, kind, spacing=MIN_SPACING_M):
        for cnd in pool:
            if sum(1 for p in picked if p["kind"] == kind) >= n:
                return
            if all(dist_bearing(p["lat"], p["lon"], cnd["lat"], cnd["lon"])[0] >= spacing for p in picked) \
                    and cnd["d"] >= 300:
                picked.append({**cnd, "kind": kind})

    take(sorted((x for x in cands if x["d"] <= NEAR_M), key=lambda x: -x["relief"]), N_NEAR, "peak")
    take(sorted((x for x in cands if x["d"] > NEAR_M), key=lambda x: -x["z"]), N_RIM, "rim", RIM_SPACING_M)

    out = [{**HOME, "kind": "habitat", "source": "Perseverance landing site"}]
    for i, p in enumerate(sorted(picked, key=lambda x: x["d"]), 1):
        label = "Rim high point" if p["kind"] == "rim" else "Butte"
        out.append({
            "id": f"{p['kind']}_{i:02d}",
            "name": f"{label} {DIRS[round(p['b'] / 45) % 8]} {p['d'] / 1000:.1f} km",
            "lat": round(p["lat"], 5), "lon": round(p["lon"], 5), "heightM": 0, "kind": p["kind"],
            "reliefM": round(p["relief"]), "source": "auto-picked from CTX DTM (no IAU-named feature within 300 m in the USGS Gazetteer; Mars Trek check still to do)",
        })
    (DATA / "landmarks.json").write_text(json.dumps(out, indent=2))
    for lm in out:
        print(f"{lm['id']:10s} {lm['name']:28s} relief {lm.get('reliefM', '-')}")
    print(f"wrote data/landmarks.json ({len(out)} landmarks)")


if __name__ == "__main__":
    main()
