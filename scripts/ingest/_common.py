"""Shared paths, HTTP, checksums, and manifest helpers for COSMOS ingest.

Every normalized file written by the adapters in this package must deserialize
into the types declared in `apps/web/src/data/types.ts`. That file is the
authoritative contract and is never edited from here.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

TRANSFORMATION_VERSION = "2.0.0"
DATASET_VERSION = "2.0.0"

ROOT = Path(__file__).resolve().parents[2]
DATA_RAW = ROOT / "data" / "raw"
DATA_NORMALIZED = ROOT / "data" / "normalized"
DATA_MANIFESTS = ROOT / "data" / "manifests"
WEB_PUBLIC = ROOT / "apps" / "web" / "public"
WEB_DATA = WEB_PUBLIC / "data"
WEB_TEXTURES = WEB_PUBLIC / "textures"

USER_AGENT = (
    "COSMOS-Ingest/2.0 (UMich Hackathon multiscale universe sandbox; "
    "educational, non-commercial; contact: cosmos-ingest@example.org)"
)
# Several science portals (NIST ASD in particular) reject non-browser agents.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

try:  # JPL/NAIF chains fail against the Windows store; certifi's bundle is complete.
    import certifi

    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:  # pragma: no cover
    SSL_CONTEXT = ssl.create_default_context()

PARSEC_M = 3.0856775814913673e16
LSUN_W = 3.828e26
AU_M = 1.495978707e11
KM_TO_M = 1000.0


# ----------------------------------------------------------------- basics ---

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def log(msg: str) -> None:
    print(msg, flush=True)


def warn(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def write_json(path: Path, obj: object, *, compact: bool = False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    else:
        text = json.dumps(obj, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    path.write_text(text, encoding="utf-8")
    return path


def round_sig(value: float | None, digits: int = 6) -> float | None:
    """Round to N significant digits to keep large catalogues compact.

    Star coordinates carry ~1e17 m magnitudes; six significant digits is far
    finer than the parallax uncertainty and avoids multi-MB float literals.
    """
    if value is None:
        return None
    if value == 0 or not (value == value) or value in (float("inf"), float("-inf")):
        return 0.0 if value == 0 else None
    from math import floor, log10

    exp = floor(log10(abs(value)))
    return round(value, -(exp - (digits - 1)))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_raw(name: str, data: bytes | str) -> Path:
    DATA_RAW.mkdir(parents=True, exist_ok=True)
    path = DATA_RAW / name
    if isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_bytes(data)
    return path


# ------------------------------------------------------------------- http ---

class HttpError(Exception):
    """Raised when a bounded-retry HTTP fetch exhausts its attempts."""


def http_get(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 90.0,
    retries: int = 3,
    backoff: float = 2.0,
    browser_ua: bool = False,
) -> bytes:
    """GET with a descriptive User-Agent, bounded retries and exponential backoff."""
    return _request(
        url,
        data=None,
        headers=headers,
        timeout=timeout,
        retries=retries,
        backoff=backoff,
        browser_ua=browser_ua,
    )


def http_post_form(
    url: str,
    form: dict[str, str],
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 90.0,
    retries: int = 3,
    backoff: float = 2.0,
    browser_ua: bool = False,
    return_url: bool = False,
) -> bytes | tuple[bytes, str]:
    body = urllib.parse.urlencode(form).encode("ascii")
    hdrs = dict(headers or {})
    hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded")
    return _request(
        url,
        data=body,
        headers=hdrs,
        timeout=timeout,
        retries=retries,
        backoff=backoff,
        browser_ua=browser_ua,
        return_url=return_url,
    )


def _request(
    url: str,
    *,
    data: bytes | None,
    headers: dict[str, str] | None,
    timeout: float,
    retries: int,
    backoff: float,
    browser_ua: bool,
    return_url: bool = False,
):
    hdrs = {
        "User-Agent": BROWSER_UA if browser_ua else USER_AGENT,
        "Accept": "*/*",
        "Accept-Encoding": "gzip, identity",
    }
    hdrs.update(headers or {})
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, data=data, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
                payload = resp.read()
                if resp.headers.get("Content-Encoding", "").lower() == "gzip":
                    payload = gzip.decompress(payload)
                if return_url:
                    return payload, resp.geturl()
                return payload
        except urllib.error.HTTPError as e:  # noqa: PERF203 - need per-attempt handling
            body = b""
            try:
                body = e.read()[:400]
            except Exception:  # pragma: no cover - best effort diagnostics
                pass
            last = HttpError(f"HTTP {e.code} {e.reason} for {url}: {body!r}")
            # 4xx other than 429 will not get better by retrying.
            if e.code < 500 and e.code != 429:
                break
        except Exception as e:
            last = e
        if attempt < retries:
            time.sleep(backoff ** attempt)
    raise HttpError(f"GET/POST failed after {retries} attempt(s): {url}") from last


# --------------------------------------------------------------- manifests ---

VALID_STATUS = ("ok", "partial", "failed")


def manifest_entry(
    *,
    source_id: str,
    source_urls: Iterable[str],
    release: str | None,
    query: str | None,
    retrieved_at: str | None = None,
    checksum: str | None = None,
    license_text: str | None = None,
    attribution: str | None = None,
    coverage: str | None = None,
    units: str | None = None,
    frame: str | None = None,
    validation_status: str = "ok",
    note: str | None = None,
) -> dict:
    """Build a dict matching `DatasetManifestEntry` in types.ts exactly."""
    if validation_status not in VALID_STATUS:
        raise ValueError(f"validationStatus must be one of {VALID_STATUS}, got {validation_status!r}")
    return {
        "sourceId": source_id,
        "sourceUrls": list(dict.fromkeys(source_urls)),
        "release": release,
        "query": query,
        "retrievedAt": retrieved_at or utc_now_iso(),
        "checksum": checksum,
        "license": license_text,
        "attribution": attribution,
        "coverage": coverage,
        "units": units,
        "frame": frame,
        "validationStatus": validation_status,
        "note": note,
    }


def save_manifest(entry: dict, filename: str) -> Path:
    """Persist a DatasetManifestEntry to data/manifests/<filename>."""
    return write_json(DATA_MANIFESTS / filename, entry)


def save_normalized(obj: object, filename: str) -> Path:
    """Persist a normalized payload and return its path."""
    return write_json(DATA_NORMALIZED / filename, obj)


def provenance(
    *,
    evidence_kind: str,
    source_id: str,
    source_url: str | None = None,
    source_record_id: str | None = None,
    release: str | None = None,
    retrieved_at: str | None = None,
    method: str | None = None,
    assumptions: list[str] | None = None,
) -> dict:
    """Build the `Provenance` mixin. Never label modelled values as observed."""
    if evidence_kind not in ("observed", "derived", "assumed", "simulated", "generated"):
        raise ValueError(f"bad evidenceKind {evidence_kind!r}")
    out: dict[str, Any] = {"evidenceKind": evidence_kind, "sourceId": source_id}
    if source_url:
        out["sourceUrl"] = source_url
    if source_record_id:
        out["sourceRecordId"] = source_record_id
    if release:
        out["release"] = release
    if retrieved_at:
        out["retrievedAt"] = retrieved_at
    if method:
        out["method"] = method
    if assumptions:
        out["assumptions"] = assumptions
    return out
