"""Ingest framework: every source implements fetch → normalize → validate → manifest.

A source module exposes `SOURCE_ID`, `CATEGORY` and `run() -> SourceResult`.
Raw responses are written under data/raw/<source>/ before any transformation.
Normalized tables go to data/normalized/tables/<table>.json (validated against
schema.TABLES) and are mirrored to apps/web/public/data/tables/ as the offline
cache the browser falls back to when SpacetimeDB is unreachable.
"""
from __future__ import annotations

import importlib
import json
import sys
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path

from _common import (
    DATA_MANIFESTS,
    DATA_NORMALIZED,
    DATA_RAW,
    WEB_DATA,
    log,
    sha256_bytes,
    utc_now_iso,
    warn,
)
from schema import TABLES, coerce_row

TABLE_DIR = DATA_NORMALIZED / "tables"
WEB_TABLE_DIR = WEB_DATA / "tables"
BY_SOURCE_DIR = DATA_NORMALIZED / "by_source"


@dataclass
class SourceResult:
    source_id: str
    source_name: str
    category: str
    tables: dict[str, list[dict]]
    source_urls: list[str]
    release: str
    query: str
    license: str
    attribution: str
    coverage: str
    units: str = ""
    frame: str = ""
    note: str = ""
    raw_checksums: list[str] = field(default_factory=list)
    validation_status: str = "ok"


def raw_dir(source_id: str) -> Path:
    d = DATA_RAW / source_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_raw(source_id: str, name: str, data: bytes | str) -> tuple[Path, str]:
    """Persist an upstream response verbatim and return (path, checksum)."""
    payload = data.encode("utf-8") if isinstance(data, str) else data
    path = raw_dir(source_id) / name
    path.write_bytes(payload)
    return path, sha256_bytes(payload)


def _validate(table: str, rows: list[dict]) -> list[dict]:
    validated = [coerce_row(table, r) for r in rows]
    pk = TABLES[table]["columns"][0][0]
    seen: set = set()
    for r in validated:
        if r[pk] in seen:
            raise ValueError(f"{table}: duplicate primary key {r[pk]!r}")
        seen.add(r[pk])
    return validated


def _dump(rows: list[dict]) -> str:
    return json.dumps(rows, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _write_table(table: str, rows: list[dict], source_id: str) -> None:
    """Persist one source's contribution; `assemble()` merges contributions per table."""
    d = BY_SOURCE_DIR / source_id
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{table}.json").write_text(_dump(_validate(table, rows)), encoding="utf-8")


def assemble() -> dict[str, int]:
    """Merge per-source table files into data/normalized/tables and the web cache."""
    merged: dict[str, list[dict]] = {}
    for f in sorted(BY_SOURCE_DIR.glob("*/*.json")):
        merged.setdefault(f.stem, []).extend(json.loads(f.read_text(encoding="utf-8")))
    TABLE_DIR.mkdir(parents=True, exist_ok=True)
    WEB_TABLE_DIR.mkdir(parents=True, exist_ok=True)
    counts = {}
    for table, rows in merged.items():
        text = _dump(_validate(table, rows))
        (TABLE_DIR / f"{table}.json").write_text(text, encoding="utf-8")
        (WEB_TABLE_DIR / f"{table}.json").write_text(text, encoding="utf-8")
        counts[table] = len(rows)
    return counts


def write_result(res: SourceResult) -> dict:
    total = 0
    for table, rows in res.tables.items():
        if table not in TABLES:
            raise KeyError(f"{res.source_id} produced unknown table {table}")
        _write_table(table, rows, res.source_id)
        total += len(rows)
    manifest = {
        "id": res.source_id,
        "sourceName": res.source_name,
        "category": res.category,
        "sourceUrls": " ".join(dict.fromkeys(res.source_urls)),
        "release": res.release,
        "query": res.query,
        "retrievedAt": utc_now_iso(),
        "checksum": ";".join(res.raw_checksums[:12]),
        "license": res.license,
        "attribution": res.attribution,
        "coverage": res.coverage,
        "units": res.units,
        "frame": res.frame,
        "validationStatus": res.validation_status,
        "rowCount": total,
        "tables": ",".join(f"{t}:{len(r)}" for t, r in res.tables.items()),
        "note": res.note,
    }
    DATA_MANIFESTS.mkdir(parents=True, exist_ok=True)
    (DATA_MANIFESTS / f"{res.source_id}.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return manifest


def write_manifest_table() -> int:
    rows = []
    for p in sorted(DATA_MANIFESTS.glob("*.json")):
        m = json.loads(p.read_text(encoding="utf-8"))
        if "category" not in m or "tables" not in m:
            continue  # legacy manifests from the v1 pipeline
        rows.append(m)
    _write_table("dataset_manifest", rows, "_manifests")
    return len(rows)


SOURCES = [
    "spice", "horizons", "nssdc", "pds", "earthdata", "natural_earth", "owid_energy",
    "noaa", "usgs", "gaia", "named_stars", "exoplanets", "sdss", "heasarc", "hca",
    "ncbi", "ensembl", "clinvar", "pdb", "pubchem", "nist", "nuclear", "pdg",
]


def main(argv: list[str]) -> int:
    wanted = argv or SOURCES
    failures = []
    for name in wanted:
        t0 = time.time()
        log(f"\n=== {name} ===")
        try:
            mod = importlib.import_module(f"sources.{name}")
            res: SourceResult = mod.run()
            m = write_result(res)
            log(f"--- {name}: {m['tables']} [{m['validationStatus']}] {time.time() - t0:.1f}s")
        except Exception as e:  # keep going; a failed source is reported, never faked
            failures.append(name)
            warn(f"!!! {name} FAILED: {e}")
            traceback.print_exc()
    n = write_manifest_table()
    counts = assemble()
    log("\ntables: " + ", ".join(f"{t}={c}" for t, c in sorted(counts.items())))
    log(f"manifests: {n} | failures: {failures or 'none'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
