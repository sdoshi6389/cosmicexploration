"""PubChem PUG-REST: compound properties + 3D conformers (SDF) for the molecular layer.

Heme carries iron, and PubChem does not compute 3D conformers for such compounds;
its geometry comes from the crystallographic HEM ligand in 4HHB instead.
"""
from __future__ import annotations

import json
import time

from _common import http_get
from pipeline import SourceResult, save_raw

SOURCE_ID = "pubchem"
PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
COMPOUNDS = {
    977: "Oxygen",
    962: "Water",
    280: "Carbon dioxide",
    297: "Methane",
    783: "Hydrogen",
    5793: "Glucose",
    5957: "ATP",
    2519: "Caffeine",
    26945: "Heme",
    14811: "Tungsten trioxide",
    14805: "Nickel oxide",
}
PROPS = "MolecularFormula,MolecularWeight,IUPACName,SMILES"


def _sdf_atoms_bonds(sdf: str):
    lines = sdf.splitlines()
    counts = lines[3]
    na, nb = int(counts[0:3]), int(counts[3:6])
    atoms = []
    for ln in lines[4: 4 + na]:
        x, y, z = float(ln[0:10]), float(ln[10:20]), float(ln[20:30])
        atoms.append((ln[31:34].strip(), x, y, z))
    bonds = []
    for ln in lines[4 + na: 4 + na + nb]:
        bonds.append((int(ln[0:3]), int(ln[3:6]), int(ln[6:9])))
    return atoms, bonds


def run() -> SourceResult:
    mols, matoms, mbonds, checksums, notes = [], [], [], [], []
    for cid, name in COMPOUNDS.items():
        props = json.loads(http_get(f"{PUG}/compound/cid/{cid}/property/{PROPS}/JSON", timeout=60))
        save_raw(SOURCE_ID, f"cid{cid}_props.json", json.dumps(props))
        p = props["PropertyTable"]["Properties"][0]
        time.sleep(0.25)  # PUG-REST: ≤5 requests/s
        conformer = "none (PubChem does not generate 3D for this compound)"
        atoms, bonds = [], []
        try:
            sdf = http_get(f"{PUG}/compound/cid/{cid}/SDF?record_type=3d", timeout=60, retries=1).decode()
            _, cs = save_raw(SOURCE_ID, f"cid{cid}_3d.sdf", sdf)
            checksums.append(f"{cid}={cs}")
            atoms, bonds = _sdf_atoms_bonds(sdf)
            conformer = "PubChem3D computed conformer (model, not an observed geometry)"
        except Exception:
            notes.append(f"CID {cid} ({name}): no 3D conformer")
        time.sleep(0.25)
        mols.append(
            {
                "cid": cid,
                "name": name,
                "formula": p.get("MolecularFormula", ""),
                "molecularWeight": float(p.get("MolecularWeight", 0)),
                "iupacName": p.get("IUPACName", ""),
                "smiles": p.get("SMILES", "") or p.get("CanonicalSMILES", ""),
                "atomCount": len(atoms),
                "bondCount": len(bonds),
                "conformer": conformer,
            }
        )
        for i, (el, x, y, z) in enumerate(atoms):
            matoms.append({"id": f"{cid}:{i}", "cid": cid, "idx": i, "element": el, "x": x, "y": y, "z": z})
        for i, (a1, a2, order) in enumerate(bonds):
            mbonds.append({"id": f"{cid}:{i}", "cid": cid, "a1": a1 - 1, "a2": a2 - 1, "order": order})
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="PubChem PUG-REST",
        category="molecular",
        tables={"molecule": mols, "molecule_atom": matoms, "molecule_bond": mbonds},
        source_urls=[PUG],
        release="PubChem (live)",
        query=f"CIDs {', '.join(map(str, COMPOUNDS))}: {PROPS} + SDF record_type=3d",
        license="Public domain (NCBI PubChem)",
        attribution="Kim S, et al. PubChem 2025 update. Nucleic Acids Res.",
        coverage=f"{len(mols)} compounds, {len(matoms)} conformer atoms",
        units="Å, g/mol",
        frame="conformer-local Cartesian",
        raw_checksums=checksums,
        note="; ".join(notes),
    )
