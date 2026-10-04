#!/usr/bin/env python3
"""Gaia DR3 bright high-quality-parallax star catalogue -> `StarCatalog`.

Strategy, stopping at the first success:

1. ESA Gaia archive **async** TAP job (sync times out from this network).
2. VizieR TAPVizieR mirror of Gaia DR3 (`I/355/gaiadr3`).
3. SIMBAD TAP (bright named stars with Hipparcos/Gaia parallaxes).
4. Curated fallback of named stars with published parallaxes.

Distances come from `1000 / parallax_mas` and are only accepted when
`parallax_over_error > 10`. Negative or noisy parallaxes are never inverted.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from _common import (
    BROWSER_UA,
    LSUN_W,
    PARSEC_M,
    USER_AGENT,
    HttpError,
    http_get,
    http_post_form,
    log,
    manifest_entry,
    round_sig,
    save_manifest,
    save_normalized,
    sha256_bytes,
    utc_now_iso,
    warn,
    write_raw,
)
from starcolor import star_color_hex

GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap"
GAIA_ASYNC = f"{GAIA_TAP}/async"
GAIA_SYNC = f"{GAIA_TAP}/sync"
VIZIER_TAP_SYNC = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync"
SIMBAD_TAP_SYNC = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"

TARGET_ROWS = 10000

GAIA_ADQL = f"""SELECT TOP {TARGET_ROWS} source_id, ra, dec, parallax, parallax_error,
  parallax_over_error, pmra, pmdec, phot_g_mean_mag, bp_rp, teff_gspphot, ruwe
FROM gaiadr3.gaia_source
WHERE parallax > 0 AND parallax_over_error > 10 AND ruwe < 1.4
ORDER BY phot_g_mean_mag ASC"""

# VizieR exposes Gaia DR3 as I/355/gaiadr3 with its own column spellings.
# RPlx is parallax/parallax_error; BP-RP is published directly but the hyphen
# is awkward in ADQL, so BPmag/RPmag are fetched and differenced instead.
VIZIER_ADQL = f"""SELECT TOP {TARGET_ROWS} "Source", "RA_ICRS", "DE_ICRS", "Plx", "e_Plx",
  "RPlx", "pmRA", "pmDE", "Gmag", "BPmag", "RPmag", "Teff", "RUWE"
FROM "I/355/gaiadr3"
WHERE "Plx" > 0 AND "RPlx" > 10 AND "RUWE" < 1.4
ORDER BY "Gmag" ASC"""

SIMBAD_ADQL = """SELECT TOP 5000 b.main_id, b.ra, b.dec, b.plx_value, b.plx_err,
  b.pmra, b.pmdec, b.V, b.B, b.sp_type
FROM basic AS b
WHERE b.plx_value > 0 AND b.plx_err > 0 AND b.plx_value / b.plx_err > 10
  AND b.V IS NOT NULL AND b.V < 7.0
