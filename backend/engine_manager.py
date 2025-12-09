import os
from functools import lru_cache
from typing import List, Optional

from download_model import SUPPORTED, fetch_model
from whisper_engine import WhisperEngine

DEFAULT_MODEL = os.getenv("WHISPER_MODEL_SIZE", "large-v3")


@lru_cache(maxsize=8)
def get_engine(model_size: Optional[str] = None) -> WhisperEngine:
    size = model_size or DEFAULT_MODEL
    return WhisperEngine(model_size=size)


def installed_models() -> List[str]:
    return WhisperEngine.available_models()


def supported_models() -> List[str]:
    return list(SUPPORTED)


def available_models() -> List[str]:
    installed = set(installed_models())
    ordered = [m for m in SUPPORTED if m in installed]
    return ordered


def ensure_engine(model_size: Optional[str] = None, download: bool = True) -> WhisperEngine:
    size = model_size or DEFAULT_MODEL
    try:
        return get_engine(size)
    except FileNotFoundError:
        if not download:
            raise
        fetch_model(size)
        get_engine.cache_clear()
        return get_engine(size)
