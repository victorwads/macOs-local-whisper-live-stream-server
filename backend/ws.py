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

    # New parameters
    current_language = "auto"
    partial_interval_ms = 500  # Default 500ms
    last_partial_time = 0
    
    # State for partial processing
    current_segment_id = 0
    last_processed_size = 0
    partial_processing_task = None

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
        nonlocal engine_local, engine_task, current_segment_id, last_processed_size
        
        # Invalidate current partials
        current_segment_id += 1
        last_processed_size = 0
        
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
            start_time = time.time()
            result = await loop.run_in_executor(
                None, engine_local.transcribe_array, audio_segment, current_language
            )
            process_time = time.time() - start_time
            audio_duration = audio_segment.size / SAMPLE_RATE
            text = (result.get("text") or "").strip()
            
            # Filter out common hallucination
            if text == "Thank you.":
                text = ""
            if text == "[BLANK_AUDIO]":
                text = ""
                
            if text:
                final_history.append(text)
                await websocket.send_text(json.dumps({
                    "type": "final",
                    "final": text,
                    "history": final_history,
                    "stats": {
                        "audio_duration": audio_duration,
                        "processing_time": process_time
                    }
                }))
        except Exception as exc:
            logger.error("Transcription failed: %s", exc, exc_info=True)
            await websocket.send_text(json.dumps({"error": str(exc)}))

    segmenter = AudioSegmenter(min_seconds, MAX_SECONDS, SAMPLE_RATE, on_segment_ready)

    async def process_partial():
        nonlocal last_partial_time, engine_local, last_processed_size
        if partial_interval_ms < 100:
            return

        now = time.time() * 1000
        if now - last_partial_time < partial_interval_ms:
            return

        # Check if we have enough audio in buffer to try a partial
        # We don't want to process extremely short segments
        current_size = segmenter.buffer.size
        if current_size < SAMPLE_RATE * 0.5: # at least 0.5s
            return
            
        # Check if buffer has grown since last processing
        if current_size <= last_processed_size:
            return

        if engine_local is None:
             if engine_task.done():
                 engine_local = engine_task.result()
             else:
                 return

        last_partial_time = now
        
        # Capture segment ID to verify validity later
        my_segment_id = current_segment_id
        
        # Copy buffer for partial transcription
        audio_copy = np.copy(segmenter.buffer)
        
        loop = asyncio.get_event_loop()
        try:
            # Run in executor to avoid blocking
            start_time = time.time()
            result = await loop.run_in_executor(
                None, engine_local.transcribe_array, audio_copy, current_language
            )
            process_time = time.time() - start_time
            audio_duration = audio_copy.size / SAMPLE_RATE
            
            # Check if segment is still valid (no flush happened)
            if my_segment_id != current_segment_id:
                return
                
            text = (result.get("text") or "").strip()
            
            if text:
                last_processed_size = current_size
                await websocket.send_text(json.dumps({
                    "type": "partial",
                    "text": text,
                    "stats": {
                        "audio_duration": audio_duration,
                        "processing_time": process_time
                    }
                }))
        except Exception:
            # Partial failures shouldn't kill the connection
            pass

    await send_models_message()
    engine_task = asyncio.create_task(load_engine(current_model))

    # Create a persistent receive task
    receive_task = asyncio.create_task(websocket.receive())
    last_activity_time = time.time()

    try:
        while True:
            try:
                # Determine wait time
                now = time.time()
                time_since_activity = now - last_activity_time
                
                # We want to wake up for partials
                wait_timeout = min_seconds
                if partial_interval_ms > 0:
                    wait_timeout = min(wait_timeout, partial_interval_ms / 1000.0)
                
                # Also ensure we don't sleep past the silence timeout
                remaining_silence_time = min_seconds - time_since_activity
                if remaining_silence_time > 0:
                    wait_timeout = min(wait_timeout, remaining_silence_time)
                else:
                    wait_timeout = 0 # Check immediately

                done, pending = await asyncio.wait([receive_task], timeout=wait_timeout)

                if receive_task in done:
                    # Message received
                    message = receive_task.result()
                    last_activity_time = time.time()
                    
                    # Prepare next receive task immediately
                    receive_task = asyncio.create_task(websocket.receive())
                    
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
                        elif ctype == "set_params":
                            # Update params
                            if "min_seconds" in control:
                                segmenter.min_seconds = float(control["min_seconds"])
                                min_seconds = segmenter.min_seconds
                            if "language" in control:
                                current_language = control["language"]
                            if "partial_interval" in control:
                                partial_interval_ms = float(control["partial_interval"])

                    if "bytes" in message and message["bytes"]:
                        chunk = np.frombuffer(message["bytes"], dtype=np.float32)
                        await segmenter.push_audio_chunk(chunk)

                else:
                    # Timeout occurred
                    # Check if it's a silence timeout
                    if time.time() - last_activity_time >= min_seconds:
                        # If we have data in buffer, flush it now
                        await segmenter.flush()
                        # Reset activity time to avoid repeated flushing if no new data comes
                        last_activity_time = time.time()
                
                # Try to process partials in background if not already running
                if partial_processing_task is None or partial_processing_task.done():
                    partial_processing_task = asyncio.create_task(process_partial())

            except WebSocketDisconnect:
                break
            except RuntimeError as exc:
                logger.error("Runtime error on websocket receive: %s", exc, exc_info=True)
                break
                
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("Unhandled websocket exception: %s", exc, exc_info=True)
        try:
            await websocket.send_text(json.dumps({"error": str(exc)}))
        except Exception:
            pass
