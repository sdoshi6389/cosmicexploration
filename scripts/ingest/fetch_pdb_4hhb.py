#!/usr/bin/env python3
"""Download and normalize RCSB PDB 4HHB (hemoglobin) CA coordinates."""
from __future__ import annotations

import re
import sys
import urllib.error
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

PDB_ID = "4HHB"
CIF_URL = f"https://files.rcsb.org/download/{PDB_ID}.cif"
PDB_URL = f"https://files.rcsb.org/download/{PDB_ID}.pdb"
TARGET_CHAINS = frozenset({"A", "B", "C", "D"})


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "COSMOS-Ingest/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def parse_pdb_atoms(text: str) -> list[dict]:
    atoms: list[dict] = []
    for line in text.splitlines():
        if not line.startswith("ATOM  ") and not line.startswith("HETATM"):
            continue
        if len(line) < 54:
            continue
        atom_name = line[12:16].strip()
        if atom_name != "CA":
            continue
        alt_loc = line[16].strip()
        if alt_loc not in ("", "A"):
            continue
        chain = line[21].strip()
        if chain not in TARGET_CHAINS:
            continue
        try:
            res_seq = int(line[22:26].strip())
            x = float(line[30:38])
            y = float(line[38:46])
            z = float(line[46:54])
        except ValueError:
            continue
        element = line[76:78].strip() if len(line) >= 78 else "C"
        atoms.append(
            {
                "chainId": chain,
                "residueSeq": res_seq,
                "atomName": "CA",
                "element": element or "C",
                "coordsAngstrom": [x, y, z],
            }
        )
    return atoms


def parse_cif_ca(text: str) -> list[dict]:
    """Minimal mmCIF parser for _atom_site CA records on chains A–D."""
    lines = text.splitlines()
    loop_start = None
    headers: list[str] = []
    for i, line in enumerate(lines):
        if line.strip() == "loop_":
            j = i + 1
            cols: list[str] = []
            while j < len(lines) and lines[j].strip().startswith("_"):
                cols.append(lines[j].strip().split()[0])
                j += 1
            if "_atom_site.label_atom_id" in cols:
                loop_start = i
                headers = cols
                break
    if loop_start is None:
        return []

    idx = {h: n for n, h in enumerate(headers)}
    need = [
        "_atom_site.label_atom_id",
        "_atom_site.label_asym_id",
        "_atom_site.label_seq_id",
        "_atom_site.Cartn_x",
        "_atom_site.Cartn_y",
        "_atom_site.Cartn_z",
        "_atom_site.type_symbol",
    ]
    if not all(k in idx for k in need):
        return []

    data_start = loop_start + 1 + len(headers)
    atoms: list[dict] = []
    for line in lines[data_start:]:
        s = line.strip()
        if not s or s.startswith("#") or s.startswith("_") or s.startswith("loop_"):
            if atoms:
                break
            continue
        if s.startswith("data_") or s.startswith("save_"):
            break
        parts = s.split()
        if len(parts) < len(headers):
            continue
        atom_id = parts[idx["_atom_site.label_atom_id"]]
        if atom_id != "CA":
            continue
        chain = parts[idx["_atom_site.label_asym_id"]]
        if chain not in TARGET_CHAINS:
            continue
        try:
            res_seq = int(parts[idx["_atom_site.label_seq_id"]])
            x = float(parts[idx["_atom_site.Cartn_x"]])
            y = float(parts[idx["_atom_site.Cartn_y"]])
            z = float(parts[idx["_atom_site.Cartn_z"]])
        except ValueError:
            continue
        element = parts[idx["_atom_site.type_symbol"]]
        atoms.append(
            {
                "chainId": chain,
                "residueSeq": res_seq,
                "atomName": "CA",
                "element": element,
                "coordsAngstrom": [x, y, z],
            }
        )
    return atoms


