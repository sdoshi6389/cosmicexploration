import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import chat, health, voice
from app.config import get_settings
from app.worker import run_worker

settings = get_settings()

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Run the Imagine job worker alongside the API (disable with IMAGINE_WORKER=0)."""
    stop = asyncio.Event()
    task = asyncio.create_task(run_worker(stop)) if os.environ.get("IMAGINE_WORKER", "1") != "0" else None
    yield
    stop.set()
    if task:
        await asyncio.gather(task, return_exceptions=True)


app = FastAPI(title="COSMOS API", version="3.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.include_router(health.router)
app.include_router(chat.router)
app.include_router(voice.router)
app.mount("/assets/generated", StaticFiles(directory=str(settings.generated_dir)), name="generated")


@app.get("/")
def root() -> dict:
    return {"service": "cosmos-api", "docs": "/docs"}
