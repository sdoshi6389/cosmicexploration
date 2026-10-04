"""NIST Atomic Spectra Database: evaluated levels, lines (with Einstein A) and ionization energies.

ASD tables do not supply many-electron wavefunctions. B4 renders an analytic
hydrogenic orbital for H I and labels clouds for other species as illustrative.
"""
from __future__ import annotations

import csv
import io
import re
import urllib.parse

from _common import http_get, log
from pipeline import SourceResult, save_raw

SOURCE_ID = "nist_asd"
LEVELS = "https://physics.nist.gov/cgi-bin/ASD/energy1.pl"
LINES = "https://physics.nist.gov/cgi-bin/ASD/lines1.pl"
IE = "https://physics.nist.gov/cgi-bin/ASD/ie.pl"

SPECIES = {"H I": 400, "He I": 60, "C I": 60, "N I": 60, "O I": 60, "Na I": 40, "Fe I": 60}
LINE_SPECIES = {"H I": (80, 2700), "He I": (50, 2200), "Na I": (250, 1200), "O I": (100, 1400)}
ORB = "spdfghiklmnoqrtuv"


def _clean(v: str) -> str:
    return v.strip().strip('"').strip()


def _num(v: str):
    s = _clean(v).strip("[]()?+x ").replace(" ", "")
    try:
        return float(s)
    except ValueError:
        return None


def _tsv(raw: bytes) -> list[dict[str, str]]:
    text = raw.decode("utf-8", "replace")
    return [
        {k.strip(): (v or "") for k, v in r.items() if k}
        for r in csv.DictReader(io.StringIO(text), delimiter="\t")
    ]


