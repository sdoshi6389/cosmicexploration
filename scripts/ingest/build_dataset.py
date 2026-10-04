#!/usr/bin/env python3
"""Assemble CosmosDataset from whatever normalized files exist."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from _common import (
    DATA_NORMALIZED,
    DATA_MANIFESTS,
    WEB_DATA,
    DATASET_VERSION,
    utc_now_iso,
    write_json,
    manifest_entry,
    save_manifest,
)

ROOT = Path(__file__).resolve().parents[2]


def load(name: str):
    p = DATA_NORMALIZED / name
    if not p.is_file():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def main() -> int:
    stars = load("stars_gaia_dr3.json") or load("galaxy_k3.json")
    if stars and "stars" not in stars and "starCount" not in stars:
        # galaxy_k3 pack shape
        raw = stars.get("stars") or []
        stars = {
            "id": "stars.fallback",
            "mode": stars.get("sampleMode", "curated_fallback"),
            "starCount": len(raw),
            "selectionFunction": "Normalized from galaxy_k3 pack or Gaia ingest.",
            "stars": raw,
            "sourceUrls": [],
            "retrievedAt": utc_now_iso(),
        }

    solar = load("horizons_solar_system.json") or load("solar_k2.json")
    earth = load("earth_k1_full.json") or load("earth_k1.json")
    protein = load("pdb_4hhb_backbone.json") or load("pdb_4hhb_ca.json")
    gene = load("bio_b2.json")
    atom = load("atom_b4.json")
    particles = load("particle_b6.json")
    isotopes = load("nuclear_b5_context.json")
    exo = load("exoplanets.json")

    manifests = []
    for mf in DATA_MANIFESTS.glob("*.json"):
        try:
            manifests.append(json.loads(mf.read_text(encoding="utf-8")))
        except Exception:
            pass
    if not manifests:
        manifests.append(
            manifest_entry(
                source_id="local-assembly",
                source_urls=[],
                release=DATASET_VERSION,
                query=None,
                validation_status="partial",
                note="Assembled from available normalized files.",
            )
        )

    bundle = {
        "version": DATASET_VERSION,
        "assembledAt": utc_now_iso(),
        "origin": "local-cache",
        "stars": stars,
        "solarSystem": solar if solar and "bodies" in solar else None,
        "earth": earth if earth and "id" in earth and "anchors" in earth else None,
        "protein": protein if protein and "atoms" in protein else None,
        "gene": gene if gene and "cdsSequence" in gene else None,
        "atom": atom if atom and "levels" in atom else None,
        "particles": particles if particles and "particles" in particles else None,
        "isotopes": isotopes if isinstance(isotopes, list) else [],
        "exoplanets": exo if isinstance(exo, list) else [],
        "manifests": manifests,
    }

    out1 = DATA_NORMALIZED / "cosmos_dataset.json"
    write_json(out1, bundle, compact=True)
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(out1, WEB_DATA / "cosmos_dataset.json")
    save_manifest(
        manifest_entry(
            source_id="cosmos-dataset-bundle",
            source_urls=["local://data/normalized/cosmos_dataset.json"],
            release=DATASET_VERSION,
            query="build_dataset.py",
            validation_status="partial" if not stars else "ok",
            note=f"stars={bundle['stars']['starCount'] if bundle['stars'] else 0}",
        ),
        "cosmos_dataset.json",
    )
    print(f"wrote {out1} ({out1.stat().st_size/1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