def main() -> int:
    DATA_RAW.mkdir(parents=True, exist_ok=True)
    retrieved_at = utc_now_iso()
    source_url = CIF_URL
    raw_bytes: bytes | None = None
    parse_errors: list[str] = []

    for url, label in ((CIF_URL, "cif"), (PDB_URL, "pdb")):
        try:
            raw_bytes = download(url)
            source_url = url
            raw_path = DATA_RAW / f"{PDB_ID}.{label}"
            raw_path.write_bytes(raw_bytes)
            print(f"OK downloaded {url} -> {raw_path.name}")
            break
        except urllib.error.URLError as e:
            parse_errors.append(f"{label} download failed: {e}")
            print(f"FAIL {url}: {e}", file=sys.stderr)

    if raw_bytes is None:
        err_path = DATA_NORMALIZED / "pdb_4hhb_error.json"
        write_json(
            err_path,
            {
                "schema": "cosmos.ingest.error.v1",
                "pdbId": PDB_ID,
                "retrievedAt": retrieved_at,
                "error": "Download failed for both CIF and PDB URLs.",
                "attemptedUrls": [CIF_URL, PDB_URL],
                "details": parse_errors,
                "note": "No coordinates were invented; re-run when RCSB is reachable.",
            },
        )
        print(
            "ERROR: Could not download 4HHB from RCSB. Wrote pdb_4hhb_error.json — no fabricated coords.",
            file=sys.stderr,
        )
        return 1

    text = raw_bytes.decode("utf-8", errors="replace")
    atoms = parse_cif_ca(text) if source_url.endswith(".cif") else parse_pdb_atoms(text)
    if not atoms and source_url.endswith(".cif"):
        atoms = parse_pdb_atoms(text)

    if not atoms:
        err_path = DATA_NORMALIZED / "pdb_4hhb_error.json"
        write_json(
            err_path,
            {
                "schema": "cosmos.ingest.error.v1",
                "pdbId": PDB_ID,
                "retrievedAt": retrieved_at,
                "sourceUrl": source_url,
                "error": "Download succeeded but CA atom parse returned zero records.",
                "note": "No coordinates were invented.",
            },
        )
        print("ERROR: Parse produced zero CA atoms.", file=sys.stderr)
        return 1

    by_chain: dict[str, list] = {c: [] for c in sorted(TARGET_CHAINS)}
    for a in atoms:
        by_chain.setdefault(a["chainId"], []).append(a)

    normalized = {
        "schema": "cosmos.pdb.structure.v1",
        "pdbId": PDB_ID,
        "title": "Deoxyhemoglobin (4HHB)",
        "retrievedAt": retrieved_at,
        "sourceUrl": source_url,
        "representation": "CA_backbone_subset",
        "chains": sorted(TARGET_CHAINS),
        "units": "Angstrom",
        "atomCount": len(atoms),
        "atoms": atoms,
        "byChain": {c: by_chain.get(c, []) for c in sorted(TARGET_CHAINS)},
        "evidence": {
            "kind": "observed",
            "method": "rcsb_download",
            "notes": ["Alpha-carbon subset for rendering; full structure in raw file."],
        },
    }

    norm_path = DATA_NORMALIZED / "pdb_4hhb_ca.json"
    write_json(norm_path, normalized)

    manifest = build_manifest(
        manifest_id="manifest.pdb.4hhb.v1",
        normalized_path=norm_path,
        source_urls=[source_url, "https://www.rcsb.org/structure/4HHB"],
        release=PDB_ID,
        query={"pdbId": PDB_ID, "atomFilter": "CA", "chains": sorted(TARGET_CHAINS)},
        license_text="RCSB PDB — see structure page for citation and license terms.",
        attribution="Protein Data Bank; 4HHB depositor structure",
        coverage=f"CA atoms chains A–D, n={len(atoms)}",
        units="Angstrom (Cartesian, crystal frame)",
        frame="PDB Cartesian / mmCIF atom_site",
        validation_status="validated",
        retrieved_at=retrieved_at,
    )
    save_manifest(manifest, "pdb_4hhb.json")
    print(f"Normalized {len(atoms)} CA atoms -> {norm_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
