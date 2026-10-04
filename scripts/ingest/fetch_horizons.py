#!/usr/bin/env python3
"""Fetch Solar System state vectors from NASA JPL Horizons API."""
from __future__ import annotations

import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from _common import (
    DATA_MANIFESTS,
    DATA_NORMALIZED,
    DATA_RAW,
    build_manifest,
    save_manifest,
    utc_now_iso,
    write_json,
)

HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"

BODIES: dict[str, dict[str, str]] = {
    "sun": {"command": "10", "name": "Sun", "horizons_id": "10"},
    "mercury": {"command": "199", "name": "Mercury", "horizons_id": "199"},
    "venus": {"command": "299", "name": "Venus", "horizons_id": "299"},
    "earth": {"command": "399", "name": "Earth", "horizons_id": "399"},
    "moon": {"command": "301", "name": "Moon", "horizons_id": "301"},
    "mars": {"command": "499", "name": "Mars", "horizons_id": "499"},
    "jupiter": {"command": "599", "name": "Jupiter", "horizons_id": "599"},
}

EPOCH_START = "2025-01-01"
EPOCH_STOP = "2025-01-02"
STEP_SIZE = "1 d"

KM_TO_M = 1000.0


def horizons_query_url(command: str) -> str:
    params = {
        "format": "text",
        "COMMAND": f"'{command}'",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": "'500@10'",
        "START_TIME": f"'{EPOCH_START}'",
        "STOP_TIME": f"'{EPOCH_STOP}'",
        "STEP_SIZE": f"'{STEP_SIZE}'",
        "REF_SYSTEM": "'ICRF'",
        "REF_PLANE": "'FRAME'",
        "VEC_CORR": "'NONE'",
        "OUT_UNITS": "'KM-S'",
        "CSV_FORMAT": "'YES'",
    }
    return f"{HORIZONS_API}?{urllib.parse.urlencode(params)}"


