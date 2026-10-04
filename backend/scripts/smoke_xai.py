"""Live smoke test of every xAI integration COSMOS uses (prints no secrets).

    .venv/Scripts/python.exe scripts/smoke_xai.py [--no-image]
"""
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import xai  # noqa: E402
from app.config import get_settings  # noqa: E402


async def main() -> int:
    s = get_settings()
    print(f"xai configured: {s.xai_configured} | text={s.xai_text_model} image={s.xai_image_model} voice={s.xai_voice_model}")
    ok = True
    t = time.time()
    try:
        msg = await xai.chat(
            "You are a test harness. Call the tool.",
            [{"role": "user", "content": "Navigate to the galaxy."}],
            [{"type": "function", "function": {"name": "navigate", "description": "Fly to a stop", "parameters": {"type": "object", "properties": {"stop": {"type": "string", "enum": ["galaxy", "earth"]}}, "required": ["stop"]}}}],
        )
        calls = [c["function"]["name"] + c["function"]["arguments"] for c in (msg.get("tool_calls") or [])]
        print(f"[chat]  ok in {time.time() - t:.1f}s | tool_calls={calls} | content={str(msg.get('content'))[:80]!r}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"[chat]  FAILED: {e}")
    t = time.time()
    try:
        sec = await xai.client_secret(60)
        print(f"[voice] client secret minted in {time.time() - t:.1f}s | length={len(sec['clientSecret'])} | expiresAt={sec['expiresAt']}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"[voice] FAILED: {e}")
    if "--no-image" not in sys.argv:
        t = time.time()
        try:
            data, model = await xai.image("A Dyson swarm of golden hexagonal collectors partially veiling a bright yellow star, cinematic space art, no text.")
            out = s.generated_dir / "smoke_test.png"
            out.write_bytes(data)
            print(f"[image] {model} returned {len(data):,} bytes in {time.time() - t:.1f}s -> {out}")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"[image] FAILED: {e}")
    print("ALL OK" if ok else "SOME CHECKS FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
