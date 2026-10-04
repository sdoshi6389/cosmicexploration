"""Particle Data Group API database (SQLite snapshot): summary-table particle properties."""
from __future__ import annotations

import sqlite3

from _common import http_get, log, sha256_file
from pipeline import SourceResult, raw_dir

SOURCE_ID = "pdg"
EDITION = "2025"
URL = f"https://pdg.lbl.gov/{EDITION}/api/pdgall-{EDITION}-v0.2.0.sqlite"
UNIT_TO_MEV = {"MeV": 1.0, "GeV": 1e3, "keV": 1e-3, "eV": 1e-6, "TeV": 1e6}


def _category(mc: int) -> str:
    a = abs(mc)
    if 1 <= a <= 8:
        return "quark"
    if 11 <= a <= 18:
        return "lepton"
    if a in (21, 22, 23, 24):
        return "gauge boson"
    if a == 25:
        return "scalar boson"
    if 100 <= a < 1000 or 10000 <= a < 1_000_000 and (a // 1000) % 10 == 0:
        return "meson"
    if 1000 <= a < 10000:
        return "baryon"
    return "other"


def _value(cur, pdgid: str, dtype: str):
    """Summary-table value for the particle's child quantity of a given data type."""
    child = cur.execute(
        "SELECT pdgid, flags FROM pdgid WHERE parent_pdgid = ? AND data_type = ? ORDER BY "
        "CASE WHEN flags LIKE '%D%' THEN 0 ELSE 1 END, sort LIMIT 1",
        (pdgid, dtype),
    ).fetchone()
    if not child:
        return None
    row = cur.execute(
        "SELECT value, error_positive, error_negative, unit_text, limit_type FROM pdgdata "
        "WHERE pdgid = ? AND edition = ? AND in_summary_table = 1 ORDER BY sort LIMIT 1",
        (child[0], EDITION),
    ).fetchone()
    if not row or row[0] is None or row[4]:  # skip limits (lower/upper bounds)
        return None
    return row


def run() -> SourceResult:
    path = raw_dir(SOURCE_ID) / f"pdgall-{EDITION}-v0.2.0.sqlite"
    if not path.exists():
        log(f"  downloading {URL}")
        path.write_bytes(http_get(URL, timeout=600))
    cs = sha256_file(path)
    con = sqlite3.connect(str(path))
    cur = con.cursor()
    citation = dict(cur.execute("SELECT name, value FROM pdginfo").fetchall()).get("citation", "")
    rows = []
    for pid, pdgid, name, mc, charge, qi, qj, qp, qc in cur.execute(
        "SELECT id, pdgid, name, mcid, charge, quantum_i, quantum_j, quantum_p, quantum_c "
        "FROM pdgparticle WHERE mcid IS NOT NULL"
    ).fetchall():
        c2 = con.cursor()
        mass = _value(c2, pdgid, "M")
        width = _value(c2, pdgid, "G")
        life = _value(c2, pdgid, "T")
        mass_mev = mass_err = width_mev = life_s = None
        if mass:
            f = UNIT_TO_MEV.get((mass[3] or "MeV").strip(), 1.0)
            mass_mev = mass[0] * f
            mass_err = max(mass[1] or 0, mass[2] or 0) * f
        if width:
            width_mev = width[0] * UNIT_TO_MEV.get((width[3] or "MeV").strip(), 1.0)
        if life and (life[3] or "s").strip() == "s":
            life_s = life[0]
        if pdgid == "S000":  # photon: massless by definition in the summary
            mass_mev = 0.0
        rows.append(
            {
                "id": f"pdg.{mc}",
                "mcId": int(mc),
                "name": name,
                "pdgId": pdgid,
                "charge": float(charge or 0),
                "spin": qj or "",
                "parity": qp or "",
                "cParity": qc or "",
                "isospin": qi or "",
                "massMeV": mass_mev,
                "massErrMeV": mass_err,
                "widthMeV": width_mev,
                "lifetimeS": life_s,
                "category": _category(int(mc)),
                "edition": EDITION,
            }
        )
    con.close()
    with_mass = sum(1 for r in rows if r["massMeV"] is not None)
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="Particle Data Group — API database",
        category="particle",
        tables={"pdg_particle": rows},
        source_urls=[URL, f"https://pdg.lbl.gov/{EDITION}/api/index.html"],
        release=f"PDG {EDITION} edition (pdgall-{EDITION}-v0.2.0)",
        query="pdgparticle with MC id; summary-table M/G/T values (limits excluded)",
        license="CC BY 4.0",
        attribution=citation,
        coverage=f"{len(rows)} particle charge states, {with_mass} with summary masses",
        units="MeV, s, e",
        raw_checksums=[f"{path.name}={cs}"],
    )
