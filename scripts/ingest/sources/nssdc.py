"""NASA NSSDC Planetary Fact Sheet → reference physical properties per planet."""
from __future__ import annotations

import html
import re

from _common import http_get
from pipeline import SourceResult, save_raw

SOURCE_ID = "nasa_nssdc_factsheet"
URL = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/"

ROW_MAP = {
    "Mass": "massE24Kg",
    "Diameter": "diameterKm",
    "Density": "densityKgM3",
    "Gravity": "gravityMs2",
    "Escape Velocity": "escapeVelocityKms",
    "Rotation Period": "rotationPeriodHours",
    "Length of Day": "dayLengthHours",
    "Distance from Sun": "distanceFromSunE6Km",
    "Orbital Period": "orbitalPeriodDays",
    "Orbital Velocity": "orbitalVelocityKms",
    "Obliquity to Orbit": "obliquityDeg",
    "Mean Temperature": "meanTemperatureC",
    "Surface Pressure": "surfacePressureBars",
    "Number of Moons": "moonCount",
    "Ring System": "ringSystem",
    "Global Magnetic Field": "globalMagneticField",
}


def _num(s: str):
    s = s.replace(",", "").replace("*", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def run() -> SourceResult:
    raw = http_get(URL, timeout=60)
    _, cs = save_raw(SOURCE_ID, "factsheet.html", raw)
    text = raw.decode("latin-1")
    table = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S | re.I):
        cells = [
            html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
            for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)
        ]
        if cells:
            table.append(cells)
    header = table[0][1:]
    rows = {name: {"id": f"body.{name.lower()}", "name": name.title()} for name in header}
    for cells in table[1:]:
        label = cells[0]
        key = next((v for k, v in ROW_MAP.items() if label.startswith(k)), None)
        if not key:
            continue
        for name, val in zip(header, cells[1:]):
            if key in ("ringSystem", "globalMagneticField"):
                rows[name][key] = val
            elif key == "moonCount":
                n = _num(val)
                rows[name][key] = int(n) if n is not None else None
            else:
                rows[name][key] = _num(val)
    out = list(rows.values())
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NASA NSSDC Planetary Fact Sheet",
        category="solar_system",
        tables={"planet_fact": out},
        source_urls=[URL],
        release="NSSDC fact sheet (live page)",
        query="Planetary Fact Sheet - Metric",
        license="Public domain (NASA)",
        attribution="Dr. David R. Williams, NASA Goddard Space Flight Center",
        coverage=f"{len(out)} bodies (Moon distance/orbit values are geocentric)",
        units="as labelled per column (10^24 kg, km, kg/m^3, m/s^2, km/s, h, 10^6 km, d, deg, C, bar)",
        raw_checksums=[cs],
    )
