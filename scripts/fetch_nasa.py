# Written with AI assistance (Claude / GitHub Copilot)
"""Fetch NASA data once and save it into data/ (the app never calls APIs at runtime).

Outputs:
  data/traverse.json            real Perseverance path  [{sol, lat, lon}]
  data/targets.json             science targets = rover position at chosen sols
  data/donki_sep_may2024.json   raw DONKI Solar Energetic Particle events, May 2024
  data/scenario_demo.json       demo timeline (uses the DONKI event id)

Run from repo root:  python3 scripts/fetch_nasa.py
GeoJSON [lon, lat] is converted to {lat, lon} HERE and nowhere else (ARCHITECTURE.md §7).
"""
from __future__ import annotations

import json
import ssl
import subprocess
import urllib.error
import urllib.request

from dtm import DATA, HOME, LAT_MAX, LAT_MIN, LON_MAX, LON_MIN

WAYPOINTS = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
DONKI = "https://api.nasa.gov/DONKI/SEP?startDate=2024-05-01&endDate=2024-05-31&api_key=DEMO_KEY"
HEADERS = {"User-Agent": "sightline-hackathon-data-fetch/1.0"}

TARGETS = [  # id, name, sol
    ("landing", "Octavia E. Butler Landing", 13),
    ("three_forks", "Three Forks sample depot (approx.)", 653),
    ("cheyava_falls", "Cheyava Falls sample area (approx.)", 1174),
    ("delta_top", "Upper delta (approx.)", 1320),
    ("crater_rim", "Crater rim (approx.)", 2022),
]


def get_json(url: str):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.URLError as err:
        if not isinstance(err.reason, ssl.SSLError):
            raise
        # python.org builds on macOS ship without CA certs; curl uses the system store (verification stays ON)
        out = subprocess.run(["curl", "-sfL", "--max-time", "60", "-A", HEADERS["User-Agent"], url],
                             check=True, capture_output=True)
        return json.loads(out.stdout.decode("utf-8"))


def inside(lat: float, lon: float) -> bool:
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def main() -> None:
    feats = get_json(WAYPOINTS)["features"]
    pts = []
    for f in feats:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]  # GeoJSON order → converted here
        if abs(lat - p["lat"]) > 1e-3 or abs(lon - p["lon"]) > 1e-3:
            raise SystemExit("waypoint geometry and properties disagree — check coordinate order")
        if inside(lat, lon):
            pts.append({"sol": int(p["sol"]), "lat": round(lat, 5), "lon": round(lon, 5)})
    pts.sort(key=lambda x: x["sol"])
    (DATA / "traverse.json").write_text(json.dumps(pts, separators=(",", ":")))
    print(f"traverse: {len(pts)} of {len(feats)} waypoints inside the map, sols {pts[0]['sol']}–{pts[-1]['sol']}")

    targets = []
    for tid, name, sol in TARGETS:
        best = min(pts, key=lambda x: abs(x["sol"] - sol))
        targets.append({"id": tid, "name": name, "lat": best["lat"], "lon": best["lon"], "sol": best["sol"],
                        "source": "Perseverance waypoint (M20_waypoints.json, NASA/JPL MMGIS)"})
        print(f"target {tid:14s} sol {best['sol']:5d}  {best['lat']:.5f}, {best['lon']:.5f}")
    (DATA / "targets.json").write_text(json.dumps(targets, indent=2))

    sep = get_json(DONKI)
    (DATA / "donki_sep_may2024.json").write_text(json.dumps(sep, indent=2))
    print(f"DONKI: {len(sep)} SEP events in May 2024")
    # DONKI's May 2024 SEP list ends on 13 May (Earth/STEREO-A observers); the 20 May event that
    # Curiosity measured at Mars is not in it. Use the strongest Earth-observed proton event
    # (GOES >100 MeV) as the replay trigger and say so in the scenario note.
    ev = next((e for e in sep if ">100 MeV" in json.dumps(e.get("instruments", []))), sep[0])
    print(f"scenario uses {ev['sepID']} ({ev['eventTime']})")

    scenario = {
        "name": "Sol 12 EVA — May 2024 storm replay",
        "sol": 12, "startLtst": 9.0, "start": {"lat": HOME["lat"], "lon": HOME["lon"]},
        "target": "three_forks",
        "events": [
            {"tMin": 0, "type": "eva_start"},
            {"tMin": 30, "type": "tau", "value": 0.5},
            # astronaut reaches Three Forks (~2.5 km) around t=45-55; fix there before turning back
            {"tMin": 55, "type": "skyline_fix", "site": "three_forks"},
            {"tMin": 60, "type": "sep_onset", "donkiId": ev["sepID"],
             "note": "Replay trigger: strongest proton event of the May 2024 storm in DONKI (GOES >100 MeV, seen at Earth). Dose context: Curiosity RAD measured 8,100 µGy at Mars in the 20 May 2024 event, which DONKI's SEP list does not include."},
            # Dust spike. τ 2 (Jan 2022 Jezero storm, Lemmon et al. 2022) leaves visibility ~23 km, beyond every
            # landmark, so it changes nothing on the map. τ 6 is a stronger regional storm (global storms go higher).
            {"tMin": 75, "type": "tau", "value": 6.0,
             "note": "Dust storm stronger than the Jan 2022 Jezero storm (τ≈2). Illustrative value for the demo."},
            {"tMin": 200, "type": "eva_end"},
        ],
    }
    (DATA / "scenario_demo.json").write_text(json.dumps(scenario, indent=2))
    print("wrote data/traverse.json, targets.json, donki_sep_may2024.json, scenario_demo.json")


if __name__ == "__main__":
    main()
