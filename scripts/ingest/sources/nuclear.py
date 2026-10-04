"""IAEA LiveChart of Nuclides API (ENSDF / NUBASE2020 / AME2020).

All ~3,400 ground states, plus levels and decay radiation for the traversal
nuclides: Fe-56 (heme iron), Na-22 (β⁺ source feeding B6 annihilation) and its
daughter Ne-22.
"""
from __future__ import annotations

import csv
import io

from _common import http_get
from _tap import f_or_none
from pipeline import SourceResult, save_raw

SOURCE_ID = "iaea_livechart"
API = "https://www-nds.iaea.org/relnsd/v1/data"
LEVEL_NUCLIDES = ["56fe", "22na", "22ne", "1h", "2h", "4he", "12c", "16o"]
DECAY = [("22na", "bp"), ("22na", "g"), ("60co", "bm"), ("60co", "g"), ("56co", "g")]


def _csv(raw: bytes) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))))


def _hl_text(r: dict) -> str:
    hl = (r.get("half_life") or "").strip()
    if hl.upper() == "STABLE":
        return "stable"
    op = (r.get("operator_hl") or "").strip()
    unit = (r.get("unit_hl") or "").strip()
    return f"{op}{hl} {unit}".strip()


def run() -> SourceResult:
    checksums = []
    raw = http_get(f"{API}?fields=ground_states&nuclides=all", timeout=180)
    _, cs = save_raw(SOURCE_ID, "ground_states_all.csv", raw)
    checksums.append(f"ground={cs}")
    nuclides = []
    for r in _csv(raw):
        z, n = int(r["z"]), int(r["n"])
        a = z + n
        sym = r["symbol"].strip()
        stable = (r.get("half_life") or "").strip().upper() == "STABLE"
        modes = []
        for k in ("decay_1", "decay_2", "decay_3"):
            if r.get(k):
                pct = r.get(f"{k}_%") or ""
                modes.append(f"{r[k]}{' ' + pct + '%' if pct else ''}")
        nuclides.append(
            {
                "id": f"{a}{sym}",
                "z": z,
                "n": n,
                "a": a,
                "symbol": sym,
                "halfLifeS": None if stable else f_or_none(r.get("half_life_sec")),
                "halfLifeText": _hl_text(r),
                "stable": stable,
                "spinParity": (r.get("jp") or "").strip(),
                "decayModes": "; ".join(modes),
                "massExcessKeV": f_or_none(r.get("massexcess")),
                "bindingPerNucleonKeV": f_or_none(r.get("binding")),
                "abundancePct": f_or_none(r.get("abundance")),
                "qBetaMinusKeV": f_or_none(r.get("qbm")),
                "qEcKeV": f_or_none(r.get("qec")),
            }
        )
    levels = []
    for nuc in LEVEL_NUCLIDES:
        raw = http_get(f"{API}?fields=levels&nuclides={nuc}", timeout=120)
        _, cs = save_raw(SOURCE_ID, f"levels_{nuc}.csv", raw)
        checksums.append(f"{nuc}={cs}")
        rows = _csv(raw)
        for i, r in enumerate(rows[:40]):
            e = f_or_none(r.get("energy"))
            if e is None:
                continue
            levels.append(
                {
                    "id": f"{nuc}:{i}",
                    "nuclide": nuc,
                    "energyKeV": e,
                    "spinParity": (r.get("jp") or "").strip(),
                    "halfLifeText": " ".join(
                        x for x in [(r.get("half_life") or "").strip(), (r.get("unit_hl") or "").strip()] if x
                    ),
                    "source": "IAEA LiveChart levels (ENSDF)",
                }
            )
    rads = []
    for nuc, kind in DECAY:
        raw = http_get(f"{API}?fields=decay_rads&nuclides={nuc}&rad_types={kind}", timeout=120)
        _, cs = save_raw(SOURCE_ID, f"decay_{nuc}_{kind}.csv", raw)
        checksums.append(f"{nuc}-{kind}={cs}")
        for i, r in enumerate(_csv(raw)):
            # β spectra report mean energy; gammas report the line energy.
            e = f_or_none(r.get("mean_energy")) if kind in ("bp", "bm") else f_or_none(r.get("energy"))
            if e is None:
                continue
            rads.append(
                {
                    "id": f"{nuc}:{kind}:{i}",
                    "parent": nuc,
                    "decayMode": (r.get("decay") or "").strip() or kind,
                    "radiationType": {"bp": "beta+", "bm": "beta-", "g": "gamma"}[kind],
                    "energyKeV": e,
                    "intensityPct": f_or_none(r.get("intensity_beta") if kind in ("bp", "bm") else r.get("intensity")),
                    "source": "IAEA LiveChart decay_rads (ENSDF)",
                }
            )
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="IAEA LiveChart of Nuclides (ENSDF / NUBASE / AME)",
        category="nuclear",
        tables={"nuclide": nuclides, "nuclear_level": levels, "decay_radiation": rads},
        source_urls=[API, "https://www-nds.iaea.org/relnsd/vcharthtml/api_v0_guide.html",
                     "https://www.nndc.bnl.gov/ensdf/"],
        release="LiveChart API v1 (ENSDF evaluations; AME2020 masses)",
        query=f"ground_states all; levels {LEVEL_NUCLIDES}; decay_rads {DECAY}",
        license="IAEA Nuclear Data Services — free use with citation",
        attribution="IAEA Nuclear Data Section; ENSDF (NNDC, Brookhaven National Laboratory)",
        coverage=f"{len(nuclides)} ground states, {len(levels)} levels, {len(rads)} decay radiations",
        units="keV, s, %",
        raw_checksums=checksums,
        note="ENSDF evaluations are served via the IAEA LiveChart API (NuDat3 has no bulk REST API).",
    )
