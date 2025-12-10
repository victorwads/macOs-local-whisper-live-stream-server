#!/usr/bin/env bash
set -euo pipefail

bash install.sh

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
# whisper.cpp default binary lives in ./bin/whisper-cli after install; fallbacks for build paths
DEFAULT_CPP_BIN=""
for path in \
  "$(dirname "$0")/whisper.cpp/bin/whisper-cli" \
  "$(dirname "$0")/whisper.cpp/bin/main" \
  "$(dirname "$0")/whisper.cpp/whisper-cli" \
  "$(dirname "$0")/whisper.cpp/main" \
  "$(dirname "$0")/whisper.cpp/build/bin/whisper-cli" \
  "$(dirname "$0")/whisper.cpp/build/bin/main" \
  "$(dirname "$0")/whisper.cpp/build/bin/Release/whisper-cli" \
  "$(dirname "$0")/whisper.cpp/build/bin/Release/main"; do
  if [ -x "$path" ]; then
    DEFAULT_CPP_BIN="$path"
    break
  fi
done
export WHISPER_CPP_BIN=${WHISPER_CPP_BIN:-$DEFAULT_CPP_BIN}
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
