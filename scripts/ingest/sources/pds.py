"""NASA PDS archive elevation grids + labelled illustrative colour maps for planets.

PDS products (observed): MGS MOLA MEGDR 4 px/deg topography (Mars) and LRO LOLA
LDEM_4 (Moon), fetched from the PDS Geosciences Node with their PDS3 labels and
converted to equirectangular 16-bit-normalised PNG heightmaps for bump mapping.

Colour maps for other bodies come from Solar System Scope (CC BY 4.0, derived from
NASA imagery). They are rendering assets, labelled `illustrative`, never evidence.
"""
from __future__ import annotations

import re

import numpy as np
from PIL import Image

from _common import WEB_TEXTURES, http_get, log, sha256_bytes
from pipeline import SourceResult, raw_dir, save_raw

SOURCE_ID = "nasa_pds"
GEO = "https://pds-geosciences.wustl.edu"
PDS_PRODUCTS = [
    {
        "id": "pds.mars.mola_megdr_4ppd",
        "bodyId": "body.mars",
        "img": f"{GEO}/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/megt90n000cb.img",
        "lbl": f"{GEO}/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/megt90n000cb.lbl",
        "out": "pds/mars_mola_elevation.png",
    },
    {
        "id": "pds.moon.lola_ldem_4",
        "bodyId": "body.moon",
        "img": f"{GEO}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_4.img",
        "lbl": f"{GEO}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_4.lbl",
        "out": "pds/moon_lola_elevation.png",
    },
]

SSS = "https://www.solarsystemscope.com/textures/download"
ILLUSTRATIVE = [
    ("body.sun", "albedo", "2k_sun.jpg"),
    ("body.mercury", "albedo", "2k_mercury.jpg"),
    ("body.venus", "albedo", "2k_venus_atmosphere.jpg"),
    ("body.moon", "albedo", "2k_moon.jpg"),
    ("body.mars", "albedo", "2k_mars.jpg"),
    ("body.jupiter", "albedo", "2k_jupiter.jpg"),
    ("body.saturn", "albedo", "2k_saturn.jpg"),
    ("body.saturn", "ring", "2k_saturn_ring_alpha.png"),
    ("body.uranus", "albedo", "2k_uranus.jpg"),
    ("body.neptune", "albedo", "2k_neptune.jpg"),
    ("body.earth", "clouds", "2k_earth_clouds.jpg"),
    ("sky.milky_way", "albedo", "8k_stars_milky_way.jpg"),
]


def _label(text: str, key: str) -> str | None:
    m = re.search(rf"^\s*{key}\s*=\s*(.+?)\s*$", text, re.M)
    return m.group(1).strip().strip('"') if m else None


def _product(p: dict, checksums: list[str]) -> dict:
    lbl = http_get(p["lbl"], timeout=60).decode("latin-1")
    save_raw(SOURCE_ID, p["lbl"].rsplit("/", 1)[1], lbl)
    path = raw_dir(SOURCE_ID) / p["img"].rsplit("/", 1)[1]
    if not path.exists():
        log(f"  downloading {p['img']}")
        path.write_bytes(http_get(p["img"], timeout=300))
    data = path.read_bytes()
    checksums.append(f"{path.name}={sha256_bytes(data)}")
    lines = int(_label(lbl, "LINES"))
    samples = int(_label(lbl, "LINE_SAMPLES"))
    stype = _label(lbl, "SAMPLE_TYPE") or "MSB_INTEGER"
    dtype = ">i2" if stype.startswith("MSB") else "<i2"
    scale = float(_label(lbl, "SCALING_FACTOR") or 1.0)
    offset = float(_label(lbl, "OFFSET") or 0.0)
    arr = np.frombuffer(data[: lines * samples * 2], dtype=dtype).reshape(lines, samples).astype(np.float64)
    elev = arr * scale + (0.0 if abs(offset) > 1e5 else offset)  # LOLA offset is the datum radius
    lo, hi = np.percentile(elev, 0.5), np.percentile(elev, 99.5)
    norm = np.clip((elev - lo) / (hi - lo), 0, 1)
    # Products start at 0°E; recentre on 180° so the map matches three.js sphere UVs.
    norm = np.roll(norm, samples // 2, axis=1)
    img = Image.fromarray((norm * 255).astype(np.uint8), mode="L")
    out = WEB_TEXTURES / p["out"]
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, optimize=True)
    return {
        "id": p["id"],
        "bodyId": p["bodyId"],
        "kind": "elevation",
        "path": f"/textures/{p['out']}",
        "width": samples,
        "height": lines,
        "source": f"{_label(lbl, 'DATA_SET_ID')} ({_label(lbl, 'INSTRUMENT_ID') or 'PDS'})",
        "sourceProductId": _label(lbl, "PRODUCT_ID") or path.name,
        "sourceUrl": p["img"],
        "projection": "simple cylindrical, recentred to 180°; elevation normalised 0.5–99.5 pct "
        f"({lo:.0f}…{hi:.0f} m)",
        "license": "Public domain (NASA PDS)",
        "evidenceKind": "observed",
    }


def run() -> SourceResult:
    rows, checksums = [], []
    for p in PDS_PRODUCTS:
        rows.append(_product(p, checksums))
    for body, kind, fname in ILLUSTRATIVE:
        out = WEB_TEXTURES / "planets" / fname
        out.parent.mkdir(parents=True, exist_ok=True)
        if not out.exists():
            log(f"  texture {fname}")
            out.write_bytes(http_get(f"{SSS}/{fname}", timeout=120))
        with Image.open(out) as im:
            w, h = im.size
        rows.append(
            {
                "id": f"tex.{body}.{kind}",
                "bodyId": body,
                "kind": kind,
                "path": f"/textures/planets/{fname}",
                "width": w,
                "height": h,
                "source": "Solar System Scope (derived from NASA mission imagery)",
                "sourceProductId": fname,
                "sourceUrl": f"{SSS}/{fname}",
                "projection": "equirectangular",
                "license": "CC BY 4.0 — Solar System Scope / INOVE",
                "evidenceKind": "illustrative",
            }
        )
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NASA Planetary Data System (Geosciences Node)",
        category="solar_system",
        tables={"planet_texture": rows},
        source_urls=[p["img"] for p in PDS_PRODUCTS] + [SSS],
        release="MGS-M-MOLA-5-MEGDR-L3-V1.0; LRO-L-LOLA-4-GDR-V1.0",
        query="MEGT90N000CB (4 px/deg), LDEM_4 (4 px/deg)",
        license="PDS: public domain; colour maps CC BY 4.0 (illustrative)",
        attribution="NASA PDS Geosciences Node; MGS MOLA and LRO LOLA science teams; Solar System Scope",
        coverage=f"{len(PDS_PRODUCTS)} PDS elevation products, {len(ILLUSTRATIVE)} illustrative maps",
        units="elevation normalised to 8-bit for rendering; source metres recorded in projection note",
        frame="body-fixed planetocentric, simple cylindrical",
        raw_checksums=checksums,
        note="Bodies without a colour map render with labelled procedural shading.",
    )
