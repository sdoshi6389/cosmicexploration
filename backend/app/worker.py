"""Grok Imagine worker for SpacetimeDB calculation jobs.

The worker is an ordinary SpacetimeDB client with its own identity (registered by the
admin via the `register_worker` reducer). It polls `calculation_job` (row-level
security only shows it jobs of its kind), leases a job with `claim_job`, renders the
server-built prompt with Grok Imagine, stores the bytes locally, and calls
`complete_job`. SpacetimeDB rejects the result as `stale` if the level's output
changed after the request, and rejects calls from anyone who does not hold the lease.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx

from app import xai
from app.config import PROJECT_ROOT, get_settings

log = logging.getLogger("cosmos.worker")

HOST = os.environ.get("SPACETIME_HOST", "https://maincloud.spacetimedb.com")
DB = os.environ.get("SPACETIME_DB", "cosmicexploration-dejjt")
IDENTITY_FILE = PROJECT_ROOT / "backend" / ".worker_identity.json"
LEASE_SECONDS = 120
POLL_SECONDS = 2.0


class Stdb:
    """Minimal SpacetimeDB HTTP client (SQL reads + reducer calls) under one identity."""

    def __init__(self, client: httpx.AsyncClient):
        self.client = client
        self.identity = ""
        self.token = ""

    async def ensure_identity(self) -> None:
        if IDENTITY_FILE.exists():
            data = json.loads(IDENTITY_FILE.read_text(encoding="utf-8"))
            self.identity, self.token = data["identity"], data["token"]
            return
        r = await self.client.post(f"{HOST}/v1/identity")
        r.raise_for_status()
        data = r.json()
        self.identity, self.token = data["identity"], data["token"]
        IDENTITY_FILE.write_text(json.dumps({"identity": self.identity, "token": self.token}), encoding="utf-8")
        log.warning("created worker identity %s — register it: spacetime call %s register_worker '\"%s\"' '\"imagine\"' '\"imagine-worker\"' --server maincloud", self.identity, DB, self.identity)

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    async def sql(self, query: str) -> list[dict[str, Any]]:
        r = await self.client.post(f"{HOST}/v1/database/{DB}/sql", content=query, headers=self._auth())
        r.raise_for_status()
        out: list[dict[str, Any]] = []
        for stmt in r.json():
            names = [e["name"]["some"] if isinstance(e.get("name"), dict) else e.get("name") for e in stmt["schema"]["elements"]]
            out += [dict(zip(names, row)) for row in stmt["rows"]]
        return out

    async def call(self, reducer: str, *args: Any) -> tuple[bool, str]:
        r = await self.client.post(f"{HOST}/v1/database/{DB}/call/{reducer}", json=list(args), headers=self._auth())
        return r.status_code < 300, r.text


async def process(stdb: Stdb, job: dict[str, Any]) -> str:
    job_id = job["id"]
    ok, msg = await stdb.call("claim_job", job_id, LEASE_SECONDS)
    if not ok:
        return f"claim refused: {msg[:160]}"
    payload = json.loads(job["payload_json"] or "{}")
    prompt = str(payload.get("prompt", ""))[:3800]
    s = get_settings()
    try:
        key = hashlib.sha256(f"{s.xai_image_model}\n{prompt}".encode()).hexdigest()[:24]
        out = s.generated_dir / f"{key}.png"
        model = s.xai_image_model
        if not out.exists():
            data, model = await xai.image(prompt)
            out.write_bytes(data)
        label = f"Illustrative concept (Grok Imagine) · {job['level'].upper()} rev {job['revision']} · not a simulation output"
        ok, msg = await stdb.call("complete_job", job_id, f"/assets/generated/{out.name}", model, label)
        return "completed" if ok else f"complete refused: {msg[:160]}"
    except Exception as e:  # noqa: BLE001 — report any render failure back to the job
        await stdb.call("fail_job", job_id, str(e)[:400])
        return f"failed: {e}"


async def run_worker(stop: asyncio.Event) -> None:
    s = get_settings()
    if not s.xai_configured:
        log.warning("Imagine worker disabled: XAI_API_KEY not configured")
        return
    async with httpx.AsyncClient(timeout=30) as client:
        stdb = Stdb(client)
        try:
            await stdb.ensure_identity()
        except Exception as e:  # noqa: BLE001
            log.error("worker could not obtain a SpacetimeDB identity: %s", e)
            return
        log.info("Imagine worker running as %s", stdb.identity[:16])
        while not stop.is_set():
            try:
                jobs = await stdb.sql("SELECT * FROM calculation_job WHERE status = 'queued'")
                for job in jobs:
                    if job.get("kind") != "imagine":
                        continue
                    result = await process(stdb, job)
                    log.info("job %s: %s", job["id"], result)
            except httpx.HTTPError as e:
                log.debug("poll error: %s", e)
            except Exception as e:  # noqa: BLE001
                log.warning("worker loop error: %s", e)
            try:
                await asyncio.wait_for(stop.wait(), timeout=POLL_SECONDS)
            except asyncio.TimeoutError:
                pass


def worker_identity() -> str | None:
    if IDENTITY_FILE.exists():
        return json.loads(IDENTITY_FILE.read_text(encoding="utf-8")).get("identity")
    return None


__all__ = ["run_worker", "worker_identity", "Path"]
