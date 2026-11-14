# Written with AI assistance (Claude / GitHub Copilot)
"""MOLA MEGDR 128 px/deg topography (463 m) as a far-field backdrop for the CTX DTM horizon.

Product: MGS-M-MOLA-5-MEGDR-L3-V1.0 MEGT44N000HB.IMG  (verified against its .lbl: 11520 samples x 5632 lines,
MSB 16-bit signed integer, metres above the areoid, simple cylindrical, planetocentric, 44N-0N, 0E-90E,
line 0 = 44N edge, pixel centres at 44 - (row+0.5)/128 and (col+0.5)/128).
Only rows 2944-3583 (21N-16N, full 0-90E width) are fetched with an HTTP Range request into raw/mola/ (git-ignored).
"""
from __future__ import annotations

import urllib.request

import numpy as np

from dtm import ROOT

URL = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt44n000hb.img"
LBL_URL = URL[:-3] + "lbl"
DIR = ROOT / "raw" / "mola"
ROW0, ROW1 = 2944, 3584                 # fetched lines [ROW0, ROW1)  -> 21N .. 16N
NCOL, PPD, TOP_LAT = 11520, 128.0, 44.0
COL0, COL1 = 9600, 10240                # cropped columns 75E .. 80E
BIN = DIR / f"megt44n000hb_rows{ROW0}-{ROW1 - 1}.bin"
PRODUCT = "MGS MOLA MEGDR megt44n000hb (128 px/deg, 463 m, metres above areoid)"


def fetch() -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    if not BIN.exists():
        rb = NCOL * 2
        req = urllib.request.Request(URL, headers={"Range": f"bytes={ROW0 * rb}-{ROW1 * rb - 1}", "User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(req, timeout=300)
        assert resp.status == 206, "server ignored the Range request"
        BIN.write_bytes(resp.read())


def load() -> np.ndarray:
    """int16 -> float32 array (ROW1-ROW0, COL1-COL0) of topography in metres."""
    fetch()
    a = np.fromfile(BIN, dtype=">i2").reshape(ROW1 - ROW0, NCOL)
    return a[:, COL0:COL1].astype(np.float32)


def sample(m: np.ndarray, lat, lon) -> np.ndarray:
    """Bilinear sample of the cropped array at planetocentric lat/lon (deg); NaN outside."""
    lat, lon = np.asarray(lat, dtype=np.float64), np.asarray(lon, dtype=np.float64)
    r = (TOP_LAT - lat) * PPD - 0.5 - ROW0
    c = lon * PPD - 0.5 - COL0
    ok = (r >= 0) & (r <= m.shape[0] - 1.001) & (c >= 0) & (c <= m.shape[1] - 1.001)
    r0, c0 = np.floor(np.where(ok, r, 0)).astype(int), np.floor(np.where(ok, c, 0)).astype(int)
    fr, fc = r - r0, c - c0
    v = (m[r0, c0] * (1 - fr) * (1 - fc) + m[r0 + 1, c0] * fr * (1 - fc) + m[r0, c0 + 1] * (1 - fr) * fc + m[r0 + 1, c0 + 1] * fr * fc)
    return np.where(ok, v, np.nan)
