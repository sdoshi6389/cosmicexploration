"""NASA HEASARC: Galactic low- and high-mass X-ray binary catalogues (Liu et al.).

An X-ray binary hosts a neutron star or black hole; only rows the catalogue tags
as a black-hole candidate are labelled so. Everything else stays 'unidentified'.
"""
from __future__ import annotations

from _common import http_post_form
from _tap import f_or_none, parse_votable
from pipeline import SourceResult, save_raw

SOURCE_ID = "nasa_heasarc"
TAP = "https://heasarc.gsfc.nasa.gov/xamin/vo/tap"
TABLES = {"lmxbcat": "LMXB", "hmxbcat": "HMXB"}


def _compact(row: dict) -> str:
    # Liu et al. X-ray type codes: A atoll, B burster, P pulsar, Z Z-source → neutron star;
    # U ultrasoft → black-hole candidate; everything else is left unidentified.
    codes = {c.strip().upper() for c in (row.get("xray_type") or "").split(",") if c.strip()}
    if codes & {"A", "B", "P", "Z"}:
        return "neutron star (catalogue type code)"
    if "U" in codes:
        return "black-hole candidate (ultrasoft type code)"
    return "unidentified compact object"


def run() -> SourceResult:
    rows, checksums = [], []
    for table, kind in TABLES.items():
        data = http_post_form(
            f"{TAP}/sync",
            {"REQUEST": "doQuery", "LANG": "ADQL", "QUERY": f"SELECT * FROM {table}"},
            timeout=120,
        )
        _, cs = save_raw(SOURCE_ID, f"{table}.xml", data)
        checksums.append(f"{table}={cs}")
        for r in parse_votable(data):
            if not r.get("ra") or not r.get("dec"):
                continue
            dist = f_or_none(r.get("distance"))  # not provided by these catalogues
            period = f_or_none(r.get("porb"))  # days (VOTable unit="d")
            rows.append(
                {
                    "id": f"{kind.lower()}.{r['name'].strip().replace(' ', '_')}",
                    "name": r["name"].strip(),
                    "raDeg": float(r["ra"]),
                    "decDeg": float(r["dec"]),
                    "glDeg": float(r.get("lii") or 0),
                    "gbDeg": float(r.get("bii") or 0),
                    "kind": kind,
                    "distanceKpc": dist,
                    "orbitalPeriodDays": period,
                    "compactObject": _compact(r),
                    "catalog": table,
                }
            )
    uniq = {}
    for r in rows:
        uniq.setdefault(r["id"], r)
    rows = list(uniq.values())
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NASA HEASARC (LMXBCAT, HMXBCAT)",
        category="stars",
        tables={"xray_binary": rows},
        source_urls=[TAP],
        release="Liu, van Paradijs & van den Heuvel 2006/2007 catalogues",
        query="SELECT * FROM lmxbcat; SELECT * FROM hmxbcat",
        license="Public (NASA HEASARC)",
        attribution="NASA High Energy Astrophysics Science Archive Research Center",
        coverage=f"{len(rows)} X-ray binaries",
        units="deg, kpc, days",
        frame="ICRS + galactic",
        raw_checksums=checksums,
        note="X-ray source ≠ identified black hole; compact-object labels follow catalogue codes only.",
    )
