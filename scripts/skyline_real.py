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
import sys
import urllib.request

import numpy as np
from PIL import Image

import skyline as sk
from dtm import DATA, EW_M, PX_M, ROOT, LAT_MAX, LAT_MID, LAT_MIN, LON_MAX, LON_MIN, latlon_to_px, load_dtm, px_to_latlon

CASES = {
    # Test 1 (legacy): chosen by rule before any matching: earliest sol with a single traverse.json waypoint; middle frame of a 21-frame strip.
    "sol204": dict(sol=204, imageId="NLG_0204_0685053395_488ECM_N0071716NCAM00518_00_2I4J", legacy=True,
                   tries={"frames": 1, "edge_settings": 1}),
    # Test 2 (geometry-screened, see assumptions in the JSON): rank 7 of the screening list, first rank with a usable frame.
    "sol1946": dict(sol=1946, imageId="NLG_1946_0839690905_667ECM_N0905110NCAM00500_00_2I4J", legacy=False,
                    tries={"frames": 1, "edge_settings": 1}, candidatesTried=7, windowDeg=(232, 328), skipped=[
                        "1 sol 1175 (window 62-158): horizon strips exist but their true azimuths (72, 144) are 34-38 deg from the window centre; other frames are tilted (mastEl +25 or <-3) or half-field",
                        "2 sol 1117 (124-220): only horizon strip points at true azimuth 355",
                        "3 sol 1101 (130-226): only half-width (2576 px) horizon strips at azimuths 21, 67, 287, 333",
                        "4 sol 1063 (132-228): no horizon strip (all frames mastEl < -25)",
                        "5 sol 1814 (76-172): no single full-width frame near mastEl 0 (only 2576 px half-field tiles)",
                        "6 sol 1102 (130-226): only horizon strip points at true azimuth 355",
                        "7 sol 1946 (232-328): full-width strip at true azimuth 288, LTST 11:12, mastEl -3.7 -> used"]),
}
API = "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&id="
RAW = ROOT / "raw" / "navcam"
OUT = DATA / "skyline_real"
SEED = 2021
EDGE_SIGMA_PX, EDGE_THRESH = 1.5, 4.0       # edge detector settings (see assumptions: number of settings tried)
CONVENTION = "rover_to_site"                # attitude quaternion rotates rover-frame vectors into the site (north-east-down) frame
CONVENTION_EVIDENCE = ("bearing test on the traverse: for 20 sols where traverse.json shows a drive >60 m since the previous waypoint, the yaw of the last frame's quaternion "
                       "read as rover->site matched the drive bearing better than the opposite reading in 15 of 20 sols (in 5 sols it was within 12 deg of the drive bearing while the opposite reading was off by 110-157 deg), "
                       "i.e. the rover mostly drives forward along its heading; no skyline data involved (one-off check run outside this script on 20 sols).")
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


MARGIN_M, MAX_TERRAIN_KM = 1000.0, 14.0


def horizon_terrain(z: np.ndarray, lat: float, lon: float):
    """Screening only: per 2 deg azimuth -> (horizon elevation deg, terrain forming it is >= 1 km inside the DTM and <= 14 km away)."""
    H, W = z.shape
    dist = np.arange(40.0, 15000.0 + 1, 40.0)
    curv = dist ** 2 / (2 * sk.R_MARS)
    r0, c0 = latlon_to_px(lat, lon, z.shape)
    r = np.rint(r0 - np.cos(sk.AZ)[:, None] * dist[None] / PX_M).astype(int)
    c = np.rint(c0 + np.sin(sk.AZ)[:, None] * dist[None] / EW_M).astype(int)
    ok = (r >= 0) & (r < H) & (c >= 0) & (c < W)
    zz = z[np.clip(r, 0, H - 1), np.clip(c, 0, W - 1)].astype(np.float64)
    eye = z[int(round(r0)), int(round(c0))] + sk.EYE_M
    ang = np.where(ok, np.degrees(np.arctan((zz - curv[None] - eye) / dist[None])), -np.inf)
    k = ang.argmax(1)
    ix = np.arange(sk.NAZ)
    mr, mc = MARGIN_M / PX_M, MARGIN_M / EW_M
    inside = (r[ix, k] >= mr) & (r[ix, k] < H - mr) & (c[ix, k] >= mc) & (c[ix, k] < W - mc) & (dist[k] <= MAX_TERRAIN_KM * 1000)
    return ang[ix, k], inside


def screen(z: np.ndarray, top: int = 10):
    """Geometry-only ranking of traverse waypoints x 96 deg azimuth windows (no images, no matching involved).
    Rule: a window is good where the horizon is 0.5-8 deg (visible in a horizon strip at mastEl ~0) and its terrain is inside the DTM.
    Rank: single-waypoint sols first, then fraction of good azimuths (rounded to 0.01), then std of horizon elevation (relief to match)."""
    trav = json.loads((DATA / "traverse.json").read_text(encoding="utf-8"))
    cnt = {}
    for t in trav:
        cnt[t["sol"]] = cnt.get(t["sol"], 0) + 1
    rows = []
    for t in trav:
        el, inside = horizon_terrain(z, t["lat"], t["lon"])
        good = (el >= 0.5) & (el <= 8.0) & inside
        best = max(((good[(w + np.arange(48)) % 180].mean(), el[(w + np.arange(48)) % 180].std(), w * 2) for w in range(180)),
                   key=lambda x: (round(x[0], 2), x[1]))
        rows.append((cnt[t["sol"]] > 1, -round(best[0], 2), -best[1], t["sol"], best[2], t["lat"], t["lon"]))
    rows.sort()
    for i, r in enumerate(rows[:top], 1):
        print(f"{i:2d}  sol {r[3]}  window {r[4]}-{r[4] + 96}  good fraction {-r[1]:.2f}  relief {-r[2]:.2f}  waypoints in sol {'>1' if r[0] else '1'}")


def rms(a, b):
    return float(np.sqrt(np.mean((a - b) ** 2)))


