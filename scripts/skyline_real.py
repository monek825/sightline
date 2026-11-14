# Written with AI assistance (Claude / GitHub Copilot)
"""One real-photo skyline check -> data/skyline_real/<id>.json (+ a JPEG copy of the frame).

Takes ONE Perseverance Navcam-Left frame (NASA raw-images API, downloaded to raw/navcam/, treated purely as data),
traces its skyline (first strong bright-to-dark step from the top, per column), converts pixels to
azimuth/elevation with the frame's own CAHVORE camera model + attitude quaternion, and compares it with the
CTX-DTM horizon at the rover's traverse.json position (sol-level waypoint). The horizon function is imported
from skyline.py, not copied.

Run from repo root:  python scripts/skyline_real.py
Honest-result script: whatever the match is, it is written to the JSON verdict.
"""
from __future__ import annotations

import json
import math
import urllib.request

import numpy as np
from PIL import Image

import skyline as sk
from dtm import DATA, EW_M, PX_M, ROOT, LAT_MAX, LAT_MIN, LON_MAX, LON_MIN, latlon_to_px, load_dtm, px_to_latlon

SOL = 204                                   # chosen BEFORE looking at any match: earliest sol with a single traverse waypoint
IMAGE_ID = "NLG_0204_0685053395_488ECM_N0071716NCAM00518_00_2I4J"   # middle frame of the 21-frame sol-204 horizon strip
API = "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&id="
RAW = ROOT / "raw" / "navcam"
OUT = DATA / "skyline_real"
SEED = 2021
EDGE_SIGMA_PX, EDGE_THRESH = 1.5, 4.0       # edge detector settings (see assumptions: number of settings tried)
TRIES = {"frames": 1, "edge_settings": 1}   # keep in sync with what was actually tried (printed + written to JSON)
HDG_SHIFTS = np.arange(-5, 6)               # +-10 deg in 2 deg steps
FIT_AZ = np.arange(-10, 10.01, 0.25)        # fine azimuth shift for the fit at the waypoint (deg)


def fetch(url: str, dest):
    if not dest.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        dest.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    return dest


def vec(s: str) -> np.ndarray:
    return np.array([float(v) for v in s.strip("()").split(",")])


def quat_matrix(q) -> np.ndarray:
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


