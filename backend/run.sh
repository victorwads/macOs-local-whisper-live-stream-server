#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
source .venv/bin/activate
export WHISPER_MODEL_SIZE=${WHISPER_MODEL_SIZE:-large-v3}
export WHISPER_DEVICE=${WHISPER_DEVICE:-metal}
export WHISPER_COMPUTE_TYPE=${WHISPER_COMPUTE_TYPE:-auto}
export WHISPER_STRICT_DEVICE=${WHISPER_STRICT_DEVICE:-1}
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
