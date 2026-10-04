"""NASA Earthdata: CMR collection discovery + GIBS global imagery for Earth layers.

CMR supplies the collection identity (concept id, short name, version) and GIBS
(the Earthdata Global Imagery Browse Services) supplies public, login-free WMS
renderings of the same products. Granule downloads that need Earthdata Login are
not used.
"""
from __future__ import annotations

import json
import urllib.parse

from PIL import Image

from _common import WEB_TEXTURES, http_get, log, sha256_bytes
from pipeline import SourceResult, save_raw

SOURCE_ID = "nasa_earthdata"
CMR = "https://cmr.earthdata.nasa.gov/search/collections.json"
GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"

LAYERS = [
    {
        "id": "earth.day",
        "title": "Blue Marble Next Generation (true colour, shaded relief + bathymetry)",
        "gibs": "BlueMarble_ShadedRelief_Bathymetry",
        "cmr": None,
        "time": None,
        "fmt": "image/jpeg",
        "size": (4096, 2048),
        "units": "true colour",
        "legend": "MODIS-derived monthly composite (2004)",
        "evidence": "observed",
    },
    {
        "id": "earth.night",
        "title": "VIIRS Black Marble night lights (2016)",
        "gibs": "VIIRS_Black_Marble",
        "cmr": ("VNP46A4", None),
        "time": "2016-01-01",
        "fmt": "image/jpeg",
        "size": (4096, 2048),
        "units": "at-sensor radiance, visualised",
        "legend": "Suomi NPP VIIRS Day/Night Band annual composite",
        "evidence": "observed",
    },
    {
        "id": "earth.land_water",
        "title": "MODIS land / water mask (MOD44W)",
        "gibs": "MODIS_Terra_L3_Land_Water_Mask",
        "cmr": ("MOD44W", "061"),
        "time": None,
        "fmt": "image/png",
        "size": (2048, 1024),
        "units": "mask",
        "legend": "water pixels drive the ocean specular highlight",
        "evidence": "observed",
    },
    {
        "id": "earth.lst_day",
        "title": "MODIS Terra land surface temperature, day (monthly, Jul 2025)",
        "gibs": "MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day",
        "cmr": ("MOD11C3", "061"),
        "time": "2025-07-01",
        "fmt": "image/png",
        "size": (2048, 1024),
        "units": "K (GIBS colour palette)",
        "legend": "GIBS palette: blue cold → red hot",
        "evidence": "observed",
    },
    {
        "id": "earth.ndvi",
        "title": "MODIS Terra NDVI (monthly, Jul 2025)",
        "gibs": "MODIS_Terra_L3_NDVI_Monthly",
        "cmr": ("MOD13C2", "061"),
        "time": "2025-07-01",
        "fmt": "image/png",
        "size": (2048, 1024),
        "units": "NDVI (GIBS colour palette)",
        "legend": "brown bare → green dense vegetation",
        "evidence": "observed",
    },
]


def _cmr(short: str, version: str | None) -> dict:
    q = {"short_name": short, "page_size": "1"}
    if version:
        q["version"] = version
    d = json.loads(http_get(f"{CMR}?{urllib.parse.urlencode(q)}", timeout=60))
    entries = d.get("feed", {}).get("entry", [])
    return entries[0] if entries else {}


def run() -> SourceResult:
    rows, checksums, urls = [], [], [CMR, GIBS]
    for L in LAYERS:
        w, h = L["size"]
        params = {
            "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0", "LAYERS": L["gibs"],
            "STYLES": "", "FORMAT": L["fmt"], "CRS": "EPSG:4326", "BBOX": "-90,-180,90,180",
            "WIDTH": str(w), "HEIGHT": str(h), "TRANSPARENT": "TRUE" if L["fmt"] == "image/png" else "FALSE",
        }
        if L["time"]:
            params["TIME"] = L["time"]
        url = f"{GIBS}?{urllib.parse.urlencode(params)}"
        log(f"  GIBS {L['gibs']}")
        img = http_get(url, timeout=240)
        if not img[:4] in (b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xdb", b"\x89PNG") and img[:2] != b"\xff\xd8":
            raise RuntimeError(f"GIBS returned non-image for {L['gibs']}: {img[:200]!r}")
        ext = "jpg" if L["fmt"] == "image/jpeg" else "png"
        out = WEB_TEXTURES / "earth" / f"{L['id'].split('.', 1)[1]}.{ext}"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(img)
        with Image.open(out) as im:
            assert im.size == (w, h), im.size
        checksums.append(f"{out.name}={sha256_bytes(img)}")
        concept, short = "", ""
        if L["cmr"]:
            entry = _cmr(*L["cmr"])
            save_raw(SOURCE_ID, f"cmr_{L['cmr'][0]}.json", json.dumps(entry, indent=1))
            concept = entry.get("id", "")
            short = f"{entry.get('short_name', L['cmr'][0])} v{entry.get('version_id', '')}"
        rows.append(
            {
                "id": L["id"],
                "title": L["title"],
                "gibsLayer": L["gibs"],
                "cmrConceptId": concept,
                "collectionShortName": short,
                "timeRange": L["time"] or "static",
                "path": f"/textures/earth/{out.name}",
                "units": L["units"],
                "legend": L["legend"],
                "evidenceKind": L["evidence"],
            }
        )
        urls.append(url.split("?")[0] + f"?LAYERS={L['gibs']}")
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NASA Earthdata (CMR + GIBS)",
        category="earth",
        tables={"earth_layer": rows},
        source_urls=urls,
        release="GIBS 'best' WMS, EPSG:4326",
        query="; ".join(f"{L['gibs']}@{L['time'] or 'static'}" for L in LAYERS),
        license="NASA open data (no restrictions)",
        attribution="NASA EOSDIS GIBS / Worldview; LP DAAC (MODIS); LAADS (VIIRS Black Marble)",
        coverage=f"{len(rows)} global layers",
        units="rendered imagery (scientific units noted per layer)",
        frame="EPSG:4326 plate carrée, -180..180 lon",
        raw_checksums=checksums,
    )
