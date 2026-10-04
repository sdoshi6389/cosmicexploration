"""ESA Gaia DR3 via the Gaia Archive TAP service (async jobs).

Three bounded, quality-filtered samples (all parallax_over_error > 10, RUWE < 1.4,
so 1000/parallax is an acceptable distance estimator per Bailer-Jones 2015/2021):

  bright   DESIGN.md seed query — 10k brightest high-quality sources
  nearby   25k nearest sources (parallax > 10 mas, within ~100 pc)
  field    15k G < 13 sources at 1–4 kpc (parallax 0.25–1 mas), random_index < 1.5e8 subsample

Selection functions are recorded; this is not an unbiased census of the galaxy.
Luminosity is Gaia FLAME `lum_flame` where available; Teff is GSP-Phot.
"""
from __future__ import annotations

import math

from _tap import f_or_none, parse_csv, tap_async
from _common import log, sha256_file
from pipeline import SourceResult, raw_dir, save_raw

SOURCE_ID = "esa_gaia_dr3"
ESA_TAP = "https://gea.esac.esa.int/tap-server/tap"
# ESA's archive was unresponsive (sync and async timeouts); ARI Heidelberg is an official
# Gaia DPAC partner data centre serving the identical gaiadr3 schema.
TAP = "https://gaia.ari.uni-heidelberg.de/tap"

COLS = (
    "g.source_id, g.ra, g.dec, g.parallax, g.parallax_error, g.pmra, g.pmdec, g.radial_velocity, "
    "g.phot_g_mean_mag, g.bp_rp, g.ref_epoch, g.ruwe, g.l, g.b, ap.teff_gspphot, ap.lum_flame"
)
JOIN = (
    "FROM gaiadr3.gaia_source AS g LEFT OUTER JOIN gaiadr3.astrophysical_parameters AS ap "
    "ON g.source_id = ap.source_id"
)
QUALITY = "g.parallax > 0 AND g.parallax_over_error > 10 AND g.ruwe < 1.4"

SAMPLES = {
    "bright": f"SELECT TOP 10000 {COLS} {JOIN} WHERE {QUALITY} ORDER BY phot_g_mean_mag ASC",
    "nearby": f"SELECT TOP 25000 {COLS} {JOIN} WHERE {QUALITY} AND g.parallax > 10 ORDER BY parallax DESC",
    "field": (
        f"SELECT TOP 15000 {COLS} {JOIN} WHERE {QUALITY} AND g.parallax BETWEEN 0.25 AND 1.0 "
        # random_index is uniform and indexed: a range is an unbiased subsample without a full sort.
        "AND g.phot_g_mean_mag < 13 AND g.random_index < 150000000"
    ),
}


def run() -> SourceResult:
    rows: dict[str, dict] = {}
    checksums = []
    for sample, adql in SAMPLES.items():
        log(f"  gaia sample '{sample}'")
        cached = raw_dir(SOURCE_ID) / f"gaia_dr3_{sample}.csv"
        if cached.exists() and cached.stat().st_size > 1000:
            data = cached.read_bytes()  # immutable DR3 query: reuse the stored raw response
            cs = sha256_file(cached)
        else:
            data = tap_async(TAP, adql, max_wait_s=1500)
            _, cs = save_raw(SOURCE_ID, f"gaia_dr3_{sample}.csv", data)
        checksums.append(f"{sample}={cs}")
        parsed = parse_csv(data)
        log(f"    {len(parsed)} rows")
        skipped = 0
        for r in parsed:
            sid = r["source_id"]
            if sid in rows:
                continue
            required = [f_or_none(r.get(k)) for k in ("ra", "dec", "parallax", "parallax_error", "phot_g_mean_mag", "l", "b", "ref_epoch")]
            if any(x is None for x in required):
                skipped += 1  # e.g. no G-band photometry; never fabricate a magnitude
                continue
            plx = float(r["parallax"])
            d = 1000.0 / plx
            ra, dec = math.radians(float(r["ra"])), math.radians(float(r["dec"]))
            rows[sid] = {
                "sourceId": sid,
                "raDeg": float(r["ra"]),
                "decDeg": float(r["dec"]),
                "parallaxMas": plx,
                "parallaxErrorMas": float(r["parallax_error"]),
                "pmraMasYr": f_or_none(r["pmra"]),
                "pmdecMasYr": f_or_none(r["pmdec"]),
                "radialVelocityKms": f_or_none(r["radial_velocity"]),
                "gMag": float(r["phot_g_mean_mag"]),
                "bpRp": f_or_none(r["bp_rp"]),
                "teffK": f_or_none(r["teff_gspphot"]),
                "luminosityLsun": f_or_none(r["lum_flame"]),
                "distancePc": d,
                "xPc": d * math.cos(dec) * math.cos(ra),
                "yPc": d * math.cos(dec) * math.sin(ra),
                "zPc": d * math.sin(dec),
                "glDeg": float(r["l"]),
                "gbDeg": float(r["b"]),
                "ruwe": f_or_none(r["ruwe"]),
                "refEpoch": float(r["ref_epoch"]),
                "sample": sample,
            }
        if skipped:
            log(f"    skipped {skipped} rows missing required astrometry/photometry")
    out = list(rows.values())
    with_lum = sum(1 for r in out if r["luminosityLsun"] is not None)
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="ESA Gaia Data Release 3",
        category="stars",
        tables={"gaia_star": out},
        source_urls=[TAP, ESA_TAP, "https://www.cosmos.esa.int/web/gaia/dr3"],
        release="Gaia DR3 (2022-06-13), reference epoch J2016.0",
        query=" || ".join(f"[{k}] {v}" for k, v in SAMPLES.items()),
        license="CC BY-SA 3.0 IGO (ESA)",
        attribution="ESA/Gaia/DPAC; Gaia Collaboration, Vallenari et al. 2023",
        coverage=f"{len(out)} unique sources ({with_lum} with FLAME luminosity); bright/nearby/field "
        "selection — not a galaxy census",
        units="deg, mas, mas/yr, km/s, mag, K, L_sun, pc",
        frame="ICRS, epoch J2016.0; cartesian pc with Sun at origin; galactic l,b from Gaia",
        raw_checksums=checksums,
        note="Served from the ARI Heidelberg Gaia mirror (ESA archive timed out). Distances = 1000/parallax "
        "only for parallax_over_error > 10; uncertainties retained.",
    )
