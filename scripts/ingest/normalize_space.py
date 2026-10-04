#!/usr/bin/env python3
"""Turn cached science files into row-shaped tables the app and SpacetimeDB share."""
from __future__ import annotations

import json
import math
from pathlib import Path

from _common import DATA_NORMALIZED, WEB_DATA, write_json

AU = 1.495978707e11
LSUN = 3.828e26

SOLAR_META = {
    "sun": {"kind": "star", "radiusM": 6.96e8, "massKg": 1.9885e30, "luminosityW": LSUN, "orbitPeriodDays": 0, "colorHex": "#ffd27e"},
    "mercury": {"kind": "planet", "radiusM": 2.4397e6, "massKg": 3.301e23, "luminosityW": 0, "orbitPeriodDays": 87.97, "colorHex": "#b1b1b1"},
    "venus": {"kind": "planet", "radiusM": 6.0518e6, "massKg": 4.867e24, "luminosityW": 0, "orbitPeriodDays": 224.7, "colorHex": "#e3c16f"},
    "earth": {"kind": "planet", "radiusM": 6.371e6, "massKg": 5.972e24, "luminosityW": 0, "orbitPeriodDays": 365.25, "colorHex": "#4a90c2"},
    "moon": {"kind": "moon", "radiusM": 1.737e6, "massKg": 7.342e22, "luminosityW": 0, "orbitPeriodDays": 27.32, "colorHex": "#c9c9c9"},
    "mars": {"kind": "planet", "radiusM": 3.3895e6, "massKg": 6.417e23, "luminosityW": 0, "orbitPeriodDays": 686.98, "colorHex": "#c96a4a"},
    "jupiter": {"kind": "planet", "radiusM": 6.9911e7, "massKg": 1.898e27, "luminosityW": 0, "orbitPeriodDays": 4332.6, "colorHex": "#d4a574"},
    "saturn": {"kind": "planet", "radiusM": 5.8232e7, "massKg": 5.683e26, "luminosityW": 0, "orbitPeriodDays": 10759, "colorHex": "#e6d5a8"},
    "uranus": {"kind": "planet", "radiusM": 2.5362e7, "massKg": 8.681e25, "luminosityW": 0, "orbitPeriodDays": 30687, "colorHex": "#7ec8d8"},
    "neptune": {"kind": "planet", "radiusM": 2.4622e7, "massKg": 1.024e26, "luminosityW": 0, "orbitPeriodDays": 60190, "colorHex": "#4169e1"},
}

# Published-mean heliocentric positions (AU, ecliptic J2000-ish) used only if Horizons
# did not return that body. Marked assumed.
FALLBACK_AU = {
    "saturn": (-8.8, 4.2, 0.3),
    "uranus": (13.4, 13.8, -0.1),
    "neptune": (29.7, -5.6, -0.5),
}


def load(name: str):
    p = DATA_NORMALIZED / name
    if not p.is_file():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def orbit_path(x: float, y: float, z: float, n: int = 96) -> list[list[float]]:
    r = math.sqrt(x * x + y * y)
    if r < 1e6:
        return []
    out = []
    for i in range(n + 1):
        th = 2 * math.pi * i / n
        out.append([r * math.cos(th), r * math.sin(th), z * 0.15])
    return out


