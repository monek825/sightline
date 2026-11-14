# Written with AI assistance (Claude / GitHub Copilot)
"""Build HiRISE close-up ground patches: real 25 cm orthomosaic imagery for small boxes where people zoom in.

Outputs (data/):
  hirise_home.jpg, hirise_three_forks.jpg   greyscale JPEG, left=lonMin, right=lonMax, top=latMax, bottom=latMin
  hirise_patches.json                        [{id, name, file, latMin, latMax, lonMin, lonMax, mPerPx, missingTiles, noDataPct}]

Run from repo root:  python3 scripts/make_hirise_patch.py
Tiles (Mars Trek WMTS, zoom 16 = ~0.64 m/px) are cached under raw/hirise16/ (git-ignored). Fetched once; the app never
calls APIs at runtime. Pixels with no HiRISE coverage (missing tiles or transparent tile areas) are filled from
data/terrain_texture.jpg (the CTX mosaic, also real data) and reported. HiRISE brightness/contrast is matched to the CTX
mosaic over the same box (one gain + offset), so the patch edge does not show a seam; no pixel is invented.
"""
from __future__ import annotations

import io
import json
import math
import ssl
import subprocess
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

from dtm import DATA, ROOT

URL = ("https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/"
       "1.0.0/default/default028mm/{z}/{y}/{x}.png")
HEADERS = {"User-Agent": "sightline-hackathon-data-fetch/1.0"}
Z, TILE = 16, 256
SIZE = 180 / 2**Z            # tile size in degrees
CACHE = ROOT / "raw" / f"hirise{Z}"
BOX_M = 3000                 # patch is BOX_M x BOX_M metres
MAX_PX = 4096                # longest side of the saved image
QUALITY = 80
M_PER_DEG = 2 * math.pi * 3396190 / 360   # Mars radius from data/meta.json (marsRadiusM)
PATCHES = [("home", "meta"), ("three_forks", "targets")]


def get_tile(xy):
    """Return PNG bytes, or None if the tile does not exist."""
    x, y = xy
    cached = CACHE / f"{x}_{y}.png"
    if cached.exists():
        return cached.read_bytes() or None  # empty file = known 404
    for attempt in range(4):  # the server sometimes resets connections; resume from cache on re-run
        try:
            data = fetch_tile(x, y)
            break
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    CACHE.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(data or b"")
    return data


def fetch_tile(x, y):
    url = URL.format(z=Z, y=y, x=x)
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None
        raise
    except urllib.error.URLError as err:
        if not isinstance(err.reason, ssl.SSLError):
            raise
        # python.org builds on macOS ship without CA certs; curl uses the system store (verification stays ON)
        out = subprocess.run(["curl", "-sfL", "--max-time", "60", "-A", HEADERS["User-Agent"], url],
                             capture_output=True)
        return out.stdout if out.returncode == 0 and out.stdout else None


def ctx_crop(box, meta_bounds, size=None):
    """The CTX mosaic (data/terrain_texture.jpg) cropped to box, as float32 0..255.
    size=None keeps the CTX pixel size (native resolution); otherwise resized to size."""
    ctx = Image.open(DATA / "terrain_texture.jpg").convert("L")
    b = meta_bounds
    fx = lambda lon: (lon - b["lonMin"]) / (b["lonMax"] - b["lonMin"]) * ctx.width
    fy = lambda lat: (b["latMax"] - lat) / (b["latMax"] - b["latMin"]) * ctx.height
    src = (fx(box["lonMin"]), fy(box["latMax"]), fx(box["lonMax"]), fy(box["latMin"]))
    if size is None:
        size = (max(1, round(src[2] - src[0])), max(1, round(src[3] - src[1])))
    crop = ctx.resize(size, Image.BICUBIC, box=src)
    return np.asarray(crop, dtype=np.float32)


