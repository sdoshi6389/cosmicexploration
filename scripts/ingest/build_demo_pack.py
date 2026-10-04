#!/usr/bin/env python3
"""Assemble per-level normalized packs and demo_baseline.json for COSMOS."""
from __future__ import annotations

import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from _common import (
    DATA_MANIFESTS,
    DATA_NORMALIZED,
    ROOT,
    build_manifest,
    save_manifest,
    utc_now_iso,
    write_json,
)

GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
PDG_URL = "https://pdg.lbl.gov/"
HORIZONS_NORM = DATA_NORMALIZED / "horizons_solar_system.json"
PDB_NORM = DATA_NORMALIZED / "pdb_4hhb_ca.json"

# Rydberg energy using CODATA 2018 constants (derived)
RYDBERG_EV = 13.605693122994


def load_json(path: Path) -> dict | list | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def hydrogen_levels() -> list[dict]:
    levels = []
    for n in range(1, 6):
        e_ev = -RYDBERG_EV / (n * n)
        levels.append(
            {
                "n": n,
                "l": 0,
                "label": f"n={n}",
                "energyEv": e_ev,
                "evidence": {
                    "kind": "derived",
                    "method": "rydberg_formula",
                    "constants": "CODATA 2018 R∞, hc",
                    "sourceUrl": "https://physics.nist.gov/cuu/Constants/",
                },
            }
        )
    return levels


def pdg_particles() -> list[dict]:
    return [
        {
            "id": "particle.electron",
            "name": "electron",
            "symbol": "e⁻",
            "massMeV": 0.51099895000,
            "charge_e": -1,
            "evidence": {"kind": "observed", "sourceUrl": PDG_URL, "release": "PDG 2024 summary"},
        },
        {
            "id": "particle.positron",
            "name": "positron",
            "symbol": "e⁺",
            "massMeV": 0.51099895000,
            "charge_e": 1,
            "evidence": {"kind": "observed", "sourceUrl": PDG_URL, "release": "PDG 2024 summary"},
        },
        {
            "id": "particle.photon",
            "name": "photon",
            "symbol": "γ",
            "massMeV": 0,
            "charge_e": 0,
            "evidence": {"kind": "observed", "sourceUrl": PDG_URL, "release": "PDG 2024 summary"},
        },
    ]


def icrs_to_cartesian_m(ra_deg: float, dec_deg: float, distance_m: float) -> list[float]:
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    x = distance_m * math.cos(dec) * math.cos(ra)
    y = distance_m * math.cos(dec) * math.sin(ra)
    z = distance_m * math.sin(dec)
    return [x, y, z]


CURATED_NAMED_STARS = [
    ("star.sirius", "Sirius A", 101.287, -16.716, 8.6, 9.7e27),
    ("star.canopus", "Canopus", 95.988, -52.696, 310, 1.3e28),
    ("star.arcturus", "Arcturus", 213.915, 19.182, 37, 1.1e28),
    ("star.vega", "Vega", 279.235, 38.784, 25, 4.0e27),
    ("star.capella", "Capella", 79.172, 45.998, 42, 1.2e28),
    ("star.rigel", "Rigel", 78.634, -8.202, 860, 1.2e29),
    ("star.procyon", "Procyon", 114.825, 5.225, 11.4, 6.9e27),
    ("star.betelgeuse", "Betelgeuse", 88.793, 7.407, 640, 1.6e29),
    ("star.altair", "Altair", 297.696, 8.868, 16.7, 3.6e27),
    ("star.aldebaran", "Aldebaran", 68.980, 16.509, 65, 1.6e28),
    ("star.spica", "Spica", 201.298, -11.161, 250, 1.1e28),
    ("star.antares", "Antares", 247.352, -26.432, 550, 7.5e28),
    ("star.pollux", "Pollux", 116.329, 28.026, 33.8, 3.2e28),
    ("star.fomalhaut", "Fomalhaut", 344.413, -29.622, 25, 3.6e27),
    ("star.deneb", "Deneb", 310.358, 45.280, 2600, 1.9e29),
    ("star.regulus", "Regulus", 152.092, 11.967, 79, 2.9e28),
    ("star.mira", "Mira", 34.837, -2.978, 300, 5.0e28),
    ("star.polaris", "Polaris", 37.954, 89.264, 433, 4.7e28),
    ("star.sun_proxy", "Sun (local)", 0, 0, 1.496e11, 3.826e26),
]


