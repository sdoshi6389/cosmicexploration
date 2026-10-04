"""USGS FDSN event service: M5+ earthquakes over a bounded twelve-month window."""
from __future__ import annotations

import datetime as dt
import json
import urllib.parse

from _common import http_get
from pipeline import SourceResult, save_raw

SOURCE_ID = "usgs_earthquakes"
API = "https://earthquake.usgs.gov/fdsnws/event/1/query"
START, END, MINMAG = "2025-10-01", "2026-10-01", "5.0"


def run() -> SourceResult:
    q = {"format": "geojson", "starttime": START, "endtime": END, "minmagnitude": MINMAG, "orderby": "time"}
    url = f"{API}?{urllib.parse.urlencode(q)}"
    raw = http_get(url, timeout=120)
    _, cs = save_raw(SOURCE_ID, f"events_{START}_{END}_M{MINMAG}.geojson", raw)
    feats = json.loads(raw)["features"]
    rows = []
    for f in feats:
        p, g = f["properties"], f["geometry"]["coordinates"]
        if p.get("mag") is None:
            continue
        rows.append(
            {
                "id": f["id"],
                "timeIso": dt.datetime.fromtimestamp(p["time"] / 1000, dt.timezone.utc).isoformat(),
                "magnitude": p["mag"],
                "place": p.get("place") or "",
                "latDeg": g[1],
                "lonDeg": g[0],
                "depthKm": g[2],
                "eventType": p.get("type") or "earthquake",
            }
        )
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="USGS Earthquake Hazards Program — FDSN Event",
        category="earth",
        tables={"earthquake": rows},
        source_urls=[url],
        release="ComCat (live)",
        query=f"starttime={START} endtime={END} minmagnitude={MINMAG}",
        license="Public domain (USGS)",
        attribution="U.S. Geological Survey",
        coverage=f"{len(rows)} events M≥{MINMAG}",
        units="magnitude (mixed types), km depth",
        frame="WGS84",
        raw_checksums=[cs],
        note="Event points do not constitute a tectonic or geological model.",
    )
