"""Single source of truth for every science table COSMOS stores.

`gen_contracts.py` turns this registry into the SpacetimeDB module tables and the
client TypeScript row types, so the ingest pipeline, the database and the web app
cannot drift apart. Column types:

    str, f64, i32, u32, bool            required
    f64?, u32?, i32?                    nullable (missing observations stay null)

The first column of every table is its primary key.
"""
from __future__ import annotations

from typing import Any

Table = dict[str, Any]

TABLES: dict[str, Table] = {
    # ------------------------------------------------------------ provenance
    "dataset_manifest": {
        "doc": "One row per ingested source: query, release, checksum, licence, coverage.",
        "columns": [
            ("id", "str"), ("sourceName", "str"), ("category", "str"), ("sourceUrls", "str"),
            ("release", "str"), ("query", "str"), ("retrievedAt", "str"), ("checksum", "str"),
            ("license", "str"), ("attribution", "str"), ("coverage", "str"), ("units", "str"),
            ("frame", "str"), ("validationStatus", "str"), ("rowCount", "u32"), ("tables", "str"),
            ("note", "str"),
        ],
    },
    # ------------------------------------------------------------- solar system
    "horizons_body": {
        "doc": "JPL Horizons heliocentric state vectors at the pinned epoch plus SPICE constants.",
        "columns": [
            ("id", "str"), ("name", "str"), ("naifId", "i32"), ("kind", "str"), ("parentId", "str"),
            ("xM", "f64"), ("yM", "f64"), ("zM", "f64"),
            ("vxMps", "f64"), ("vyMps", "f64"), ("vzMps", "f64"),
            ("epochTdb", "str"), ("epochJd", "f64"), ("frame", "str"), ("center", "str"),
            ("radiusKm", "f64?"), ("gmKm3S2", "f64?"), ("massKg", "f64?"),
            ("semiMajorAxisAu", "f64?"), ("eccentricity", "f64?"), ("inclinationDeg", "f64?"),
            ("orbitPeriodDays", "f64?"), ("rotationPeriodHours", "f64?"), ("obliquityDeg", "f64?"),
            ("colorHex", "str"), ("evidenceKind", "str"),
        ],
    },
    "orbit_sample": {
        "doc": "Sampled orbit tracks from Horizons (heliocentric for planets, parent-centric for moons).",
        "columns": [
            ("id", "str"), ("bodyId", "str"), ("center", "str"), ("idx", "u32"), ("jdTdb", "f64"),
            ("xM", "f64"), ("yM", "f64"), ("zM", "f64"),
        ],
        "index": ["bodyId"],
    },
    "spice_constant": {
        "doc": "NAIF SPICE generic PCK/GM kernel values per body.",
        "columns": [
            ("id", "str"), ("naifId", "i32"), ("name", "str"),
            ("radiusAKm", "f64?"), ("radiusBKm", "f64?"), ("radiusCKm", "f64?"), ("gmKm3S2", "f64?"),
            ("poleRaDeg", "f64?"), ("poleDecDeg", "f64?"), ("pmW0Deg", "f64?"), ("pmRateDegDay", "f64?"),
            ("kernels", "str"),
        ],
    },
    "planet_fact": {
        "doc": "NASA NSSDC Planetary Fact Sheet values (reference physical data).",
        "columns": [
            ("id", "str"), ("name", "str"), ("massE24Kg", "f64?"), ("diameterKm", "f64?"),
            ("densityKgM3", "f64?"), ("gravityMs2", "f64?"), ("escapeVelocityKms", "f64?"),
            ("rotationPeriodHours", "f64?"), ("dayLengthHours", "f64?"), ("distanceFromSunE6Km", "f64?"),
            ("orbitalPeriodDays", "f64?"), ("orbitalVelocityKms", "f64?"), ("obliquityDeg", "f64?"),
            ("meanTemperatureC", "f64?"), ("surfacePressureBars", "f64?"), ("moonCount", "u32?"),
            ("ringSystem", "str"), ("globalMagneticField", "str"),
        ],
    },
    "planet_texture": {
        "doc": "Planet surface maps: PDS archive elevation grids and labelled illustrative colour maps.",
        "columns": [
            ("id", "str"), ("bodyId", "str"), ("kind", "str"), ("path", "str"), ("width", "u32"),
            ("height", "u32"), ("source", "str"), ("sourceProductId", "str"), ("sourceUrl", "str"),
            ("projection", "str"), ("license", "str"), ("evidenceKind", "str"),
        ],
    },
    # -------------------------------------------------------------------- earth
    "earth_layer": {
        "doc": "NASA Earthdata (CMR discovery + GIBS imagery) global layers.",
        "columns": [
            ("id", "str"), ("title", "str"), ("gibsLayer", "str"), ("cmrConceptId", "str"),
            ("collectionShortName", "str"), ("timeRange", "str"), ("path", "str"), ("units", "str"),
            ("legend", "str"), ("evidenceKind", "str"),
        ],
    },
    "earth_city": {
        "doc": "Natural Earth populated places (1:110m).",
        "columns": [
            ("id", "str"), ("name", "str"), ("country", "str"), ("latDeg", "f64"), ("lonDeg", "f64"),
            ("population", "f64?"), ("rank", "u32?"),
        ],
    },
    "energy_record": {
        "doc": "World primary energy and electricity generation (Our World in Data / Energy Institute).",
        "columns": [
            ("id", "str"), ("entity", "str"), ("year", "u32"), ("metric", "str"), ("source", "str"),
            ("valueTwh", "f64"),
        ],
    },
    "climate_anomaly": {
        "doc": "NOAA NCEI global land+ocean surface temperature anomaly.",
        "columns": [("id", "str"), ("year", "u32"), ("anomalyC", "f64"), ("baseline", "str")],
    },
    "earthquake": {
        "doc": "USGS FDSN event catalogue (bounded query).",
        "columns": [
            ("id", "str"), ("timeIso", "str"), ("magnitude", "f64"), ("place", "str"),
            ("latDeg", "f64"), ("lonDeg", "f64"), ("depthKm", "f64"), ("eventType", "str"),
        ],
    },
    # ------------------------------------------------------------------- stars
    "gaia_star": {
        "doc": "ESA Gaia DR3 quality-filtered astrometry (parallax_over_error > 10, RUWE < 1.4).",
        "columns": [
            ("sourceId", "str"), ("raDeg", "f64"), ("decDeg", "f64"), ("parallaxMas", "f64"),
            ("parallaxErrorMas", "f64"), ("pmraMasYr", "f64?"), ("pmdecMasYr", "f64?"),
            ("radialVelocityKms", "f64?"), ("gMag", "f64"), ("bpRp", "f64?"), ("teffK", "f64?"),
            ("luminosityLsun", "f64?"), ("distancePc", "f64"), ("xPc", "f64"), ("yPc", "f64"),
            ("zPc", "f64"), ("glDeg", "f64"), ("gbDeg", "f64"), ("ruwe", "f64?"), ("refEpoch", "f64"),
            ("sample", "str"),
        ],
    },
    "named_star": {
        "doc": "Bright named stars (IAU WGSN names) with SIMBAD/Hipparcos astrometry.",
        "columns": [
            ("id", "str"), ("name", "str"), ("simbadId", "str"), ("raDeg", "f64"), ("decDeg", "f64"),
            ("parallaxMas", "f64?"), ("vMag", "f64?"), ("spType", "str"), ("distancePc", "f64?"),
            ("xPc", "f64?"), ("yPc", "f64?"), ("zPc", "f64?"), ("gaiaDr3Id", "str"), ("source", "str"),
        ],
    },
    "exoplanet_system": {
        "doc": "NASA Exoplanet Archive pscomppars composite parameters (all confirmed planets).",
        "columns": [
            ("plName", "str"), ("hostname", "str"), ("raDeg", "f64"), ("decDeg", "f64"),
            ("distancePc", "f64?"), ("orbitalPeriodDays", "f64?"), ("semiMajorAxisAu", "f64?"),
            ("radiusEarth", "f64?"), ("massEarth", "f64?"), ("eqTempK", "f64?"), ("eccentricity", "f64?"),
            ("insolationEarth", "f64?"), ("stTeffK", "f64?"), ("stRadiusSun", "f64?"),
            ("stMassSun", "f64?"), ("stLumLog", "f64?"), ("discoveryMethod", "str"),
            ("discoveryYear", "u32?"), ("sysPlanetCount", "u32?"), ("gaiaDr3Id", "str"),
            ("xPc", "f64?"), ("yPc", "f64?"), ("zPc", "f64?"),
        ],
    },
    "sdss_galaxy": {
        "doc": "SDSS DR18 spectroscopic galaxies with Planck18 comoving distances.",
        "columns": [
            ("specObjId", "str"), ("raDeg", "f64"), ("decDeg", "f64"), ("redshift", "f64"),
            ("redshiftErr", "f64"), ("subclass", "str"), ("petroMagR", "f64?"), ("comovingMpc", "f64"),
            ("xMpc", "f64"), ("yMpc", "f64"), ("zMpc", "f64"),
        ],
    },
    "xray_binary": {
        "doc": "HEASARC LMXB/HMXB catalogues. An X-ray binary is not automatically a black hole.",
        "columns": [
            ("id", "str"), ("name", "str"), ("raDeg", "f64"), ("decDeg", "f64"), ("glDeg", "f64"),
            ("gbDeg", "f64"), ("kind", "str"), ("distanceKpc", "f64?"), ("orbitalPeriodDays", "f64?"),
            ("compactObject", "str"), ("catalog", "str"),
        ],
    },
    # ----------------------------------------------------------------- biology
    "hca_project": {
        "doc": "Human Cell Atlas (Azul) projects touching blood / bone-marrow erythroid context.",
        "columns": [
            ("id", "str"), ("title", "str"), ("organs", "str"), ("cellCount", "f64?"),
            ("donorCount", "u32?"), ("cellTypes", "str"), ("assays", "str"), ("url", "str"),
        ],
    },
    "gene_record": {
        "doc": "NCBI Gene + Ensembl gene/transcript identifiers.",
        "columns": [
            ("id", "str"), ("geneId", "str"), ("symbol", "str"), ("description", "str"),
            ("chromosome", "str"), ("mapLocation", "str"), ("assembly", "str"), ("startPos", "u32?"),
            ("endPos", "u32?"), ("strand", "i32"), ("ensemblGeneId", "str"), ("refseqTranscript", "str"),
            ("refseqProtein", "str"), ("ensemblTranscript", "str"), ("summary", "str"),
        ],
    },
    "sequence_record": {
        "doc": "Coding and protein sequences (NCBI nuccore/protein and Ensembl).",
        "columns": [
            ("accession", "str"), ("geneSymbol", "str"), ("kind", "str"), ("length", "u32"),
            ("sequence", "str"), ("source", "str"), ("release", "str"),
        ],
    },
    "variant_record": {
        "doc": "Curated HBB variants: Ensembl VEP-style consequence + ClinVar classification.",
        "columns": [
            ("id", "str"), ("geneSymbol", "str"), ("rsId", "str"), ("clinvarId", "str"),
            ("hgvsC", "str"), ("hgvsP", "str"), ("proteinChange", "str"), ("chromosome", "str"),
            ("positionGrch38", "u32?"), ("refAllele", "str"), ("altAllele", "str"),
            ("cdsPosition", "u32?"), ("codonRef", "str"), ("codonAlt", "str"), ("consequence", "str"),
            ("clinicalSignificance", "str"), ("reviewStatus", "str"), ("conditions", "str"),
            ("source", "str"),
        ],
    },
    "pdb_entry": {
        "doc": "RCSB PDB entry metadata.",
        "columns": [
            ("id", "str"), ("title", "str"), ("method", "str"), ("resolutionA", "f64?"),
            ("depositDate", "str"), ("organism", "str"), ("description", "str"), ("atomCount", "u32"),
            ("chains", "str"), ("ligands", "str"),
        ],
    },
    "pdb_atom": {
        "doc": "mmCIF atom_site rows (model 1, first altloc, waters dropped). Coordinates in Å.",
        "columns": [
            ("id", "str"), ("entryId", "str"), ("serial", "u32"), ("chain", "str"), ("resSeq", "i32"),
            ("resName", "str"), ("atomName", "str"), ("element", "str"),
            ("x", "f64"), ("y", "f64"), ("z", "f64"), ("occupancy", "f64"), ("bFactor", "f64"),
            ("hetero", "bool"),
        ],
        "index": ["entryId"],
    },
    "pdb_secondary": {
        "doc": "Helix / strand ranges from mmCIF struct_conf and struct_sheet_range.",
        "columns": [
            ("id", "str"), ("entryId", "str"), ("chain", "str"), ("kind", "str"),
            ("startResSeq", "i32"), ("endResSeq", "i32"),
        ],
    },
    # ---------------------------------------------------------------- molecular
    "molecule": {
        "doc": "PubChem compounds with 3D conformers.",
        "columns": [
            ("cid", "u32"), ("name", "str"), ("formula", "str"), ("molecularWeight", "f64"),
            ("iupacName", "str"), ("smiles", "str"), ("atomCount", "u32"), ("bondCount", "u32"),
            ("conformer", "str"),
        ],
    },
    "molecule_atom": {
        "doc": "PubChem 3D conformer atoms (Å).",
        "columns": [
            ("id", "str"), ("cid", "u32"), ("idx", "u32"), ("element", "str"),
            ("x", "f64"), ("y", "f64"), ("z", "f64"),
        ],
        "index": ["cid"],
    },
    "molecule_bond": {
        "doc": "PubChem 3D conformer bonds.",
        "columns": [("id", "str"), ("cid", "u32"), ("a1", "u32"), ("a2", "u32"), ("order", "u32")],
        "index": ["cid"],
    },
    # ------------------------------------------------------------------- atomic
    "nist_level": {
        "doc": "NIST ASD evaluated energy levels.",
        "columns": [
            ("id", "str"), ("species", "str"), ("configuration", "str"), ("term", "str"), ("j", "str"),
            ("energyEv", "f64"), ("uncertaintyEv", "f64?"), ("n", "u32?"), ("l", "u32?"),
            ("reference", "str"),
        ],
    },
    "nist_line": {
        "doc": "NIST ASD spectral lines with Einstein A coefficients where evaluated.",
        "columns": [
            ("id", "str"), ("species", "str"), ("wavelengthVacNm", "f64"), ("akiPerS", "f64?"),
            ("accuracy", "str"), ("eiEv", "f64"), ("ekEv", "f64"), ("lowerConf", "str"),
            ("lowerTerm", "str"), ("lowerJ", "str"), ("upperConf", "str"), ("upperTerm", "str"),
            ("upperJ", "str"), ("lineType", "str"),
        ],
    },
    "ionization_energy": {
        "doc": "NIST ASD ground-state ionization energies.",
        "columns": [("species", "str"), ("element", "str"), ("ionizationEv", "f64"), ("reference", "str")],
    },
    # ------------------------------------------------------------------ nuclear
    "nuclide": {
        "doc": "IAEA LiveChart ground states (ENSDF / NUBASE / AME2020).",
        "columns": [
            ("id", "str"), ("z", "u32"), ("n", "u32"), ("a", "u32"), ("symbol", "str"),
            ("halfLifeS", "f64?"), ("halfLifeText", "str"), ("stable", "bool"), ("spinParity", "str"),
            ("decayModes", "str"), ("massExcessKeV", "f64?"), ("bindingPerNucleonKeV", "f64?"),
            ("abundancePct", "f64?"), ("qBetaMinusKeV", "f64?"), ("qEcKeV", "f64?"),
        ],
    },
    "nuclear_level": {
        "doc": "IAEA LiveChart / ENSDF excited levels for the traversal nuclides.",
        "columns": [
            ("id", "str"), ("nuclide", "str"), ("energyKeV", "f64"), ("spinParity", "str"),
            ("halfLifeText", "str"), ("source", "str"),
        ],
    },
    "decay_radiation": {
        "doc": "IAEA LiveChart / ENSDF decay radiation (beta+, gamma, X-ray) for traversal nuclides.",
        "columns": [
            ("id", "str"), ("parent", "str"), ("decayMode", "str"), ("radiationType", "str"),
            ("energyKeV", "f64"), ("intensityPct", "f64?"), ("source", "str"),
        ],
    },
    # ----------------------------------------------------------------- particle
    "pdg_particle": {
        "doc": "Particle Data Group API database: summary-table masses, widths, lifetimes.",
        "columns": [
            ("id", "str"), ("mcId", "i32"), ("name", "str"), ("pdgId", "str"), ("charge", "f64"),
            ("spin", "str"), ("parity", "str"), ("cParity", "str"), ("isospin", "str"),
            ("massMeV", "f64?"), ("massErrMeV", "f64?"), ("widthMeV", "f64?"), ("lifetimeS", "f64?"),
            ("category", "str"), ("edition", "str"),
        ],
    },
}


def coerce_row(table: str, row: dict) -> dict:
    """Validate one row against the registry; raise on type errors, keep nulls."""
    spec = TABLES[table]["columns"]
    out: dict[str, Any] = {}
    for name, typ in spec:
        v = row.get(name)
        optional = typ.endswith("?")
        base = typ.rstrip("?")
        if v is None or (isinstance(v, float) and v != v):
            if optional:
                out[name] = None
                continue
            if base == "str":
                out[name] = ""
                continue
            raise ValueError(f"{table}.{name}: required value missing in {row!r}"[:400])
        if base == "str":
            out[name] = str(v)
        elif base == "f64":
            f = float(v)
            if f != f or f in (float("inf"), float("-inf")):
                if optional:
                    out[name] = None
                    continue
                raise ValueError(f"{table}.{name}: non-finite {v}")
            out[name] = f
        elif base in ("u32", "i32"):
            i = int(v)
            if base == "u32" and i < 0:
                raise ValueError(f"{table}.{name}: negative u32 {v}")
            out[name] = i
        elif base == "bool":
            out[name] = bool(v)
        else:  # pragma: no cover
            raise ValueError(f"unknown type {typ}")
    return out
