import asyncio
import json
import time
import os
import logging
from collections import deque
from typing import Optional

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from engine_manager import DEFAULT_MODEL, ensure_engine, installed_models, supported_models, BACKEND
from download_model import fetch_model
from cpp_model import download_cpp_model

router = APIRouter()
logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
MAX_SECONDS = 10
MAX_SAMPLES = MAX_SECONDS * SAMPLE_RATE
DEFAULT_MIN_SECONDS = 0.5
DEFAULT_INFER_INTERVAL = 0.5
DEFAULT_WINDOW_SECONDS = 4
DEFAULT_VOICE_FACTOR = 0.2  # position between min/max RMS to decide speech
ENERGY_HISTORY = 50

@router.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    buffer = np.zeros(0, dtype=np.float32)
    last_infer = 0.0
    backlog_processed = False
    engine_local: Optional = None
    pending_text = ""
    confirmed_text = ""
    final_history: list[str] = []
    last_ids = []
    chunk_meta = deque()  # (id, start, end)
    current_model = DEFAULT_MODEL
    query_params = websocket.query_params
    try:
        window_seconds = float(query_params.get("window", DEFAULT_WINDOW_SECONDS))
    except ValueError:
        window_seconds = DEFAULT_WINDOW_SECONDS
    try:
        infer_interval = float(query_params.get("interval", DEFAULT_INFER_INTERVAL))
    except ValueError:
        infer_interval = DEFAULT_INFER_INTERVAL
    try:
        min_seconds = float(query_params.get("min_seconds", DEFAULT_MIN_SECONDS))
    except ValueError:
        min_seconds = DEFAULT_MIN_SECONDS
    try:
        voice_factor = float(query_params.get("voice_factor", DEFAULT_VOICE_FACTOR))
    except ValueError:
        voice_factor = DEFAULT_VOICE_FACTOR

    window_seconds = max(0.5, min(window_seconds, MAX_SECONDS))
    infer_interval = max(0.2, min(infer_interval, 2.0))
    min_seconds = max(0.1, min(min_seconds, window_seconds))
    voice_factor = max(0.05, min(voice_factor, 0.9))

    window_samples = int(window_seconds * SAMPLE_RATE)
    min_samples_for_infer = int(min_seconds * SAMPLE_RATE)
    energy_history = deque(maxlen=ENERGY_HISTORY)
    last_debug = 0.0

    async def send_models_message():
        await websocket.send_text(
            json.dumps(
                {
                    "type": "models",
                    "supported": supported_models(),
                    "installed": installed_models(),
                    "default": DEFAULT_MODEL,
                    "current": current_model,
                }
            )
        )

    async def load_engine(model_name: str) -> Optional:
        try:
            await websocket.send_text(json.dumps({"status": f"loading model {model_name}"}))
            eng = ensure_engine(model_name, download=False)
            info = eng.info()
            await websocket.send_text(
                json.dumps(
                    {
                        "status": f"model loaded {info['model']}",
                        "device": info.get("device"),
                        "compute_type": info.get("compute_type"),
                        "type": "model_info",
                    }
                )
            )
            return eng
        except FileNotFoundError:
            await websocket.send_text(json.dumps({"status": f"downloading model {model_name}"}))
            loop = asyncio.get_event_loop()
            try:
                if BACKEND == "cpp":
                    await loop.run_in_executor(None, download_cpp_model, model_name, os.getenv("WHISPER_MODELS_DIR"))
                else:
                    await loop.run_in_executor(None, fetch_model, model_name, BACKEND)
                await websocket.send_text(json.dumps({"status": f"download complete {model_name}"}))
                eng = ensure_engine(model_name, download=False)
                info = eng.info()
                await websocket.send_text(
                    json.dumps(
                        {
                            "status": f"model loaded {info['model']}",
                            "device": info.get("device"),
                            "compute_type": info.get("compute_type"),
                            "type": "model_info",
                        }
                    )
                )
                return eng
            except Exception as exc:
                logger.error("Model load failed (download): %s", exc, exc_info=True)
                await websocket.send_text(json.dumps({"error": f"model load failed: {exc}"}))
                return None
        except Exception as exc:
            logger.error("Model load failed: %s", exc, exc_info=True)
            logger.error("Model load failed: %s", exc, exc_info=True)
            await websocket.send_text(json.dumps({"error": f"model load failed: {exc}"}))
            return None

    async def emit_final(status: Optional[str] = None) -> None:
        nonlocal pending_text, final_history, last_ids, confirmed_text
        final_block = pending_text.strip()
        if not final_block:
            return
        if confirmed_text and final_block.startswith(confirmed_text):
            final_block = final_block[len(confirmed_text) :].strip()
        if not final_block:
            return
        confirmed_text = (confirmed_text + " " + final_block).strip()
        final_history.append(final_block)
        payload = {
            "type": "final",
            "final": final_block,
            "history": final_history,
            "processed_ids": last_ids,
        }
        if status:
            payload["status"] = status
        await websocket.send_text(json.dumps(payload))
        pending_text = ""

    async def process_audio_chunk(chunk: np.ndarray, chunk_id: Optional[str] = None) -> None:
        nonlocal buffer, chunk_meta, energy_history, backlog_processed, pending_text, last_infer, last_debug, engine_local, engine_task, last_ids
        if chunk.size == 0:
            return
        chunk_rms = float(np.sqrt(np.mean(np.square(chunk))))
        energy_history.append(chunk_rms)
        min_rms = min(energy_history) if energy_history else 0.0
        max_rms = max(energy_history) if energy_history else 0.0
        dyn_threshold = min_rms + (max_rms - min_rms) * voice_factor
        voice_active = chunk_rms >= dyn_threshold and chunk_rms > 1e-5

        start = buffer.size
        buffer = np.concatenate((buffer, chunk))
        end = start + chunk.size
        if chunk_id:
            chunk_meta.append((chunk_id, start, end))
        if buffer.size > MAX_SAMPLES:
            overflow = buffer.size - MAX_SAMPLES
            buffer = buffer[-MAX_SAMPLES:]
            if chunk_id:
                new_meta = deque()
                for mid, s, e in chunk_meta:
                    s -= overflow
                    e -= overflow
                    if e <= 0:
                        continue
                    new_meta.append((mid, max(0, s), e))
                chunk_meta = new_meta
            else:
                chunk_meta.clear()

        now = time.time()
        if engine_local is None and (now - last_debug) > 1.0:
            last_debug = now
            await websocket.send_text(
                json.dumps(
                    {
                        "status": f"accumulating {buffer.size / SAMPLE_RATE:.2f}s waiting model",
                        "buffer_seconds": buffer.size / SAMPLE_RATE,
                        "type": "debug",
                    }
                )
            )

        if engine_local is None and engine_task.done():
            engine_local = engine_task.result()
            if engine_local is None:
                logger.error("Model not loaded; engine_task returned None")
                await websocket.send_text(json.dumps({"error": "model not loaded; check logs"}))
                engine_task = asyncio.create_task(load_engine(current_model))
                return

        if engine_local and not backlog_processed and buffer.size >= min_samples_for_infer:
            backlog_processed = True
            loop = asyncio.get_event_loop()
            try:
                await websocket.send_text(
                    json.dumps(
                        {
                            "status": f"processing backlog {buffer.size / SAMPLE_RATE:.2f}s",
                            "type": "debug",
                        }
                    )
                )
                result = await loop.run_in_executor(
                    None, engine_local.transcribe_array, np.copy(buffer), None
                )
                await websocket.send_text(
                    json.dumps(
                        {
                            "status": f"backlog processed {buffer.size / SAMPLE_RATE:.2f}s",
                            "type": "debug",
                        }
                    )
                )
                text = (result.get("text") or "").strip()
                if text:
                    pending_text = text
                    ids = [mid for (mid, s, e) in chunk_meta]
                    last_ids = ids
                    await websocket.send_text(
                        json.dumps({"type": "partial", "partial": text, "processed_ids": ids})
                    )
            except Exception as exc:
                logger.error("Backlog processing failed: %s", exc, exc_info=True)
                await websocket.send_text(json.dumps({"error": str(exc)}))

        now = time.time()
        if (
            buffer.size >= min_samples_for_infer
            and (now - last_infer) >= infer_interval
            and voice_active
            and engine_local
        ):
            last_infer = now
            audio_copy = np.copy(buffer[-window_samples:])
            loop = asyncio.get_event_loop()
            partial_text = ""
            try:
                await websocket.send_text(
                    json.dumps(
                        {
                            "status": f"processing window {window_seconds:.2f}s",
                            "type": "debug",
                        }
                    )
                )
                result = await loop.run_in_executor(
                    None, engine_local.transcribe_array, audio_copy, None
                )
                partial_text = (result.get("text") or "").strip()
            except Exception as exc:
                logger.error("Window processing failed: %s", exc, exc_info=True)
                await websocket.send_text(json.dumps({"error": str(exc)}))
                return
            if partial_text:
                pending_text = partial_text
                ids = []
                if chunk_meta:
                    window_start = max(buffer.size - window_samples, 0)
                    window_end = buffer.size
                    ids = [mid for (mid, s, e) in chunk_meta if e > window_start and s < window_end]
                last_ids = ids
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "partial",
                            "partial": partial_text,
                            "processed_ids": ids,
                            "window_seconds": window_seconds,
                            "interval": infer_interval,
                            "min_seconds": min_seconds,
                            "rms": chunk_rms,
                            "threshold": dyn_threshold,
                        }
                    )
                )

    await send_models_message()
    engine_task = asyncio.create_task(load_engine(current_model))
    try:
        while True:
            try:
                message = await websocket.receive()
            except WebSocketDisconnect:
                break
            except RuntimeError as exc:
                logger.error("Runtime error on websocket receive: %s", exc, exc_info=True)
                try:
                    await websocket.send_text(json.dumps({"error": str(exc)}))
                except Exception:
                    pass
                break
            # Handle control messages
            if "text" in message and message["text"]:
                try:
                    control = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                ctype = control.get("type")
                if ctype == "chunk":
                    cid = control.get("id")
                    audio_b64 = control.get("audio")
                    if audio_b64 is None:
                        continue
                    try:
                        decoded = __import__("base64").b64decode(audio_b64)
                        audio_bytes = np.frombuffer(decoded, dtype=np.float32)
                    except Exception as exc:
                        logger.error("Failed to decode chunk %s: %s", cid, exc, exc_info=True)
                        continue
                    await process_audio_chunk(audio_bytes, cid)
                    continue
                elif ctype == "silence":
                    await emit_final(status="silence detected")
                    buffer = np.zeros(0, dtype=np.float32)
                    chunk_meta.clear()
                    backlog_processed = False
                    last_infer = 0.0
                    pending_text = ""
                    last_ids = []
                    continue
                if ctype == "select_model":
                    new_model = control.get("model") or current_model
                    if new_model != current_model:
                        await emit_final(status="model switch")
                        current_model = new_model
                        buffer = np.zeros(0, dtype=np.float32)
                        backlog_processed = False
                        last_infer = 0.0
                        pending_text = ""
                        final_history = []
                        confirmed_text = ""
                        last_ids = []
                        engine_local = None
                        chunk_meta.clear()
                        engine_task = asyncio.create_task(load_engine(current_model))
                        await websocket.send_text(json.dumps({"status": f"switching to {current_model}"}))
                elif ctype == "set_params":
                    try:
                        window_seconds = float(control.get("window", window_seconds))
                        interval = float(control.get("interval", infer_interval))
                        min_seconds = float(control.get("min_seconds", min_seconds))
                        voice_factor = float(control.get("voice_factor", voice_factor))
                        window_seconds = max(0.5, min(window_seconds, MAX_SECONDS))
                        infer_interval = max(0.2, min(interval, 2.0))
                        min_seconds = max(0.1, min(min_seconds, window_seconds))
                        voice_factor = max(0.05, min(voice_factor, 0.9))
                        window_samples = int(window_seconds * SAMPLE_RATE)
                        min_samples_for_infer = int(min_seconds * SAMPLE_RATE)
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "status": "params updated",
                                    "window_seconds": window_seconds,
                                    "interval": infer_interval,
                                    "min_seconds": min_seconds,
                                    "voice_factor": voice_factor,
                                }
                            )
                        )
                    except Exception:
                        pass
                elif ctype == "request_models":
                    await send_models_message()
                continue

            if "bytes" not in message:
                continue
            data = message["bytes"] or b""
            if not data:
                continue

            chunk = np.frombuffer(data, dtype=np.float32)
            await process_audio_chunk(chunk)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # pragma: no cover - runtime protection
        logger.error("Unhandled websocket exception: %s", exc, exc_info=True)
        try:
            await websocket.send_text(json.dumps({"error": str(exc)}))
        except Exception:
            pass