ORDER BY b.V ASC"""

SELECTION_FUNCTION = (
    "Brightest-first subset of Gaia DR3 gaia_source with parallax > 0, "
    "parallax_over_error > 10 and RUWE < 1.4, truncated to the first "
    f"{TARGET_ROWS} rows ordered by phot_g_mean_mag ascending. This is a "
    "magnitude-limited, high-quality-astrometry sample dominated by nearby and "
    "intrinsically luminous stars. It is NOT an unbiased map of the Galaxy: "
    "faint stars, high-extinction sightlines, crowded fields, negative or noisy "
    "parallaxes and unresolved binaries are all systematically excluded. Do not "
    "infer stellar density, the luminosity function or Galactic structure from it."
)


# ------------------------------------------------------------ TAP plumbing ---

def _no_redirect_opener() -> urllib.request.OpenerDirector:
    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
            return None

    return urllib.request.build_opener(_NoRedirect)


def submit_gaia_async(adql: str) -> str:
    """POST an async TAP job and return its job URL."""
    form = {
        "REQUEST": "doQuery",
        "LANG": "ADQL",
        "FORMAT": "json",
        "PHASE": "RUN",
        "QUERY": adql,
    }
    body = urllib.parse.urlencode(form).encode("ascii")
    req = urllib.request.Request(
        GAIA_ASYNC,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "*/*",
        },
    )
    opener = _no_redirect_opener()
    try:
        with opener.open(req, timeout=60) as resp:
            # 200 with job XML (rare) - dig the jobid out of the document.
            payload = resp.read().decode("utf-8", errors="replace")
            m = re.search(r"<uws:jobId>([^<]+)</uws:jobId>", payload) or re.search(
                r"<jobId>([^<]+)</jobId>", payload
            )
            if m:
                return f"{GAIA_ASYNC}/{m.group(1)}"
            raise HttpError("async submit returned 200 without a jobId")
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307):
            loc = e.headers.get("Location") or ""
            if not loc:
                raise HttpError("async submit redirect without Location") from e
            return urllib.parse.urljoin(GAIA_ASYNC, loc)
        detail = b""
        try:
            detail = e.read()[:400]
        except Exception:
            pass
        raise HttpError(f"async submit HTTP {e.code}: {detail!r}") from e


def poll_gaia_async(job_url: str, *, max_wait_s: float = 420.0) -> bytes:
    """Poll `/phase` until COMPLETED, then download the result document."""
    deadline = time.time() + max_wait_s
    delay = 3.0
    last_phase = ""
    while time.time() < deadline:
        phase = http_get(f"{job_url}/phase", timeout=45, retries=2).decode().strip()
        if phase != last_phase:
            log(f"  gaia async phase={phase}")
            last_phase = phase
        if phase == "COMPLETED":
            return http_get(f"{job_url}/results/result", timeout=300, retries=2)
        if phase in ("ERROR", "ABORTED", "HELD", "UNKNOWN"):
            try:
                err = http_get(f"{job_url}", timeout=45, retries=1).decode()[:600]
            except Exception:
                err = "(no job document)"
            raise HttpError(f"async job phase={phase}: {err}")
        time.sleep(delay)
        delay = min(delay * 1.4, 20.0)
    raise HttpError(f"async job did not complete within {max_wait_s:.0f}s (last phase {last_phase})")


def tap_sync(url: str, adql: str, fmt: str, *, timeout: float = 180.0) -> bytes:
    form = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": fmt, "QUERY": adql}
    return http_post_form(url, form, timeout=timeout, retries=2)


# -------------------------------------------------------------- row parsing --

def parse_tap_json(payload: bytes) -> tuple[list[str], list[list]]:
    doc = json.loads(payload.decode("utf-8", errors="replace"))
    meta = doc.get("metadata") or doc.get("columns") or []
    cols = [str(c.get("name", "")).lower() for c in meta]
    rows = doc.get("data") or []
    if not cols and rows and isinstance(rows[0], dict):
        cols = [k.lower() for k in rows[0]]
        rows = [[r.get(k) for k in rows[0]] for r in rows]
    return cols, rows


def parse_tap_csv(payload: bytes) -> tuple[list[str], list[list]]:
    text = payload.decode("utf-8", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return [], []
    cols = [c.strip().lower() for c in rows[0]]
    out: list[list] = []
    for r in rows[1:]:
        if len(r) < len(cols):
            continue
        out.append([(v.strip() if isinstance(v, str) else v) or None for v in r])
    return cols, out


def parse_votable(payload: bytes) -> tuple[list[str], list[list]]:
    """Minimal VOTable TABLEDATA reader - enough for a flat numeric table."""
    text = payload.decode("utf-8", errors="replace")
    cols = [m.lower() for m in re.findall(r'<FIELD[^>]*\bname="([^"]+)"', text)]
    rows: list[list] = []
    for tr in re.findall(r"<TR>(.*?)</TR>", text, flags=re.S):
        cells = re.findall(r"<TD[^>]*>(.*?)</TD>", tr, flags=re.S)
        rows.append([(c.strip() or None) for c in cells])
    return cols, rows


def sniff_and_parse(payload: bytes) -> tuple[list[str], list[list]]:
    head = payload[:400].lstrip()
    if head.startswith(b"{"):
        return parse_tap_json(payload)
    if head.startswith(b"<?xml") or head.startswith(b"<VOTABLE") or b"<VOTABLE" in head:
        return parse_votable(payload)
    return parse_tap_csv(payload)


def num(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        return f if math.isfinite(f) else None
    s = str(v).strip()
    if not s or s.lower() in ("null", "nan", "none", "--", "-"):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


class ColumnMap:
    def __init__(self, cols: list[str]) -> None:
        self.idx = {c: i for i, c in enumerate(cols)}

    def get(self, row: list, *names: str):
        for n in names:
            i = self.idx.get(n.lower())
            if i is not None and i < len(row):
                return row[i]
        return None


# ------------------------------------------------------------ normalisation --

def icrs_to_cartesian(ra_deg: float, dec_deg: float, distance_m: float) -> tuple[float, float, float]:
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    cd = math.cos(dec)
    return (distance_m * cd * math.cos(ra), distance_m * cd * math.sin(ra), distance_m * math.sin(dec))


def abs_mag(g_mag: float | None, distance_pc: float | None) -> float | None:
    if g_mag is None or distance_pc is None or distance_pc <= 0:
        return None
    return g_mag + 5.0 - 5.0 * math.log10(distance_pc)


def luminosity_from_abs_mag(abs_g: float | None) -> float | None:
    """Crude bolometric proxy: treat absolute G as absolute bolometric.

    No bolometric correction or extinction term is applied, so this is a
    `derived` order-of-magnitude figure, not a measured luminosity.
    """
    if abs_g is None or not (-15.0 < abs_g < 25.0):
        return None
    return (10.0 ** (-0.4 * (abs_g - 4.83))) * LSUN_W


LUM_METHOD = (
    "M_G = G + 5 - 5*log10(d_pc) with d_pc = 1000/parallax_mas; "
    "L = 10**(-0.4*(M_G - 4.83)) * 3.828e26 W. Absolute G is used as a "
    "bolometric proxy with no bolometric correction and no extinction "
    "correction, so the value is an order-of-magnitude estimate."
)


def build_star(
    *,
    star_id: str,
    name: str | None,
    ra_deg: float,
    dec_deg: float,
    parallax_mas: float | None,
    parallax_over_error: float | None,
    g_mag: float | None,
    bp_rp: float | None,
    teff_k: float | None,
    source_id_label: str,
    source_url: str,
    release: str,
    retrieved_at: str,
) -> dict | None:
    if parallax_mas is None or parallax_mas <= 0:
        return None
    if parallax_over_error is None or parallax_over_error <= 10.0:
        return None
    distance_pc = 1000.0 / parallax_mas
    distance_m = distance_pc * PARSEC_M
    x, y, z = icrs_to_cartesian(ra_deg, dec_deg, distance_m)
    abs_g = abs_mag(g_mag, distance_pc)
    lum = luminosity_from_abs_mag(abs_g)
    rec = {
        "evidenceKind": "observed",
        "sourceId": source_id_label,
        "sourceUrl": source_url,
        "sourceRecordId": star_id,
        "release": release,
        "retrievedAt": retrieved_at,
        "method": (
            "Astrometry and photometry as published. Distance = 1000/parallax_mas "
            "(parallax_over_error > 10). Cartesian ICRS metres with the Sun at the "
            "origin: x=d*cos(dec)*cos(ra), y=d*cos(dec)*sin(ra), z=d*sin(dec). "
            "colorHex and luminosityW are derived, not measured."
        ),
        "assumptions": [
            "Distance from simple parallax inversion; valid only for high S/N parallaxes.",
            "No extinction or reddening correction applied.",
            f"luminosityW derived: {LUM_METHOD}" if lum is not None else "luminosityW not derivable.",
        ],
        "id": star_id,
        "name": name,
        "raDeg": round_sig(ra_deg, 9),
        "decDeg": round_sig(dec_deg, 9),
        "distanceM": round_sig(distance_m, 7),
        "parallaxMas": round_sig(parallax_mas, 7),
        "x": round_sig(x, 7),
        "y": round_sig(y, 7),
        "z": round_sig(z, 7),
        "absMagG": round_sig(abs_g, 6),
        "bpRp": round_sig(bp_rp, 6),
        "teffK": round_sig(teff_k, 6),
        "luminosityW": round_sig(lum, 6),
        "colorHex": star_color_hex(teff_k, bp_rp),
    }
    return rec


# ------------------------------------------------------------------ sources --

def try_gaia_async(retrieved_at: str) -> tuple[list[dict], dict] | None:
    log("[gaia] submitting async TAP job ...")
    try:
        job_url = submit_gaia_async(GAIA_ADQL)
    except Exception as e:
        warn(f"[gaia] async submit failed: {e}")
        return None
    log(f"[gaia] job url {job_url}")
    try:
        payload = poll_gaia_async(job_url)
    except Exception as e:
        warn(f"[gaia] async poll/download failed: {e}")
        return None
    raw_path = write_raw("gaia_dr3_async_result.json", payload)
    cols, rows = sniff_and_parse(payload)
    log(f"[gaia] async returned {len(rows)} rows, {len(cols)} cols -> {raw_path.name}")
    if not rows:
        return None
    cm = ColumnMap(cols)
    stars: list[dict] = []
    for r in rows:
        ra = num(cm.get(r, "ra"))
        dec = num(cm.get(r, "dec"))
        if ra is None or dec is None:
            continue
        sid = cm.get(r, "source_id")
        plx = num(cm.get(r, "parallax"))
        poe = num(cm.get(r, "parallax_over_error"))
        plx_err = num(cm.get(r, "parallax_error"))
        if poe is None and plx is not None and plx_err:
            poe = plx / plx_err
        star = build_star(
            star_id=f"gaia-dr3-{sid}",
            name=None,
            ra_deg=ra,
            dec_deg=dec,
            parallax_mas=plx,
            parallax_over_error=poe,
            g_mag=num(cm.get(r, "phot_g_mean_mag")),
            bp_rp=num(cm.get(r, "bp_rp")),
            teff_k=num(cm.get(r, "teff_gspphot")),
            source_id_label="esa-gaia-dr3",
            source_url=GAIA_TAP,
            release="Gaia DR3",
            retrieved_at=retrieved_at,
        )
        if star:
            stars.append(star)
    meta = {
        "mode": "gaia_tap",
        "sourceUrls": [GAIA_ASYNC, job_url],
        "query": GAIA_ADQL,
        "release": "Gaia DR3",
        "rawPath": str(raw_path),
        "checksum": sha256_bytes(payload),
        "rawRows": len(rows),
    }
    return stars, meta


def try_gaia_sync(retrieved_at: str) -> tuple[list[dict], dict] | None:
    """Short sync query as a cheap second chance on the primary archive."""
    adql = GAIA_ADQL.replace(f"TOP {TARGET_ROWS}", "TOP 3000")
    log("[gaia] trying sync TAP (TOP 3000) ...")
    try:
        payload = tap_sync(GAIA_SYNC, adql, "json", timeout=120)
    except Exception as e:
        warn(f"[gaia] sync failed: {e}")
        return None
    raw_path = write_raw("gaia_dr3_sync_result.json", payload)
    cols, rows = sniff_and_parse(payload)
    log(f"[gaia] sync returned {len(rows)} rows -> {raw_path.name}")
    if not rows:
        return None
    cm = ColumnMap(cols)
    stars = []
    for r in rows:
        ra, dec = num(cm.get(r, "ra")), num(cm.get(r, "dec"))
        if ra is None or dec is None:
            continue
        plx = num(cm.get(r, "parallax"))
        poe = num(cm.get(r, "parallax_over_error"))
        plx_err = num(cm.get(r, "parallax_error"))
        if poe is None and plx is not None and plx_err:
            poe = plx / plx_err
        star = build_star(
            star_id=f"gaia-dr3-{cm.get(r, 'source_id')}",
            name=None,
            ra_deg=ra,
            dec_deg=dec,
            parallax_mas=plx,
            parallax_over_error=poe,
            g_mag=num(cm.get(r, "phot_g_mean_mag")),
            bp_rp=num(cm.get(r, "bp_rp")),
            teff_k=num(cm.get(r, "teff_gspphot")),
            source_id_label="esa-gaia-dr3",
            source_url=GAIA_TAP,
            release="Gaia DR3",
            retrieved_at=retrieved_at,
        )
        if star:
            stars.append(star)
    return stars, {
        "mode": "gaia_tap",
        "sourceUrls": [GAIA_SYNC],
        "query": adql,
        "release": "Gaia DR3",
        "rawPath": str(raw_path),
        "checksum": sha256_bytes(payload),
        "rawRows": len(rows),
    }


def try_vizier(retrieved_at: str) -> tuple[list[dict], dict] | None:
    for fmt, ext in (("json", "json"), ("csv", "csv"), ("votable", "xml")):
        log(f"[vizier] TAPVizieR I/355/gaiadr3 FORMAT={fmt} ...")
        try:
            payload = tap_sync(VIZIER_TAP_SYNC, VIZIER_ADQL, fmt, timeout=240)
        except Exception as e:
            warn(f"[vizier] {fmt} failed: {e}")
            continue
        try:
            cols, rows = sniff_and_parse(payload)
        except Exception as e:
            warn(f"[vizier] {fmt} unparseable: {e}")
            continue
        if not rows:
            warn(f"[vizier] {fmt} returned no rows; head={payload[:300]!r}")
            continue
        raw_path = write_raw(f"gaia_dr3_vizier_result.{ext}", payload)
        log(f"[vizier] {len(rows)} rows -> {raw_path.name}")
        cm = ColumnMap(cols)
        stars = []
        for r in rows:
            ra = num(cm.get(r, "ra_icrs", "raj2000", "ra"))
            dec = num(cm.get(r, "de_icrs", "dej2000", "dec"))
            if ra is None or dec is None:
                continue
            plx = num(cm.get(r, "plx", "parallax"))
            poe = num(cm.get(r, "rplx"))
            e_plx = num(cm.get(r, "e_plx"))
            if poe is None and plx is not None and e_plx:
                poe = plx / e_plx
            bp = num(cm.get(r, "bpmag"))
            rp = num(cm.get(r, "rpmag"))
            bp_rp = num(cm.get(r, "bp-rp", "bp_rp"))
            if bp_rp is None and bp is not None and rp is not None:
                bp_rp = bp - rp
            star = build_star(
                star_id=f"gaia-dr3-{cm.get(r, 'source')}",
                name=None,
                ra_deg=ra,
                dec_deg=dec,
                parallax_mas=plx,
                parallax_over_error=poe,
                g_mag=num(cm.get(r, "gmag")),
                bp_rp=bp_rp,
                teff_k=num(cm.get(r, "teff")),
                source_id_label="vizier-i355-gaiadr3",
                source_url=VIZIER_TAP_SYNC,
                release="Gaia DR3 via VizieR I/355/gaiadr3",
                retrieved_at=retrieved_at,
            )
            if star:
                stars.append(star)
        return stars, {
            "mode": "vizier_mirror",
            "sourceUrls": [VIZIER_TAP_SYNC],
            "query": VIZIER_ADQL,
            "release": "Gaia DR3 via VizieR I/355/gaiadr3",
            "rawPath": str(raw_path),
            "checksum": sha256_bytes(payload),
            "rawRows": len(rows),
        }
    return None


def try_simbad(retrieved_at: str) -> tuple[list[dict], dict] | None:
    for fmt, ext in (("json", "json"), ("csv", "csv"), ("votable", "xml")):
        log(f"[simbad] TAP FORMAT={fmt} ...")
        try:
            payload = tap_sync(SIMBAD_TAP_SYNC, SIMBAD_ADQL, fmt, timeout=180)
        except Exception as e:
            warn(f"[simbad] {fmt} failed: {e}")
            continue
        try:
            cols, rows = sniff_and_parse(payload)
        except Exception as e:
            warn(f"[simbad] {fmt} unparseable: {e}")
            continue
        if not rows:
            continue
        raw_path = write_raw(f"simbad_bright_stars.{ext}", payload)
        log(f"[simbad] {len(rows)} rows -> {raw_path.name}")
        cm = ColumnMap(cols)
        stars = []
        for r in rows:
            ra, dec = num(cm.get(r, "ra")), num(cm.get(r, "dec"))
            if ra is None or dec is None:
                continue
            plx = num(cm.get(r, "plx_value"))
            err = num(cm.get(r, "plx_err"))
            poe = plx / err if (plx is not None and err) else None
            v = num(cm.get(r, "v"))
            b = num(cm.get(r, "b"))
            main_id = cm.get(r, "main_id")
            name = str(main_id).strip() if main_id else None
            star = build_star(
                star_id=f"simbad-{re.sub(r'[^A-Za-z0-9]+', '-', name or 'unknown').strip('-').lower()}",
                name=name,
                ra_deg=ra,
                dec_deg=dec,
                parallax_mas=plx,
                parallax_over_error=poe,
                # SIMBAD serves Johnson V, not Gaia G. Treated as a G proxy and
                # flagged in the assumptions of the catalogue-level note.
                g_mag=v,
                bp_rp=(b - v) if (b is not None and v is not None) else None,
                teff_k=None,
                source_id_label="simbad-basic",
                source_url=SIMBAD_TAP_SYNC,
                release="SIMBAD (live)",
                retrieved_at=retrieved_at,
            )
            if star:
                stars.append(star)
        return stars, {
            "mode": "vizier_mirror",
            "sourceUrls": [SIMBAD_TAP_SYNC],
            "query": SIMBAD_ADQL,
            "release": "SIMBAD basic (live)",
            "rawPath": str(raw_path),
            "checksum": sha256_bytes(payload),
            "rawRows": len(rows),
            "note": "Johnson V/B-V substituted for Gaia G/BP-RP.",
        }
    return None


def curated_fallback(retrieved_at: str) -> tuple[list[dict], dict]:
    """Published values for named stars, used only when every service fails."""
    from gaia_curated import CURATED_STARS

    stars = []
    for s in CURATED_STARS:
        plx = s.get("parallax_mas")
        poe = s.get("parallax_over_error")
        star = build_star(
            star_id=s["id"],
            name=s["name"],
            ra_deg=s["ra_deg"],
            dec_deg=s["dec_deg"],
            parallax_mas=plx,
            parallax_over_error=poe,
            g_mag=s.get("g_mag"),
            bp_rp=s.get("bp_rp"),
            teff_k=s.get("teff_k"),
            source_id_label="curated-bright-stars",
            source_url="https://www.cosmos.esa.int/web/gaia/dr3",
            release="curated from published Gaia DR3 / Hipparcos values",
            retrieved_at=retrieved_at,
        )
        if star:
            stars.append(star)
    return stars, {
        "mode": "curated_fallback",
        "sourceUrls": ["https://www.cosmos.esa.int/web/gaia/dr3"],
        "query": None,
        "release": "curated bright-star table",
        "rawPath": None,
        "checksum": None,
        "rawRows": len(stars),
    }


# --------------------------------------------------------------------- main --

def run() -> dict:
    retrieved_at = utc_now_iso()
    attempts: list[str] = []
    result = None
    if os.environ.get("COSMOS_SKIP_REMOTE") == "1":
        warn("[stars] COSMOS_SKIP_REMOTE=1 — curated fallback only")
        stars, meta = curated_fallback(retrieved_at)
        attempts.append(f"curated_fallback=ok({len(stars)} stars)")
        result = (stars, meta)
    if result is None:
        for label, fn in (
            ("gaia_async", try_gaia_async),
            ("gaia_sync", try_gaia_sync),
            ("vizier", try_vizier),
            ("simbad", try_simbad),
        ):
            try:
                result = fn(retrieved_at)
            except Exception as e:  # keep walking the ladder
                warn(f"[{label}] unexpected error: {e}")
                result = None
            if result and len(result[0]) >= 200:
                attempts.append(f"{label}=ok({len(result[0])} stars)")
                break
            attempts.append(f"{label}=failed" if not result else f"{label}=too_few({len(result[0])})")
            result = None

    if result is None:
        warn("[stars] all remote catalogues failed; using curated fallback")
        result = curated_fallback(retrieved_at)
        attempts.append(f"curated_fallback=ok({len(result[0])} stars)")

    stars, meta = result
    # Deduplicate on source record id, keep brightest ordering.
    seen = set()
    deduped = []
    for s in stars:
        if s["id"] in seen:
            continue
        seen.add(s["id"])
        deduped.append(s)
    stars = deduped

    catalog = {
        "id": "stars.gaia_dr3.bright_parallax",
        "mode": meta["mode"],
        "starCount": len(stars),
        "selectionFunction": (
            SELECTION_FUNCTION
            if meta["mode"] != "curated_fallback"
            else (
                "Curated list of named bright stars with published parallaxes, used "
                "because every remote catalogue service was unreachable. Heavily "
                "biased toward famous naked-eye stars; not a statistical sample."
            )
        )
        + (f" Source note: {meta['note']}" if meta.get("note") else ""),
        "stars": stars,
        "sourceUrls": meta["sourceUrls"],
        "retrievedAt": retrieved_at,
    }

    save_normalized(catalog, "stars_gaia_dr3.json")

    if len(stars) >= 5000:
        status, note = "ok", f"{len(stars)} stars via {meta['mode']}."
    elif len(stars) >= 200:
        status, note = "partial", f"Only {len(stars)} stars via {meta['mode']}; target was 5000+."
    else:
        status, note = "partial", f"Fallback catalogue with {len(stars)} stars."
    note += " Attempt ladder: " + ", ".join(attempts) + "."

    entry = manifest_entry(
        source_id="esa-gaia-dr3",
        source_urls=meta["sourceUrls"],
        release=meta["release"],
        query=meta["query"],
        retrieved_at=retrieved_at,
        checksum=meta["checksum"],
        license_text=(
            "Gaia data are released under CC BY-SA 3.0 IGO; cite the Gaia mission "
            "and DPAC per https://www.cosmos.esa.int/web/gaia-users/credits-terms"
        ),
        attribution="ESA/Gaia/DPAC",
        coverage=catalog["selectionFunction"],
        units="deg for ra/dec, mas for parallax, metres for distance and x/y/z, W for luminosity",
        frame="ICRS, Sun at origin, Gaia DR3 reference epoch J2016.0 for astrometry",
        validation_status=status,
        note=note,
    )
    save_manifest(entry, "stars_gaia_dr3.json")
    log(f"[stars] mode={meta['mode']} stars={len(stars)} status={status}")
    return {"catalog": catalog, "manifest": entry}


if __name__ == "__main__":
    out = run()
    sys.exit(0 if out["manifest"]["validationStatus"] != "failed" else 1)
