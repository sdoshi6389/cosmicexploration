"""Human Cell Atlas Data Portal (Azul): projects with blood / bone-marrow specimens.

Provides cell-type and tissue context for the B2 erythrocyte journey. HCA does not
provide 3D anatomy or simulated cell behaviour; the scene states that explicitly.
"""
from __future__ import annotations

import json
import urllib.parse

from _common import http_get
from pipeline import SourceResult, save_raw

SOURCE_ID = "human_cell_atlas"
AZUL = "https://service.azul.data.humancellatlas.org/index/projects"
ORGANS = ["blood", "bone marrow"]


def run() -> SourceResult:
    filters = urllib.parse.quote(json.dumps({"organ": {"is": ORGANS}}))
    hits, url = [], f"{AZUL}?filters={filters}&size=50"
    pages = 0
    while url and pages < 5:
        d = json.loads(http_get(url, timeout=120))
        save_raw(SOURCE_ID, f"projects_page{pages}.json", json.dumps(d))
        hits.extend(d.get("hits", []))
        url = (d.get("pagination") or {}).get("next")
        pages += 1
    rows = []
    for h in hits:
        p = h["projects"][0]
        organs, cell_types, total = set(), set(), 0.0
        for cs in h.get("cellSuspensions") or []:
            organs.update(o for o in cs.get("organ") or [] if o)
            cell_types.update(c for c in cs.get("selectedCellType") or [] if c)
            total += cs.get("totalCells") or 0
        donors = sum((d.get("donorCount") or 0) for d in h.get("donorOrganisms") or [])
        assays = set()
        for pr in h.get("protocols") or []:
            assays.update(a for a in pr.get("libraryConstructionApproach") or [] if a)
        est = p.get("estimatedCellCount") or (total or None)
        rows.append(
            {
                "id": p["projectId"],
                "title": p["projectTitle"],
                "organs": "|".join(sorted(organs)),
                "cellCount": est,
                "donorCount": donors or None,
                "cellTypes": "|".join(sorted(cell_types))[:900],
                "assays": "|".join(sorted(assays))[:300],
                "url": f"https://data.humancellatlas.org/explore/projects/{p['projectId']}",
            }
        )
    return SourceResult(
        source_id=SOURCE_ID,
        source_name="Human Cell Atlas Data Portal (Azul)",
        category="biology",
        tables={"hca_project": rows},
        source_urls=[AZUL, "https://data.humancellatlas.org/apis"],
        release="default Azul catalog (live)",
        query=f"projects filters organ in {ORGANS}",
        license="Per-project data use terms (mostly CC BY 4.0)",
        attribution="Human Cell Atlas Data Coordination Platform",
        coverage=f"{len(rows)} projects with blood / bone-marrow specimens",
        units="cells, donors",
        raw_checksums=[],
        note="Metadata context only; no anatomy meshes or cell simulations come from HCA.",
    )
