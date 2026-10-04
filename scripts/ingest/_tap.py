"""Minimal IVOA TAP client (sync + async) for Gaia, Exoplanet Archive, HEASARC, SIMBAD."""
from __future__ import annotations

import csv
import io
import re
import time
import urllib.parse
import urllib.request

from _common import SSL_CONTEXT, USER_AGENT, http_get, http_post_form, log


def tap_sync(base: str, adql: str, *, timeout: float = 180, fmt: str = "csv") -> bytes:
    form = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": fmt, "QUERY": adql}
    return http_post_form(f"{base}/sync", form, timeout=timeout, retries=2)


def tap_async(base: str, adql: str, *, max_wait_s: float = 1200, fmt: str = "csv") -> bytes:
    """Submit an async job, poll its phase, and download the result."""
    body = urllib.parse.urlencode(
        {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": fmt, "PHASE": "RUN", "QUERY": adql}
    ).encode()

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):  # keep the Location header
            return None

    opener = urllib.request.build_opener(
        NoRedirect, urllib.request.HTTPSHandler(context=SSL_CONTEXT)
    )
    req = urllib.request.Request(
        f"{base}/async", data=body,
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        resp = opener.open(req, timeout=120)
        job_url = resp.geturl()
        location = resp.headers.get("Location")
    except urllib.error.HTTPError as e:  # 303 See Other surfaces as HTTPError with NoRedirect
        if e.code not in (301, 302, 303):
            raise
        location = e.headers.get("Location")
        job_url = None
    job_url = location or job_url
    if not job_url:
        raise RuntimeError("TAP async: no job URL returned")
    log(f"    TAP job {job_url}")
    t0 = time.time()
    phase = ""
    while time.time() - t0 < max_wait_s:
        phase = http_get(f"{job_url}/phase", timeout=60).decode().strip()
        if phase in ("COMPLETED", "ERROR", "ABORTED"):
            break
        time.sleep(4)
    if phase != "COMPLETED":
        err = http_get(f"{job_url}/error", timeout=60)[:600] if phase == "ERROR" else b""
        raise RuntimeError(f"TAP async job ended in {phase or 'timeout'}: {err!r}")
    log(f"    job completed in {time.time() - t0:.0f}s")
    return http_get(f"{job_url}/results/result", timeout=600)


def parse_csv(data: bytes) -> list[dict[str, str]]:
    text = data.decode("utf-8", "replace")
    lines = [ln for ln in text.splitlines() if not ln.startswith("#")]
    return list(csv.DictReader(io.StringIO("\n".join(lines))))


def f_or_none(v) -> float | None:
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s.lower() in ("nan", "null", "none", "--"):
        return None
    try:
        x = float(s)
    except ValueError:
        m = re.match(r"^[-+]?\d*\.?\d+(e[-+]?\d+)?", s, re.I)
        return float(m.group(0)) if m else None
    return None if x != x else x


def parse_votable(data: bytes) -> list[dict[str, str]]:
    """Parse a VOTable (TABLEDATA, BINARY or BINARY2) into dict rows of strings."""
    if b"<BINARY" in data:
        import warnings

        from astropy.io.votable import parse_single_table

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            t = parse_single_table(io.BytesIO(data)).to_table()
        out = []
        for row in t:
            d = {}
            for name in t.colnames:
                v = row[name]
                d[name] = "" if getattr(v, "mask", False) is True or str(v) in ("--", "nan") else str(v).strip()
            out.append(d)
        return out
    import xml.etree.ElementTree as ET

    root = ET.fromstring(data)
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"
    table = root.find(f".//{ns}TABLE")
    if table is None:
        info = root.find(f".//{ns}INFO")
        raise RuntimeError(f"VOTable without TABLE: {info.text if info is not None else data[:300]!r}")
    fields = [f.get("name") for f in table.findall(f"{ns}FIELD")]
    rows = []
    for tr in table.iter(f"{ns}TR"):
        cells = [(td.text or "").strip() for td in tr.findall(f"{ns}TD")]
        rows.append(dict(zip(fields, cells)))
    return rows
