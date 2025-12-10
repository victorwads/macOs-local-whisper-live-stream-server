import os
from functools import lru_cache
from pathlib import Path
from typing import List, Optional, Union

from download_model import SUPPORTED, fetch_model
from cpp_model import download_cpp_model
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
    installed: List[str] = []
    try:
        installed.extend(WhisperEngine.available_models())
    except Exception:
        pass
    cpp_dir = Path(os.getenv("WHISPER_MODELS_DIR") or Path(__file__).resolve().parent / "models") / "cpp"
    if cpp_dir.exists():
        for item in cpp_dir.iterdir():
            if item.is_file() and item.suffix == ".bin":
                installed.append(item.name.replace("ggml-", "").replace(".bin", ""))
            elif item.is_dir():
                installed.append(item.name)
    return sorted(set(installed))


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
        if BACKEND == "cpp":
            download_cpp_model(size, models_root=os.getenv("WHISPER_MODELS_DIR"))
        else:
            fetch_model(size, backend="faster")
        get_engine.cache_clear()
        return get_engine(size)
