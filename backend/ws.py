import asyncio
import contextlib
import json
import time
import os
import logging
import unicodedata
from typing import Optional

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from engine_manager import (
    DEFAULT_MODEL,
    ensure_engine,
    installed_models,
    installed_models_info,
    supported_models,
    BACKEND,
)
from download_model import fetch_model
from cpp_model import download_cpp_model
from whisper_server_client import server_manager
from segmenter import AudioSegmenter

router = APIRouter()
logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
DEFAULT_MAX_SECONDS = 10
DEFAULT_MIN_SECONDS = 2.0

IGNORED_TEXTS = {
    "Thank you.",
    "[BLANK_AUDIO]",
    "Thanks for watching!",
    "MBC News",
    "You",
}

CODE_TO_NAME = {
    "en": "English", "zh": "Chinese", "de": "German", "es": "Spanish", "ru": "Russian", 
    "ko": "Korean", "fr": "French", "ja": "Japanese", "pt": "Portuguese", "tr": "Turkish", 
    "pl": "Polish", "ca": "Catalan", "nl": "Dutch", "ar": "Arabic", "sv": "Swedish", 
    "it": "Italian", "id": "Indonesian", "hi": "Hindi", "fi": "Finnish", "vi": "Vietnamese", 
    "he": "Hebrew", "uk": "Ukrainian", "el": "Greek", "ms": "Malay", "th": "Thai", 
    "da": "Danish", "cs": "Czech", "ro": "Romanian", "hu": "Hungarian", "ta": "Tamil", 
    "no": "Norwegian", "sk": "Slovak", "hr": "Croatian", "bg": "Bulgarian", "ur": "Urdu", 
    "lt": "Lithuanian", "sl": "Slovenian", "lv": "Latvian", "et": "Estonian", "af": "Afrikaans", 
    "gl": "Galician", "mr": "Marathi", "is": "Icelandic", "sw": "Swahili", "mk": "Macedonian", 
    "cy": "Welsh", "sr": "Serbian", "ne": "Nepali", "az": "Azerbaijani", "fa": "Persian", 
    "bs": "Bosnian", "kk": "Kazakh", "sq": "Albanian", "am": "Amharic", "hy": "Armenian", 
    "km": "Khmer", "lo": "Lao", "my": "Burmese", "mn": "Mongolian", "sn": "Shona", 
    "yo": "Yoruba", "so": "Somali", "zu": "Zulu", "kn": "Kannada", "ml": "Malayalam", 
    "te": "Telugu", "si": "Sinhala", "tk": "Turkmen", "lb": "Luxembourgish", "ps": "Pashto", 
    "gu": "Gujarati", "pa": "Punjabi", "eo": "Esperanto", "tl": "Tagalog", "bn": "Bengali", 
    "eu": "Basque", "oc": "Occitan", "la": "Latin", "qu": "Quechua", "sa": "Sanskrit", 
    "yi": "Yiddish", "haw": "Hawaiian", "jw": "Javanese", "sd": "Sindhi", "ku": "Kurdish", 
    "tg": "Tajik", "tt": "Tatar", "cr": "Cree", "bo": "Tibetan",
}


def _is_latin_like(ch: str) -> bool:
    """Return True if the character belongs to a Latin-based script.

    This covers English and Portuguese (and most western languages) by
    checking the Unicode name for the substring 'LATIN'.
    """

    try:
        return "LATIN" in unicodedata.name(ch)
    except ValueError:
        # Character without a name
        return False


def should_ignore_non_latin(text: str, allow_non_latin: bool) -> bool:
    """Decide if a transcription should be ignored for being only non‑Latin.

    If there is at least one alphabetic character and none of them is
    Latin-based (so the whole phrase is, e.g., Cyrillic or CJK) and
    allow_non_latin is False, we ignore this text.
    """

    if allow_non_latin:
        return False

    has_letter = False
    has_latin = False

    for ch in text:
        if ch.isalpha():
            has_letter = True
            if _is_latin_like(ch):
                has_latin = True
                break

    return has_letter and not has_latin