class Cahvore:
    """Fisheye (MTYPE 2) CAHVORE; entrance-pupil term E (millimetre-scale) ignored."""

    def __init__(self, comp: str):
        p = [vec(s) for s in comp.split(";")[:7]]
        self.C, self.A, self.H, self.V, self.O, self.R = p[:6]
        self.hc, self.vc = self.H @ self.A, self.V @ self.A
        self.hs = np.linalg.norm(np.cross(self.A, self.H))
        self.vs = np.linalg.norm(np.cross(self.A, self.V))
        self.H1 = (self.H - self.hc * self.A) / self.hs
        self.V1 = (self.V - self.vc * self.A) / self.vs

    def ray(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        """pixel (x, y) in this frame's own coordinates -> unit rays in the rover frame (N, 3)."""
        w = self.A[None] + ((x - self.hc) / self.hs)[:, None] * self.H1[None] + ((y - self.vc) / self.vs)[:, None] * self.V1[None]
        lam = w / (w @ self.O)[:, None]
        d = lam - self.O[None]
        chi_d = np.linalg.norm(d, axis=1)
        u = d / np.maximum(chi_d, 1e-12)[:, None]
        chi = chi_d.copy()                                  # invert chi_d = chi (1 + R0 + R1 chi^2 + R2 chi^4)
        for _ in range(30):
            f = chi * (1 + self.R[0] + self.R[1] * chi ** 2 + self.R[2] * chi ** 4) - chi_d
            df = 1 + self.R[0] + 3 * self.R[1] * chi ** 2 + 5 * self.R[2] * chi ** 4
            chi = chi - f / df
        return np.cos(chi)[:, None] * self.O[None] + np.sin(chi)[:, None] * u


def trace_skyline(g: np.ndarray) -> np.ndarray:
    """Per column: first row (from the top) where smoothed brightness steps down by > threshold; NaN if none."""
    k = np.exp(-0.5 * (np.arange(-6, 7) / EDGE_SIGMA_PX) ** 2)
    k /= k.sum()
    gp = np.pad(g, ((6, 6), (0, 0)), mode="edge")
    sm = sum(k[i] * gp[i:i + g.shape[0]] for i in range(13))
    d = np.diff(sm, axis=0)                                 # d[r] = sm[r+1]-sm[r]
    rows = np.full(g.shape[1], np.nan)
    for c in range(g.shape[1]):
        idx = np.nonzero(d[8:, c] < -EDGE_THRESH)[0]
        if len(idx):
            r = idx[0] + 8
            while r + 1 < len(d) and d[r + 1, c] < d[r, c]:  # walk to the steepest point of that first step
                r += 1
            rows[c] = r + 0.5
    return rows


def clean_trace(rows: np.ndarray):
    """Reject columns with no edge or an outlier vs a running median (rocks/specks)."""
    ok = np.isfinite(rows)
    med = np.full_like(rows, np.nan)
    for c in range(len(rows)):
        w = rows[max(0, c - 15):c + 16]
        w = w[np.isfinite(w)]
        if len(w) > 5:
            med[c] = np.median(w)
    ok &= np.isfinite(med) & (np.abs(rows - med) < 12)
    return ok


def rms(a, b):
    return float(np.sqrt(np.mean((a - b) ** 2)))


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    meta_p = RAW / "frame.json"
    if not meta_p.exists():
        meta_p.write_bytes(urllib.request.urlopen(urllib.request.Request(API + IMAGE_ID, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read())
    im = json.loads(meta_p.read_text(encoding="utf-8"))
    if "images" in im:
        im = im["images"][0]
    assert im["imageid"] == IMAGE_ID and im["sol"] == SOL
    ext = im["extended"]
    url = im["image_files"]["full_res"]
    png = fetch(url, RAW / "frame.png")
    img = Image.open(png).convert("L")
    g = np.asarray(img, dtype=np.float64)
    H, W = g.shape
    mast_az, mast_el = float(ext["mastAz"]), float(ext["mastEl"])

    cam = Cahvore(im["camera"]["camera_model_component_list"])
    # horizontal field angle across the full width at the principal row (angle between edge rays)
    r0, r1 = cam.ray(np.array([0.0]), np.array([cam.vc]))[0], cam.ray(np.array([W - 1.0]), np.array([cam.vc]))[0]
    fov_h = math.degrees(math.acos(float(np.clip(r0 @ r1, -1, 1))))
    rv0, rv1 = cam.ray(np.array([cam.hc]), np.array([0.0]))[0], cam.ray(np.array([cam.hc]), np.array([H - 1.0]))[0]
    fov_v_strip = math.degrees(math.acos(float(np.clip(rv0 @ rv1, -1, 1))))

    # --- trace the skyline
    rows = trace_skyline(g)
    ok = clean_trace(rows)
    cols = np.arange(W, dtype=np.float64)
    # smooth the accepted trace a little (5-px median), keep rejected columns out
    rr = rows.copy()
    rr[~ok] = np.nan
    sm = rr.copy()
    for c in range(W):
        w = rr[max(0, c - 2):c + 3]
        w = w[np.isfinite(w)]
        sm[c] = np.median(w) if len(w) >= 3 else np.nan
    good = np.isfinite(sm)

    # --- pixel -> (azimuth, elevation) in the local-level site frame (x north, y east, z down)
    q = [float(v) for v in im["attitude"].strip("()").split(",")]
    Rq = quat_matrix(q)
    rays = cam.ray(cols[good], sm[good])
    results = {}
    for name, M in (("site_to_rover", Rq.T), ("rover_to_site", Rq)):     # v_site = M @ v_rover
        s = rays @ M.T
        results[name] = (np.degrees(np.arctan2(s[:, 1], s[:, 0])) % 360, np.degrees(np.arcsin(np.clip(-s[:, 2], -1, 1))))
    bore_rover = vec(im["camera"]["camera_vector"])
    centre_az = {n: float(np.degrees(np.arctan2((M @ bore_rover)[1], (M @ bore_rover)[0])) % 360) for n, M in (("site_to_rover", Rq.T), ("rover_to_site", Rq))}
    yaw = {"rover_to_site": math.degrees(math.atan2(Rq[1, 0], Rq[0, 0])) % 360}
    print(f"frame {IMAGE_ID}  {W}x{H}  traced columns {int(good.sum())}/{W}")
    print(f"camera: hs={cam.hs:.1f} vs={cam.vs:.1f} hc={cam.hc:.1f} vc={cam.vc:.1f}  field across strip {fov_h:.1f} deg wide")
    print(f"mastAz {mast_az}, rover yaw (if quaternion = rover->site) {yaw['rover_to_site']:.1f}; boresight site azimuth: {centre_az}")

    # --- DTM
    z = load_dtm()
    trav = [r for r in json.loads((DATA / "traverse.json").read_text(encoding="utf-8")) if r["sol"] == SOL]
    assert len(trav) == 1
    lat, lon = trav[0]["lat"], trav[0]["lon"]
    assert LAT_MIN < lat < LAT_MAX and LON_MIN < lon < LON_MAX
    tr, tc = latlon_to_px(lat, lon, z.shape)
    prof_truth = sk.horizons(z, np.array([tr]), np.array([tc]))[0]            # (180,) at 2 deg, 0 = north

    # diagnostic: does ANY DTM terrain within 40 km (sk.horizons uses 15 km) reach the elevation seen in the photo?
    d_keep = (sk.DIST, sk.CURV)
    sk.DIST = np.arange(40.0, 40000.0 + 1, 40.0)
    sk.CURV = sk.DIST ** 2 / (2 * sk.R_MARS)
    prof_far = sk.horizons(z, np.array([tr]), np.array([tc]))[0]
    sk.DIST, sk.CURV = d_keep

    rng = np.random.default_rng(SEED)
    dist, ang = rng.uniform(1000, 2000), rng.uniform(0, 2 * math.pi)
    off_n, off_e = dist * math.cos(ang), dist * math.sin(ang)
    pr, pc = tr - off_n / PX_M, tc + off_e / EW_M                             # prior = grid centre
    n, half, step = sk.GRID_N, sk.GRID_N // 2, sk.GRID_STEP
    north = (half - np.arange(n)) * step
    east = (np.arange(n) - half) * step
    gn, ge = np.meshgrid(north, east, indexing="ij")
    grows, gcols = (pr - gn / PX_M).ravel(), (pc + ge / EW_M).ravel()
    cand = sk.horizons(z, grows, gcols)                                       # (3721, 180)
    truth_n, truth_e = -off_n, -off_e

    out_results = {}
    for name, (az, el) in results.items():
        order = np.argsort(az)
        az_s, el_s = az[order], el[order]
        # contiguous span only (no wrap inside this camera's field)
        lo, hi = az_s[0], az_s[-1]
        if hi - lo > 180:                                                    # crossed north: unwrap
            az_u = np.where(az < 180, az + 360, az)
            order = np.argsort(az_u)
            az_s, el_s = az_u[order], el[order]
            lo, hi = az_s[0], az_s[-1]
        k0, k1 = math.ceil(lo / sk.AZ_STEP), math.floor(hi / sk.AZ_STEP)
        grid_az = np.arange(k0, k1 + 1) * sk.AZ_STEP
        obs = np.interp(grid_az, az_s, el_s)
        kidx = (grid_az / sk.AZ_STEP).astype(int) % sk.NAZ

        # (a) at the waypoint: DTM horizon sampled at az + shift, constant elevation offset fitted (least squares)
        def dtm_at(shift):
            return np.interp((grid_az + shift) % 360, np.arange(sk.NAZ) * sk.AZ_STEP, prof_truth, period=360)
        raw = rms(obs, dtm_at(0.0))
        best = None
        for sh in FIT_AZ:
            d = dtm_at(sh)
            off = float(np.mean(obs - d))
            r = rms(obs - off, d)
            if best is None or r < best[0]:
                best = (r, sh, off)
        r_fit, sh_fit, off_fit = best

        # (b) grid search, heading constrained to +-10 deg around the nominal azimuth (integer 2 deg shifts)
        def search(free_offset: bool):
            best_r = np.full(len(cand), np.inf)
            for s in HDG_SHIFTS:
                c = cand[:, (kidx + s) % sk.NAZ]
                diff = obs[None, :] - c
                if free_offset:
                    diff = diff - diff.mean(axis=1, keepdims=True)
                r = np.sqrt((diff ** 2).mean(axis=1))
                best_r = np.minimum(best_r, r)
            b = int(best_r.argmin())
            bi, bj = divmod(b, n)
            err = math.hypot(gn.ravel()[b] - truth_n, ge.ravel()[b] - truth_e)
            unc = sk.uncertainty(best_r.reshape(n, n), bi, bj)
            return b, err, unc, float(best_r.min()), best_r
        b, err, unc, rmin, rgrid = search(False)
        b2, err2, unc2, rmin2, _ = search(True)
        # shift of the best cell
        c_best = cand[b]
        sh_best = min(HDG_SHIFTS, key=lambda s: rms(obs, c_best[(kidx + s) % sk.NAZ]))
        elat, elon = px_to_latlon(grows[b], gcols[b], z.shape)
        elat2, elon2 = px_to_latlon(grows[b2], gcols[b2], z.shape)
        far = prof_far[kidx]
        out_results[name] = dict(far_max=float(far.max()), obs_min=float(obs.min()), obs_max=float(obs.max()), az=grid_az, obs=obs, kidx=kidx, raw=raw, r_fit=r_fit, sh_fit=sh_fit, off_fit=off_fit,
                                 b=b, err=err, unc=unc, rmin=rmin, sh_best=int(sh_best), est=(elat, elon),
                                 err2=err2, unc2=unc2, rmin2=rmin2, est2=(elat2, elon2),
                                 dtm=prof_truth[kidx], dtm_best=c_best[(kidx + sh_best) % sk.NAZ],
                                 mean_abs_res=float(np.median(np.abs(obs - off_fit - dtm_at(sh_fit)))))
        print(f"[{name}] az span {grid_az[0]:.0f}-{grid_az[-1]:.0f}; RMS at waypoint raw {raw:.2f} deg, fitted {r_fit:.2f} deg "
              f"(az shift {sh_fit:+.2f}, elev offset {off_fit:+.2f}); grid: error {err:.0f} m, unc {unc:.0f} m, min RMS {rmin:.2f} deg "
              f"| with free elev offset: error {err2:.0f} m, unc {unc2:.0f} m, min RMS {rmin2:.2f}")

    # Quaternion convention: the two possible readings give boresight azimuths ~170 deg apart; the one whose fitted RMS
    # at the waypoint is lower is used (this is a 2-way choice made on the data; both are written to the JSON).
    primary = min(out_results, key=lambda k: out_results[k]["r_fit"])
    R = out_results[primary]
    other = [k for k in out_results if k != primary][0]

    def rl(a):
        return [round(float(v), 3) for v in np.asarray(a).ravel()]

    far_note = (f"Diagnostic: DTM horizon computed out to 40 km (instead of 15 km) over the same azimuths peaks at {R['far_max']:+.2f} deg, "
                f"while the traced skyline is {R['obs_min']:+.2f} to {R['obs_max']:+.2f} deg - the terrain forming the skyline in this frame is not inside the DTM "
                f"(the DTM covers roughly 30 x 30 km and this waypoint is ~15 km from its eastern edge), so a match is not possible by construction at this heading.")
    big = R["err"] > 500 or R["r_fit"] > 1.0
    verdict = (f"{'POOR match' if big else 'Reasonable match'}: at the waypoint the traced skyline differs from the DTM horizon by "
               f"{R['r_fit']:.2f} deg RMS after fitting a {R['off_fit']:+.2f} deg elevation offset and {R['sh_fit']:+.2f} deg azimuth shift "
               f"({R['raw']:.2f} deg with no fitting). Grid search with the heading limited to +-10 deg lands {R['err']:.0f} m from the waypoint "
               f"(uncertainty radius {R['unc']:.0f} m); with a free elevation offset {R['err2']:.0f} m / {R['unc2']:.0f} m. "
               + far_note + " "
               + ("This single real frame does NOT support the claim that a position fix of tens of metres is achievable from one photo with this DTM. "
                  if big else "This single frame is consistent with the method, but it is one image, a hand-tuned edge detector and a waypoint that is itself uncertain. ")
               + "Not a statistical result.")
    assumptions = [
        f"One frame, chosen by rule before any matching (earliest sol with a single traverse.json waypoint; middle frame of a 21-frame horizon strip at mastEl ~0.4 deg). Frames tried: {TRIES['frames']}. Edge-detector settings tried: {TRIES['edge_settings']} (sigma {EDGE_SIGMA_PX} px, step threshold {EDGE_THRESH} grey levels/px) - no tuning against the match.",
        f"Frame is a full-width strip: subframeRect {ext['subframeRect']} of the 5120x3840 detector, scaleFactor {ext['scaleFactor']}, delivered as {W}x{H} px. Not the whole 96x73 deg field vertically: only the horizon band.",
        f"Optics from the frame's own CAHVORE model (fisheye type, radial terms R, entrance-pupil term E ignored): principal point hc={cam.hc:.0f}, vc={cam.vc:.0f} in the strip's pixel coordinates, focal ~{cam.hs:.0f} px; field across the strip {fov_h:.0f} deg wide. Close to the nominal ~96 deg horizontal Navcam field.",
        "Rover tilt is included via the attitude quaternion in the metadata; camera_vector/mastAz are rover-frame, so true azimuth = rover heading + mastAz (heading from the quaternion, not from mastAz alone as in the original plan).",
        f"Quaternion convention is not documented in the API response; two readings tried (boresight azimuth {centre_az['site_to_rover']:.0f} deg vs {centre_az['rover_to_site']:.0f} deg). Reading used: {primary}, chosen because its fitted RMS at the waypoint is lower; the other gave fitted RMS {out_results[other]['r_fit']:.2f} deg and grid error {out_results[other]['err']:.0f} m. This 2-way choice was made on the data, so the reported RMS is slightly optimistic.",
        "Position truth = traverse.json waypoint for this sol (sol-level, not the exact imaging position; the rover drove on this sol; accuracy of tens of metres or worse).",
        "Grid search: same 61x61 / 100 m grid and RMS/uncertainty rules as skyline.py, centred on a seeded prior 1-2 km from the waypoint; heading free only within +-10 deg of the nominal azimuth; no elevation offset allowed (a free-offset variant is also reported).",
        "DTM is 20 m CTX; it cannot contain metre-scale rocks and ridges close to the rover, which the camera sees as part of the skyline. Observed skyline can therefore be higher than the DTM horizon in the foreground.",
        far_note,
        "Skyline = first strong bright-to-dark step from the top; columns without an edge or deviating >12 px from a running median are dropped; 5-px median smoothing; resampled onto the 2 deg azimuth grid.",
    ]
    result = {
        "id": f"sol{SOL}", "sol": SOL, "imageId": IMAGE_ID, "imageUrl": url, "credit": im.get("credit", "NASA/JPL-Caltech"),
        "mastAzDeg": mast_az, "mastElDeg": mast_el, "fovDeg": round(fov_h, 1),
        "truth": {"lat": round(lat, 5), "lon": round(lon, 5)},
        "estimate": {"lat": round(R["est"][0], 5), "lon": round(R["est"][1], 5)},
        "errorM": round(R["err"]), "uncertaintyM": round(R["unc"]),
        "rmsAtTruthDeg": round(R["r_fit"], 3), "fittedElevOffsetDeg": round(R["off_fit"], 3), "fittedAzShiftDeg": round(R["sh_fit"], 2),
        "rmsAtTruthUnfittedDeg": round(R["raw"], 3), "gridMinRmsDeg": round(R["rmin"], 3), "headingShiftOfBestDeg": R["sh_best"] * sk.AZ_STEP,
        "freeOffsetGridSearch": {"estimate": {"lat": round(R["est2"][0], 5), "lon": round(R["est2"][1], 5)},
                                 "errorM": round(R["err2"]), "uncertaintyM": round(R["unc2"]), "minRmsDeg": round(R["rmin2"], 3)},
        "quaternionConvention": primary,
        "otherConvention": {"name": other, "rmsAtTruthDeg": round(out_results[other]["r_fit"], 3),
                            "errorM": round(out_results[other]["err"]), "uncertaintyM": round(out_results[other]["unc"])},
        "azimuthsDeg": [round(float(v), 1) for v in R["az"]],
        "observed": rl(R["obs"]), "dtmAtTruth": rl(R["dtm"]), "dtmAtBest": rl(R["dtm_best"]),
        "imageFile": f"data/skyline_real/sol{SOL}.jpg", "imageSizePx": [W, H],
        "traceXY": [[int(c), round(float(sm[c]), 1)] for c in range(0, W, 8) if np.isfinite(sm[c])],
        "assumptions": assumptions,
        "method": "Real Navcam frame (NASA/JPL-Caltech raw image), skyline traced and matched against the CTX DTM horizon; single image, hand-tuned edge detection; not simulated.",
        "verdict": verdict,
    }
    (OUT / f"sol{SOL}.json").write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    img.convert("L").save(OUT / f"sol{SOL}.jpg", quality=85, optimize=True)
    print(f"wrote data/skyline_real/sol{SOL}.json and .jpg ({(OUT / f'sol{SOL}.jpg').stat().st_size / 1024:.0f} kB)")
    print("VERDICT:", verdict)


if __name__ == "__main__":
    main()
