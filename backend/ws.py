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
    cumulative_text = ""
    last_final_sent = ""
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
                    if audio_bytes.size == 0:
                        continue
                    start = buffer.size
                    buffer = np.concatenate((buffer, audio_bytes))
                    end = start + audio_bytes.size
                    chunk_meta.append((cid, start, end))
                    if buffer.size > MAX_SAMPLES:
                        overflow = buffer.size - MAX_SAMPLES
                        buffer = buffer[-MAX_SAMPLES:]
                        # adjust chunk_meta
                        new_meta = deque()
                        for mid, s, e in chunk_meta:
                            s -= overflow
                            e -= overflow
                            if e <= 0:
                                continue
                            new_meta.append((mid, max(0, s), e))
                        chunk_meta = new_meta
                    continue
                if ctype == "select_model":
                    new_model = control.get("model") or current_model
                    if new_model != current_model:
                        current_model = new_model
                        buffer = np.zeros(0, dtype=np.float32)
                        backlog_processed = False
                        cumulative_text = ""
                        last_infer = 0.0
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
            if chunk.size == 0:
                continue

            chunk_rms = float(np.sqrt(np.mean(np.square(chunk))))
            energy_history.append(chunk_rms)
            min_rms = min(energy_history) if energy_history else 0.0
            max_rms = max(energy_history) if energy_history else 0.0
            dyn_threshold = min_rms + (max_rms - min_rms) * voice_factor
            voice_active = chunk_rms >= dyn_threshold and chunk_rms > 1e-5

            buffer = np.concatenate((buffer, chunk))
            if buffer.size > MAX_SAMPLES:
                buffer = buffer[-MAX_SAMPLES:]
                # when raw bytes path used, cannot map IDs; clear meta
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

            # If engine finished loading, capture it
            if engine_local is None and engine_task.done():
                engine_local = engine_task.result()
                if engine_local is None:
                    logger.error("Model not loaded; engine_task returned None")
                    await websocket.send_text(json.dumps({"error": "model not loaded; check logs"}))
                    # stay connected so client can retry/select another model
                    engine_task = asyncio.create_task(load_engine(current_model))
                    continue

            # Process backlog once after engine ready
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
                    text = result.get("text", "")
                    if text:
                        cumulative_text = text
                        ids = [mid for (mid, s, e) in chunk_meta]
                        await websocket.send_text(
                            json.dumps({"type": "partial", "partial": text, "processed_ids": ids})
                        )
                        if cumulative_text != last_final_sent:
                            last_final_sent = cumulative_text
                            await websocket.send_text(
                                json.dumps(
                                    {
                                        "type": "final",
                                        "final": cumulative_text,
                                        "processed_ids": ids,
                                        "status": "backlog processed",
                                    }
                                )
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
                # Use the most recent window to keep latency low.
                audio_copy = np.copy(buffer[-window_samples:])
                loop = asyncio.get_event_loop()
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
                except Exception as exc:  # pragma: no cover - safeguard
                    logger.error("Window processing failed: %s", exc, exc_info=True)
                    await websocket.send_text(json.dumps({"error": str(exc)}))
                    continue
                partial_text = result.get("text", "")
                if partial_text:
                    if cumulative_text and partial_text.startswith(cumulative_text):
                        cumulative_text = partial_text
                    elif cumulative_text in partial_text:
                        cumulative_text = partial_text
                    else:
                        cumulative_text = (cumulative_text + " " + partial_text).strip()
                    ids = []
                    if chunk_meta:
                        window_start = max(buffer.size - window_samples, 0)
                        window_end = buffer.size
                        ids = [mid for (mid, s, e) in chunk_meta if e > window_start and s < window_end]
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
                    if cumulative_text and cumulative_text != last_final_sent:
                        last_final_sent = cumulative_text
                        await websocket.send_text(
                            json.dumps({"type": "final", "final": cumulative_text, "processed_ids": ids})
                        )
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # pragma: no cover - runtime protection
        logger.error("Unhandled websocket exception: %s", exc, exc_info=True)
        try:
            await websocket.send_text(json.dumps({"error": str(exc)}))
        except Exception:
            pass
