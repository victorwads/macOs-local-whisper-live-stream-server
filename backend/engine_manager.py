import os
from functools import lru_cache
from typing import List, Optional, Union

from download_model import SUPPORTED, fetch_model
from whisper_engine import WhisperEngine
from whisper_cpp import WhisperCppEngine

DEFAULT_MODEL = os.getenv("WHISPER_MODEL_SIZE", "large-v3")
BACKEND = os.getenv("WHISPER_BACKEND", "cpp").lower()  # cpp or faster


def _make_engine(model_size: str):
    if BACKEND == "cpp":
        return WhisperCppEngine(model_name=model_size)
    return WhisperEngine(model_size=model_size)


@lru_cache(maxsize=8)
def get_engine(model_size: Optional[str] = None):
    size = model_size or DEFAULT_MODEL
    return _make_engine(size)


def installed_models() -> List[str]:
    try:
        return WhisperEngine.available_models()
    except Exception:
        return []


def supported_models() -> List[str]:
    extras = [f"ggml-{m}.bin" for m in SUPPORTED]
    return list(SUPPORTED) + extras


def available_models() -> List[str]:
    installed = set(installed_models())
    ordered = [m for m in SUPPORTED if m in installed]
    if ordered:
        return ordered
    return list(installed)


def ensure_engine(model_size: Optional[str] = None, download: bool = True):
    size = model_size or DEFAULT_MODEL
    try:
        return get_engine(size)
    except FileNotFoundError:
        if not download:
            raise
        fetch_model(size)
        get_engine.cache_clear()
        return get_engine(size)
