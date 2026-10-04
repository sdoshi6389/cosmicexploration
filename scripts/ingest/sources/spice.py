"""NASA NAIF SPICE generic kernels → body radii, GM and IAU rotation models."""
from __future__ import annotations

import spiceypy as sp

from _common import http_get
from pipeline import SourceResult, raw_dir, save_raw
from sources.bodies import BODIES

SOURCE_ID = "naif_spice"
BASE = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"
KERNELS = {
    "naif0012.tls": f"{BASE}/lsk/naif0012.tls",
    "pck00011.tpc": f"{BASE}/pck/pck00011.tpc",
    "gm_de440.tpc": f"{BASE}/pck/gm_de440.tpc",
}


def _vals(naif: int, item: str, n: int) -> list[float] | None:
    try:
        if not sp.bodfnd(naif, item):
            return None
        return list(sp.bodvcd(naif, item, n)[1])
    except Exception:
        return None


def run() -> SourceResult:
    checksums = []
    d = raw_dir(SOURCE_ID)
    for name, url in KERNELS.items():
        path = d / name
        if not path.exists():
            _, cs = save_raw(SOURCE_ID, name, http_get(url, timeout=120))
        else:
            from _common import sha256_file

            cs = sha256_file(path)
        checksums.append(f"{name}={cs}")
        sp.furnsh(str(path))

    rows = []
    for cid, name, naif, _cmd, _kind, _parent, _col in BODIES:
        if naif < 0:  # spacecraft carry no PCK/GM entries
            continue
        radii = _vals(naif, "RADII", 3)
        gm = _vals(naif, "GM", 1)
        ra = _vals(naif, "POLE_RA", 3)
        dec = _vals(naif, "POLE_DEC", 3)
        pm = _vals(naif, "PM", 3)
        if not any([radii, gm, ra, pm]):
            continue
        rows.append(
            {
                "id": cid,
                "naifId": naif,
                "name": name,
                "radiusAKm": radii[0] if radii else None,
                "radiusBKm": radii[1] if radii else None,
                "radiusCKm": radii[2] if radii else None,
                "gmKm3S2": gm[0] if gm else None,
                "poleRaDeg": ra[0] if ra else None,
                "poleDecDeg": dec[0] if dec else None,
                "pmW0Deg": pm[0] if pm else None,
                "pmRateDegDay": pm[1] if pm else None,
                "kernels": "pck00011.tpc gm_de440.tpc",
            }
        )
    sp.kclear()
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NASA NAIF SPICE generic kernels",
        category="solar_system",
        tables={"spice_constant": rows},
        source_urls=list(KERNELS.values()),
        release="pck00011 / gm_de440 / naif0012",
        query="bodvcd RADII, GM, POLE_RA, POLE_DEC, PM for curated body list",
        license="Public domain (NASA/JPL NAIF)",
        attribution="NASA/JPL Navigation and Ancillary Information Facility",
        coverage=f"{len(rows)} bodies with PCK/GM entries",
        units="km, km^3/s^2, deg, deg/day",
        frame="IAU body-fixed rotation models relative to ICRF",
        raw_checksums=checksums,
    )
