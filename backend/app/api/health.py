from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health() -> dict:
    s = get_settings()
    return {
        "status": "ok",
        "xai_configured": s.xai_configured,
        "models": {"text": s.xai_text_model, "image": s.xai_image_model, "voice": s.xai_voice_model},
        "persistence": "SpacetimeDB (client-side subscription)",
    }
