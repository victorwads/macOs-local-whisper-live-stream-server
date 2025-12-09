#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PYTHON_BIN=${PYTHON_BIN:-python3}
if command -v python3.11 >/dev/null 2>&1; then
  PYTHON_BIN=python3.11
fi

echo "Using python executable: $PYTHON_BIN"

$PYTHON_BIN -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

MODEL_SIZE=${WHISPER_MODEL_SIZE:-large-v3}

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found; attempting to install..." >&2
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg || true
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y ffmpeg || true
  else
    echo "Please install ffmpeg manually; audio decoding may fail." >&2
  fi
fi

python - <<'PY'
from pathlib import Path
from faster_whisper.utils import download_model

models_dir = Path(__file__).parent / "models"
models_dir.mkdir(exist_ok=True)
model_size = "${MODEL_SIZE}"
print(f"Downloading Whisper model '{model_size}' to {models_dir} ...")
download_model(model_size, models_dir)
print("Model download complete.")
PY

echo "Installation finished."