def run() -> SourceResult:
    levels, lines, ies, checksums = [], [], [], []
    for sp, cap in SPECIES.items():
        q = {
            "de": "0", "spectrum": sp, "units": "1", "format": "3", "output": "0", "page_size": "15",
            "multiplet_ordered": "0", "conf_out": "on", "term_out": "on", "level_out": "on",
            "unc_out": "1", "j_out": "on", "biblio": "on", "submit": "Retrieve Data",
        }
        raw = http_get(f"{LEVELS}?{urllib.parse.urlencode(q)}", timeout=120, browser_ua=True)
        _, cs = save_raw(SOURCE_ID, f"levels_{sp.replace(' ', '_')}.tsv", raw)
        checksums.append(f"{sp}={cs}")
        count = 0
        for i, r in enumerate(_tsv(raw)):
            e = _num(r.get("Level (eV)", ""))
            conf = _clean(r.get("Configuration", ""))
            if e is None or not conf:
                continue
            n = l = None
            if sp == "H I":
                m = re.match(r"^(\d+)([a-z])?$", conf)
                if not m:
                    continue
                n = int(m.group(1))
                l = ORB.index(m.group(2)) if m.group(2) else None
                if n > 12:
                    continue
            levels.append(
                {
                    "id": f"{sp.replace(' ', '')}:{i}",
                    "species": sp,
                    "configuration": conf,
                    "term": _clean(r.get("Term", "")),
                    "j": _clean(r.get("J", "")),
                    "energyEv": e,
                    "uncertaintyEv": _num(r.get("Uncertainty (eV)", "")),
                    "n": n,
                    "l": l,
                    "reference": _clean(r.get("Reference", "")),
                }
            )
            count += 1
            if count >= cap:
                break
        log(f"  NIST levels {sp}: {count}")

    for sp, (lo, hi) in LINE_SPECIES.items():
        q = {
            "spectra": sp, "limits_type": "0", "low_w": str(lo), "upp_w": str(hi), "unit": "1",
            "de": "0", "format": "3", "line_out": "0", "remove_js": "on", "en_unit": "1", "output": "0",
            "bibrefs": "1", "page_size": "15", "show_obs_wl": "1", "show_calc_wl": "1", "unc_out": "1",
            "order_out": "0", "show_av": "2", "tsb_value": "0", "A_out": "0", "intens_out": "on",
            "allowed_out": "1", "forbid_out": "1", "conf_out": "on", "term_out": "on", "enrg_out": "on",
            "J_out": "on", "submit": "Retrieve Data",
        }
        raw = http_get(f"{LINES}?{urllib.parse.urlencode(q)}", timeout=120, browser_ua=True)
        _, cs = save_raw(SOURCE_ID, f"lines_{sp.replace(' ', '_')}.tsv", raw)
        checksums.append(f"lines {sp}={cs}")
        count = 0
        for i, r in enumerate(_tsv(raw)):
            wl = _num(r.get("obs_wl_vac(nm)", "")) or _num(r.get("ritz_wl_vac(nm)", ""))
            ei, ek = _num(r.get("Ei(eV)", "")), _num(r.get("Ek(eV)", ""))
            if wl is None or ei is None or ek is None:
                continue
            uconf = _clean(r.get("conf_k", ""))
            if sp == "H I" and re.match(r"^\d+$", uconf) and int(uconf) > 12:
                continue
            lines.append(
                {
                    "id": f"{sp.replace(' ', '')}:L{i}",
                    "species": sp,
                    "wavelengthVacNm": wl,
                    "akiPerS": _num(r.get("Aki(s^-1)", "")),
                    "accuracy": _clean(r.get("Acc", "")),
                    "eiEv": ei,
                    "ekEv": ek,
                    "lowerConf": _clean(r.get("conf_i", "")),
                    "lowerTerm": _clean(r.get("term_i", "")),
                    "lowerJ": _clean(r.get("J_i", "")),
                    "upperConf": uconf,
                    "upperTerm": _clean(r.get("term_k", "")),
                    "upperJ": _clean(r.get("J_k", "")),
                    "lineType": _clean(r.get("Type", "")) or "E1",
                }
            )
            count += 1
        log(f"  NIST lines {sp}: {count}")

    q = {
        "spectra": "H-Fe", "units": "1", "format": "3", "order": "0", "at_num_out": "on",
        "sp_name_out": "on", "ion_charge_out": "on", "el_name_out": "on", "e_out": "0",
        "unc_out": "on", "biblio": "on", "submit": "Retrieve Data",
    }
    raw = http_get(f"{IE}?{urllib.parse.urlencode(q)}", timeout=120, browser_ua=True)
    _, cs = save_raw(SOURCE_ID, "ionization_H-Fe.tsv", raw)
    checksums.append(f"ie={cs}")
    for r in _tsv(raw):
        name = _clean(r.get("Sp. Name", ""))
        charge = _clean(r.get("Ion Charge", ""))
        key = next((k for k in r if k.startswith("Ionization Energy")), None)
        if not name or charge not in ("0", "+0") or not key:
            continue
        ev = _num(r[key])
        if ev is None:
            continue
        ies.append(
            {"species": name, "element": _clean(r.get("El. Name", "")), "ionizationEv": ev,
             "reference": _clean(r.get("Ref.", ""))}
        )
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="NIST Atomic Spectra Database (ver. 5.12)",
        category="atomic",
        tables={"nist_level": levels, "nist_line": lines, "ionization_energy": ies},
        source_urls=[LEVELS, LINES, IE],
        release="NIST ASD v5.12 (live query)",
        query=f"levels {list(SPECIES)}; lines {list(LINE_SPECIES)}; IE H–Fe neutral",
        license="Public domain (NIST SRD 78)",
        attribution="Kramida, A., Ralchenko, Yu., Reader, J., and NIST ASD Team",
        coverage=f"{len(levels)} levels, {len(lines)} lines, {len(ies)} ionization energies",
        units="eV, nm (vacuum), s^-1",
        raw_checksums=checksums,
        note="H I configurations limited to n ≤ 12; other species first N levels by energy.",
    )