def build(pid, name, lat, lon, meta_bounds):
    half_lat = BOX_M / 2 / M_PER_DEG
    half_lon = BOX_M / 2 / (M_PER_DEG * math.cos(math.radians(lat)))
    box = {"latMin": lat - half_lat, "latMax": lat + half_lat, "lonMin": lon - half_lon, "lonMax": lon + half_lon}
    x0, x1 = math.floor((box["lonMin"] + 180) / SIZE), math.floor((box["lonMax"] + 180) / SIZE)
    y0, y1 = math.floor((90 - box["latMax"]) / SIZE), math.floor((90 - box["latMin"]) / SIZE)
    coords = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        data = list(pool.map(get_tile, coords))

    w, h = (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE
    grey = Image.new("L", (w, h))
    alpha = Image.new("L", (w, h), 0)          # 255 = HiRISE data, 0 = none
    missing = 0
    for (x, y), png in zip(coords, data):
        if png is None:
            missing += 1
            continue
        t = Image.open(io.BytesIO(png)).convert("LA")
        g, a = t.split()
        grey.paste(g, ((x - x0) * TILE, (y - y0) * TILE))
        alpha.paste(a, ((x - x0) * TILE, (y - y0) * TILE))

    ppd = TILE / SIZE
    crop = (round((box["lonMin"] - (x0 * SIZE - 180)) * ppd), round(((90 - y0 * SIZE) - box["latMax"]) * ppd),
            round((box["lonMax"] - (x0 * SIZE - 180)) * ppd), round(((90 - y0 * SIZE) - box["latMin"]) * ppd))
    grey, alpha = grey.crop(crop), alpha.crop(crop)
    scale = min(1, MAX_PX / max(grey.size))
    size = (round(grey.width * scale), round(grey.height * scale))
    if scale < 1:
        grey, alpha = grey.resize(size, Image.LANCZOS), alpha.resize(size, Image.BILINEAR)

    g = np.asarray(grey, dtype=np.float32)
    a = np.asarray(alpha, dtype=np.float32) / 255
    ctx = ctx_crop(box, meta_bounds, size)
    have = a > 0.99
    if have.sum() < 1000:
        raise SystemExit(f"{pid}: almost no HiRISE coverage in this box; not writing a patch")
    # One gain + offset so HiRISE tones match the CTX mosaic. Fitted at the CTX's own resolution (~5 m): there both
    # images show the same features, so the overall look matches at the patch edge, and HiRISE keeps its full
    # fine-scale contrast (fitting at full resolution would squash it, since CTX has none of that detail).
    ctx_n = ctx_crop(box, meta_bounds)
    small = (ctx_n.shape[1], ctx_n.shape[0])
    g_n = np.asarray(Image.fromarray(g.round().astype(np.uint8)).resize(small, Image.BOX), dtype=np.float32)
    have_n = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize(small, Image.BOX), dtype=np.float32) > 250
    gain = ctx_n[have_n].std() / max(1e-3, g_n[have_n].std())
    offset = ctx_n[have_n].mean() - gain * g_n[have_n].mean()
    g = np.clip(g * gain + offset, 0, 255)
    out = g * a + ctx * (1 - a)                 # no-data pixels: CTX underneath
    img = Image.fromarray(out.round().astype(np.uint8), "L")
    path = DATA / f"hirise_{pid}.jpg"
    img.save(path, "JPEG", quality=QUALITY, optimize=True)
    m_per_px = BOX_M / img.width
    nodata = float((a < 0.5).mean() * 100)
    print(f"{pid}: tiles={len(coords)} missing={missing} no-data={nodata:.1f}% -> {path.name} {img.width}x{img.height} "
          f"({m_per_px:.2f} m/px, {path.stat().st_size / 1e6:.2f} MB, gain {gain:.2f} offset {offset:.1f})")
    return {"id": pid, "name": name, "file": f"data/{path.name}", **{k: round(v, 7) for k, v in box.items()},
            "mPerPx": round(m_per_px, 3), "missingTiles": missing, "noDataPct": round(nodata, 1),
            "source": "HiRISE orthomosaic NASA/JPL-Caltech/UArizona via NASA Mars Trek (JEZ_hirise_soc_006, 25 cm, fetched at zoom 16)"}


def main() -> None:
    meta = json.load(open(DATA / "meta.json"))
    targets = {t["id"]: t for t in json.load(open(DATA / "targets.json"))}
    out = []
    for pid, src in PATCHES:
        p = meta["home"] if src == "meta" else targets[pid]
        out.append(build(pid, p["name"], p["lat"], p["lon"], meta["bounds"]))
    (DATA / "hirise_patches.json").write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote data/hirise_patches.json ({len(out)} patches)")


if __name__ == "__main__":
    main()
