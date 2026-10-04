"""Curated globin targets shared by the NCBI, Ensembl and ClinVar adapters.

HBB is the B2 edit target; HBA1 supplies the α chains of the same 4HHB tetramer.
RefSeq accessions are the MANE Select transcripts/proteins.
"""

GENES = [
    {"symbol": "HBB", "geneId": "3043", "refseqTranscript": "NM_000518", "refseqProtein": "NP_000509"},
    {"symbol": "HBA1", "geneId": "3039", "refseqTranscript": "NM_000558", "refseqProtein": "NP_000549"},
]

# rsId, curated label, HGVS c. on the HBB MANE transcript (used to pick the single-variant ClinVar record)
HBB_VARIANTS = [
    ("rs334", "HbS (sickle)", "c.20A>T"),
    ("rs33930165", "HbC", "c.19G>A"),
    ("rs33950507", "HbE", "c.79G>A"),
    ("rs11549407", "β⁰-thalassaemia (Gln40Ter)", "c.118C>T"),
    ("rs35004220", "β⁺-thalassaemia (IVS-I-110)", "c.93-21G>A"),
]
