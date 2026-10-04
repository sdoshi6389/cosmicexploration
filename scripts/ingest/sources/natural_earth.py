"""Natural Earth 1:110m populated places → K1 infrastructure anchor cities."""
from __future__ import annotations

import json

from _common import http_get
from pipeline import SourceResult, save_raw

SOURCE_ID = "natural_earth"
URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
    "ne_110m_populated_places_simple.geojson"
)


def run() -> SourceResult:
    raw = http_get(URL, timeout=90)
    _, cs = save_raw(SOURCE_ID, "ne_110m_populated_places_simple.geojson", raw)
    feats = json.loads(raw)["features"]
    rows, seen = [], set()
    for f in feats:
        p = f["properties"]
        name = p.get("name") or p.get("nameascii")
        cid = f"city.{(p.get('nameascii') or name).lower().replace(' ', '_')}.{(p.get('adm0_a3') or '').lower()}"
        if cid in seen:
            continue
        seen.add(cid)
        rows.append(
            {
                "id": cid,
                "name": name,
                "country": p.get("adm0name") or "",
                "latDeg": p.get("latitude"),
                "lonDeg": p.get("longitude"),
                "population": p.get("pop_max"),
                "rank": p.get("rank_max"),
            }
        )
    rows.sort(key=lambda r: -(r["population"] or 0))
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="Natural Earth populated places",
        category="earth",
        tables={"earth_city": rows},
        source_urls=[URL, "https://www.naturalearthdata.com/"],
        release="natural-earth-vector master (v5.x)",
        query="ne_110m_populated_places_simple",
        license="Public domain (Natural Earth)",
        attribution="Made with Natural Earth",
        coverage=f"{len(rows)} cities",
        units="degrees, persons",
        frame="WGS84",
        raw_checksums=[cs],
    )
