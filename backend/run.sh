#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
source .venv/bin/activate

MODEL_SIZE=${WHISPER_MODEL_SIZE:-${MODEL_SIZE:-large-v3}}
if [ "${WHISPER_INTERACTIVE:-${INTERACTIVE:-0}}" = "1" ] && [ -t 0 ] && [ -t 1 ]; then
  MODEL_SIZE=$(python choose_model.py --default "$MODEL_SIZE")
fi
export WHISPER_MODEL_SIZE="$MODEL_SIZE"
export WHISPER_DEVICE=${WHISPER_DEVICE:-metal}
export WHISPER_COMPUTE_TYPE=${WHISPER_COMPUTE_TYPE:-auto}
export WHISPER_STRICT_DEVICE=${WHISPER_STRICT_DEVICE:-0}
export WHISPER_BACKEND=${WHISPER_BACKEND:-cpp}
# whisper.cpp default binary lives in ./bin/main after make; fall back to legacy ./main
DEFAULT_CPP_BIN="$(dirname "$0")/whisper.cpp/bin/main"
if [ ! -x "$DEFAULT_CPP_BIN" ]; then
  DEFAULT_CPP_BIN="$(dirname "$0")/whisper.cpp/main"
fi
export WHISPER_CPP_BIN=${WHISPER_CPP_BIN:-$DEFAULT_CPP_BIN}
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
