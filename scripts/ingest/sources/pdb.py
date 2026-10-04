"""RCSB PDB: 4HHB (deoxy HbA) and 2HBS (deoxy HbS, the real sickle-haemoglobin structure).

mmCIF atom_site is parsed with author numbering (auth_asym_id / auth_seq_id) so β6
in the literature equals resSeq 6 on β chains. Model 1, first altloc, no waters.
The β6 residue identity is validated against both structures: GLU in 4HHB, VAL in 2HBS.
"""
from __future__ import annotations

import json
import shlex

from _common import http_get
from pipeline import SourceResult, save_raw

SOURCE_ID = "rcsb_pdb"
ENTRIES = ["4HHB", "2HBS"]
DATA_API = "https://data.rcsb.org/rest/v1/core"
FILES = "https://files.rcsb.org/download"


def _loops(text: str) -> dict[str, list[dict[str, str]]]:
    """Tiny mmCIF loop_ reader (enough for atom_site, struct_conf, struct_sheet_range)."""
    out: dict[str, list[dict[str, str]]] = {}
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        if lines[i].strip() != "loop_":
            i += 1
            continue
        i += 1
        keys = []
        while i < len(lines) and lines[i].startswith("_"):
            keys.append(lines[i].strip())
            i += 1
        cat = keys[0].split(".")[0] if keys else ""
        cols = [k.split(".", 1)[1] for k in keys]
        rows = []
        buf: list[str] = []
        while i < len(lines) and not lines[i].startswith(("loop_", "_", "#")):
            ln = lines[i]
            if ln.startswith(";"):  # multi-line text field
                txt = [ln[1:]]
                i += 1
                while i < len(lines) and not lines[i].startswith(";"):
                    txt.append(lines[i])
                    i += 1
                buf.append(" ".join(txt).strip())
            else:
                buf.extend(shlex.split(ln, posix=True) if ("'" in ln or '"' in ln) else ln.split())
            while len(buf) >= len(cols):
                rows.append(dict(zip(cols, buf[: len(cols)])))
                buf = buf[len(cols):]
            i += 1
        out[cat] = rows
    return out


def run() -> SourceResult:
    entries, atoms, sse, checksums, notes = [], [], [], [], []
    for pid in ENTRIES:
        cif = http_get(f"{FILES}/{pid}.cif", timeout=120).decode()
        _, cs = save_raw(SOURCE_ID, f"{pid}.cif", cif)
        checksums.append(f"{pid}={cs}")
        meta = json.loads(http_get(f"{DATA_API}/entry/{pid}", timeout=60))
        save_raw(SOURCE_ID, f"{pid}_entry.json", json.dumps(meta))
        loops = _loops(cif)
        n = 0
        seen_alt: set[tuple] = set()
        for a in loops["_atom_site"]:
            if a.get("pdbx_PDB_model_num", "1") != "1":
                continue
            res = a.get("auth_comp_id") or a["label_comp_id"]
            if res == "HOH":
                continue
            alt = a.get("label_alt_id", ".")
            key = (a["auth_asym_id"], a["auth_seq_id"], a.get("auth_atom_id") or a["label_atom_id"])
            if alt not in (".", "?"):
                if key in seen_alt:
                    continue
                seen_alt.add(key)
            atoms.append(
                {
                    "id": f"{pid}:{a['id']}",
                    "entryId": pid,
                    "serial": int(a["id"]),
                    "chain": a["auth_asym_id"],
                    "resSeq": int(a["auth_seq_id"]),
                    "resName": res,
                    "atomName": (a.get("auth_atom_id") or a["label_atom_id"]).strip('"'),
                    "element": a["type_symbol"],
                    "x": float(a["Cartn_x"]),
                    "y": float(a["Cartn_y"]),
                    "z": float(a["Cartn_z"]),
                    "occupancy": float(a["occupancy"]),
                    "bFactor": float(a["B_iso_or_equiv"]),
                    "hetero": a["group_PDB"] == "HETATM",
                }
            )
            n += 1
        for k, h in enumerate(loops.get("_struct_conf", [])):
            sse.append(
                {
                    "id": f"{pid}:H{k}",
                    "entryId": pid,
                    "chain": h["beg_auth_asym_id"],
                    "kind": "helix",
                    "startResSeq": int(h["beg_auth_seq_id"]),
                    "endResSeq": int(h["end_auth_seq_id"]),
                }
            )
        for k, s in enumerate(loops.get("_struct_sheet_range", [])):
            sse.append(
                {
                    "id": f"{pid}:S{k}",
                    "entryId": pid,
                    "chain": s["beg_auth_asym_id"],
                    "kind": "strand",
                    "startResSeq": int(s["beg_auth_seq_id"]),
                    "endResSeq": int(s["end_auth_seq_id"]),
                }
            )
        # Polymer entity descriptions → chain map.
        chains = []
        for ent_id in meta.get("rcsb_entry_container_identifiers", {}).get("polymer_entity_ids", []):
            pe = json.loads(http_get(f"{DATA_API}/polymer_entity/{pid}/{ent_id}", timeout=60))
            desc = pe.get("rcsb_polymer_entity", {}).get("pdbx_description", "")
            auth = pe.get("rcsb_polymer_entity_container_identifiers", {}).get("auth_asym_ids", [])
            org = (pe.get("rcsb_entity_source_organism") or [{}])[0].get("scientific_name", "")
            chains.append(f"{','.join(auth)}={desc}")
        ligands = sorted({a["resName"] for a in atoms if a["entryId"] == pid and a["hetero"]})
        # β6 validation: chain B residue 6.
        b6 = {a["resName"] for a in atoms if a["entryId"] == pid and a["chain"] == "B" and a["resSeq"] == 6}
        notes.append(f"{pid} chain B residue 6 = {','.join(sorted(b6)) or 'missing'}")
        res = meta.get("rcsb_entry_info", {}).get("resolution_combined") or [None]
        entries.append(
            {
                "id": pid,
                "title": meta.get("struct", {}).get("title", ""),
                "method": (meta.get("exptl") or [{}])[0].get("method", ""),
                "resolutionA": res[0],
                "depositDate": meta.get("rcsb_accession_info", {}).get("deposit_date", "")[:10],
                "organism": org if chains else "",
                "description": "Deoxy haemoglobin A (reference)" if pid == "4HHB" else
                "Deoxy haemoglobin S (sickle; β Glu6Val), polymer-contact crystal form",
                "atomCount": n,
                "chains": " | ".join(chains),
                "ligands": ",".join(ligands),
            }
        )
    ok = any("4HHB chain B residue 6 = GLU" in s for s in notes) and any("2HBS chain B residue 6 = VAL" in s for s in notes)
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="RCSB Protein Data Bank",
        category="biology",
        tables={"pdb_entry": entries, "pdb_atom": atoms, "pdb_secondary": sse},
        source_urls=[f"{FILES}/{p}.cif" for p in ENTRIES] + [DATA_API],
        release="PDB archive (live)",
        query=", ".join(ENTRIES),
        license="CC0 1.0 (PDB data)",
        attribution="RCSB PDB; Fermi & Perutz 1984 (4HHB); Harrington et al. 1997 (2HBS)",
        coverage=f"{len(entries)} entries, {len(atoms)} atoms, {len(sse)} secondary-structure ranges",
        units="Å (scientific storage converts to m only when needed)",
        frame="crystallographic orthogonal frame per entry",
        raw_checksums=checksums,
        validation_status="ok" if ok else "partial",
        note="; ".join(notes),
    )
