"""Ensembl REST: canonical transcript CDS + protein, cross-validated against RefSeq."""
from __future__ import annotations

import json
import time

from _common import http_get
from pipeline import BY_SOURCE_DIR, SourceResult, save_raw
from sources.genes import GENES

SOURCE_ID = "ensembl_rest"
API = "https://rest.ensembl.org"


def _get(path: str, ctype: str = "application/json"):
    sep = "&" if "?" in path else "?"
    raw = http_get(f"{API}{path}{sep}content-type={ctype}", timeout=60)
    time.sleep(0.15)  # Ensembl: 15 requests/s limit
    return raw


def run() -> SourceResult:
    refseq = {}
    p = BY_SOURCE_DIR / "ncbi_datasets" / "sequence_record.json"
    if p.exists():
        for r in json.loads(p.read_text(encoding="utf-8")):
            refseq[(r["geneSymbol"], r["kind"])] = r["sequence"]
    seqs, checksums, notes = [], [], []
    status = "ok"
    for g in GENES:
        raw = _get(f"/lookup/symbol/homo_sapiens/{g['symbol']}?expand=0")
        _, cs = save_raw(SOURCE_ID, f"lookup_{g['symbol']}.json", raw)
        checksums.append(cs)
        info = json.loads(raw)
        tx = info["canonical_transcript"].split(".")[0]
        cds = _get(f"/sequence/id/{tx}?type=cds", "text/plain").decode().strip()
        prot = _get(f"/sequence/id/{tx}?type=protein", "text/plain").decode().strip()
        save_raw(SOURCE_ID, f"{tx}_cds.txt", cds)
        ref_cds = refseq.get((g["symbol"], "cds"))
        match = ref_cds == cds if ref_cds else None
        if match is False:
            status = "partial"
        notes.append(f"{g['symbol']} {tx} CDS {'== RefSeq' if match else '≠ RefSeq' if match is False else 'unchecked'}")
        seqs.append(
            {"accession": info["canonical_transcript"] + ":cds", "geneSymbol": g["symbol"], "kind": "cds",
             "length": len(cds), "sequence": cds,
             "source": f"Ensembl canonical transcript ({info.get('assembly_name', 'GRCh38')})",
             "release": info["canonical_transcript"]}
        )
        seqs.append(
            {"accession": info["canonical_transcript"] + ":protein", "geneSymbol": g["symbol"],
             "kind": "protein", "length": len(prot), "sequence": prot,
             "source": "Ensembl canonical translation", "release": info["canonical_transcript"]}
        )
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="Ensembl REST API",
        category="biology",
        tables={"sequence_record": seqs},
        source_urls=[API],
        release="Ensembl (live, GRCh38)",
        query="; ".join(f"lookup/symbol/homo_sapiens/{g['symbol']} → sequence/id/<canonical>?type=cds|protein" for g in GENES),
        license="Ensembl: no restrictions (Apache 2.0 software, open data)",
        attribution="Ensembl, EMBL-EBI",
        coverage=f"{len(seqs)} sequences",
        units="bases / residues",
        frame="GRCh38",
        raw_checksums=checksums,
        validation_status=status,
        note="; ".join(notes),
    )
