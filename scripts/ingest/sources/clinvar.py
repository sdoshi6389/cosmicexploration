"""ClinVar (E-utilities) + Ensembl variation: curated HBB variants.

For each rsID the single-variant ClinVar record on the HBB MANE transcript is
selected (compound haplotype records are skipped). The reference base at the HGVS
c. position is validated against the RefSeq CDS before codons are derived.
"""
from __future__ import annotations

import json
import re
import time

from _common import http_get
from pipeline import BY_SOURCE_DIR, SourceResult, save_raw
from sources.genes import HBB_VARIANTS

SOURCE_ID = "ncbi_clinvar"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
ENSEMBL = "https://rest.ensembl.org/variation/human"

AA3 = {
    "TTT": "Phe", "TTC": "Phe", "TTA": "Leu", "TTG": "Leu", "CTT": "Leu", "CTC": "Leu", "CTA": "Leu",
    "CTG": "Leu", "ATT": "Ile", "ATC": "Ile", "ATA": "Ile", "ATG": "Met", "GTT": "Val", "GTC": "Val",
    "GTA": "Val", "GTG": "Val", "TCT": "Ser", "TCC": "Ser", "TCA": "Ser", "TCG": "Ser", "CCT": "Pro",
    "CCC": "Pro", "CCA": "Pro", "CCG": "Pro", "ACT": "Thr", "ACC": "Thr", "ACA": "Thr", "ACG": "Thr",
    "GCT": "Ala", "GCC": "Ala", "GCA": "Ala", "GCG": "Ala", "TAT": "Tyr", "TAC": "Tyr", "TAA": "Ter",
    "TAG": "Ter", "CAT": "His", "CAC": "His", "CAA": "Gln", "CAG": "Gln", "AAT": "Asn", "AAC": "Asn",
    "AAA": "Lys", "AAG": "Lys", "GAT": "Asp", "GAC": "Asp", "GAA": "Glu", "GAG": "Glu", "TGT": "Cys",
    "TGC": "Cys", "TGA": "Ter", "TGG": "Trp", "CGT": "Arg", "CGC": "Arg", "CGA": "Arg", "CGG": "Arg",
    "AGT": "Ser", "AGC": "Ser", "AGA": "Arg", "AGG": "Arg", "GGT": "Gly", "GGC": "Gly", "GGA": "Gly",
    "GGG": "Gly",
}


def _json(url: str) -> dict:
    d = json.loads(http_get(url, timeout=60))
    time.sleep(0.4)
    return d


def run() -> SourceResult:
    cds_rows = json.loads((BY_SOURCE_DIR / "ncbi_datasets" / "sequence_record.json").read_text(encoding="utf-8"))
    cds = next(r["sequence"] for r in cds_rows if r["geneSymbol"] == "HBB" and r["kind"] == "cds")
    rows, checksums, notes = [], [], []
    for rs, label, hgvs_c in HBB_VARIANTS:
        ens = _json(f"{ENSEMBL}/{rs}?content-type=application/json")
        save_raw(SOURCE_ID, f"ensembl_{rs}.json", json.dumps(ens))
        mapping = next((m for m in ens.get("mappings", []) if m.get("assembly_name") == "GRCh38"), {})

        ids = _json(f"{EUTILS}/esearch.fcgi?db=clinvar&term={rs}&retmode=json&retmax=50")["esearchresult"]["idlist"]
        summ = _json(f"{EUTILS}/esummary.fcgi?db=clinvar&id={','.join(ids)}&retmode=json")["result"]
        _, cs = save_raw(SOURCE_ID, f"clinvar_{rs}.json", json.dumps(summ))
        checksums.append(f"{rs}={cs}")
        pick = None
        for i in ids:
            r = summ.get(i, {})
            title = r.get("title", "")
            if "(HBB)" in title and f"{hgvs_c}" in title and "[" not in title:
                pick = r
                break
        if pick is None:
            notes.append(f"{rs}: no single-variant ClinVar record matched {hgvs_c}")
            continue
        cls = pick.get("germline_classification") or {}
        traits = sorted({t.get("trait_name", "") for t in cls.get("trait_set", []) if t.get("trait_name")})

        m = re.match(r"c\.(\d+)([ACGT])>([ACGT])$", hgvs_c)
        cds_pos = codon_ref = codon_alt = None
        protein_change = pick.get("protein_change") or ""
        if m:
            cds_pos, ref, alt = int(m.group(1)), m.group(2), m.group(3)
            if cds[cds_pos - 1] != ref:
                raise ValueError(f"{rs}: RefSeq CDS base {cds[cds_pos - 1]} ≠ HGVS ref {ref} at c.{cds_pos}")
            ci = (cds_pos - 1) // 3
            codon_ref = cds[ci * 3: ci * 3 + 3]
            off = (cds_pos - 1) % 3
            codon_alt = codon_ref[:off] + alt + codon_ref[off + 1:]
            # HGVS counts Met1; mature-protein (legacy) numbering drops it.
            protein_change = protein_change or f"{AA3[codon_ref]}{ci + 1}{AA3[codon_alt]}"
            notes.append(f"{rs} {hgvs_c}: codon {ci + 1} {codon_ref}->{codon_alt} "
                         f"({AA3[codon_ref]}->{AA3[codon_alt]}; legacy residue {ci})")
        rows.append(
            {
                "id": rs,
                "geneSymbol": "HBB",
                "rsId": rs,
                "clinvarId": pick.get("accession", ""),
                "hgvsC": hgvs_c,
                "hgvsP": protein_change,
                "proteinChange": label,
                "chromosome": mapping.get("seq_region_name", "11"),
                "positionGrch38": mapping.get("start"),
                "refAllele": (mapping.get("allele_string") or "/").split("/")[0],
                "altAllele": "/".join((mapping.get("allele_string") or "/").split("/")[1:]),
                "cdsPosition": cds_pos,
                "codonRef": codon_ref or "",
                "codonAlt": codon_alt or "",
                "consequence": ens.get("most_severe_consequence", ""),
                "clinicalSignificance": cls.get("description", ""),
                "reviewStatus": cls.get("review_status", ""),
                "conditions": "|".join(traits),
                "source": "ClinVar esummary + Ensembl variation (GRCh38)",
            }
        )
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NCBI ClinVar + Ensembl Variation",
        category="biology",
        tables={"variant_record": rows},
        source_urls=[f"{EUTILS}/esummary.fcgi?db=clinvar", ENSEMBL],
        release="ClinVar (live) / Ensembl (live)",
        query="; ".join(f"{rs} {c}" for rs, _, c in HBB_VARIANTS),
        license="ClinVar: public domain; Ensembl: open",
        attribution="NCBI ClinVar; Ensembl, EMBL-EBI",
        coverage=f"{len(rows)} curated HBB variants",
        units="GRCh38 1-based; HGVS on MANE transcript",
        frame="GRCh38 / NM_000518",
        raw_checksums=checksums,
        note="; ".join(notes),
        validation_status="ok" if len(rows) == len(HBB_VARIANTS) else "partial",
    )