def solar_bodies() -> list[dict]:
    raw = load("horizons_solar_system.json") or {}
    src = raw.get("bodies") or {}
    rows = []
    keys = list(SOLAR_META.keys())
    for key in keys:
        meta = SOLAR_META[key]
        rec = src.get(key) if isinstance(src, dict) else None
        pos = [0.0, 0.0, 0.0]
        vel = [0.0, 0.0, 0.0]
        epoch = "2025-01-01T00:00:00Z"
        evidence = "assumed"
        source = "iau-mean-elements"
        if rec:
            sv = rec.get("stateVector") or {}
            pos = [float(v) for v in (sv.get("positionM") or pos)]
            vel = [float(v) for v in (sv.get("velocityMps") or vel)]
            epoch = str(sv.get("epoch") or rec.get("epoch") or epoch)
            evidence = "observed"
            source = "jpl-horizons"
        elif key in FALLBACK_AU:
            ax, ay, az = FALLBACK_AU[key]
            pos = [ax * AU, ay * AU, az * AU]
        rows.append(
            {
                "id": f"body.{key}",
                "name": key.capitalize() if key != "sun" else "Sun",
                "horizonsId": rec.get("horizonsId") if rec else "",
                "kind": meta["kind"],
                "radiusM": meta["radiusM"],
                "massKg": meta["massKg"],
                "positionM": pos,
                "velocityMps": vel,
                "xM": pos[0],
                "yM": pos[1],
                "zM": pos[2],
                "vxMps": vel[0],
                "vyMps": vel[1],
                "vzMps": vel[2],
                "luminosityW": meta["luminosityW"],
                "orbitPeriodDays": meta["orbitPeriodDays"],
                "orbitPathM": orbit_path(*pos),
                "colorHex": meta["colorHex"],
                "epoch": epoch,
                "frame": "ICRF",
                "evidenceKind": evidence,
                "sourceId": source,
                "sourceUrl": "https://ssd.jpl.nasa.gov/api/horizons.api" if evidence == "observed" else "",
                "retrievedAt": raw.get("retrievedAt") or "",
            }
        )
    for extra in load("catalog_extra_solar.json") or []:
        pos = [float(extra.get("xM") or 0), float(extra.get("yM") or 0), float(extra.get("zM") or 0)]
        extra["positionM"] = pos
        extra["velocityMps"] = [0.0, 0.0, 0.0]
        extra["orbitPathM"] = orbit_path(*pos)
        extra.setdefault("sourceUrl", "")
        extra.setdefault("retrievedAt", "")
        rows.append(extra)
    return rows


def star_rows() -> list[dict]:
    catalog = load("catalog_stars.json")
    if catalog:
        return catalog
    pack = load("stars_gaia_dr3.json") or {}
    out = []
    for s in pack.get("stars") or []:
        sid = s.get("id") or ""
        name = s.get("name") or sid
        x, y, z = float(s.get("x") or 0), float(s.get("y") or 0), float(s.get("z") or 0)
        dist = float(s.get("distanceM") or 0)
        lum = float(s.get("luminosityW") or 0)
        if sid in ("star.sol", "star_sol") or name.lower() in ("sol", "sun"):
            x = y = z = dist = 0.0
            lum = LSUN
        out.append(
            {
                "id": sid,
                "name": name,
                "raDeg": float(s.get("raDeg") or 0),
                "decDeg": float(s.get("decDeg") or 0),
                "distanceM": dist,
                "parallaxMas": float(s.get("parallaxMas") or 0),
                "x": x,
                "y": y,
                "z": z,
                "luminosityW": lum,
                "teffK": float(s.get("teffK") or 0),
                "colorHex": s.get("colorHex") or "#ffffff",
                "absMagG": s.get("absMagG"),
                "bpRp": s.get("bpRp"),
                "evidenceKind": s.get("evidenceKind") or "observed",
                "sourceId": s.get("sourceId") or "curated-bright-stars",
                "sourceUrl": s.get("sourceUrl") or "",
                "retrievedAt": s.get("retrievedAt") or "",
            }
        )
    return out