def fetch_body(command: str) -> tuple[str, str]:
    url = horizons_query_url(command)
    req = urllib.request.Request(url, headers={"User-Agent": "COSMOS-Ingest/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return raw, url


def parse_soe_eoe(text: str) -> list[dict[str, str | float]]:
    """Parse CSV vector rows between $$SOE and $$EOE."""
    m_start = text.find("$$SOE")
    m_end = text.find("$$EOE")
    if m_start < 0 or m_end < 0 or m_end <= m_start:
        raise ValueError("Horizons response missing $$SOE/$$EOE markers")

    block = text[m_start + 5 : m_end].strip()
    lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
    if not lines:
        raise ValueError("Empty ephemeris block between $$SOE and $$EOE")

    records: list[dict[str, str | float]] = []
    for line in lines:
        if line.startswith("DATE__"):
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 7:
            continue
        # Typical CSV: JDTDB, Calendar, X, Y, Z, VX, VY, VZ
        try:
            x, y, z = float(parts[2]), float(parts[3]), float(parts[4])
            vx, vy, vz = float(parts[5]), float(parts[6]), float(parts[7])
        except (ValueError, IndexError):
            continue
        records.append(
            {
                "calendarTime": parts[1] if len(parts) > 1 else parts[0],
                "jdTdb": parts[0],
                "positionKm": [x, y, z],
                "velocityKmS": [vx, vy, vz],
                "positionM": [x * KM_TO_M, y * KM_TO_M, z * KM_TO_M],
                "velocityMps": [vx * KM_TO_M, vy * KM_TO_M, vz * KM_TO_M],
            }
        )
    if not records:
        raise ValueError("Could not parse any vector rows from Horizons CSV block")
    return records


def normalize_all(raw_by_key: dict[str, str]) -> dict:
    retrieved_at = utc_now_iso()
    bodies_out: dict[str, dict] = {}
    for key, meta in BODIES.items():
        raw = raw_by_key.get(key)
        if not raw:
            continue
        vectors = parse_soe_eoe(raw)
        sample = vectors[0]
        bodies_out[key] = {
            "horizonsId": meta["horizons_id"],
            "name": meta["name"],
            "command": meta["command"],
            "epoch": sample["calendarTime"],
            "jdTdb": sample["jdTdb"],
            "frame": "ICRF",
            "center": "500@10",
            "refPlane": "FRAME",
            "vecCorr": "NONE",
            "aberrationCorrection": "NONE",
            "timeScale": "TDB",
            "stateVector": {
                "positionM": sample["positionM"],
                "velocityMps": sample["velocityMps"],
                "originId": "ssb",
                "frame": "ICRF",
                "epoch": EPOCH_START + "T00:00:00.000",
                "timeScale": "TDB",
                "aberrationCorrection": "NONE",
            },
            "samples": vectors,
            "units": {
                "positionRaw": "km",
                "velocityRaw": "km/s",
                "positionNormalized": "m",
                "velocityNormalized": "m/s",
            },
        }

    return {
        "schema": "cosmos.horizons.solar_system.v1",
        "retrievedAt": retrieved_at,
        "epochPin": {"start": EPOCH_START, "stop": EPOCH_STOP, "step": STEP_SIZE},
        "sourceApi": HORIZONS_API,
        "bodies": bodies_out,
    }


def main() -> int:
    DATA_RAW.mkdir(parents=True, exist_ok=True)
    DATA_NORMALIZED.mkdir(parents=True, exist_ok=True)
    DATA_MANIFESTS.mkdir(parents=True, exist_ok=True)

    raw_by_key: dict[str, str] = {}
    source_urls: list[str] = []
    errors: list[str] = []

    for key, meta in BODIES.items():
        try:
            raw, url = fetch_body(meta["command"])
            source_urls.append(url)
            if "ERROR" in raw[:500].upper() and "$$SOE" not in raw:
                errors.append(f"{key}: API error snippet: {raw[:300]}")
                continue
            raw_path = DATA_RAW / f"horizons_{key}_{EPOCH_START.replace('-', '')}.txt"
            raw_path.write_text(raw, encoding="utf-8")
            raw_by_key[key] = raw
            print(f"OK fetched {meta['name']} -> {raw_path.name}")
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            errors.append(f"{key}: {e}")
            print(f"FAIL {meta['name']}: {e}", file=sys.stderr)

    if not raw_by_key:
        print("No Horizons bodies fetched successfully.", file=sys.stderr)
        for err in errors:
            print(f"  {err}", file=sys.stderr)
        return 1

    try:
        normalized = normalize_all(raw_by_key)
    except ValueError as e:
        print(f"Normalize failed: {e}", file=sys.stderr)
        return 1

    norm_path = DATA_NORMALIZED / "horizons_solar_system.json"
    write_json(norm_path, normalized)

    manifest = build_manifest(
        manifest_id="manifest.horizons.solar_system.v1",
        normalized_path=norm_path,
        source_urls=list(dict.fromkeys(source_urls)),
        release="Horizons ephemeris (live API)",
        query={
            "CENTER": "500@10",
            "EPHEM_TYPE": "VECTORS",
            "REF_SYSTEM": "ICRF",
            "REF_PLANE": "FRAME",
            "VEC_CORR": "NONE",
            "OUT_UNITS": "KM-S",
            "CSV_FORMAT": "YES",
            "START_TIME": EPOCH_START,
            "STOP_TIME": EPOCH_STOP,
            "STEP_SIZE": STEP_SIZE,
            "bodies": [m["command"] for m in BODIES.values()],
        },
        license_text="NASA/JPL Horizons — public domain U.S. government work; cite SSD/JPL Horizons.",
        attribution="NASA JPL Solar System Dynamics — Horizons Ephemeris System",
        coverage=f"SSB-centered ICRF vectors at pinned epoch {EPOCH_START}; bodies fetched: {list(raw_by_key.keys())}",
        units="normalized positions in m, velocities in m/s (converted from KM-S)",
        frame="ICRF",
        validation_status="validated" if len(raw_by_key) == len(BODIES) else "partial",
        retrieved_at=normalized["retrievedAt"],
        extra={"fetchErrors": errors} if errors else None,
    )
    mpath = save_manifest(manifest, "horizons_solar_system.json")
    print(f"Wrote {norm_path.relative_to(norm_path.parents[2])}")
    print(f"Wrote {mpath.relative_to(mpath.parents[2])}")
    return 0 if len(raw_by_key) == len(BODIES) else 2


if __name__ == "__main__":
    sys.exit(main())