def normalize_language(lang: str) -> str:
    if not lang:
        return None
    lang = lang.strip()
    if lang.lower() == "auto":
        return None
        
    # Check if it's a full name match
    clean_lang = lang.lower()
    for name in CODE_TO_NAME.values():
        if name.lower() == clean_lang:
            return name
            
    # Extract code (first 2 chars or split by hyphen)
    code = clean_lang.split("-")[0]
    
    if code in CODE_TO_NAME:
        return CODE_TO_NAME[code]
        
    return None


def _normalize_segments(raw_segments) -> list[dict]:
    if not isinstance(raw_segments, list):
        return []
    normalized = []
    for seg in raw_segments:
        if not isinstance(seg, dict):
            continue
        start = seg.get("start")
        end = seg.get("end")
        text = (seg.get("text") or "").strip()
        try:
            start_f = float(start)
            end_f = float(end)
        except (TypeError, ValueError):
            continue
        if end_f < start_f:
            continue
        normalized.append(
            {
                "start": round(start_f, 3),
                "end": round(end_f, 3),
                "text": text,
            }
        )
    return normalized

@router.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket) -> None:
    # await websocket.accept() # Moved down to avoid double accept if any logic before it fails or if we want to accept later
    engine_local: Optional = None
    final_history: list[str] = []
    current_model = DEFAULT_MODEL
    
    query_params = websocket.query_params
    try:
        min_seconds = float(query_params.get("min_seconds", DEFAULT_MIN_SECONDS))
    except ValueError:
        min_seconds = DEFAULT_MIN_SECONDS
    
    try:
        max_seconds = float(query_params.get("max_seconds", DEFAULT_MAX_SECONDS))
    except ValueError:
        max_seconds = DEFAULT_MAX_SECONDS

    # Ensure max_seconds and min_seconds are reasonable
    max_seconds = max(1.0, min(max_seconds, 60.0))
    min_seconds = max(0.5, min(min_seconds, max_seconds))

    # New parameters
    current_language = "auto"
    partial_interval_current_ms = 0.0
    last_processing_ms = 0.0
    # If False, texts composed only of non‑Latin letters (e.g. Cyrillic)
    # will be ignored by default. Can be overridden by env or set_params.
    allow_non_latin = os.getenv("ALLOW_NON_LATIN", "0") == "1"
    
    # State for partial processing
    current_segment_id = 0
    last_processed_size = 0
    partial_processing_task = None
    is_processing_partial = False # Explicit flag for safety
    
    # await websocket.accept() # Already accepted by FastAPI? No, we need to accept.
    # The error "Expected ASGI message 'websocket.send' or 'websocket.close', but got 'websocket.accept'"
    # usually means we are trying to accept an already accepted connection or doing something out of order.
    # Let's check if we are calling accept twice or if there is some middleware interference.
    # Actually, looking at the traceback, it seems like standard FastAPI usage.
    # Wait, did I accidentally duplicate the accept call in previous edits?
    
    await websocket.accept()
    logger.info("WebSocket connected")
    
    # Track connection for the default model initially
    server_manager.update_socket_count(current_model, 1)

    async def send_models_message():
        await websocket.send_text(
            json.dumps(
                {
                    "type": "models",
                    "supported": supported_models(),
                    "installed": installed_models(),
                    "installed_info": installed_models_info(),
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

    final_segments_queue: asyncio.Queue = asyncio.Queue()

    async def on_segment_ready(audio_segment: np.ndarray):
        nonlocal current_segment_id, last_processed_size, last_processing_ms, partial_interval_current_ms

        # Invalidate current partials immediately when a final segment closes.
        current_segment_id += 1
        segment_id = current_segment_id
        last_processed_size = 0
        last_processing_ms = 0.0
        partial_interval_current_ms = 0.0

        if audio_segment.size == 0:
            return

        await final_segments_queue.put((segment_id, np.copy(audio_segment), current_language))

    async def process_final_segments():
        nonlocal engine_local, engine_task

        while True:
            item = await final_segments_queue.get()
            if item is None:
                final_segments_queue.task_done()
                break

            _segment_id, audio_segment, language_for_segment = item

            try:
                if engine_local is None:
                    if not engine_task.done():
                        await websocket.send_text(json.dumps({"status": "waiting for model load..."}))
                        try:
                            engine_local = await engine_task
                        except Exception:
                            engine_local = None
                    else:
                        engine_local = engine_task.result()

                if engine_local is None:
                    await websocket.send_text(json.dumps({"error": "Model failed to load"}))
                    continue

                loop = asyncio.get_event_loop()
                await websocket.send_text(json.dumps({"status": "transcribing segment"}))
                start_time = time.time()
                result = await loop.run_in_executor(
                    None, engine_local.transcribe_array, audio_segment, language_for_segment
                )
                process_time = time.time() - start_time
                audio_duration = audio_segment.size / SAMPLE_RATE
                text = (result.get("text") or "").strip()
                segments = _normalize_segments(result.get("segments"))

                if text in IGNORED_TEXTS:
                    text = ""

                if text and should_ignore_non_latin(text, allow_non_latin):
                    text = ""

                if text:
                    final_history.append(text)
                    await websocket.send_text(json.dumps({
                        "type": "final",
                        "final": text,
                        "segments": segments,
                        "history": final_history,
                        "stats": {
                            "audio_duration": audio_duration,
                            "processing_time": process_time,
                            "processing_time_ms": int(round(process_time * 1000)),
                            "partial_interval_ms": int(round(partial_interval_current_ms)),
                        }
                    }))
            except Exception as exc:
                logger.error("Transcription failed: %s", exc, exc_info=True)
                await websocket.send_text(json.dumps({"error": str(exc)}))
            finally:
                final_segments_queue.task_done()

    segmenter = AudioSegmenter(min_seconds, max_seconds, SAMPLE_RATE, on_segment_ready)

    async def process_partial(requested_interval_ms: float = 0.0):
        nonlocal engine_local, last_processed_size, is_processing_partial, last_processing_ms, partial_interval_current_ms
        
        if is_processing_partial:
            logger.warning("Partial requested but is_processing_partial is True! Skipping.")
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
                 logger.info("Partial skipped: Engine not ready")
                 return

        is_processing_partial = True
        try:
            current_audio_seconds = current_size / SAMPLE_RATE
            partial_interval_current_ms = max(0.0, requested_interval_ms)
            logger.info(
                "Running partial: buffer=%.2fs requested_interval=%.0fms",
                current_audio_seconds,
                partial_interval_current_ms,
            )
            
            # Capture segment ID to verify validity later
            my_segment_id = current_segment_id
            
            # Copy buffer for partial transcription
            audio_copy = np.copy(segmenter.buffer)
            
            loop = asyncio.get_event_loop()
            
            # Run in executor to avoid blocking
            start_time = time.time()
            result = await loop.run_in_executor(
                None, lambda: engine_local.transcribe_array(audio_copy, current_language, is_partial=True)
            )
            process_time = time.time() - start_time
            last_processing_ms = process_time * 1000.0
            audio_duration = audio_copy.size / SAMPLE_RATE
            text = (result.get("text") or "").strip()
            segments = _normalize_segments(result.get("segments"))

            if text in IGNORED_TEXTS:
                text = ""

            # Ignore partials that are purely non‑Latin unless explicitly allowed
            if text and should_ignore_non_latin(text, allow_non_latin):
                text = ""

            if text:
                # CRITICAL FIX: Check if segment changed while we were processing
                # If it changed, this partial is for an old segment and we must NOT update last_processed_size
                # or send the result, as it would corrupt the state for the new segment.
                if my_segment_id != current_segment_id:
                    logger.info(f"Partial result ignored: segment changed (id {my_segment_id} -> {current_segment_id})")
                else:
                    last_processed_size = current_size
                    logger.info(f"Partial result: '{text}' ({process_time*1000:.0f}ms)")
                    await websocket.send_text(json.dumps({
                        "type": "partial",
                        "text": text,
                        "segments": segments,
                        "stats": {
                            "audio_duration": audio_duration,
                            "processing_time": process_time,
                            "processing_time_ms": int(round(process_time * 1000)),
                            "partial_interval_ms": int(round(partial_interval_current_ms)),
                        }
                    }))
            else:
                logger.info("Partial result empty or ignored")
        except Exception as e:
            logger.error(f"Partial failed: {e}")
            pass
        finally:
            is_processing_partial = False

    await send_models_message()
    engine_task = asyncio.create_task(load_engine(current_model))
    final_processing_task = asyncio.create_task(process_final_segments())

    # Create a persistent receive task
    receive_task = asyncio.create_task(websocket.receive())
    last_activity_time = time.time()

    try:
        while True:
            try:
                # Determine wait time
                now = time.time()
                time_since_activity = now - last_activity_time
                
                wait_timeout = min_seconds
                
                # Also ensure we don't sleep past the silence timeout
                remaining_silence_time = min_seconds - time_since_activity
                if remaining_silence_time > 0:
                    wait_timeout = min(wait_timeout, remaining_silence_time)
                else:
                    wait_timeout = 0 # Check immediately

                tasks = [receive_task]
                if partial_processing_task is not None and not partial_processing_task.done():
                    tasks.append(partial_processing_task)

                done, pending = await asyncio.wait(tasks, timeout=wait_timeout, return_when=asyncio.FIRST_COMPLETED)

                if partial_processing_task in done:
                    try:
                        partial_processing_task.result()
                    except Exception as e:
                        logger.error(f"Partial task error: {e}")

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
                                # Update socket counts
                                server_manager.update_socket_count(current_model, -1)
                                current_model = new_model
                                server_manager.update_socket_count(current_model, 1)
                                
                                engine_local = None
                                segmenter.reset()
                                # Reset state for new model to avoid partial lag
                                current_segment_id += 1
                                last_processed_size = 0
                                
                                # Drop queued segments from the old model/context.
                                while not final_segments_queue.empty():
                                    try:
                                        final_segments_queue.get_nowait()
                                        final_segments_queue.task_done()
                                    except asyncio.QueueEmpty:
                                        break

                                engine_task = asyncio.create_task(load_engine(current_model))
                                await websocket.send_text(json.dumps({"status": f"switching to {current_model}"}))
                        elif ctype == "request_models":
                            await send_models_message()
                        elif ctype == "set_params":
                            # Update params
                            if "min_seconds" in control:
                                segmenter.min_seconds = float(control["min_seconds"])
                                min_seconds = segmenter.min_seconds
                            if "max_seconds" in control:
                                next_max = float(control["max_seconds"])
                                max_seconds = max(1.0, min(next_max, 60.0))
                                segmenter.max_seconds = max_seconds
                                # Keep min_seconds valid if max decreased
                                if min_seconds > max_seconds:
                                    min_seconds = max_seconds
                                    segmenter.min_seconds = min_seconds
                            if "language" in control:
                                current_language = normalize_language(control["language"])
                                await websocket.send_text(json.dumps({
                                    "type": "language_update",
                                    "language": current_language or "Auto"
                                }))
                            if "allow_non_latin" in control:
                                allow_non_latin = bool(control["allow_non_latin"])
                        elif ctype == "trigger_partial":
                            requested_interval_ms = float(control.get("interval_ms", 0))
                            if partial_processing_task is None or partial_processing_task.done():
                                partial_processing_task = asyncio.create_task(process_partial(requested_interval_ms))

                    if "bytes" in message and message["bytes"]:
                        chunk = np.frombuffer(message["bytes"], dtype=np.float32)
                        await segmenter.push_audio_chunk(chunk)
                        # logger.info(f"Received chunk: {len(chunk)} samples") # Too verbose for every chunk? Maybe debug level.
                        
                else:
                    # Timeout occurred
                    # Check if it's a silence timeout
                    if time.time() - last_activity_time >= min_seconds:
                        # If we have data in buffer, flush it now
                        await segmenter.flush()
                        # Reset activity time to avoid repeated flushing if no new data comes
                        last_activity_time = time.time()
                
                # Partial execution is now frontend-triggered via control message "trigger_partial".

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
    finally:
        if partial_processing_task is not None and not partial_processing_task.done():
            partial_processing_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await partial_processing_task
        if final_processing_task is not None and not final_processing_task.done():
            await final_segments_queue.put(None)
            with contextlib.suppress(asyncio.CancelledError):
                await final_processing_task
        if receive_task is not None and not receive_task.done():
            receive_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await receive_task

        server_manager.update_socket_count(current_model, -1)
        logger.info("WebSocket disconnected")