def earth_pack() -> dict:
    e = load("earth_k1_full.json") or load("earth_k1.json") or {}
    anchors = list(e.get("anchors") or [])
    seen = {a.get("id") for a in anchors}
    for extra in load("catalog_cities.json") or []:
        if extra.get("id") not in seen:
            anchors.append(extra)
            seen.add(extra.get("id"))
    energy = list(e.get("energyMix") or [])
    extra_energy = [
        {"source": "oil", "capacityW": 2.0e12, "generationW": 1.1e13, "capacityFactor": 0.55},
        {"source": "geothermal", "capacityW": 1.6e10, "generationW": 9.0e10, "capacityFactor": 0.75},
        {"source": "biomass", "capacityW": 1.4e11, "generationW": 6.5e11, "capacityFactor": 0.55},
        {"source": "tidal", "capacityW": 1.2e9, "generationW": 1.0e9, "capacityFactor": 0.25},
    ]
    have = {row.get("source") for row in energy}
    for row in extra_energy:
        if row["source"] not in have:
            energy.append(row)
    return {
        "constant": {
            "id": "earth",
            "radiusM": float(e.get("radiusM") or 6.371e6),
            "massKg": float(e.get("massKg") or 5.972e24),
            "albedo": float(e.get("albedo") or 0.306),
            "emissivity": float(e.get("emissivity") or 0.95),
            "solarConstantWm2": float(e.get("solarConstantWm2") or 1361),
            "greenhouseOffsetK": float(e.get("greenhouseOffsetK") or 33),
            "observedMeanSurfaceTempK": float(e.get("observedMeanSurfaceTempK") or 288),
            "baselinePrimaryPowerW": float(e.get("baselinePrimaryPowerW") or 1.9e13),
            "evidenceKind": e.get("evidenceKind") or "assumed",
            "sourceId": e.get("sourceId") or "iau-earth",
        },
        "anchors": anchors,
        "energy": energy,
        "textures": e.get("textures") or {},
        "climateSamples": e.get("climateSamples") or [],
    }


def exoplanet_rows() -> list[dict]:
    catalog = load("catalog_exoplanets.json")
    if catalog:
        return catalog
    return []


def particle_rows() -> list[dict]:
    catalog = load("catalog_particles.json")
    if catalog:
        return catalog
    pack = load("particle_b6.json") or {}
    out = []
    pdg = {"electron": 11, "positron": -11, "photon": 22}
    for p in pack.get("particles") or []:
        name = p.get("name") or ""
        out.append(
            {
                "id": p.get("id") or name,
                "name": name,
                "symbol": p.get("symbol") or "",
                "pdgId": pdg.get(name, 0),
                "massMev": float(p.get("massMeV") or p.get("massMev") or 0),
                "charge": float(p.get("charge_e") or p.get("charge") or 0),
                "spinJ": 0.5 if name != "photon" else 1.0,
                "evidenceKind": "observed",
                "sourceId": "pdg",
            }
        )
    return out


def atomic_rows() -> list[dict]:
    catalog = load("catalog_atomic_levels.json")
    if catalog:
        return catalog
    pack = load("atom_b4.json") or {}
    out = []
    for lv in pack.get("levels") or []:
        n = int(lv.get("n") or 1)
        l = int(lv.get("l") or 0)
        out.append(
            {
                "id": f"H-n{n}-l{l}",
                "species": pack.get("element") or "H",
                "n": n,
                "l": l,
                "energyEv": float(lv.get("energyEv") or 0),
                "term": lv.get("label") or f"n={n}",
                "evidenceKind": "derived",
                "sourceId": "nist-rydberg",
            }
        )
    return out


def isotope_rows() -> list[dict]:
    catalog = load("catalog_isotopes.json")
    if catalog:
        return catalog
    pack = load("nuclear_b5_context.json") or {}
    props = pack.get("properties") or {}
    return [
        {
            "id": "fe56",
            "symbol": pack.get("isotope") or "Fe-56",
            "z": int(props.get("Z") or 26),
            "a": int(props.get("A") or 56),
            "bindingEnergyPerNucleonMev": float((props.get("bindingEnergyPerNucleonMeV") or {}).get("value") or 8.79),
            "evidenceKind": "assumed",
            "sourceId": "nndc-placeholder",
        }
    ]


def gene_rows() -> list[dict]:
    catalog = load("catalog_genes.json")
    if catalog:
        return catalog
    pack = load("bio_b2.json") or {}
    var = pack.get("variant") or {}
    seq = pack.get("sequenceWindow") or {}
    return [
        {
            "id": "gene.hbb",
            "geneSymbol": pack.get("gene") or "HBB",
            "transcriptId": pack.get("transcriptRef") or "NM_000518.5",
            "cdsSequence": seq.get("before") or "",
            "variantLabel": var.get("name") or "HbS",
            "rsId": var.get("rsId") or "rs334",
            "structureId": "4HHB",
            "evidenceKind": "assumed",
            "sourceId": "ncbi-clinvar-curated",
        }
    ]