def fetch_gaia_top100(timeout_s: float = 15.0) -> tuple[list[dict], str | None]:
    adql = (
        "SELECT TOP 100 source_id, ra, dec, parallax, phot_g_mean_mag "
        "FROM gaiadr3.gaia_source WHERE parallax > 5 AND phot_g_mean_mag < 12 "
        "ORDER BY phot_g_mean_mag"
    )
    body = urllib.parse.urlencode({"REQUEST": "sync", "FORMAT": "csv", "QUERY": adql}).encode()
    req = urllib.request.Request(
        GAIA_TAP,
        data=body,
        method="POST",
        headers={"User-Agent": "COSMOS-Ingest/1.0", "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            text = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as e:
        return [], str(e)

    lines = [ln for ln in text.strip().splitlines() if ln.strip()]
    if len(lines) < 2:
        return [], "empty or header-only Gaia response"
    header = [h.strip() for h in lines[0].split(",")]
    stars: list[dict] = []
    for line in lines[1:]:
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < len(header):
            continue
        row = dict(zip(header, parts))
        try:
            sid = row.get("source_id", "")
            ra = float(row["ra"])
            dec = float(row["dec"])
            plx = float(row["parallax"])
            mag = float(row.get("phot_g_mean_mag", "0") or "0")
        except (KeyError, ValueError):
            continue
        dist_pc = 1000.0 / plx if plx > 0 else None
        dist_m = dist_pc * 3.0856775814913673e16 if dist_pc else 10 * 3.0856775814913673e16
        pos = icrs_to_cartesian_m(ra, dec, dist_m)
        lum = 3.826e26 * 10 ** ((4.83 - mag) / 2.5) if mag else 3.826e26
        stars.append(
            {
                "id": f"gaia.{sid}",
                "sourceId": sid,
                "name": f"Gaia DR3 {sid}",
                "raDeg": ra,
                "decDeg": dec,
                "parallaxMas": plx,
                "photGMag": mag,
                "positionM": pos,
                "luminosityW": lum,
                "evidence": {"kind": "observed", "sourceId": "gaia_dr3", "method": "tap_sync_top100"},
            }
        )
    return stars, None


def curated_galaxy_sample() -> list[dict]:
    stars: list[dict] = []
    for sid, name, ra, dec, dist_ly, lum in CURATED_NAMED_STARS:
        dist_m = dist_ly * 9.4607304725808e15
        stars.append(
            {
                "id": sid,
                "name": name,
                "raDeg": ra,
                "decDeg": dec,
                "distanceLy": dist_ly,
                "positionM": icrs_to_cartesian_m(ra, dec, dist_m),
                "luminosityW": lum,
                "evidence": {
                    "kind": "assumed",
                    "sourceId": "curated_catalog",
                    "method": "named_star_approximate_icrs",
                    "assumptions": [
                        "Approximate RA/Dec and distance for demo navigation; not a full Gaia ingest.",
                    ],
                },
            }
        )
    return stars


def hbb_bio_pack() -> dict:
    before_window = "ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCC"
    after_window = "ATGGTGCATCTGACTCCTGGTGAGAAGTCTGCCGTTACTGCC"
    return {
        "schema": "cosmos.biology.hbb_sickle.v1",
        "gene": "HBB",
        "transcriptRef": "NM_000518.5 (beta-globin, representative)",
        "variant": {
            "name": "HbS / sickle cell",
            "rsId": "rs334",
            "proteinChange": "Glu6Val",
            "hgvsCoding": "c.20A>T",
            "mechanism": "GAG→GTG at codon 6",
        },
        "sequenceWindow": {
            "before": before_window,
            "after": after_window,
            "codon6Before": "GAG",
            "codon6After": "GTG",
        },
        "clinvarStyle": {
            "clinicalSignificance": "Pathogenic (educational reference)",
            "reviewStatus": "curated_demo",
            "condition": "Sickle cell disease (HBB-related)",
        },
        "structureLink": {"pdbId": "4HHB", "role": "deoxyhemoglobin tetramer context"},
        "evidence": {
            "kind": "assumed",
            "method": "curated_educational_reference",
            "notes": [
                "Sequence window aligned with engine HBB_SICKLE_REFERENCE_WINDOW; verify against NCBI RefSeq for production.",
            ],
        },
    }


def write_level_manifest(
    filename: str,
    manifest_id: str,
    norm_path: Path,
    source_urls: list[str],
    release: str,
    query: object,
    license_text: str,
    attribution: str,
    coverage: str,
    units: str,
    frame: str,
    validation_status: str,
) -> None:
    manifest = build_manifest(
        manifest_id=manifest_id,
        normalized_path=norm_path,
        source_urls=source_urls,
        release=release,
        query=query,
        license_text=license_text,
        attribution=attribution,
        coverage=coverage,
        units=units,
        frame=frame,
        validation_status=validation_status,
    )
    save_manifest(manifest, filename)


def main() -> int:
    DATA_NORMALIZED.mkdir(parents=True, exist_ok=True)
    retrieved = utc_now_iso()
    horizons = load_json(HORIZONS_NORM) or {}
    pdb = load_json(PDB_NORM)

    # --- K1 Earth ---
    earth_k1 = {
        "schema": "cosmos.level.k1.v1",
        "level": "K1",
        "entityId": "body.earth",
        "name": "Earth",
        "horizonsId": "399",
        "assumptions": {
            "albedo": {"value": 0.306, "evidence": {"kind": "assumed", "note": "CMIP/Earth-energy-budget style demo default"}},
            "emissivity": {"value": 0.96, "evidence": {"kind": "assumed"}},
        },
        "baselinePowerW": {
            "P0": 1.8e13,
            "label": "global primary energy consumption (order-of-magnitude)",
            "evidence": {
                "kind": "assumed",
                "note": "~1.8×10¹³ W ≈ 580 EJ/yr scale; editable in scenarios",
            },
        },
        "stateVector": horizons.get("bodies", {}).get("earth", {}).get("stateVector"),
        "evidenceNote": "Horizons state when fetch_horizons.py has been run",
    }
    p_k1 = DATA_NORMALIZED / "earth_k1.json"
    write_json(p_k1, earth_k1)
    write_level_manifest(
        "earth_k1.json",
        "manifest.level.earth_k1.v1",
        p_k1,
        [HORIZONS_NORM.as_posix(), "https://ssd.jpl.nasa.gov/horizons/"],
        "cosmos-demo-v1",
        {"level": "K1", "horizonsBody": "399"},
        "Mixed: NASA Horizons (vectors) + assumed planetary energy defaults",
        "NASA JPL Horizons; COSMOS demo assumptions",
        "Earth entity K1 intervention baseline",
        "m, W, dimensionless albedo/emissivity",
        "ICRF (when Horizons present)",
        "validated" if earth_k1.get("stateVector") else "partial",
    )

    # --- K2 Solar ---
    sun_body = horizons.get("bodies", {}).get("sun", {})
    solar_k2 = {
        "schema": "cosmos.level.k2.v1",
        "level": "K2",
        "sun": {
            "horizonsId": "10",
            "luminosityW": {
                "value": 3.826e26,
                "evidence": {"kind": "observed", "sourceId": "iau_solar_constant_scale", "note": "Standard solar luminosity L☉"},
            },
            "stateVector": sun_body.get("stateVector"),
        },
        "solarSystemBodies": {
            k: {
                "name": v.get("name"),
                "horizonsId": v.get("horizonsId"),
                "stateVector": v.get("stateVector"),
            }
            for k, v in horizons.get("bodies", {}).items()
        },
        "epochPin": horizons.get("epochPin"),
        "sourceHorizonsFile": str(HORIZONS_NORM.relative_to(ROOT)).replace("\\", "/"),
    }
    p_k2 = DATA_NORMALIZED / "solar_k2.json"
    write_json(p_k2, solar_k2)
    write_level_manifest(
        "solar_k2.json",
        "manifest.level.solar_k2.v1",
        p_k2,
        ["https://ssd.jpl.nasa.gov/api/horizons.api"],
        horizons.get("retrievedAt", "not_fetched"),
        {"level": "K2", "epochPin": horizons.get("epochPin")},
        "NASA/JPL Horizons — public domain U.S. government work",
        "NASA JPL SSD Horizons",
        "Sun + major bodies state vectors for Dyson/swarm context",
        "m, m/s, W",
        "ICRF",
        "validated" if sun_body else "pending_horizons_fetch",
    )

    # --- K3 Galaxy ---
    gaia_stars, gaia_err = fetch_gaia_top100()
    gaia_mode = "gaia_tap"
    if not gaia_stars:
        gaia_stars = curated_galaxy_sample()
        gaia_mode = "curated_fallback"
    galaxy_k3 = {
        "schema": "cosmos.level.k3.v1",
        "level": "K3",
        "galaxyContextId": "catalog.milky_way",
        "sampleMode": gaia_mode,
        "gaiaError": gaia_err,
        "starCount": len(gaia_stars),
        "stars": gaia_stars,
        "coverageNote": "TOP 100 bright nearby Gaia DR3 sources, or curated named-star fallback",
    }
    p_k3 = DATA_NORMALIZED / "galaxy_k3.json"
    write_json(p_k3, galaxy_k3)
    write_level_manifest(
        "galaxy_k3.json",
        "manifest.level.galaxy_k3.v1",
        p_k3,
        [GAIA_TAP] if gaia_mode == "gaia_tap" else ["curated_named_stars"],
        "Gaia DR3" if gaia_mode == "gaia_tap" else "curated-v1",
        {"mode": gaia_mode, "adql": "TOP 100 parallax>5" if gaia_mode == "gaia_tap" else "named list"},
        "Gaia ESA — credit Gaia Collaboration; curated fallback is demo-only",
        "ESA Gaia DPAC / COSMOS curated fallback",
        f"{len(gaia_stars)} stars for K3 navigation sample",
        "m, W, deg",
        "ICRS",
        "validated" if gaia_mode == "gaia_tap" else "partial_assumed",
    )

    # --- B2 Bio ---
    bio_b2 = hbb_bio_pack()
    if pdb:
        bio_b2["structure"] = {"pdbNormalized": "pdb_4hhb_ca.json", "atomCount": pdb.get("atomCount")}
    p_b2 = DATA_NORMALIZED / "bio_b2.json"
    write_json(p_b2, bio_b2)
    write_level_manifest(
        "bio_b2.json",
        "manifest.level.bio_b2.v1",
        p_b2,
        ["https://www.ncbi.nlm.nih.gov/gene/3043", "https://www.ncbi.nlm.nih.gov/clinvar/variation/50623/"],
        "curated-educational-v1",
        {"gene": "HBB", "variant": "rs334"},
        "NCBI/ClinVar references — educational demo; not clinical advice",
        "NCBI RefSeq / ClinVar style metadata",
        "HBB sickle cell counterfactual window",
        "nucleotides",
        "N/A",
        "validated",
    )

    # --- B4 Atom ---
    atom_b4 = {
        "schema": "cosmos.level.b4.v1",
        "level": "B4",
        "element": "H",
        "levels": hydrogen_levels(),
        "method": f"E_n = -{RYDBERG_EV} eV / n² (Rydberg, infinite mass approx.)",
    }
    p_b4 = DATA_NORMALIZED / "atom_b4.json"
    write_json(p_b4, atom_b4)
    write_level_manifest(
        "atom_b4.json",
        "manifest.level.atom_b4.v1",
        p_b4,
        ["https://physics.nist.gov/cuu/Constants/"],
        "CODATA 2018 derived",
        {"element": "H", "n": "1..5"},
        "NIST CODATA constants — public domain",
        "NIST Physical Measurement Laboratory",
        "Hydrogen n=1..5 energies",
        "eV",
        "N/A",
        "validated",
    )

    # --- B6 Particle ---
    particle_b6 = {
        "schema": "cosmos.level.b6.v1",
        "level": "B6",
        "particles": pdg_particles(),
    }
    p_b6 = DATA_NORMALIZED / "particle_b6.json"
    write_json(p_b6, particle_b6)
    write_level_manifest(
        "particle_b6.json",
        "manifest.level.particle_b6.v1",
        p_b6,
        [PDG_URL],
        "PDG 2024 summary values",
        {"particles": ["electron", "positron", "photon"]},
        "PDG — cite Particle Data Group",
        "Particle Data Group (LBL)",
        "Sandbox particle properties",
        "MeV, e",
        "N/A",
        "validated",
    )

    # --- B5 Nuclear context placeholder ---
    nuclear_b5 = {
        "schema": "cosmos.level.b5_context.v1",
        "level": "B5",
        "isotope": "Fe-56",
        "placeholder": True,
        "properties": {
            "Z": 26,
            "N": 30,
            "A": 56,
            "bindingEnergyPerNucleonMeV": {"value": 8.79, "evidence": {"kind": "assumed", "note": "textbook-scale placeholder"}},
        },
        "evidence": {
            "kind": "assumed",
            "method": "placeholder_until_nndc_ingest",
            "futureSource": "NNDC / NuDat",
        },
    }
    p_b5 = DATA_NORMALIZED / "nuclear_b5_context.json"
    write_json(p_b5, nuclear_b5)
    write_level_manifest(
        "nuclear_b5_context.json",
        "manifest.level.nuclear_b5.v1",
        p_b5,
        ["https://www.nndc.bnl.gov/nudat3/"],
        "placeholder-v1",
        {"isotope": "Fe-56"},
        "NNDC — future ingest",
        "NNDC placeholder",
        "Semantic traversal context only",
        "MeV, dimensionless Z/N/A",
        "N/A",
        "placeholder",
    )

    # --- demo_baseline assembly ---
    demo = {
        "schema": "cosmos.demo_baseline.v1",
        "id": "cosmos-demo-v1",
        "version": "1.0.0",
        "assembledAt": retrieved,
        "levels": {
            "K1": "earth_k1.json",
            "K2": "solar_k2.json",
            "K3": "galaxy_k3.json",
            "B2": "bio_b2.json",
            "B4": "atom_b4.json",
            "B5": "nuclear_b5_context.json",
            "B6": "particle_b6.json",
        },
        "ingestStatus": {
            "horizons": HORIZONS_NORM.is_file(),
            "pdb4hhb": PDB_NORM.is_file(),
            "galaxyMode": gaia_mode,
        },
        "voicePolicy": "Grok Voice is mandatory for K1–K3 and B2/B4/B6; supersedes any optional Voice wording in DESIGN.md.",
        "snapshotEpoch": horizons.get("epochPin", {"start": "2025-01-01"}),
    }
    p_demo = DATA_NORMALIZED / "demo_baseline.json"
    write_json(p_demo, demo)
    write_level_manifest(
        "demo_baseline.json",
        "manifest.demo_baseline.v1",
        p_demo,
        [str(ROOT / "scripts" / "ingest" / "build_demo_pack.py")],
        "1.0.0",
        {"assembler": "build_demo_pack.py"},
        "COSMOS demo bundle",
        "COSMOS ingest",
        "Index of all level packs",
        "mixed",
        "mixed",
        "validated",
    )

    print(f"Galaxy sample: {gaia_mode} ({len(gaia_stars)} stars)")
    if gaia_err:
        print(f"  Gaia note: {gaia_err}")
    print(f"Assembled demo_baseline.json and level packs in {DATA_NORMALIZED}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
