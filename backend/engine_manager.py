import os
from functools import lru_cache
from typing import List, Optional

from download_model import SUPPORTED
from whisper_engine import WhisperEngine

DEFAULT_MODEL = os.getenv("WHISPER_MODEL_SIZE", "large-v3")


@lru_cache(maxsize=8)
def get_engine(model_size: Optional[str] = None) -> WhisperEngine:
    size = model_size or DEFAULT_MODEL
    return WhisperEngine(model_size=size)


def available_models() -> List[str]:
    # Only list what is supported by faster-whisper to avoid invalid options.
    installed = set(WhisperEngine.available_models())
    ordered = [m for m in SUPPORTED if m in installed]
    return ordered if ordered else list(SUPPORTED)
