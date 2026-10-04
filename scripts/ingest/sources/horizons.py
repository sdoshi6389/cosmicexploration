"""NASA/JPL Horizons → heliocentric state vectors, osculating elements, orbit tracks.

Parameters follow DESIGN.md §6: CENTER='500@10', EPHEM_TYPE='VECTORS',
REF_SYSTEM='ICRF', REF_PLANE='FRAME', VEC_CORR='NONE', OUT_UNITS='KM-S',
CSV_FORMAT='YES'. Rows between $$SOE/$$EOE are parsed; km → m exactly once.
"""
from __future__ import annotations

import json
import math
import time
import urllib.parse

from _common import http_get, log
from pipeline import BY_SOURCE_DIR, SourceResult, save_raw
from sources.bodies import BODIES, EPOCH, EPOCH_STOP, PARENT_CENTER

SOURCE_ID = "jpl_horizons"
API = "https://ssd.jpl.nasa.gov/api/horizons.api"
G_KM3_KG_S2 = 6.67430e-20
AU_KM = 149_597_870.7

LAUNCH = {
    "craft.voyager1": "1977-09-08",
    "craft.voyager2": "1977-08-23",
    "craft.new_horizons": "2006-01-20",
    "craft.jwst": "2021-12-27",
    "craft.parker": "2018-08-14",
}


def _query(params: dict) -> str:
    base = {
        "format": "json",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "REF_SYSTEM": "ICRF",
        "REF_PLANE": "FRAME",
        "OUT_UNITS": "KM-S",
        "CSV_FORMAT": "YES",
    }
    base.update(params)
    q = "&".join(f"{k}={urllib.parse.quote(str(v), safe='@')}" for k, v in base.items())
    for attempt in range(3):
        payload = json.loads(http_get(f"{API}?{q}", timeout=90))
        if "result" in payload:
            time.sleep(0.25)  # stay well inside Horizons' fair-use limits
            return payload["result"]
        time.sleep(2 + attempt * 3)
    raise RuntimeError(f"Horizons returned no result for {params}")


def _rows(result: str) -> list[list[str]]:
    if "$$SOE" not in result:
        raise RuntimeError(result[:800])
    body = result.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    return [[c.strip() for c in ln.split(",")] for ln in body.strip().splitlines() if ln.strip()]


def _q(cmd: str) -> str:
    return f"'{cmd}'"


def _vectors(cmd: str, center: str, start: str, stop: str, step: str) -> list[list[str]]:
    return _rows(
        _query(
            {
                "COMMAND": _q(cmd),
                "CENTER": _q(center),
                "EPHEM_TYPE": "VECTORS",
                "VEC_CORR": "NONE",
                "VEC_TABLE": "2",
                "START_TIME": _q(start),
                "STOP_TIME": _q(stop),
                "STEP_SIZE": _q(step),
            }
        )
    )


def _elements(cmd: str, center: str) -> dict[str, float]:
    rows = _rows(
        _query(
            {
                "COMMAND": _q(cmd),
                "CENTER": _q(center),
                "EPHEM_TYPE": "ELEMENTS",
                "START_TIME": _q(EPOCH),
                "STOP_TIME": _q(EPOCH_STOP),
                "STEP_SIZE": _q("1 d"),
            }
        )
    )
    r = rows[0]
    # JDTDB, Cal, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
    return {"EC": float(r[2]), "IN": float(r[4]), "A": float(r[11]), "PR": float(r[13])}


def _spice_rows() -> dict[str, dict]:
    path = BY_SOURCE_DIR / "naif_spice" / "spice_constant.json"
    if not path.exists():
        return {}
    return {r["id"]: r for r in json.loads(path.read_text(encoding="utf-8"))}


def _unit(v):
    n = math.sqrt(sum(c * c for c in v)) or 1.0
    return [c / n for c in v]


