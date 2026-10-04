from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Server-side configuration. Secrets stay here — never in the browser bundle."""

    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", PROJECT_ROOT / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    xai_api_key: str | None = Field(default=None, alias="XAI_API_KEY")
    xai_text_model: str = Field(default="grok-4-1-fast-reasoning", alias="XAI_TEXT_MODEL")
    xai_image_model: str = Field(default="grok-imagine-image-2.0", alias="XAI_IMAGE_MODEL")
    xai_voice_model: str = Field(default="grok-voice-latest", alias="XAI_VOICE_MODEL")
    xai_voice: str = Field(default="eve", alias="XAI_VOICE")
    xai_base_url: str = Field(default="https://api.x.ai/v1", alias="XAI_BASE_URL")
    asset_dir: Path = Field(default=PROJECT_ROOT / "assets", alias="ASSET_DIR")
    cors_origins: str = Field(default="http://localhost:5173,http://127.0.0.1:5173", alias="CORS_ORIGINS")
    image_daily_limit: int = Field(default=60, alias="IMAGE_DAILY_LIMIT")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def xai_configured(self) -> bool:
        return bool(self.xai_api_key and self.xai_api_key.strip())

    @property
    def generated_dir(self) -> Path:
        d = (self.asset_dir if self.asset_dir.is_absolute() else PROJECT_ROOT / self.asset_dir) / "generated"
        d.mkdir(parents=True, exist_ok=True)
        return d


@lru_cache
def get_settings() -> Settings:
    return Settings()
