"""SDSS DR18 SkyServer: spectroscopic galaxy subset → cosmic-web context.

Comoving distances use astropy's Planck18 cosmology; the cosmology is recorded
because distance is derived from redshift, not observed.
"""
from __future__ import annotations

import math
import urllib.parse

from astropy.cosmology import Planck18

from _common import http_get
from _tap import f_or_none, parse_csv
from pipeline import SourceResult, save_raw

SOURCE_ID = "sdss_dr18"
API = "https://skyserver.sdss.org/dr18/SkyServerWS/SearchTools/SqlSearch"
SQL = (
    "SELECT TOP 30000 s.specObjID, s.ra, s.dec, s.z, s.zErr, s.subClass, p.petroMag_r "
    "FROM SpecObj AS s JOIN PhotoObj AS p ON s.bestObjID = p.objID "
    "WHERE s.class = 'GALAXY' AND s.zWarning = 0 AND s.z BETWEEN 0.01 AND 0.12 "
    "AND (s.specObjID % 5) = 0"
)


def run() -> SourceResult:
    url = f"{API}?{urllib.parse.urlencode({'cmd': SQL, 'format': 'csv'})}"
    data = http_get(url, timeout=300)
    _, cs = save_raw(SOURCE_ID, "specobj_galaxies.csv", data)
    text = data.decode("utf-8", "replace")
    if text.startswith("#Table1"):
        text = text.split("\n", 1)[1]
    parsed = parse_csv(text.encode())
    zs = [float(r["z"]) for r in parsed]
    dist = Planck18.comoving_distance(zs).value  # Mpc
    rows = []
    for r, d in zip(parsed, dist):
        ra, dec = math.radians(float(r["ra"])), math.radians(float(r["dec"]))
        rows.append(
            {
                "specObjId": r["specObjID"],
                "raDeg": float(r["ra"]),
                "decDeg": float(r["dec"]),
                "redshift": float(r["z"]),
                "redshiftErr": float(r["zErr"]),
                "subclass": r.get("subClass") or "",
                "petroMagR": f_or_none(r.get("petroMag_r")),
                "comovingMpc": float(d),
                "xMpc": float(d) * math.cos(dec) * math.cos(ra),
                "yMpc": float(d) * math.cos(dec) * math.sin(ra),
                "zMpc": float(d) * math.sin(dec),
            }
        )
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="Sloan Digital Sky Survey DR18",
        category="cosmology",
        tables={"sdss_galaxy": rows},
        source_urls=[API, "https://www.sdss.org/dr18/"],
        release="SDSS DR18",
        query=SQL,
        license="SDSS data: public, cite SDSS",
        attribution="Funding for SDSS-V by the Alfred P. Sloan Foundation et al.",
        coverage=f"{len(rows)} galaxies, 0.01 < z < 0.12, 1-in-5 specObjID subsample",
        units="deg, redshift, mag, comoving Mpc (Planck18 — derived)",
        frame="ICRS; cartesian comoving Mpc, observer at origin",
        raw_checksums=[cs],
    )
