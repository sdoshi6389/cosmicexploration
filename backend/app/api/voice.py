from fastapi import APIRouter, HTTPException

from app import xai
from app.config import get_settings

router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.post("/session")
async def create_voice_session() -> dict:
    """Mint a short-lived client secret so the browser can open the Grok Voice WebSocket
    (subprotocol `xai-client-secret.<token>`) without ever seeing the API key."""
    s = get_settings()
    try:
        secret = await xai.client_secret(600)
    except xai.XaiError as e:
        raise HTTPException(status_code=e.status if e.status < 600 else 502, detail=str(e)) from e
    return {
        **secret,
        "model": s.xai_voice_model,
        "voice": s.xai_voice,
        "websocketUrl": "wss://api.x.ai/v1/realtime",
    }
