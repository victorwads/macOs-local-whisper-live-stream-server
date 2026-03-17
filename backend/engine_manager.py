import os
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Union

from download_model import SUPPORTED, fetch_model
from cpp_model import download_cpp_model, list_cpp_downloadable_models
from whisper_engine import WhisperEngine
from whisper_cpp import WhisperCppEngine
from whisper_server_client import server_manager

DEFAULT_MODEL = os.getenv("WHISPER_MODEL_SIZE", "large-v3")
BACKEND = os.getenv("WHISPER_BACKEND", "cpp").lower()  # cpp or faster

# Fallback quantized variants we want to expose even if remote model listing is unavailable.
CPP_QUANT_SUFFIXES_FALLBACK = (
    "q8_0",
    "q5_0",
    "q5_1",
)

def _make_engine(model_size: str):
    if BACKEND == "cpp":
        # Ensure model exists before creating wrapper
        # This allows ensure_engine to fail if model is missing, triggering download in ws.py
        server_manager._resolve_model(model_size)

        # server-backed client: keep model loaded
        class ServerWrapper:
            def __init__(self, name: str):
                self.model_size = name

            def transcribe_array(self, audio, language=None, is_partial=False):
                return server_manager.transcribe_array(self.model_size, audio, language=language, is_partial=is_partial)

            def transcribe_file(self, file_path, language=None):
                return server_manager.transcribe_file(self.model_size, file_path, language=language)

            def info(self):
                return {"model": self.model_size, "device": "metal", "compute_type": "server"}

        return ServerWrapper(model_size)
    return WhisperEngine(model_size=model_size)


@lru_cache(maxsize=8)
def get_engine(model_size: Optional[str] = None):
    size = model_size or DEFAULT_MODEL
    return _make_engine(size)


def installed_models() -> List[str]:
    return sorted(installed_models_info().keys())


def installed_models_info() -> Dict[str, Dict[str, float]]:
    info: Dict[str, Dict[str, float]] = {}

    models_root = Path(os.getenv("WHISPER_MODELS_DIR") or Path(__file__).resolve().parent / "models")

    faster_dir = models_root / "faster"
    if faster_dir.exists():
        for item in faster_dir.iterdir():
            if item.is_dir():
                size_bytes = _dir_size_bytes(item)
                _upsert_model_info(info, item.name, size_bytes)
            elif item.is_file() and item.name.startswith("ggml-") and item.suffix in {".bin", ".gguf"}:
                _upsert_model_info(info, item.name, item.stat().st_size)

    cpp_dir = models_root / "cpp"
    if cpp_dir.exists():
        for item in cpp_dir.iterdir():
            if item.is_file() and item.suffix in {".bin", ".gguf"}:
                model_name = item.name
                if model_name.startswith("ggml-"):
                    model_name = model_name[len("ggml-") :]
                if model_name.endswith(".bin"):
                    model_name = model_name[: -len(".bin")]
                elif model_name.endswith(".gguf"):
                    model_name = model_name[: -len(".gguf")]
                _upsert_model_info(info, model_name, item.stat().st_size)
            elif item.is_dir():
                _upsert_model_info(info, item.name, _dir_size_bytes(item))

    return info


def _upsert_model_info(info: Dict[str, Dict[str, float]], model_name: str, size_bytes: int) -> None:
    current = info.get(model_name)
    size_gb = round(size_bytes / (1024 ** 3), 3)
    payload = {"size_bytes": int(size_bytes), "size_gb": size_gb}
    if current is None or payload["size_bytes"] > int(current.get("size_bytes", 0)):
        info[model_name] = payload


def _dir_size_bytes(path: Path) -> int:
    total = 0
    for root, _, files in os.walk(path):
        root_path = Path(root)
        for file_name in files:
            file_path = root_path / file_name
            try:
                total += file_path.stat().st_size
            except OSError:
                continue
    return total


def supported_models() -> List[str]:
    supported = set(SUPPORTED)

    # For whisper.cpp backend, expose quantized options without relying solely on network calls.
    if BACKEND == "cpp":
        remote_models = list_cpp_downloadable_models()
        if remote_models:
            supported.update(remote_models)
        else:
            # Offline fallback: still expose common quantized variants for each base model.
            for base in SUPPORTED:
                for suffix in CPP_QUANT_SUFFIXES_FALLBACK:
                    supported.add(f"{base}-{suffix}")

    # Always include locally installed models (e.g., manually downloaded quantized files).
    supported.update(installed_models())

    return sorted(supported)


def available_models() -> List[str]:
    installed = set(installed_models())
    ordered_supported = supported_models()
    ordered = [m for m in ordered_supported if m in installed]
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
