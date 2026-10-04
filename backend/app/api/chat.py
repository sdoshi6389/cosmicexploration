from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import xai

router = APIRouter(prefix="/api", tags=["chat"])


class ChatBody(BaseModel):
    system: str
    messages: list[dict[str, Any]] = Field(default_factory=list)
    tools: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/chat")
async def chat(body: ChatBody) -> dict:
    """One planning step: Grok returns text and/or tool calls; the client executes tools
    through its validated command gateway and posts the results back for the next step."""
    if len(body.messages) > 60:
        raise HTTPException(status_code=413, detail="conversation too long")
    try:
        message = await xai.chat(body.system[:24000], body.messages, body.tools or None)
    except xai.XaiError as e:
        raise HTTPException(status_code=e.status if e.status < 600 else 502, detail=str(e)) from e
    return {
        "message": {
            "role": "assistant",
            "content": message.get("content"),
            "tool_calls": message.get("tool_calls") or None,
        }
    }
