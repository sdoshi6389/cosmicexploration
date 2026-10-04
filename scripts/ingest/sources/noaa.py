"""NOAA NCEI Climate at a Glance: global land+ocean annual temperature anomaly."""
from __future__ import annotations

import json

from _common import http_get
from pipeline import SourceResult, save_raw

SOURCE_ID = "noaa_ncei"
URL = (
    "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series/"
    "globe/land_ocean/12/12/1850-2025/data.json"
)


def run() -> SourceResult:
    raw = http_get(URL, timeout=90)
    _, cs = save_raw(SOURCE_ID, "global_land_ocean_annual.json", raw)
    d = json.loads(raw)
    desc = d.get("description", {})
    base = desc.get("base_period") or desc.get("basePeriod") or "1901-2000"
    rows = []
    for key, v in d["data"].items():
        val = (v.get("anomaly", v.get("departure")) if isinstance(v, dict) else v)
        year = int(str(key)[:4])
        rows.append({"id": str(year), "year": year, "anomalyC": float(val), "baseline": f"{base} mean"})
    rows.sort(key=lambda r: r["year"])
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NOAA NCEI Climate at a Glance — Global Time Series",
        category="earth",
        tables={"climate_anomaly": rows},
        source_urls=[URL],
        release=desc.get("title", "NOAAGlobalTemp"),
        query="globe / land_ocean / 12-month (annual, Jan–Dec) / 1850–2025",
        license="Public domain (NOAA)",
        attribution="NOAA National Centers for Environmental Information",
        coverage=f"{rows[0]['year']}–{rows[-1]['year']} ({len(rows)} years)",
        units=desc.get("units", "Degrees Celsius"),
        raw_checksums=[cs],
        note="Global climate index; not station weather.",
    )
