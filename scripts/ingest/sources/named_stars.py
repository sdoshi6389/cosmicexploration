"""Named bright stars from CDS SIMBAD (IAU WGSN 'NAME' identifiers + Hipparcos astrometry).

Gaia saturates on the very brightest stars (Sirius, Vega, Betelgeuse...), so the
naked-eye sky the user recognises comes from SIMBAD, cross-identified to Gaia DR3
where SIMBAD records a Gaia identifier.
"""
from __future__ import annotations

import math

from _tap import f_or_none, parse_csv, tap_sync
from pipeline import SourceResult, save_raw

SOURCE_ID = "cds_simbad"
TAP = "https://simbad.cds.unistra.fr/simbad/sim-tap"

ADQL = """
SELECT b.main_id, n.id AS star_name, b.ra, b.dec, b.plx_value, b.sp_type, f.V, g.id AS gaia_id
FROM basic AS b
JOIN ident AS n ON n.oidref = b.oid
LEFT OUTER JOIN allfluxes AS f ON f.oidref = b.oid
LEFT OUTER JOIN ident AS g ON g.oidref = b.oid AND g.id LIKE 'Gaia DR3 %'
WHERE n.id LIKE 'NAME %' AND f.V < 5.0 AND b.ra IS NOT NULL
"""


def run() -> SourceResult:
    data = tap_sync(TAP, " ".join(ADQL.split()), timeout=240)
    _, cs = save_raw(SOURCE_ID, "simbad_named_v5.csv", data)
    rows, seen = [], set()
    for r in sorted(parse_csv(data), key=lambda r: f_or_none(r.get("V")) or 99):
        name = r["star_name"].replace("NAME ", "").strip()
        main = r["main_id"].strip()
        if main in seen:
            continue  # one display name per object (brightest-first ordering keeps the IAU name)
        seen.add(main)
        plx = f_or_none(r.get("plx_value"))
        d = 1000.0 / plx if plx and plx > 0 else None
        ra, dec = float(r["ra"]), float(r["dec"])
        x = y = z = None
        if d:
            rr, dd = math.radians(ra), math.radians(dec)
            x, y, z = d * math.cos(dd) * math.cos(rr), d * math.cos(dd) * math.sin(rr), d * math.sin(dd)
        rows.append(
            {
                "id": f"star.{name.lower().replace(' ', '_').replace(chr(39), '')}",
                "name": name,
                "simbadId": main,
                "raDeg": ra,
                "decDeg": dec,
                "parallaxMas": plx,
                "vMag": f_or_none(r.get("V")),
                "spType": r.get("sp_type") or "",
                "distancePc": d,
                "xPc": x, "yPc": y, "zPc": z,
                "gaiaDr3Id": (r.get("gaia_id") or "").replace("Gaia DR3 ", ""),
                "source": "SIMBAD basic/ident/allfluxes",
            }
        )
    # Primary keys must be unique even when two objects share a sanitized name.
    seen_ids: dict[str, int] = {}
    for row in rows:
        n = seen_ids.get(row["id"], 0)
        seen_ids[row["id"]] = n + 1
        if n:
            row["id"] = f"{row['id']}_{n}"
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="CDS SIMBAD Astronomical Database",
        category="stars",
        tables={"named_star": rows},
        source_urls=[TAP],
        release="SIMBAD (live)",
        query=" ".join(ADQL.split()),
        license="SIMBAD: free for scientific use with acknowledgement",
        attribution="This research has made use of the SIMBAD database, CDS, Strasbourg, France",
        coverage=f"{len(rows)} named stars with V < 5",
        units="deg, mas, mag, pc",
        frame="ICRS J2000; cartesian pc, Sun at origin",
        raw_checksums=[cs],
    )
