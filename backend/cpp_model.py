import os
from pathlib import Path

CPP_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"


def download_cpp_model(model_size: str, models_root: str | None = None) -> Path:
    models_root = models_root or os.getenv("WHISPER_MODELS_DIR")
    base_dir = Path(models_root) if models_root else Path(__file__).resolve().parent / "models"
    target = base_dir / "cpp" / f"ggml-{model_size}.bin"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return target
    import urllib.request

    url = f"{CPP_BASE_URL}/ggml-{model_size}.bin"
    print(f"Downloading ggml model for whisper.cpp: {model_size} -> {target}")
    urllib.request.urlretrieve(url, target)
    return target
