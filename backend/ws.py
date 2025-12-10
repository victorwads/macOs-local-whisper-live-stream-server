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
from segmenter import AudioSegmenter

router = APIRouter()
logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
MAX_SECONDS = 10
MAX_SAMPLES = MAX_SECONDS * SAMPLE_RATE
DEFAULT_MIN_SECONDS = 2.0
DEFAULT_INFER_INTERVAL = 0.5
DEFAULT_WINDOW_SECONDS = 4
DEFAULT_VOICE_FACTOR = 0.2
ENERGY_HISTORY = 50

@router.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    engine_local: Optional = None
    final_history: list[str] = []
    current_model = DEFAULT_MODEL
    
    query_params = websocket.query_params
    try:
        min_seconds = float(query_params.get("min_seconds", DEFAULT_MIN_SECONDS))
    except ValueError:
        min_seconds = DEFAULT_MIN_SECONDS
    
    # Ensure min_seconds is reasonable
    min_seconds = max(0.5, min(min_seconds, MAX_SECONDS))

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
            await websocket.send_text(json.dumps({"error": f"model load failed: {exc}"}))
            return None

    async def on_segment_ready(audio_segment: np.ndarray):
        nonlocal engine_local, engine_task
        if audio_segment.size == 0:
            return
            
        if engine_local is None:
            if not engine_task.done():
                await websocket.send_text(json.dumps({"status": "waiting for model load..."}))
                try:
                    engine_local = await engine_task
                except Exception:
                    pass
            else:
                engine_local = engine_task.result()
                
        if engine_local is None:
             await websocket.send_text(json.dumps({"error": "Model failed to load"}))
             return

        loop = asyncio.get_event_loop()
        try:
            await websocket.send_text(json.dumps({"status": "transcribing segment"}))
            result = await loop.run_in_executor(
                None, engine_local.transcribe_array, audio_segment, None
            )
            text = (result.get("text") or "").strip()
            if text:
                final_history.append(text)
                await websocket.send_text(json.dumps({
                    "type": "final",
                    "final": text,
                    "history": final_history
                }))
        except Exception as exc:
            logger.error("Transcription failed: %s", exc, exc_info=True)
            await websocket.send_text(json.dumps({"error": str(exc)}))

    segmenter = AudioSegmenter(min_seconds, MAX_SECONDS, SAMPLE_RATE, on_segment_ready)

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
                break

            if "text" in message and message["text"]:
                try:
                    control = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                
                ctype = control.get("type")
                if ctype == "silence":
                    await segmenter.notify_silence()
                elif ctype == "select_model":
                    new_model = control.get("model")
                    if new_model and new_model != current_model:
                        current_model = new_model
                        engine_local = None
                        segmenter.reset()
                        engine_task = asyncio.create_task(load_engine(current_model))
                        await websocket.send_text(json.dumps({"status": f"switching to {current_model}"}))
                elif ctype == "request_models":
                    await send_models_message()
            
            if "bytes" in message and message["bytes"]:
                chunk = np.frombuffer(message["bytes"], dtype=np.float32)
                await segmenter.push_audio_chunk(chunk)
                
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("Unhandled websocket exception: %s", exc, exc_info=True)
        try:
            await websocket.send_text(json.dumps({"error": str(exc)}))
        except Exception:
            pass
