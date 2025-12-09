import asyncio
import json
import time
from typing import Optional

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from whisper_engine import WhisperEngine

router = APIRouter()

MAX_SECONDS = 10
SAMPLE_RATE = 16000
MAX_SAMPLES = MAX_SECONDS * SAMPLE_RATE
MIN_SAMPLES_FOR_INFER = SAMPLE_RATE  # 1 second
INFER_INTERVAL = 1.0
WINDOW_SECONDS = 6
WINDOW_SAMPLES = WINDOW_SECONDS * SAMPLE_RATE

engine: Optional[WhisperEngine] = None


def ensure_engine() -> WhisperEngine:
    global engine
    if engine is None:
        engine = WhisperEngine()
    return engine


@router.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    buffer = np.zeros(0, dtype=np.float32)
    last_infer = 0.0
    engine_local = ensure_engine()
    try:
        while True:
            message = await websocket.receive()
            if "bytes" not in message:
                continue
            data = message["bytes"] or b""
            if not data:
                continue

            chunk = np.frombuffer(data, dtype=np.float32)
            if chunk.size == 0:
                continue

            buffer = np.concatenate((buffer, chunk))
            if buffer.size > MAX_SAMPLES:
                buffer = buffer[-MAX_SAMPLES:]

            now = time.time()
            if buffer.size >= MIN_SAMPLES_FOR_INFER and (now - last_infer) >= INFER_INTERVAL:
                last_infer = now
                # Use the most recent window to keep latency low.
                audio_copy = np.copy(buffer[-WINDOW_SAMPLES:])
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    None, engine_local.transcribe_array, audio_copy, None
                )
                partial_text = result.get("text", "")
                payload = json.dumps({"partial": partial_text})
                await websocket.send_text(payload)
    except WebSocketDisconnect:
        return
    except Exception as exc:  # pragma: no cover - runtime protection
        await websocket.send_text(json.dumps({"error": str(exc)}))
        return
