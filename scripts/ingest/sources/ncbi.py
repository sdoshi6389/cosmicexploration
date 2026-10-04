"""NCBI Datasets (gene reports) + E-utilities (RefSeq CDS / protein FASTA)."""
from __future__ import annotations

import json
import time

from _common import http_get
from pipeline import SourceResult, save_raw
from sources.genes import GENES

SOURCE_ID = "ncbi_datasets"
DATASETS = "https://api.ncbi.nlm.nih.gov/datasets/v2/gene/id"
EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"


def fasta(db: str, acc: str, rettype: str) -> tuple[str, str]:
    raw = http_get(f"{EFETCH}?db={db}&id={acc}&rettype={rettype}&retmode=text", timeout=60).decode()
    time.sleep(0.4)  # E-utilities: ≤3 requests/s without an API key
    lines = raw.strip().splitlines()
    return lines[0], "".join(ln.strip() for ln in lines[1:])


def run() -> SourceResult:
    genes, seqs, checksums = [], [], []
    for g in GENES:
        raw = http_get(f"{DATASETS}/{g['geneId']}", timeout=60)
        _, cs = save_raw(SOURCE_ID, f"gene_{g['geneId']}.json", raw)
        checksums.append(cs)
        rep = json.loads(raw)["reports"][0]["gene"]
        loc = (rep.get("annotations") or [{}])[0].get("genomic_locations", [{}])[0]
        rng = loc.get("genomic_range", {})
        summary = (rep.get("summary") or [{}])[0].get("description", "")

        cds_header, cds = fasta("nuccore", g["refseqTranscript"], "fasta_cds_na")
        prot_header, prot = fasta("protein", g["refseqProtein"], "fasta")
        save_raw(SOURCE_ID, f"{g['symbol']}_cds.fasta", f"{cds_header}\n{cds}\n")
        save_raw(SOURCE_ID, f"{g['symbol']}_protein.fasta", f"{prot_header}\n{prot}\n")
        tx_ver = cds_header.split("|")[1].split("_cds")[0] if "|" in cds_header else g["refseqTranscript"]
        prot_ver = prot_header[1:].split()[0]
        # Validate: the CDS must translate to the RefSeq protein length (+ stop codon).
        if len(cds) != (len(prot) + 1) * 3:
            raise ValueError(f"{g['symbol']}: CDS length {len(cds)} != 3×(protein {len(prot)} + stop)")

        genes.append(
            {
                "id": g["symbol"],
                "geneId": rep["gene_id"],
                "symbol": rep["symbol"],
                "description": rep.get("description", ""),
                "chromosome": (rep.get("chromosomes") or [""])[0],
                "mapLocation": (rep.get("map_locations") or [""])[0] if isinstance(rep.get("map_locations"), list) else "",
                "assembly": loc.get("genomic_accession_version", "GRCh38"),
                "startPos": int(rng["begin"]) if rng.get("begin") else None,
                "endPos": int(rng["end"]) if rng.get("end") else None,
                "strand": -1 if rng.get("orientation") == "minus" else 1,
                "ensemblGeneId": (rep.get("ensembl_gene_ids") or [""])[0],
                "refseqTranscript": tx_ver,
                "refseqProtein": prot_ver,
                "ensemblTranscript": "",
                "summary": summary[:1200],
            }
        )
        seqs.append(
            {"accession": tx_ver + ":cds", "geneSymbol": g["symbol"], "kind": "cds", "length": len(cds),
             "sequence": cds, "source": "NCBI RefSeq (E-utilities efetch fasta_cds_na)", "release": tx_ver}
        )
        seqs.append(
            {"accession": prot_ver, "geneSymbol": g["symbol"], "kind": "protein", "length": len(prot),
             "sequence": prot, "source": "NCBI RefSeq protein (E-utilities efetch fasta)", "release": prot_ver}
        )
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NCBI Datasets + E-utilities",
        category="biology",
        tables={"gene_record": genes, "sequence_record": seqs},
        source_urls=[DATASETS, EFETCH],
        release="NCBI Gene / RefSeq (live); assembly GRCh38.p14",
        query="; ".join(f"gene {g['geneId']}, {g['refseqTranscript']} CDS, {g['refseqProtein']}" for g in GENES),
        license="Public domain (NCBI)",
        attribution="National Center for Biotechnology Information",
        coverage=f"{len(genes)} genes, {len(seqs)} sequences",
        units="bases / residues; GRCh38 1-based coordinates",
        frame="GRCh38",
        raw_checksums=checksums,
    )
