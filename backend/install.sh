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

# Default: large-v3 for best quality (Metal preferred)
MODEL_SIZE=${WHISPER_MODEL_SIZE:-${MODEL_SIZE:-large-v3}}
WHISPER_CPP_DIR=${WHISPER_CPP_DIR:-whisper.cpp}

# Optional interactive selection (arrow keys) when INTERACTIVE=1 and TTY is present.
if [ "${INTERACTIVE:-0}" = "1" ] && [ -t 0 ] && [ -t 1 ]; then
  MODEL_SIZE=$(python choose_model.py --default "$MODEL_SIZE")
fi
export MODEL_SIZE

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

python download_model.py --model-size "${MODEL_SIZE}"

# Build whisper.cpp with Metal for GPU usage
if [ ! -d "$WHISPER_CPP_DIR" ]; then
  git clone https://github.com/ggerganov/whisper.cpp.git "$WHISPER_CPP_DIR"
fi
pushd "$WHISPER_CPP_DIR" >/dev/null
git pull --ff-only || true
make clean >/dev/null 2>&1 || true
WHISPER_METAL=1 make -j"$(sysctl -n hw.ncpu)" main
popd >/dev/null

# Download ggml model for whisper.cpp if missing
CPP_MODEL_PATH="models/ggml-${MODEL_SIZE}.bin"
if [ ! -f "$CPP_MODEL_PATH" ]; then
  echo "Downloading ggml model for whisper.cpp: ${MODEL_SIZE}"
  curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL_SIZE}.bin" -o "$CPP_MODEL_PATH"
fi

echo "Installation finished."
