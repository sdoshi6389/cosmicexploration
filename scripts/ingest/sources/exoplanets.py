"""NASA Exoplanet Archive: every confirmed planet from pscomppars (composite parameters).

Nulls are kept — unknown inclinations, masses or radii are never filled here.
"""
from __future__ import annotations

import math

from _tap import f_or_none, parse_csv, tap_sync
from pipeline import SourceResult, save_raw

SOURCE_ID = "nasa_exoplanet_archive"
TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP"
ADQL = (
    "select pl_name, hostname, ra, dec, sy_dist, pl_orbper, pl_orbsmax, pl_rade, pl_bmasse, "
    "pl_eqt, pl_orbeccen, pl_insol, st_teff, st_rad, st_mass, st_lum, discoverymethod, disc_year, "
    "sy_pnum, gaia_dr3_id from pscomppars"
)


def run() -> SourceResult:
    data = tap_sync(TAP, ADQL, timeout=300)
    _, cs = save_raw(SOURCE_ID, "pscomppars.csv", data)
    rows = []
    for r in parse_csv(data):
        d = f_or_none(r["sy_dist"])
        ra, dec = float(r["ra"]), float(r["dec"])
        x = y = z = None
        if d:
            rr, dd = math.radians(ra), math.radians(dec)
            x, y, z = d * math.cos(dd) * math.cos(rr), d * math.cos(dd) * math.sin(rr), d * math.sin(dd)
        year = f_or_none(r["disc_year"])
        npl = f_or_none(r["sy_pnum"])
        rows.append(
            {
                "plName": r["pl_name"],
                "hostname": r["hostname"],
                "raDeg": ra,
                "decDeg": dec,
                "distancePc": d,
                "orbitalPeriodDays": f_or_none(r["pl_orbper"]),
                "semiMajorAxisAu": f_or_none(r["pl_orbsmax"]),
                "radiusEarth": f_or_none(r["pl_rade"]),
                "massEarth": f_or_none(r["pl_bmasse"]),
                "eqTempK": f_or_none(r["pl_eqt"]),
                "eccentricity": f_or_none(r["pl_orbeccen"]),
                "insolationEarth": f_or_none(r["pl_insol"]),
                "stTeffK": f_or_none(r["st_teff"]),
                "stRadiusSun": f_or_none(r["st_rad"]),
                "stMassSun": f_or_none(r["st_mass"]),
                "stLumLog": f_or_none(r["st_lum"]),
                "discoveryMethod": r["discoverymethod"],
                "discoveryYear": int(year) if year else None,
                "sysPlanetCount": int(npl) if npl else None,
                "gaiaDr3Id": (r.get("gaia_dr3_id") or "").replace("Gaia DR3 ", ""),
                "xPc": x, "yPc": y, "zPc": z,
            }
        )
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NASA Exoplanet Archive (pscomppars)",
        category="stars",
        tables={"exoplanet_system": rows},
        source_urls=[TAP + "/sync", "https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html"],
        release="pscomppars (live composite table)",
        query=ADQL,
        license="Public (NASA/IPAC); cite the archive",
        attribution="NASA Exoplanet Archive, operated by Caltech/IPAC under contract with NASA",
        coverage=f"{len(rows)} confirmed planets",
        units="pc, days, AU, R_earth, M_earth, K, S_earth, R_sun, M_sun, log10(L/L_sun)",
        frame="ICRS; cartesian pc with Sun at origin",
        raw_checksums=[cs],
        note="Composite values mix references per planet; see `ps` table for default solutions.",
    )
