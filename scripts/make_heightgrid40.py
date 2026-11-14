# Written with AI assistance (Claude / GitHub Copilot)
"""CTX DTM -> data/heightgrid40.json (40 m cells, for the 3D terrain view only).

Same JSON shape as data/heightgrid.json ({w, h, cellM, min, max, data}, row 0 = north), but 2x2 block
means of the 20 m DTM instead of 4x4. The route planner and viewsheds keep using the 80 m heightgrid.json.

Run from repo root:  python3 scripts/make_heightgrid40.py
"""
from __future__ import annotations

import json
import math

import numpy as np
from PIL import Image

from dtm import DATA, HOME, PX_M, RAW_DTM, fill_nan, latlon_to_px

F = 2  # 20 m -> 40 m


def block_mean_nan(z: np.ndarray, f: int) -> np.ndarray:
    """NaN-aware f x f block mean (cells with no valid sample stay NaN)."""
    h, w = (z.shape[0] // f) * f, (z.shape[1] // f) * f
    b = z[:h, :w].reshape(h // f, f, w // f, f)
    with np.errstate(invalid="ignore"):
        return np.nanmean(b, axis=(1, 3))


def main() -> None:
    raw = np.array(Image.open(RAW_DTM), dtype=np.float32)
    print(f"DTM {raw.shape[1]}x{raw.shape[0]} {raw.dtype}")
    raw[raw < -1e4] = np.nan
    print(f"no-data pixels: {int(np.isnan(raw).sum())}")
    g = fill_nan(block_mean_nan(raw, F))  # holes filled the way make_grid.py does (3x3 nan-mean, repeated)
    gh, gw = g.shape
    gmin, gmax = float(g.min()), float(g.max())

    grid = {"w": gw, "h": gh, "cellM": PX_M * F, "min": round(gmin, 1), "max": round(gmax, 1),
            "data": [round(float(v), 1) for v in g.ravel()]}
    assert all(math.isfinite(v) for v in grid["data"])
    out = DATA / "heightgrid40.json"
    out.write_text(json.dumps(grid, separators=(",", ":"), allow_nan=False))
    print(f"wrote {out}  {gw}x{gh} @ {PX_M * F:.0f} m  {out.stat().st_size / 1e6:.2f} MB  min {gmin:.1f} max {gmax:.1f}")

    # sanity checks against the 80 m grid used by the rest of the app
    ref = json.load(open(DATA / "heightgrid.json"))
    r80 = np.array(ref["data"], dtype=np.float64).reshape(ref["h"], ref["w"])
    g40 = np.array(grid["data"], dtype=np.float64).reshape(gh, gw)
    d80 = g40[:ref["h"] * 2, :ref["w"] * 2].reshape(ref["h"], 2, ref["w"], 2).mean(axis=(1, 3))
    diff = np.abs(d80 - r80)
    print(f"40 m grid averaged to 80 m vs heightgrid.json: max |diff| {diff.max():.2f} m, mean {diff.mean():.3f} m")
    best = None
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            a = d80[1 + dr:ref["h"] - 1 + dr, 1 + dc:ref["w"] - 1 + dc]
            e = float(np.abs(a - r80[1:-1, 1:-1]).mean())
            print(f"  offset (dr,dc)=({dr:+d},{dc:+d}): mean |diff| {e:.3f} m")
            if best is None or e < best[0]:
                best = (e, dr, dc)
    print(f"best-matching offset (dr,dc) = ({best[1]},{best[2]})")
    for name, arr, shape in (("40 m", g40, g40.shape), ("80 m", r80, r80.shape)):
        r, c = latlon_to_px(HOME["lat"], HOME["lon"], shape)
        print(f"height at home from {name} grid: {arr[int(r), int(c)]:.1f} m")


if __name__ == "__main__":
    main()