def run() -> SourceResult:
    spice = _spice_rows()
    bodies, samples, checksums, raw_log = [], [], [], {}
    for cid, name, naif, cmd, kind, parent, color in BODIES:
        log(f"  horizons {name}")
        state = _vectors(cmd, "500@10", EPOCH, EPOCH_STOP, "1 d")[0]
        jd = float(state[0])
        x, y, z, vx, vy, vz = (float(v) * 1000.0 for v in state[2:8])  # km → m
        raw_log[cid] = {"state": state}

        elements = None
        track_center = "500@10"
        if kind in ("planet", "dwarf", "asteroid"):
            elements = _elements(cmd, "500@10")
        elif kind == "moon":
            track_center = PARENT_CENTER.get(parent, "500@10")
            elements = _elements(cmd, track_center)
        raw_log[cid]["elements"] = elements

        # Orbit track: one full period (planets/moons) or launch→epoch (spacecraft).
        track = []
        if kind == "spacecraft":
            start = LAUNCH[cid]
            track = _vectors(cmd, "500@10", start, EPOCH, "180")  # 180 equal intervals
        elif elements and elements["PR"] > 0:
            period_days = elements["PR"] / 86400.0
            n = 240 if kind != "moon" else 120
            # Centre the window on the epoch so long periods stay inside ephemeris coverage.
            start_jd = jd - period_days / 2
            stop_jd = jd + period_days / 2
            track = _vectors(cmd, track_center, f"JD{start_jd:.6f}", f"JD{stop_jd:.6f}", str(n))
        for i, row in enumerate(track):
            samples.append(
                {
                    "id": f"{cid}:{i}",
                    "bodyId": cid,
                    "center": "body.sun" if track_center == "500@10" else parent,
                    "idx": i,
                    "jdTdb": float(row[0]),
                    "xM": float(row[2]) * 1000.0,
                    "yM": float(row[3]) * 1000.0,
                    "zM": float(row[4]) * 1000.0,
                }
            )

        sc = spice.get(cid, {})
        radius = sc.get("radiusAKm")
        gm = sc.get("gmKm3S2")
        rate = sc.get("pmRateDegDay")
        rot_h = (360.0 / rate) * 24.0 if rate else None
        obliquity = None
        if sc.get("poleRaDeg") is not None and kind in ("planet", "dwarf"):
            ra, dec = math.radians(sc["poleRaDeg"]), math.radians(sc["poleDecDeg"])
            pole = [math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)]
            h = _unit([y * vz - z * vy, z * vx - x * vz, x * vy - y * vx])
            dot = max(-1.0, min(1.0, sum(a * b for a, b in zip(pole, h))))
            obliquity = math.degrees(math.acos(dot))
        if cid == "body.sun":
            x = y = z = vx = vy = vz = 0.0

        bodies.append(
            {
                "id": cid,
                "name": name,
                "naifId": naif,
                "kind": kind,
                "parentId": parent,
                "xM": x, "yM": y, "zM": z, "vxMps": vx, "vyMps": vy, "vzMps": vz,
                "epochTdb": f"{EPOCH}T00:00:00 TDB",
                "epochJd": jd,
                "frame": "ICRF",
                "center": "500@10",
                "radiusKm": radius,
                "gmKm3S2": gm,
                "massKg": (gm / G_KM3_KG_S2) if gm else None,
                "semiMajorAxisAu": (elements["A"] / AU_KM) if elements else None,
                "eccentricity": elements["EC"] if elements else None,
                "inclinationDeg": elements["IN"] if elements else None,
                "orbitPeriodDays": (elements["PR"] / 86400.0) if elements else None,
                "rotationPeriodHours": rot_h,
                "obliquityDeg": obliquity,
                "colorHex": color,
                "evidenceKind": "observed",
            }
        )

    _, cs = save_raw(SOURCE_ID, f"horizons_states_{EPOCH}.json", json.dumps(raw_log, indent=1))
    checksums.append(cs)
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NASA/JPL Horizons System",
        category="solar_system",
        tables={"horizons_body": bodies, "orbit_sample": samples},
        source_urls=[API, "https://ssd-api.jpl.nasa.gov/doc/horizons.html"],
        release=f"DE441-based Horizons ephemerides, epoch {EPOCH} TDB",
        query="VECTORS CENTER=500@10 REF_SYSTEM=ICRF REF_PLANE=FRAME VEC_CORR=NONE OUT_UNITS=KM-S; "
        "ELEMENTS at epoch; tracks over one period (moons parent-centric)",
        license="Public domain (NASA/JPL)",
        attribution="JPL Solar System Dynamics Group, Horizons On-Line Ephemeris System",
        coverage=f"{len(bodies)} bodies, {len(samples)} orbit samples",
        units="m, m/s (converted once from km, km/s)",
        frame="ICRF equatorial, heliocentric (Sun body centre); moon tracks parent-centric",
        raw_checksums=checksums,
    )