def main() -> int:
    bodies = solar_bodies()
    stars = star_rows()
    earth = earth_pack()
    exo = exoplanet_rows()
    particles = particle_rows()
    levels = atomic_rows()
    isotopes = isotope_rows()
    genes = gene_rows()

    solar_dataset = {
        "id": "solar.horizons",
        "bodies": bodies,
        "centerId": "body.sun",
        "epoch": "2025-01-01T00:00:00Z",
        "sourceUrls": ["https://ssd.jpl.nasa.gov/api/horizons.api"],
        "retrievedAt": next((b.get("retrievedAt") for b in bodies if b.get("retrievedAt")), ""),
        "evidenceKind": "observed",
        "sourceId": "jpl-horizons",
    }
    star_catalog = {
        "id": "stars.gaia_dr3.bright_parallax",
        "mode": "curated_fallback",
        "starCount": len(stars),
        "selectionFunction": "Named bright-star parallaxes plus labeled assumed nearby-disk and Milky Way field samples.",
        "stars": stars,
        "sourceUrls": ["https://www.cosmos.esa.int/web/gaia/dr3"],
        "retrievedAt": (stars[0].get("retrievedAt") if stars else "") or "",
    }
    earth_dataset = {
        "id": "earth.k1",
        **earth["constant"],
        "energyMix": earth["energy"],
        "anchors": earth["anchors"],
        "textures": earth["textures"],
        "climateSamples": earth["climateSamples"],
    }

    tables = {
        "solar_body": [{k: v for k, v in b.items() if k not in ("positionM", "velocityMps", "orbitPathM", "sourceUrl", "retrievedAt")} for b in bodies],
        "star": [{k: v for k, v in s.items() if k not in ("absMagG", "bpRp", "sourceUrl", "retrievedAt")} for s in stars],
        "earth": earth,
        "exoplanet": exo,
        "particle": particles,
        "atomic_level": levels,
        "isotope": isotopes,
        "gene": genes,
        "source_manifest": [
            {"id": "horizons", "sourceName": "NASA/JPL Horizons", "sourceUrl": "https://ssd.jpl.nasa.gov/api/horizons.api", "release": "2025-01-01 ICRF", "rowCount": len(bodies), "note": "Heliocentric state vectors + IAU radii"},
            {"id": "gaia", "sourceName": "Named bright stars + assumed nearby/field sample", "sourceUrl": "https://gea.esac.esa.int/tap-server/tap", "release": "catalog-v3", "rowCount": len(stars), "note": "Live TAP timed out; named Hipparcos/Gaia parallaxes plus labeled assumed disk/field stars"},
            {"id": "earth", "sourceName": "IAU Earth + city anchors + energy mix", "sourceUrl": "https://www.earthdata.nasa.gov/", "release": "scenario", "rowCount": len(earth["anchors"]), "note": "Constants + global city anchors"},
            {"id": "exoplanet", "sourceName": "NASA Exoplanet Archive (curated named systems)", "sourceUrl": "https://exoplanetarchive.ipac.caltech.edu/", "release": "named systems", "rowCount": len(exo), "note": "TRAPPIST-1, Kepler, hot Jupiters, imaged giants"},
            {"id": "pdg", "sourceName": "Particle Data Group", "sourceUrl": "https://pdg.lbl.gov/", "release": "2024 summary", "rowCount": len(particles), "note": "SM fermions, gauge bosons, selected hadrons"},
            {"id": "nist", "sourceName": "NIST ASD / Rydberg", "sourceUrl": "https://www.nist.gov/pml/atomic-spectra-database", "release": "H I + selected terms", "rowCount": len(levels), "note": "Hydrogenic n,l plus selected He/C/N/O/Fe/Na"},
            {"id": "nndc", "sourceName": "NNDC NuDat", "sourceUrl": "https://www.nndc.bnl.gov/nudat3/", "release": "selected isotopes", "rowCount": len(isotopes), "note": "Binding energy per nucleon, selected A"},
            {"id": "ncbi", "sourceName": "NCBI / ClinVar / PDB", "sourceUrl": "https://www.ncbi.nlm.nih.gov/", "release": "curated genes", "rowCount": len(genes), "note": "HBB plus additional educational loci"},
        ],
    }

    write_json(DATA_NORMALIZED / "solar_bodies.json", solar_dataset)
    write_json(DATA_NORMALIZED / "stdb_tables.json", tables)

    bundle = {
        "version": "2.1.0",
        "assembledAt": "",
        "origin": "local-cache",
        "stars": star_catalog,
        "solarSystem": solar_dataset,
        "earth": earth_dataset,
        "protein": load("pdb_4hhb_ca.json"),
        "gene": {
            "id": "gene.hbb",
            "geneSymbol": "HBB",
            "ensemblGeneId": None,
            "transcriptId": genes[0]["transcriptId"] if genes else "",
            "assembly": "GRCh38",
            "chromosome": "11",
            "startGrch38": None,
            "endGrch38": None,
            "strand": -1,
            "cdsSequence": genes[0]["cdsSequence"] if genes else "",
            "proteinSequence": "",
            "targetCodonIndex": 6,
            "variant": {
                "id": "var.hbb.glu6val",
                "rsId": "rs334",
                "clinvarAccession": None,
                "reviewStatus": "curated_demo",
                "conditions": ["Sickle cell disease"],
                "chromosome": "11",
                "positionGrch38": None,
                "referenceAllele": "A",
                "alternateAllele": "T",
                "hgvsC": "c.20A>T",
                "hgvsP": "p.Glu6Val",
                "consequence": "missense",
                "evidenceKind": "assumed",
                "sourceId": "clinvar-curated",
            },
            "structureId": "4HHB",
            "evidenceKind": "assumed",
            "sourceId": "ncbi",
        },
        "atom": {
            "id": "atom.hydrogen_1",
            "species": "H",
            "atomicNumber": 1,
            "ionisationEnergyEv": 13.6,
            "levels": [
                {
                    "species": "H",
                    "n": r["n"],
                    "l": r["l"],
                    "term": r["term"],
                    "configuration": r["term"],
                    "energyEv": r["energyEv"],
                    "degeneracy": 2 * r["n"] * r["n"],
                }
                for r in levels
            ],
            "lines": [],
            "evidenceKind": "derived",
            "sourceId": "nist-rydberg",
        },
        "particles": {
            "id": "particles.pdg",
            "particles": [
                {
                    "id": p["id"],
                    "pdgId": p["pdgId"],
                    "name": p["name"],
                    "symbol": p["symbol"],
                    "massMev": p["massMev"],
                    "massUncertaintyMev": None,
                    "charge": p["charge"],
                    "spinJ": p["spinJ"],
                    "lifetimeS": None,
                    "isStable": True,
                    "evidenceKind": p["evidenceKind"],
                    "sourceId": p["sourceId"],
                }
                for p in particles
            ],
            "sourceUrls": ["https://pdg.lbl.gov/"],
            "retrievedAt": "",
        },
        "isotopes": [
            {
                "id": i["id"],
                "symbol": i["symbol"],
                "z": i["z"],
                "a": i["a"],
                "massAmu": None,
                "halfLifeSeconds": None,
                "bindingEnergyPerNucleonMev": i["bindingEnergyPerNucleonMev"],
                "decayModes": [],
                "spinParity": None,
                "evidenceKind": i["evidenceKind"],
                "sourceId": i["sourceId"],
            }
            for i in isotopes
        ],
        "exoplanets": exo,
        "manifests": [],
    }
    from datetime import datetime, timezone

    bundle["assembledAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = DATA_NORMALIZED / "cosmos_dataset.json"
    write_json(out, bundle, compact=True)
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    (WEB_DATA / "cosmos_dataset.json").write_bytes(out.read_bytes())
    print(f"solar_body={len(bodies)} star={len(stars)} earth_anchor={len(earth['anchors'])} exo={len(exo)}")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
