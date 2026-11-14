# Written with AI assistance (Claude / GitHub Copilot)
"""Validate every data contract in ARCHITECTURE.md section 7.

Usage (from repo root):  python3 scripts/check_data.py
Exit code 0 = all good, 1 = problems found (each one is printed).
Needs: Pillow (for PNG checks). Pure stdlib otherwise.
"""
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CREW_README = ROOT / "crew" / "README.md"

problems = []
warnings = []


def fail(msg):
    problems.append(msg)


def load(name):
    p = DATA / name
    if not p.exists():
        fail(f"missing: data/{name}")
        return None
    try:
        # parse_constant rejects NaN/Infinity, which browsers cannot parse
        return json.loads(p.read_text(encoding="utf-8"), parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
    except ValueError as e:
        fail(f"invalid JSON in data/{name}: {e}")
        return None


def inside(b, lat, lon):
    return b["latMin"] <= lat <= b["latMax"] and b["lonMin"] <= lon <= b["lonMax"]


def check_meta():
    m = load("meta.json")
    if not m:
        return None
    b = m.get("bounds", {})
    for k in ("latMin", "latMax", "lonMin", "lonMax"):
        if not isinstance(b.get(k), (int, float)):
            fail(f"meta.json: bounds.{k} missing")
            return None
    h = m.get("home", {})
    if not inside(b, h.get("lat", 0), h.get("lon", 0)):
        fail("meta.json: home is outside bounds")
    return m


def check_grid():
    g = load("heightgrid.json")
    if not g:
        return None
    w, h, d = g.get("w"), g.get("h"), g.get("data", [])
    if not (isinstance(w, int) and isinstance(h, int)) or len(d) != w * h:
        fail(f"heightgrid.json: data length {len(d)} != w*h ({w}*{h})")
        return None
    bad = sum(1 for v in d if not isinstance(v, (int, float)) or not math.isfinite(v))
    if bad:
        fail(f"heightgrid.json: {bad} non-finite values (fill no-data before writing)")
    lo, hi = g.get("min"), g.get("max")
    if any(v < lo - 0.05 or v > hi + 0.05 for v in d if isinstance(v, (int, float))):
        fail("heightgrid.json: values outside [min, max]")
    return g


def check_points(name, rows, b, need_id=False):
    if rows is None:
        return
    ids = set()
    for i, r in enumerate(rows):
        if not inside(b, r.get("lat", 999), r.get("lon", 999)):
            fail(f"{name}[{i}] outside bounds (did lat/lon get swapped?)")
        if need_id:
            if r.get("id") in ids:
                fail(f"{name}: duplicate id {r.get('id')}")
            ids.add(r.get("id"))
    return ids


def check_viewsheds(landmark_ids, grid):
    try:
        from PIL import Image
    except ImportError:
        warnings.append("Pillow not installed: viewshed PNGs not checked (pip install pillow)")
        return
    for lid in landmark_ids:
        p = DATA / "viewsheds" / f"{lid}.png"
        if not p.exists():
            fail(f"missing viewshed: data/viewsheds/{lid}.png")
            continue
        im = Image.open(p).convert("L")
        if grid and im.size != (grid["w"], grid["h"]):
            fail(f"viewsheds/{lid}.png is {im.size}, grid is {(grid['w'], grid['h'])}")
        vals = set(im.getdata())
        if not vals <= {0, 255}:
            fail(f"viewsheds/{lid}.png has values other than 0/255")


def required_keys():
    if not CREW_README.exists():
        return []
    text = CREW_README.read_text(encoding="utf-8")
    m = re.search(r"### Required constant keys.*?`([a-z0-9_]+(?:, [a-z0-9_]+)+)`", text, re.S)
    return [k.strip() for k in m.group(1).split(",")] if m else []


def check_constants():
    rows = load("crew_constants.json")
    if rows is None:
        return
    keys = [r.get("key") for r in rows]
    dups = {k for k in keys if keys.count(k) > 1}
    if dups:
        fail(f"crew_constants.json: duplicate keys {sorted(dups)}")
    for k in required_keys():
        if k not in keys:
            fail(f"crew_constants.json: required key missing: {k}")
    for r in rows:
        if not isinstance(r.get("value"), (int, float)):
            fail(f"crew_constants.json: {r.get('key')} value is not a number")
        url = (r.get("url") or "").strip()
        if r.get("isEstimate") is False and (not url or "TODO" in url):
            fail(f"crew_constants.json: {r.get('key')} is marked NASA data but has no source URL")
        if url and "TODO" not in url and not url.startswith("https://"):
            fail(f"crew_constants.json: {r.get('key')} url must start with https://")


def check_scenario(target_ids):
    s = load("scenario_demo.json")
    if not s:
        return
    t = [e.get("tMin", -1) for e in s.get("events", [])]
    if t != sorted(t):
        fail("scenario_demo.json: events not sorted by tMin")
    if target_ids is not None and s.get("target") not in target_ids:
        fail(f"scenario_demo.json: target '{s.get('target')}' not in targets.json")
    for e in s.get("events", []):
        if e.get("type") == "skyline_fix" and not (DATA / "skyline" / f"{e.get('site')}.json").exists():
            fail(f"scenario_demo.json: skyline site '{e.get('site')}' has no data/skyline file")


def check_skyline():
    for p in sorted((DATA / "skyline").glob("*.json")):
        s = load(f"skyline/{p.name}")
        if not s:
            continue
        if p.name == "offgrid_summary.json":
            if not isinstance(s.get("sites"), dict):
                fail("skyline/offgrid_summary.json: 'sites' object missing")
            continue
        n = round(360 / s.get("azStepDeg", 2))
        if len(s.get("observed", [])) != n or len(s.get("best", [])) != n:
            fail(f"skyline/{p.name}: observed/best must have {n} values")
        g = s.get("grid", {})
        if len(g.get("rmsDeg", [])) != g.get("n", 0) ** 2:
            fail(f"skyline/{p.name}: grid.rmsDeg must have n*n values")
        if "simulated" not in s.get("method", "").lower() and "real" not in s.get("method", "").lower():
            fail(f"skyline/{p.name}: 'method' must say whether the skyline is simulated or real")


def check_secrets():
    pat = re.compile(r"api_key=(?!DEMO_KEY)[A-Za-z0-9]{10,}")
    for p in list(DATA.rglob("*.json")) + list(ROOT.rglob("*.js")):
        if ".git" in p.parts:
            continue
        if pat.search(p.read_text(encoding="utf-8", errors="ignore")):
            fail(f"possible API key committed in {p.relative_to(ROOT)}")


def main():
    meta = check_meta()
    grid = check_grid()
    b = meta["bounds"] if meta else None
    landmarks = load("landmarks.json")
    lids = set()
    if b and landmarks is not None:
        lids = check_points("landmarks.json", landmarks, b, need_id=True) or set()
        if "home" not in lids:
            fail("landmarks.json: 'home' missing")
    target_ids = None
    targets = load("targets.json")
    if b and targets is not None:
        target_ids = check_points("targets.json", targets, b, need_id=True)
    traverse = load("traverse.json")
    if b and traverse is not None:
        check_points("traverse.json", traverse, b)
        sols = [r.get("sol", 0) for r in traverse]
        if sols != sorted(sols):
            fail("traverse.json: not sorted by sol")
    if not (DATA / "basemap.png").exists():
        fail("missing: data/basemap.png (offline fallback map)")
    check_viewsheds(lids, grid)
    check_constants()
    check_scenario(target_ids)
    check_skyline()
    check_secrets()

    for w in warnings:
        print(f"WARN  {w}")
    for p in problems:
        print(f"FAIL  {p}")
    print(f"\n{len(problems)} problem(s), {len(warnings)} warning(s)")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
