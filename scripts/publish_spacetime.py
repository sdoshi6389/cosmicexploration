#!/usr/bin/env python3
"""Upload normalized science tables to SpacetimeDB through the `spacetime` CLI.

Uses the CLI's own login (no token handling here). Each table is cleared, then
upserted in column-oriented chunks small enough for the Windows command line, with
a few calls in flight at once. Row counts are verified with `spacetime sql` at the end.

    python scripts/publish_spacetime.py              # all tables
    python scripts/publish_spacetime.py gaia_star    # selected tables
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "ingest"))
from schema import TABLES  # noqa: E402

DB = "cosmicexploration-dejjt"
SERVER = "maincloud"
TABLE_DIR = ROOT / "data" / "normalized" / "tables"
MAX_ARG = 24_000  # characters of JSON per call, well inside CreateProcess's 32 767 limit
WORKERS = 6


def cli(*args: str) -> str:
    out = subprocess.run(
        ["spacetime", *args, "--server", SERVER, "--yes"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if out.returncode != 0:
        raise RuntimeError(f"spacetime {' '.join(args[:2])} failed: {out.stderr.strip()[-600:]}")
    return out.stdout


def call(reducer: str, *json_args) -> None:
    cli("call", DB, reducer, *[json.dumps(a) for a in json_args])


def chunks(table: str, rows: list[dict]):
    cols = [c for c, _ in TABLES[table]["columns"]]
    batch: list[list] = []
    size = 40
    for r in rows:
        vals = [r.get(c) for c in cols]
        enc = len(json.dumps(vals, separators=(",", ":"))) * 1.15 + 4  # escaping overhead
        if batch and size + enc > MAX_ARG:
            yield json.dumps({"c": cols, "r": batch}, separators=(",", ":"))
            batch, size = [], 40
        batch.append(vals)
        size += enc
    if batch:
        yield json.dumps({"c": cols, "r": batch}, separators=(",", ":"))


def count(table: str) -> int:
    out = cli("sql", DB, f"SELECT COUNT(*) AS n FROM {table}")
    nums = re.findall(r"^\s*(\d+)\s*$", out, re.M)
    return int(nums[-1]) if nums else -1


def publish(table: str) -> tuple[str, int, int]:
    path = TABLE_DIR / f"{table}.json"
    rows = json.loads(path.read_text(encoding="utf-8"))
    call("clear_table", table)
    parts = list(chunks(table, rows))
    with ThreadPoolExecutor(WORKERS) as pool:
        futs = [pool.submit(call, "ingest_rows", table, p) for p in parts]
        for f in as_completed(futs):
            f.result()
    return table, len(rows), count(table)


def main(argv: list[str]) -> int:
    wanted = argv or [t for t in TABLES if (TABLE_DIR / f"{t}.json").exists()]
    call("claim_admin")
    if not argv:
        call("clear_science")  # empty the superseded v1 tables
        print("cleared legacy v1 tables")
    bad = []
    for t in wanted:
        name, local, remote = publish(t)
        ok = local == remote
        bad += [] if ok else [name]
        print(f"{'OK ' if ok else 'MISMATCH'} {name:<20} local={local:<7} spacetimedb={remote}", flush=True)
    print("all tables verified" if not bad else f"mismatched: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
