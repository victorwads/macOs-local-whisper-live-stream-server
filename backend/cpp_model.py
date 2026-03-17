import os
import ssl
import subprocess
import json
from pathlib import Path
from functools import lru_cache
from urllib import request, error

CPP_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
CPP_TREE_API_URL = "https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main?recursive=1"
MIN_VALID_MODEL_BYTES = 1024 * 1024  # 1 MiB


def _download_with_urllib(url: str, target: Path, skip_verify: bool = True) -> None:
    ctx = None
    if skip_verify:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    with request.urlopen(url, context=ctx) as resp, open(target, "wb") as f:
        f.write(resp.read())


def _download_with_curl(url: str, target: Path, skip_verify: bool = True) -> None:
    cmd = ["curl", "-fL", url, "-o", str(target)]
    if skip_verify:
        cmd.insert(1, "-k")
    subprocess.run(cmd, check=True)


@lru_cache(maxsize=1)
def _list_cpp_downloadable_files() -> tuple[str, ...]:
    try:
        with request.urlopen(CPP_TREE_API_URL, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return tuple()

    files: set[str] = set()
    for item in payload:
        if not isinstance(item, dict):
            continue
        path = item.get("path", "")
        if not isinstance(path, str):
            continue
        if not path.startswith("ggml-"):
            continue
        if not (path.endswith(".bin") or path.endswith(".gguf")):
            continue
        if "-encoder." in path:
            continue
        files.add(path)
    return tuple(sorted(files))


@lru_cache(maxsize=1)
def list_cpp_downloadable_models() -> tuple[str, ...]:
    models: set[str] = set()
    for path in _list_cpp_downloadable_files():
        model_name = path
        if model_name.startswith("ggml-"):
            model_name = model_name[len("ggml-") :]
        if model_name.endswith(".bin"):
            model_name = model_name[: -len(".bin")]
        elif model_name.endswith(".gguf"):
            model_name = model_name[: -len(".gguf")]
        if model_name:
            models.add(model_name)
    return tuple(sorted(models))


def _resolve_remote_filename(model_size: str) -> str:
    normalized = model_size
    if normalized.startswith("ggml-"):
        normalized = normalized[len("ggml-") :]
    if normalized.endswith(".bin"):
        normalized = normalized[: -len(".bin")]
    elif normalized.endswith(".gguf"):
        normalized = normalized[: -len(".gguf")]

    downloadable_files = _list_cpp_downloadable_files()
    if downloadable_files:
        base = f"ggml-{normalized}"
        exact_bin = f"{base}.bin"
        exact_gguf = f"{base}.gguf"
        files_set = set(downloadable_files)
        if exact_bin in files_set:
            return exact_bin
        if exact_gguf in files_set:
            return exact_gguf

        starts_with = sorted(
            [path for path in downloadable_files if path.startswith(base + "-")]
        )
        if starts_with:
            # Prefer .bin when both are available, else use the first match.
            for path in starts_with:
                if path.endswith(".bin"):
                    return path
            return starts_with[0]

        raise FileNotFoundError(
            f"Model '{model_size}' is not available in ggerganov/whisper.cpp releases."
        )

    return f"ggml-{normalized}.bin"


def download_cpp_model(model_size: str, models_root: str | None = None) -> Path:
    models_root = models_root or os.getenv("WHISPER_MODELS_DIR")
    base_dir = Path(models_root) if models_root else Path(__file__).resolve().parent / "models"
    remote_name = _resolve_remote_filename(model_size)
    target = base_dir / "cpp" / remote_name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size >= MIN_VALID_MODEL_BYTES:
        return target
    if target.exists() and target.stat().st_size < MIN_VALID_MODEL_BYTES:
        target.unlink(missing_ok=True)

    url = f"{CPP_BASE_URL}/{remote_name}"
    print(f"Downloading ggml model for whisper.cpp: {remote_name} -> {target}")
    # Default: allow download even if cert validation fails; set WHISPER_CPP_INSECURE=0 to enforce.
    skip_verify = os.getenv("WHISPER_CPP_INSECURE", "1") != "0"
    try:
        _download_with_urllib(url, target, skip_verify=skip_verify)
    except Exception as first_err:
        try:
            _download_with_curl(url, target, skip_verify=skip_verify)
        except Exception as curl_err:
            raise RuntimeError(f"Failed to download model {model_size}: {first_err} / {curl_err}") from curl_err
    if not target.exists() or target.stat().st_size < MIN_VALID_MODEL_BYTES:
        target.unlink(missing_ok=True)
        raise RuntimeError(
            f"Downloaded file is invalid for {model_size} (missing or too small)."
        )
    return target
