"""World energy history (Our World in Data, compiled from Energy Institute + Ember).

Supplies the sourced K1 baseline P0: world primary energy consumption, converted
from TWh/yr to average watts in the client (1 TWh/yr = 1.1408e8 W).
"""
from __future__ import annotations

import csv
import io

from _common import http_get
from pipeline import SourceResult, save_raw

SOURCE_ID = "owid_energy"
URL = "https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv"

ENTITIES = {"World", "Africa", "Asia", "Europe", "North America", "South America", "Oceania"}

METRICS = {
    "primary_energy_consumption": ("primary_energy", "total"),
    "electricity_generation": ("electricity", "total"),
    "coal_consumption": ("primary_energy", "coal"),
    "oil_consumption": ("primary_energy", "oil"),
    "gas_consumption": ("primary_energy", "gas"),
    "nuclear_consumption": ("primary_energy", "nuclear"),
    "hydro_consumption": ("primary_energy", "hydro"),
    "wind_consumption": ("primary_energy", "wind"),
    "solar_consumption": ("primary_energy", "solar"),
    "biofuel_consumption": ("primary_energy", "biofuel"),
    "other_renewable_consumption": ("primary_energy", "other_renewable"),
    "coal_electricity": ("electricity", "coal"),
    "oil_electricity": ("electricity", "oil"),
    "gas_electricity": ("electricity", "gas"),
    "nuclear_electricity": ("electricity", "nuclear"),
    "hydro_electricity": ("electricity", "hydro"),
    "wind_electricity": ("electricity", "wind"),
    "solar_electricity": ("electricity", "solar"),
    "biofuel_electricity": ("electricity", "biofuel"),
}


def run() -> SourceResult:
    raw = http_get(URL, timeout=180)
    _, cs = save_raw(SOURCE_ID, "owid-energy-data.csv", raw)
    rows = []
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8"))):
        entity = r["country"]
        if entity not in ENTITIES:
            continue
        year = int(r["year"])
        if year < 1965:
            continue
        for col, (metric, src) in METRICS.items():
            if entity != "World" and col != "primary_energy_consumption":
                continue
            v = r.get(col, "")
            if v == "":
                continue
            rows.append(
                {
                    "id": f"{entity.lower().replace(' ', '_')}.{year}.{metric}.{src}",
                    "entity": entity,
                    "year": year,
                    "metric": metric,
                    "source": src,
                    "valueTwh": float(v),
                }
            )
    latest = max(r["year"] for r in rows if r["entity"] == "World" and r["metric"] == "primary_energy" and r["source"] == "total")
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="Our World in Data — Energy dataset",
        category="earth",
        tables={"energy_record": rows},
        source_urls=[URL, "https://ourworldindata.org/energy"],
        release=f"owid/energy-data master (latest primary-energy year {latest})",
        query="World (all metrics) + continents (primary energy), 1965+",
        license="CC BY 4.0",
        attribution="Energy Institute Statistical Review of World Energy; Ember; Our World in Data",
        coverage=f"{len(rows)} world-level records 1965–{latest}",
        units="TWh per year (primary energy, substitution method)",
        raw_checksums=[cs],
    )