def run_case(case: dict) -> None:
    SOL, IMAGE_ID, TRIES = case["sol"], case["imageId"], case["tries"]
    legacy = case["legacy"]
    cid = f"sol{SOL}"
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    meta_p = RAW / f"{cid}.json"
    if not meta_p.exists():
        meta_p.write_bytes(urllib.request.urlopen(urllib.request.Request(API + IMAGE_ID, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read())
    im = json.loads(meta_p.read_text(encoding="utf-8"))
    if "images" in im:
        im = im["images"][0]
    assert im["imageid"] == IMAGE_ID and im["sol"] == SOL
    ext = im["extended"]
    url = im["image_files"]["full_res"]
    png = fetch(url, RAW / f"{cid}.png")
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
    primary = min(out_results, key=lambda k: out_results[k]["r_fit"]) if legacy else CONVENTION
    R = out_results[primary]
    other = [k for k in out_results if k != primary][0]

    def rl(a):
        return [round(float(v), 3) for v in np.asarray(a).ravel()]

    inside_frac = float(horizon_terrain(z, lat, lon)[1][R["kidx"]].mean())
    far_note = (f"Diagnostic: DTM horizon computed out to 40 km (instead of 15 km) over the same azimuths peaks at {R['far_max']:+.2f} deg, "
                f"while the traced skyline is {R['obs_min']:+.2f} to {R['obs_max']:+.2f} deg - the terrain forming the skyline in this frame is not inside the DTM "
                f"(the DTM covers roughly 30 x 30 km and this waypoint is ~15 km from its eastern edge), so a match is not possible by construction at this heading.")
    big = R["err"] > 500 or R["r_fit"] > 1.0
    conv_note = (f"Convention fixed independently of any skyline fit: {CONVENTION_EVIDENCE} Other reading shown side by side: boresight azimuth "
                 f"{centre_az[other]:.0f} deg -> fitted RMS {out_results[other]['r_fit']:.2f} deg, grid error {out_results[other]['err']:.0f} m / uncertainty {out_results[other]['unc']:.0f} m.")
    verdict = (f"{'POOR match' if big else 'Reasonable match'}: at the waypoint the traced skyline differs from the DTM horizon by "
               f"{R['r_fit']:.2f} deg RMS after fitting a {R['off_fit']:+.2f} deg elevation offset and {R['sh_fit']:+.2f} deg azimuth shift "
               f"({R['raw']:.2f} deg with no fitting). Grid search with the heading limited to +-10 deg lands {R['err']:.0f} m from the waypoint "
               f"(uncertainty radius {R['unc']:.0f} m); with a free elevation offset {R['err2']:.0f} m / {R['unc2']:.0f} m. "
               + far_note + " "
               + ("This single real frame does NOT support the claim that a position fix of tens of metres is achievable from one photo with this DTM. "
                  if big else "This single frame is consistent with the method, but it is one image, a hand-tuned edge detector and a waypoint that is itself uncertain. ")
               + "Not a statistical result.")
    assumptions_new = [
        "SELECTION RULE (geometry only, fixed before any image was traced or matched): for every traverse.json waypoint compute the DTM horizon (40 m steps, 2 deg azimuth, as skyline.py) and, per azimuth, where the horizon-forming terrain lies. "
        "An azimuth is 'good' if the horizon is 0.5-8 deg above level (visible in a horizon strip with mastEl near 0) AND the forming terrain is >= 1 km inside the DTM bounds AND <= 14 km away (inside the 15 km range the matcher uses). "
        "Every 96 deg window is scored by its fraction of good azimuths; ranked: single-waypoint sols first, then fraction (0.01), then std of the DTM horizon elevation (more relief = more to match). Code: screen() in this script.",
        f"Frame rule: first candidate in rank order with one full-width (5120 px) frame, mastEl within +-8 deg, LTST 9-16 h, true azimuth (rover heading from the attitude quaternion + camera_vector) within +-15 deg of the window centre; earliest frame at that pointing. Candidates examined: {case.get('candidatesTried')}; skipped: " + " | ".join(case.get("skipped", [])) + ".",
        f"Frames tried: {TRIES['frames']}. Edge-detector settings tried: {TRIES['edge_settings']} (sigma {EDGE_SIGMA_PX} px, step threshold {EDGE_THRESH} grey levels/px), identical to test 1; no tuning.",
        f"Frame is a full-width strip: subframeRect {ext['subframeRect']} of the 5120x3840 detector, scaleFactor {ext['scaleFactor']}, delivered as {W}x{H} px; horizon band only. Overlay checked once: the trace follows the visible skyline along its whole length; rover hardware appears only at the bottom edge, far from the skyline.",
        f"Optics from the frame's own CAHVORE model (fisheye type, radial terms R used, entrance-pupil term E ignored): principal point hc={cam.hc:.0f}, vc={cam.vc:.0f} in the delivered strip's pixel coordinates, focal ~{cam.hs:.0f} px; field across the strip {fov_h:.0f} deg wide.",
        "Rover tilt is included through the attitude quaternion; camera_vector/mastAz are rover-frame, so true azimuth = rover heading + mastAz.",
        conv_note,
        "Position truth = traverse.json waypoint for this sol (sol-level, not the exact imaging position; accuracy tens of metres or worse).",
        "Grid search: same 61x61 / 100 m grid and RMS/uncertainty rules as skyline.py, centred on a seeded prior 1-2 km from the waypoint; heading free only within +-10 deg of the nominal azimuth; no elevation offset allowed (a free-offset variant is also reported).",
        f"Fraction of the traced azimuths whose DTM-horizon terrain is >= 1 km inside the DTM and <= 14 km away: {inside_frac:.2f}.",
        "DTM is 20 m CTX; it cannot contain metre-scale rocks and ridges near the rover, which appear in the photo's skyline.",
        "Skyline = first strong bright-to-dark step from the top; columns without an edge or deviating >12 px from a running median are dropped; 5-px median smoothing; resampled onto the 2 deg azimuth grid.",
    ]
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
    if not legacy:
        assumptions = assumptions_new
        big_txt = ("POOR match" if big else "Reasonable match")
        verdict = (f"{big_txt}: unfitted RMS at the waypoint {R['raw']:.2f} deg; fitted RMS {R['r_fit']:.2f} deg with elevation offset {R['off_fit']:+.2f} deg and azimuth shift {R['sh_fit']:+.2f} deg. "
                   f"Grid search (+-3 km, 100 m, heading +-10 deg): {R['err']:.0f} m from the waypoint, uncertainty radius {R['unc']:.0f} m; with a free elevation offset {R['err2']:.0f} m / {R['unc2']:.0f} m. "
                   f"{inside_frac:.0%} of the traced azimuths have their DTM-horizon terrain inside the DTM. "
                   + ("This frame does NOT support the claim that a position fix of tens of metres is achievable from a single real photo. " if big else
                      "This frame is consistent with the method, but it is a single image, a fixed hand-tuned edge detector and a sol-level waypoint. ")
                   + "Not a statistical result. " + conv_note)
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
        **({} if legacy else {"terrainInsideDtmFraction": round(inside_frac, 3)}),
        "assumptions": assumptions,
        "method": "Real Navcam frame (NASA/JPL-Caltech raw image), skyline traced and matched against the CTX DTM horizon; single image, hand-tuned edge detection; not simulated.",
        "verdict": verdict,
    }
    (OUT / f"sol{SOL}.json").write_text(json.dumps(result, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    img.convert("L").save(OUT / f"sol{SOL}.jpg", quality=85, optimize=True)
    print(f"wrote data/skyline_real/sol{SOL}.json and .jpg ({(OUT / f'sol{SOL}.jpg').stat().st_size / 1024:.0f} kB)")
    print("VERDICT:", verdict)


# ======================================================================================================================
# Panorama + MOLA-backdrop method (second round).  Legacy single-frame code above is untouched (sol204.json / sol1946.json).
# ======================================================================================================================
import time
import warnings

import mola as mo

WP_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
WP_FILE = ROOT / "raw" / "waypoints.json"
PANO_SEED = SEED                                 # same prior seed as the single-frame tests (rng(2021): 1-2 km offset, random direction)
# --- parameters fixed from the brief BEFORE any panorama result was seen; never tuned ---
HDG_MAX_DEG = 10.0                               # heading known to +-10 deg (11 shifts of 2 deg), as in the single-frame tests
ELEV_OFFSET_MAX_DEG = 0.5                        # one elevation offset per candidate, bounded to +-0.5 deg (absorbs pitch error)
NEAR_FIELD_M = 150.0                             # azimuths whose predicted horizon forms closer than this at a candidate are not scored
CTX_STEP_M, CTX_MAX_M = 40.0, 15000.0            # CTX horizon sampling (as skyline.py)
MOLA_STEP_M, MOLA_MAX_M = 250.0, 120000.0        # MOLA backdrop sampling
MIN_CELL_POINTS = 10                             # traced columns needed inside a 2-deg azimuth cell
MIN_SCORED_AZ = 20                               # a candidate needs at least this many scored azimuths (40 deg) ...
MIN_SCORED_FRAC = 0.5                            # ... and at least this fraction of the valid azimuths (added after the first development run, which
                                                 #     showed the near-field exclusion letting a candidate "win" by dropping most of a single frame; see assumptions)
FRAME_SPACING_DEG = 40.0                         # frames used for a panorama: greedy, boresight azimuths >= 40 deg apart (download budget)
FRAME_MASTEL_MAX, FRAME_LTST = 8.0, (9.0, 16.0)  # frame usability rule (same as the single-frame tests): |mastEl| <= 8 deg, local solar time 9-16 h
FRAME_WIDTH_PX = 5120                            # full-width strips only (subframeRect width)
COVERAGE_MIN_DEG = 270.0                         # held-out rule (c)
HELDOUT_MIN_SEP_M, HELDOUT_EDGE_M = 3000.0, 2000.0
SUCCESS_ERR_M, SUCCESS_UNC_M = 500.0, 1000.0    # verdict rule: "fix achieved" only if error <= 500 m AND uncertainty radius <= 1000 m (fixed before held-out)
HW_MASK = None                                   # rover-frame azimuth sector (lo, hi) deg masked as rover hardware; see hw_masked()
MPD_LAT = 2 * math.pi * sk.R_MARS / 360.0        # metres per degree latitude
N_DOWNLOADS = [0]


def fetch_count(url: str, dest):
    if not dest.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        dest.write_bytes(urllib.request.urlopen(req, timeout=120).read())
        N_DOWNLOADS[0] += 1
    return dest


def load_waypoints() -> list:
    if not WP_FILE.exists():
        WP_FILE.parent.mkdir(parents=True, exist_ok=True)
        WP_FILE.write_bytes(urllib.request.urlopen(urllib.request.Request(WP_URL, headers={"User-Agent": "Mozilla/5.0"}), timeout=120).read())
    feats = json.loads(WP_FILE.read_text(encoding="utf-8"))["features"]
    wps = [{k: f["properties"][k] for k in ("site", "drive", "sol", "lat", "lon", "yaw", "pitch", "roll", "elev_geoid")} for f in feats]
    wps.sort(key=lambda w: (w["sol"], w["site"], w["drive"]))
    return wps


def find_wp(wps, site: int, drive: int) -> dict:
    m = [w for w in wps if w["site"] == site and w["drive"] == drive]
    assert len(m) == 1, f"waypoint site {site} drive {drive}: {len(m)} matches"
    return m[0]


def next_sol(wps, w) -> int:
    later = [x["sol"] for x in wps if (x["sol"], x["site"], x["drive"]) > (w["sol"], w["site"], w["drive"]) and (x["site"], x["drive"]) != (w["site"], w["drive"])]
    return min(later) if later else w["sol"]


def sol_listing(sol: int) -> list:
    p = RAW / f"list_sol{sol}.json"
    if not p.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        url = f"https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol={sol}&camera=NAVCAM_LEFT&per_page=100&page=0"
        p.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=120).read())
        time.sleep(0.5)
    d = json.loads(p.read_text(encoding="utf-8"))
    return [i for i in d.get("images", []) if i["camera"]["instrument"] == "NAVCAM_LEFT"]


def rot_from_wp(w: dict) -> np.ndarray:
    """rover->site (north-east-down) rotation from the waypoint's yaw/pitch/roll (Z-Y-X); verified equal to the frame quaternion."""
    y, p, r = (math.radians(w[k]) for k in ("yaw", "pitch", "roll"))
    Rz = np.array([[math.cos(y), -math.sin(y), 0], [math.sin(y), math.cos(y), 0], [0, 0, 1]])
    Ry = np.array([[math.cos(p), 0, math.sin(p)], [0, 1, 0], [-math.sin(p), 0, math.cos(p)]])
    Rx = np.array([[1, 0, 0], [0, math.cos(r), -math.sin(r)], [0, math.sin(r), math.cos(r)]])
    return Rz @ Ry @ Rx


def tup(s: str):
    return tuple(float(v) for v in s.strip("()").split(","))


def ltst_hours(im: dict) -> float:
    t = im["date_taken_mars"].split("M")[1]
    h, m, s = (float(v) for v in t.split(":"))
    return h + m / 60 + s / 3600


def frame_footprint(im: dict, R: np.ndarray):
    """(boresight true azimuth, half-width deg at the principal row) from the camera model + waypoint attitude; metadata only, no image."""
    cam = Cahvore(im["camera"]["camera_model_component_list"])
    dimw = int(tup(im["extended"]["dimension"])[0])
    xs = np.array([0.0, dimw / 2 - 0.5, dimw - 1.0])
    rays = cam.ray(xs, np.full(3, cam.vc)) @ R.T
    az = np.degrees(np.arctan2(rays[:, 1], rays[:, 0])) % 360
    half = abs((az[2] - az[0] + 180) % 360 - 180) / 2
    return float(az[1]), float(half)


def usable_frames(wp: dict, wps: list) -> list:
    """All NAVCAM_LEFT frames of this site+drive passing the usability rule, with true boresight azimuth (waypoint attitude)."""
    R = rot_from_wp(wp)
    out, seen = [], set()
    for sol in range(wp["sol"], min(next_sol(wps, wp), wp["sol"] + 4) + 1):
        for im in sol_listing(sol):
            if int(im["site"]) != wp["site"] or int(im["drive"]) != wp["drive"] or im["sample_type"] != "Full" or im["imageid"] in seen:
                continue
            seen.add(im["imageid"])
            ex = im["extended"]
            if int(tup(ex["subframeRect"])[2]) != FRAME_WIDTH_PX or abs(float(ex["mastEl"])) > FRAME_MASTEL_MAX:
                continue
            if not (FRAME_LTST[0] <= ltst_hours(im) <= FRAME_LTST[1]):
                continue
            az, half = frame_footprint(im, R)
            out.append(dict(im=im, az=az, half=half, sclk=float(ex["sclk"])))
    return out


def select_frames(cands: list, seed_id: str | None = None) -> list:
    """Greedy, deterministic: start at the seed frame (given id, else the earliest sclk), walk clockwise taking the first frame >= 40 deg beyond the last taken."""
    if not cands:
        return []
    seed = next((c for c in cands if c["im"]["imageid"] == seed_id), None) if seed_id else None
    seed = seed or min(cands, key=lambda c: c["sclk"])
    rest = sorted((((c["az"] - seed["az"]) % 360, c["sclk"], i, c) for i, c in enumerate(cands) if c is not seed), key=lambda t: t[:3])
    sel, last = [seed], 0.0
    for off, _, _, c in rest:
        if off >= last + FRAME_SPACING_DEG and off <= 360 - FRAME_SPACING_DEG:
            sel.append(c)
            last = off
    return sel


def footprint_coverage(sel: list) -> float:
    """Degrees of azimuth covered by the union of the selected frames' footprints (metadata only)."""
    cov = np.zeros(360, bool)
    for c in sel:
        for a in np.arange(c["az"] - c["half"], c["az"] + c["half"], 0.5):
            cov[int(math.floor(a)) % 360] = True
    return float(cov.sum())


def hw_masked(az_rover_deg: np.ndarray) -> np.ndarray:
    """True where a ray (rover-frame azimuth, deg) is inside the rover-hardware sector declared in HW_MASK."""
    if HW_MASK is None:
        return np.zeros(len(az_rover_deg), bool)
    lo, hi = HW_MASK
    return ((az_rover_deg - lo) % 360) <= ((hi - lo) % 360)


def trace_frame(c: dict, wp: dict) -> dict:
    """Download (cached) + trace one frame with the fixed edge settings; returns per-2-deg-cell elevations (NaN where no trace) in true azimuth."""
    im = c["im"]
    png = fetch_count(im["image_files"]["full_res"], RAW / f"{im['imageid']}.png")
    g = np.asarray(Image.open(png).convert("L"), dtype=np.float64)
    H, W = g.shape
    rows = trace_skyline(g)
    ok = clean_trace(rows)
    rr = np.where(ok, rows, np.nan)
    sm = rr.copy()
    for col in range(W):
        w = rr[max(0, col - 2):col + 3]
        w = w[np.isfinite(w)]
        sm[col] = np.median(w) if len(w) >= 3 else np.nan
    good = np.isfinite(sm)
    cam = Cahvore(im["camera"]["camera_model_component_list"])
    cols = np.arange(W, dtype=np.float64)
    rays = cam.ray(cols[good], sm[good])
    s = rays @ rot_from_wp(wp).T
    az = np.degrees(np.arctan2(s[:, 1], s[:, 0])) % 360
    el = np.degrees(np.arcsin(np.clip(-s[:, 2], -1, 1)))
    az_rover = np.degrees(np.arctan2(rays[:, 1], rays[:, 0])) % 360
    keep = ~hw_masked(az_rover)
    az, el = az[keep], el[keep]
    cell = np.floor((az + sk.AZ_STEP / 2) / sk.AZ_STEP).astype(int) % sk.NAZ
    prof = np.full(sk.NAZ, np.nan)
    for k in np.unique(cell):
        m = cell == k
        if m.sum() >= MIN_CELL_POINTS:
            prof[k] = np.median(el[m])
    return dict(imageId=im["imageid"], imageUrl=im["image_files"]["full_res"], mastAz=float(im["extended"]["mastAz"]), mastEl=float(im["extended"]["mastEl"]),
                prof=prof, tracedCols=int(good.sum()), W=W, H=H, rows=sm, az_boresight=c["az"], img=g)


def merge_frames(profs: list) -> np.ndarray:
    """Median over frames per 2-deg cell (NaN = no frame / trace rejected -> not scored)."""
    st = np.array(profs)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return np.nanmedian(st, axis=0)


def horizons_ext(z: np.ndarray, m: np.ndarray, rows: np.ndarray, cols: np.ndarray, batch: int = 40):
    """Per observer (fractional DTM pixel) and 2-deg azimuth: CTX horizon (40 m to 15 km) with the distance of its forming sample,
    and the MOLA horizon (250 m steps to 120 km, only samples outside the CTX footprint or beyond 15 km). -inf = no data."""
    H, W = z.shape
    NAZ = sk.NAZ
    dc = np.arange(CTX_STEP_M, CTX_MAX_M + 1, CTX_STEP_M)
    curv_c = dc ** 2 / (2 * sk.R_MARS)
    dm = np.arange(MOLA_STEP_M, MOLA_MAX_M + 1, MOLA_STEP_M)
    curv_m = dm ** 2 / (2 * sk.R_MARS)
    sa, ca = np.sin(sk.AZ)[:, None], np.cos(sk.AZ)[:, None]
    n = len(rows)
    a_c, d_c, a_m = np.full((n, NAZ), -np.inf), np.zeros((n, NAZ)), np.full((n, NAZ), -np.inf)
    dr, dcc = -ca * dc[None] / PX_M, sa * dc[None] / EW_M
    for s in range(0, n, batch):
        r0, c0 = rows[s:s + batch], cols[s:s + batch]
        r = np.rint(r0[:, None, None] + dr[None]).astype(np.int64)
        c = np.rint(c0[:, None, None] + dcc[None]).astype(np.int64)
        ok = (r >= 0) & (r < H) & (c >= 0) & (c < W)
        zz = z[np.clip(r, 0, H - 1), np.clip(c, 0, W - 1)].astype(np.float64)
        eye = z[np.clip(np.rint(r0).astype(int), 0, H - 1), np.clip(np.rint(c0).astype(int), 0, W - 1)] + sk.EYE_M
        ang = np.where(ok, np.degrees(np.arctan((zz - curv_c[None, None] - eye[:, None, None]) / dc[None, None])), -np.inf)
        k = ang.argmax(axis=2)
        a_c[s:s + batch] = np.take_along_axis(ang, k[..., None], 2)[..., 0]
        d_c[s:s + batch] = dc[k]
        lat0 = LAT_MAX - r0 / H * (LAT_MAX - LAT_MIN)
        lon0 = LON_MIN + c0 / W * (LON_MAX - LON_MIN)
        lat = lat0[:, None, None] + (ca * dm[None])[None] / MPD_LAT
        lon = lon0[:, None, None] + (sa * dm[None])[None] / (MPD_LAT * np.cos(np.radians(lat)))
        inctx = (lat > LAT_MIN) & (lat < LAT_MAX) & (lon > LON_MIN) & (lon < LON_MAX) & (dm[None, None] <= CTX_MAX_M)
        mr = np.rint((mo.TOP_LAT - lat) * mo.PPD - 0.5 - mo.ROW0).astype(np.int64)
        mc = np.rint(lon * mo.PPD - 0.5 - mo.COL0).astype(np.int64)
        okm = (mr >= 0) & (mr < m.shape[0]) & (mc >= 0) & (mc < m.shape[1]) & ~inctx
        zm = m[np.clip(mr, 0, m.shape[0] - 1), np.clip(mc, 0, m.shape[1] - 1)].astype(np.float64)
        angm = np.where(okm, np.degrees(np.arctan((zm - curv_m[None, None] - eye[:, None, None]) / dm[None, None])), -np.inf)
        a_m[s:s + batch] = angm.max(axis=2)
    return a_c, d_c, a_m


def combine(a_c, d_c, a_m, use_mola: bool):
    """-> (horizon deg, forming distance m) as the matcher uses it; no-data azimuths -> 0 deg (as skyline.py)."""
    if use_mola:
        h = np.maximum(a_c, a_m)
        d = np.where(a_m > a_c, 1e9, d_c)
    else:
        h, d = a_c, d_c
    return np.where(np.isfinite(h), h, 0.0), d


def score_grid(cand: np.ndarray, dist: np.ndarray, obs: np.ndarray):
    """cand/dist (N, NAZ); obs (NAZ,) with NaN = not scored. Per candidate: min over 11 heading shifts (+-10 deg) of the RMS over valid
    azimuths not excluded by the near-field rule, with one elevation offset clipped to +-0.5 deg. Returns rms, shift, offset, n_scored."""
    valid = np.isfinite(obs)
    o = np.where(valid, obs, 0.0)
    N = len(cand)
    best, bs, bo, bn = np.full(N, np.inf), np.zeros(N, int), np.zeros(N), np.zeros(N, int)
    nsh = int(HDG_MAX_DEG // sk.AZ_STEP)
    for s in range(-nsh, nsh + 1):
        idx = (np.arange(sk.NAZ) + s) % sk.NAZ
        use = valid[None] & (dist[:, idx] >= NEAR_FIELD_M)
        n = use.sum(1)
        diff = np.where(use, o[None] - cand[:, idx], 0.0)
        mean = diff.sum(1) / np.maximum(n, 1)
        off = np.clip(mean, -ELEV_OFFSET_MAX_DEG, ELEV_OFFSET_MAX_DEG)
        r = np.sqrt((np.where(use, diff - off[:, None], 0.0) ** 2).sum(1) / np.maximum(n, 1))
        r = np.where((n >= MIN_SCORED_AZ) & (n >= MIN_SCORED_FRAC * valid.sum()), r, np.inf)
        better = r < best
        best, bs, bo, bn = np.where(better, r, best), np.where(better, s, bs), np.where(better, off, bo), np.where(better, n, bn)
    return best, bs, bo, bn


DEV_SEEDS = {   # development set: the frame used in the legacy single-frame test is the seed (and the "single frame" of the ablation)
    (7, 1716): "NLG_0204_0685053395_488ECM_N0071716NCAM00518_00_2I4J",
    (90, 5110): "NLG_1946_0839690905_667ECM_N0905110NCAM00500_00_2I4J",
}
LEGACY_JSON = {(7, 1716): "sol204", (90, 5110): "sol1946"}
ABLATION_ROWS = [("i_single_ctx", "single frame, CTX-only horizon (old horizon)"),
                 ("ii_single_mola", "single frame + MOLA backdrop"),
                 ("iii_pano_ctx", "panorama, CTX-only horizon"),
                 ("iv_pano_mola_full", "panorama + MOLA backdrop (full method)")]
_REG = {}


def registration(z: np.ndarray, m: np.ndarray, n: int = 400, seed: int = 1) -> dict:
    """CTX - MOLA at n random points inside the CTX DTM (nearest CTX pixel, bilinear MOLA)."""
    if not _REG:
        rng = np.random.default_rng(seed)
        r, c = rng.uniform(0, z.shape[0] - 1, n), rng.uniform(0, z.shape[1] - 1, n)
        lat, lon = px_to_latlon(r, c, z.shape)
        d = z[np.rint(r).astype(int), np.rint(c).astype(int)].astype(np.float64) - mo.sample(m, lat, lon)
        assert np.isfinite(d).all()
        _REG.update(n=n, meanM=round(float(d.mean()), 1), stdM=round(float(d.std()), 1))
    return dict(_REG)


def ascii_plot(path, az, series, size=(900, 320)):
    """Tiny JPEG: skyline elevation vs true azimuth. series = [(label, values, rgb, mode)]; mode 'dot' or 'line'."""
    from PIL import ImageDraw
    W, H = size
    vals = np.concatenate([np.asarray(v, float)[np.isfinite(v)] for _, v, _, _ in series])
    lo, hi = float(vals.min()) - 0.5, float(vals.max()) + 0.5
    im = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(im)
    X = lambda a: 40 + a / 360 * (W - 50)
    Y = lambda e: H - 25 - (e - lo) / (hi - lo) * (H - 45)
    for a in range(0, 361, 45):
        d.line([(X(a), 10), (X(a), H - 25)], fill=(225, 225, 225))
        d.text((X(a) - 8, H - 20), f"{a}", fill=(0, 0, 0))
    for e in range(int(math.ceil(lo)), int(hi) + 1):
        d.line([(40, Y(e)), (W - 10, Y(e))], fill=(225, 225, 225))
        d.text((8, Y(e) - 5), f"{e}", fill=(0, 0, 0))
    for k, (lab, v, col, mode) in enumerate(series):
        v = np.asarray(v, float)
        pts = [(X(a), Y(e)) for a, e in zip(az, v) if np.isfinite(e)]
        if mode == "dot":
            for x, y in pts:
                d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=col)
        else:
            d.line(pts, fill=col, width=2)
        d.text((50 + 230 * k, 12), lab, fill=col)
    im.save(path, quality=80, optimize=True)


def run_pano(site: int, drive: int, set_name: str) -> dict:
    t0 = time.time()
    wps = load_waypoints()
    wp = find_wp(wps, site, drive)
    R = rot_from_wp(wp)
    cands = usable_frames(wp, wps)
    sel = select_frames(cands, DEV_SEEDS.get((site, drive)))
    assert sel, "no usable frames"
    cov_meta = footprint_coverage(sel)
    n0 = N_DOWNLOADS[0]
    tr_frames = [trace_frame(c, wp) for c in sel]
    # attitude check: waypoint yaw/pitch/roll must reproduce the frame's own attitude quaternion
    qR = quat_matrix([float(v) for v in sel[0]["im"]["attitude"].strip("()").split(",")])
    att_diff = float(np.abs(qR - R).max())
    obs_pano = merge_frames([t["prof"] for t in tr_frames])
    obs_single = tr_frames[0]["prof"].copy()                      # seed frame (legacy frame for development; earliest-sclk frame otherwise)
    valid_frac = float(np.isfinite(obs_pano).mean())

    z = load_dtm()
    m = mo.load()
    reg = registration(z, m)
    assert LAT_MIN < wp["lat"] < LAT_MAX and LON_MIN < wp["lon"] < LON_MAX
    tr, tc = latlon_to_px(wp["lat"], wp["lon"], z.shape)
    rng = np.random.default_rng(PANO_SEED)
    dist, ang = rng.uniform(1000, 2000), rng.uniform(0, 2 * math.pi)   # identical draw to the single-frame tests
    off_n, off_e = dist * math.cos(ang), dist * math.sin(ang)
    pr, pc = tr - off_n / PX_M, tc + off_e / EW_M
    n = sk.GRID_N
    half, step = n // 2, sk.GRID_STEP
    gn, ge = np.meshgrid((half - np.arange(n)) * step, (np.arange(n) - half) * step, indexing="ij")
    grows, gcols = (pr - gn / PX_M).ravel(), (pc + ge / EW_M).ravel()
    truth_n, truth_e = -off_n, -off_e
    rows_all = np.concatenate([grows, [tr]])                       # last candidate = the waypoint itself (diagnostic only)
    cols_all = np.concatenate([gcols, [tc]])
    t1 = time.time()
    a_c, d_c, a_m = horizons_ext(z, m, rows_all, cols_all)
    # consistency of the CTX part with skyline.horizons (imported, unchanged)
    chk = np.linspace(0, len(rows_all) - 1, 24).astype(int)
    ref = sk.horizons(z, rows_all[chk], cols_all[chk])
    ctx_diff = float(np.abs(np.where(np.isfinite(a_c[chk]), a_c[chk], 0.0) - ref).max())
    assert ctx_diff < 1e-6, ctx_diff
    print(f"[{site}/{drive}] frames {len(sel)} (downloads {N_DOWNLOADS[0] - n0}), valid az {valid_frac:.2f}; horizons {time.time() - t1:.0f}s; ctx-vs-skyline.horizons max diff {ctx_diff:.1e} deg")

    hz = {False: combine(a_c, d_c, a_m, False), True: combine(a_c, d_c, a_m, True)}
    rows_out = {}
    for key, _ in ABLATION_ROWS:
        obs = obs_single if key.startswith(("i_", "ii_")) else obs_pano
        use_mola = key.startswith(("ii_", "iv_"))
        cand, dd = hz[use_mola]
        rms, sh, off, ns = score_grid(cand, dd, obs)
        g = rms[:-1]
        b = int(g.argmin())
        bi, bj = divmod(b, n)
        err = float(math.hypot(gn.ravel()[b] - truth_n, ge.ravel()[b] - truth_e))
        unc = sk.uncertainty(g.reshape(n, n), bi, bj)
        elat, elon = px_to_latlon(grows[b], gcols[b], z.shape)
        rows_out[key] = dict(errorM=round(err), uncertaintyM=round(unc), minRmsDeg=round(float(g.min()), 3), estimate={"lat": round(elat, 5), "lon": round(elon, 5)},
                             headingShiftDeg=int(sh[b]) * sk.AZ_STEP, elevOffsetDeg=round(float(off[b]), 3), scoredAzimuths=int(ns[b]),
                             rmsAtWaypointDeg=round(float(rms[-1]), 3), headingShiftAtWaypointDeg=int(sh[-1]) * sk.AZ_STEP, elevOffsetAtWaypointDeg=round(float(off[-1]), 3),
                             _b=b, _sh=int(sh[b]), _off=float(off[b]))
        print(f"   {key:<18} error {err:6.0f} m  unc {unc:5.0f} m  min RMS {g.min():.3f} deg  (heading {int(sh[b]) * 2:+d}, offset {off[b]:+.2f}, {ns[b]} az)  | at waypoint RMS {rms[-1]:.3f}")
    full = rows_out["iv_pano_mola_full"]

    # residuals of the full method at the waypoint (diagnostic): observed - horizon(full) at shift/offset fitted there
    azg = np.arange(sk.NAZ) * sk.AZ_STEP
    hfull_w = hz[True][0][-1]
    hctx_w = hz[False][0][-1]
    s_w = full["headingShiftAtWaypointDeg"] // sk.AZ_STEP
    idx_w = (np.arange(sk.NAZ) + s_w) % sk.NAZ
    near_w = hz[True][1][-1][idx_w] < NEAR_FIELD_M
    res_w = np.where(np.isfinite(obs_pano) & ~near_w, obs_pano - full["elevOffsetAtWaypointDeg"] - hfull_w[idx_w], np.nan)
    res_valid = res_w[np.isfinite(res_w)]
    near_n = int((np.isfinite(obs_pano) & near_w).sum())
    mola_wins = float((a_m[-1] > a_c[-1])[np.isfinite(obs_pano)].mean())

    def r3(a):
        return [None if not np.isfinite(v) else round(float(v), 3) for v in np.asarray(a, float).ravel()]

    legacy = None
    lj = LEGACY_JSON.get((site, drive))
    if lj and (OUT / f"{lj}.json").exists():
        L = json.loads((OUT / f"{lj}.json").read_text(encoding="utf-8"))
        legacy = {"file": f"data/skyline_real/{lj}.json", "errorM": L["errorM"], "uncertaintyM": L["uncertaintyM"], "note": "legacy single-frame run: sol-level traverse.json truth, quaternion attitude, no elevation offset, no near-field rule, CTX only"}
    abl = {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")} for k, v in rows_out.items()}
    grade = ("FIX ACHIEVED" if full["errorM"] <= SUCCESS_ERR_M and full["uncertaintyM"] <= SUCCESS_UNC_M else
             "WEAK (better than the prior but not a usable fix)" if full["errorM"] < dist else "FAILED (no better than the prior)")
    verdict = (f"{grade} (rule fixed before the held-out runs: FIX = error <= {SUCCESS_ERR_M:.0f} m and uncertainty <= {SUCCESS_UNC_M:.0f} m; WEAK = error below the prior offset). Full method (panorama of {len(sel)} frames, {valid_frac:.0%} of azimuths scored, CTX + MOLA backdrop): "
               f"error {full['errorM']} m, uncertainty radius {full['uncertaintyM']} m, min RMS {full['minRmsDeg']:.3f} deg (prior offset {dist:.0f} m). "
               f"Ablation errors (m): single/CTX {abl['i_single_ctx']['errorM']}, single+MOLA {abl['ii_single_mola']['errorM']}, panorama/CTX {abl['iii_pano_ctx']['errorM']}, full {full['errorM']}. "
               f"At the waypoint itself the full-method RMS is {full['rmsAtWaypointDeg']:.3f} deg (residual median {float(np.median(res_valid)):+.2f}, 5-95% range {float(np.percentile(res_valid, 5)):+.2f} to {float(np.percentile(res_valid, 95)):+.2f} deg). "
               f"One position, one run: not a statistical result.")
    out = {
        "id": f"site{site:03d}_drive{drive:04d}", "set": set_name,
        "waypoint": {"site": site, "drive": drive, "sol": wp["sol"], "yaw": round(wp["yaw"], 3), "pitch": round(wp["pitch"], 3), "roll": round(wp["roll"], 3)},
        "truth": {"lat": round(wp["lat"], 5), "lon": round(wp["lon"], 5)},
        "estimate": full["estimate"], "errorM": full["errorM"], "uncertaintyM": full["uncertaintyM"], "minRmsDeg": full["minRmsDeg"],
        "priorOffsetM": round(dist), "headingShiftOfBestDeg": full["headingShiftDeg"], "elevOffsetOfBestDeg": full["elevOffsetDeg"],
        "rmsAtWaypointDeg": full["rmsAtWaypointDeg"],
        "frames": [{"imageId": t["imageId"], "imageUrl": t["imageUrl"], "mastAzDeg": t["mastAz"], "mastElDeg": t["mastEl"],
                    "trueBoresightAzDeg": round(t["az_boresight"], 1), "tracedColumns": t["tracedCols"], "imageSizePx": [t["W"], t["H"]]} for t in tr_frames],
        "singleFrameId": tr_frames[0]["imageId"],
        "validAzimuthFraction": round(valid_frac, 3), "footprintCoverageDeg": round(cov_meta, 1),
        "backdrop": {"product": mo.PRODUCT, "labelVerified": "11520 x 5632, MSB_INTEGER 16 bit, 128 px/deg, 44N-0N x 0E-90E, metres above areoid, planetocentric (megt44n000hb.lbl)",
                     "ctxMinusMolaRegistration": {"points": reg["n"], "meanM": reg["meanM"], "stdM": reg["stdM"]},
                     "usedBeyond": f"samples outside the CTX footprint or farther than {CTX_MAX_M / 1000:.0f} km, every {MOLA_STEP_M:.0f} m out to {MOLA_MAX_M / 1000:.0f} km, nearest MOLA cell, same curvature term",
                     "azimuthsWhereMolaFormsHorizonFraction": round(mola_wins, 3)},
        "ablation": abl,
        "legacySingleFrame": legacy,
        "azimuthsDeg": [int(a) for a in azg],
        "observed": r3(obs_pano), "observedSingleFrame": r3(obs_single),
        "horizonAtWaypointCtx": r3(hctx_w), "horizonAtWaypointFull": r3(hfull_w),
        "horizonAtBestFull": r3(hz[True][0][full["_b"]]),
        "residualAtWaypointFull": r3(res_w),
        "nearFieldExcludedAtWaypoint": near_n,
        "fixedParameters": {"edgeSigmaPx": EDGE_SIGMA_PX, "edgeThreshold": EDGE_THRESH, "azStepDeg": sk.AZ_STEP, "headingUncertaintyDeg": HDG_MAX_DEG, "elevationOffsetMaxDeg": ELEV_OFFSET_MAX_DEG,
                            "nearFieldM": NEAR_FIELD_M, "grid": "61 x 61 at 100 m, prior 1-2 km from the waypoint (seed 2021)", "uncertaintyRule": "RMS <= best + 0.05 deg, min 50 m",
                            "ctxStepM": CTX_STEP_M, "ctxMaxKm": CTX_MAX_M / 1000, "molaStepM": MOLA_STEP_M, "molaMaxKm": MOLA_MAX_M / 1000, "minCellColumns": MIN_CELL_POINTS, "minScoredAzimuths": MIN_SCORED_AZ,
                            "frameSpacingDeg": FRAME_SPACING_DEG, "frameRule": f"NAVCAM_LEFT, same site+drive, full-width ({FRAME_WIDTH_PX} px) strip, |mastEl| <= {FRAME_MASTEL_MAX:.0f} deg, LTST {FRAME_LTST[0]:.0f}-{FRAME_LTST[1]:.0f} h",
                            "hardwareMaskRoverAzDeg": HW_MASK, "minScoredFractionOfValid": MIN_SCORED_FRAC,
                            "successRule": f"FIX = error <= {SUCCESS_ERR_M:.0f} m and uncertainty <= {SUCCESS_UNC_M:.0f} m; WEAK = error < prior offset; else FAILED"},
        "assumptions": [
            "Truth position AND attitude come from NASA's M20_waypoints.json entry matched by site+drive (not by sol); the waypoint yaw/pitch/roll rotation equals each frame's own attitude quaternion "
            f"(max matrix element difference {att_diff:.1e}). Waypoint = end-of-drive localization; its own accuracy is not stated by NASA in the file and is assumed to be metres to tens of metres.",
            "Frames: all Navcam-left frames of this site+drive that pass the fixed usability rule; of those a deterministic greedy subset (boresight azimuths >= 40 deg apart, starting at the seed frame, clockwise) is downloaded to stay inside the download budget. "
            f"{len(cands)} frames passed the rule, {len(sel)} used. Seed/'single frame' = {'the frame of the legacy single-frame test' if (site, drive) in DEV_SEEDS else 'the earliest-sclk usable frame'}.",
            f"Skyline traced per frame with the SAME settings as the single-frame tests (sigma {EDGE_SIGMA_PX} px, threshold {EDGE_THRESH}, 5-px median smoothing, >12 px running-median outlier rejection); not tuned. "
            f"Each frame's columns are converted to true azimuth/elevation with its own CAHVORE model and the waypoint attitude, binned to 2-deg cells (>= {MIN_CELL_POINTS} traced columns, median elevation); frames are merged per cell by median. "
            "Cells with no frame or no accepted trace are NaN (null) and are not scored.",
            f"Rover-hardware rule: {'a rover-frame azimuth sector ' + str(HW_MASK) + ' deg is masked' if HW_MASK else 'no azimuth sector is masked'}. On the development frames the rover deck/RTG appears only in the lowest part of the frame, well below the skyline, so the geometric rule is: nothing masked. Not examined for held-out frames before the run.",
            f"Matching: heading known to +-{HDG_MAX_DEG:.0f} deg (11 shifts of 2 deg); one elevation offset per candidate (clipped to +-{ELEV_OFFSET_MAX_DEG} deg); azimuths whose predicted horizon forms closer than {NEAR_FIELD_M:.0f} m at the candidate are excluded for that candidate; score = RMS over scored azimuths. "
            "The same near-field and offset rules are used in all four ablation rows; only the frame set and the backdrop change. "
            f"A candidate must score at least {MIN_SCORED_AZ} azimuths AND {MIN_SCORED_FRAC:.0%} of the valid azimuths: this guard was added after the first development run, in which the single-frame best candidate scored only 20 of 48 azimuths because the near-field rule dropped the rest (a degenerate 'win'). It was not tuned on position error.",
            f"Horizon = max over CTX samples (40 m, to 15 km) and MOLA samples (250 m, to 120 km, only outside the CTX footprint or beyond 15 km), Mars curvature term, eye 2 m above the CTX elevation at the candidate. "
            f"CTX minus MOLA at {reg['n']} random points inside the DTM: mean {reg['meanM']} m, std {reg['stdM']} m, so no vertical offset is applied. MOLA is 463 m/pixel and median-binned: it cannot represent terrain finer than that.",
            "CTX part of horizons_ext is checked equal to skyline.horizons (imported, unchanged) at 24 candidates every run (max difference < 1e-6 deg).",
            "A 20 m DTM cannot contain metre-scale rocks in the foreground; those rows of the skyline are part of the photo but not of the model.",
            f"Downloads this run: {N_DOWNLOADS[0] - n0} images (cached ones not counted).",
        ],
        "method": "Real Navcam frames (NASA/JPL-Caltech raw images), skyline traced and matched against CTX DTM + MOLA horizon; not simulated.",
        "verdict": verdict,
    }
    path = OUT / f"site{site:03d}_drive{drive:04d}_pano.json"
    path.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    ascii_plot(OUT / f"site{site:03d}_drive{drive:04d}_pano.jpg", azg,
               [("observed (panorama)", obs_pano, (200, 0, 0), "dot"), ("CTX only @waypoint", hctx_w, (0, 90, 200), "line"), ("CTX+MOLA @waypoint", hfull_w, (0, 150, 60), "line")])
    print(f"   wrote {path.name} (+ .jpg), {time.time() - t0:.0f}s total")
    print("   VERDICT:", verdict)
    return out


def select_heldout(dev_positions: list, wps: list) -> list:
    """Scan waypoints in ascending sol order; take the first two site+drive positions satisfying the held-out rules. Returns [(wp, log), ...]; the log is printed and returned."""
    z_shape = (1512, 1596)
    cosl = math.cos(math.radians(LAT_MID))
    log, chosen = [], []

    def dkm(a, b):
        return math.hypot((a["lat"] - b["lat"]) * MPD_LAT, (a["lon"] - b["lon"]) * MPD_LAT * cosl)

    dev = [find_wp(wps, s, d) for s, d in dev_positions]
    seen = set()
    for w in wps:
        key = (w["site"], w["drive"])
        if key in seen:
            continue
        seen.add(key)
        entry = {"site": w["site"], "drive": w["drive"], "sol": w["sol"]}
        reason = None
        if any(dkm(w, d) < HELDOUT_MIN_SEP_M for d in dev):
            reason = "(a) < 3 km from a development position"
        elif any(dkm(w, c[0]) < HELDOUT_MIN_SEP_M for c in chosen):
            reason = "(a) < 3 km from the first held-out position"
        else:
            e_ns = min(w["lat"] - LAT_MIN, LAT_MAX - w["lat"]) * MPD_LAT
            e_ew = min(w["lon"] - LON_MIN, LON_MAX - w["lon"]) * MPD_LAT * cosl
            if min(e_ns, e_ew) < HELDOUT_EDGE_M:
                reason = f"(b) {min(e_ns, e_ew) / 1000:.1f} km from the DTM edge (< 2 km)"
        if reason is None:
            cands = usable_frames(w, wps)
            sel = select_frames(cands)
            cov = footprint_coverage(sel) if sel else 0.0
            entry.update(usableFrames=len(cands), selectedFrames=len(sel), footprintCoverageDeg=cov)
            if cov < COVERAGE_MIN_DEG:
                reason = f"(c) usable frames {len(cands)}, merged footprint coverage {cov:.0f} deg < 270"
        if reason:
            entry["skipped"] = reason
        else:
            entry["chosen"] = True
            chosen.append((w, entry))
        log.append(entry)
        if len(chosen) == 2:
            break
    return [(c[0], c[1]) for c in chosen], log


def print_heldout_log(log):
    for e in log:
        print(f"  sol {e['sol']:4d} site {e['site']:3d} drive {e['drive']:5d}: " + ("CHOSEN" if e.get("chosen") else "skipped " + e["skipped"]))


def main() -> None:
    args = sys.argv[1:]
    if "--screen" in args:
        screen(load_dtm(), 10)
        return
    if "--dev" in args:                               # development set: both positions (run_pano is deterministic)
        for (site, drive) in DEV_SEEDS:
            run_pano(site, drive, "development")
        return
    if "--pano" in args:                              # --pano SITE DRIVE [--set development|held-out]
        k = args.index("--pano")
        site, drive = int(args[k + 1]), int(args[k + 2])
        set_name = args[args.index("--set") + 1] if "--set" in args else "development"
        run_pano(site, drive, set_name)
        return
    if "--heldout-select" in args or "--heldout" in args:
        wps = load_waypoints()
        chosen, log = select_heldout(list(DEV_SEEDS), wps)
        print_heldout_log(log)
        print(f"examined {len(log)} site+drive positions; downloads so far {N_DOWNLOADS[0]}")
        (OUT / "heldout_selection.json").write_text(json.dumps({"rule": "scan waypoints (sorted by sol, site, drive; unique site+drive) ascending; first two that are (a) >= 3 km from both development positions and from each other, "
                                                                "(b) >= 2 km inside the CTX DTM bounds, (c) have usable daytime Navcam-left frames whose greedy-selected footprint coverage (metadata only) is >= 270 deg",
                                                                "examined": len(log), "log": log}, indent=1, allow_nan=False), encoding="utf-8")
        if "--heldout" in args:
            for w, _ in chosen:
                run_pano(w["site"], w["drive"], "held-out")
        return
    for name, case in CASES.items():
        if not args or name in args:
            run_case(case)


if __name__ == "__main__":
    main()
