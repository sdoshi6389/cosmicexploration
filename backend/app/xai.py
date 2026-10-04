"""Thin async client for the xAI endpoints COSMOS uses.

  chat            POST /v1/chat/completions   (Grok text model with function tools)
  image           POST /v1/images/generations (Grok Imagine)
  client_secret   POST /v1/realtime/client_secrets (ephemeral token for browser Voice)
"""
from __future__ import annotations

import base64
from typing import Any

import httpx

from app.config import get_settings


class XaiError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _headers() -> dict[str, str]:
    s = get_settings()
    if not s.xai_configured:
        raise XaiError(503, "XAI_API_KEY is not configured on the server")
    return {"Authorization": f"Bearer {s.xai_api_key}", "Content-Type": "application/json"}


async def chat(system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None) -> dict[str, Any]:
    s = get_settings()
    payload: dict[str, Any] = {
        "model": s.xai_text_model,
        "messages": [{"role": "system", "content": system}, *messages],
        "temperature": 0.3,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.post(f"{s.xai_base_url}/chat/completions", headers=_headers(), json=payload)
    if r.status_code >= 400:
        raise XaiError(r.status_code, f"chat completion failed: {r.text[:400]}")
    data = r.json()
    return data["choices"][0]["message"]


async def image(prompt: str, *, aspect_ratio: str = "16:9", resolution: str = "1k") -> tuple[bytes, str]:
    s = get_settings()
    payload = {
        "model": s.xai_image_model,
        "prompt": prompt,
        "n": 1,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "response_format": "b64_json",
    }
    async with httpx.AsyncClient(timeout=180.0) as client:
        r = await client.post(f"{s.xai_base_url}/images/generations", headers=_headers(), json=payload)
        if r.status_code >= 400:
            raise XaiError(r.status_code, f"image generation failed: {r.text[:400]}")
        data = r.json()
        item = (data.get("data") or [{}])[0]
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"]), data.get("model", s.xai_image_model)
        if item.get("url"):  # provider URLs expire: download the bytes immediately
            img = await client.get(item["url"])
            img.raise_for_status()
            return img.content, data.get("model", s.xai_image_model)
    raise XaiError(502, "image response contained no image data")


async def client_secret(expires_seconds: int = 600) -> dict[str, Any]:
    s = get_settings()
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{s.xai_base_url}/realtime/client_secrets",
            headers=_headers(),
            json={"expires_after": {"seconds": expires_seconds}},
        )
    if r.status_code >= 400:
        raise XaiError(r.status_code, f"client secret request failed: {r.text[:400]}")
    data = r.json()
    secret = data.get("value") or data.get("client_secret") or data.get("clientSecret") or data.get("token")
    if isinstance(secret, dict):
        secret = secret.get("value")
    if not secret:
        raise XaiError(502, f"unexpected client secret response keys: {sorted(data)}")
    expires = data.get("expires_at") or data.get("expiresAt")
    if isinstance(data.get("client_secret"), dict):
        expires = expires or data["client_secret"].get("expires_at")
    return {"clientSecret": secret, "expiresAt": expires}
