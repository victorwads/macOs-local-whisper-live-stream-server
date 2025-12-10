import os
import ssl
import subprocess
from pathlib import Path
from urllib import request, error

CPP_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"


def _download_with_urllib(url: str, target: Path, skip_verify: bool = True) -> None:
    ctx = None
    if skip_verify:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    with request.urlopen(url, context=ctx) as resp, open(target, "wb") as f:
        f.write(resp.read())


def _download_with_curl(url: str, target: Path, skip_verify: bool = True) -> None:
    cmd = ["curl", "-L", url, "-o", str(target)]
    if skip_verify:
        cmd.insert(1, "-k")
    subprocess.run(cmd, check=True)


def download_cpp_model(model_size: str, models_root: str | None = None) -> Path:
    models_root = models_root or os.getenv("WHISPER_MODELS_DIR")
    base_dir = Path(models_root) if models_root else Path(__file__).resolve().parent / "models"
    target = base_dir / "cpp" / f"ggml-{model_size}.bin"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return target

    url = f"{CPP_BASE_URL}/ggml-{model_size}.bin"
    print(f"Downloading ggml model for whisper.cpp: {model_size} -> {target}")
    # Default: allow download even if cert validation fails; set WHISPER_CPP_INSECURE=0 to enforce.
    skip_verify = os.getenv("WHISPER_CPP_INSECURE", "1") != "0"
    try:
        _download_with_urllib(url, target, skip_verify=skip_verify)
    except Exception as first_err:
        try:
            _download_with_curl(url, target, skip_verify=skip_verify)
        except Exception as curl_err:
            raise RuntimeError(f"Failed to download model {model_size}: {first_err} / {curl_err}") from curl_err
    return target
