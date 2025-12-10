#!/usr/bin/env python3
"""
Integration test that exercises the whisper.cpp HTTP server path.
It ensures the requested ggml model is available, starts (or reuses)
the server via WhisperServerManager, sends the bundled voicememo audio,
and verifies that transcription text is returned.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Tuple

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
VENV_PY = BACKEND_DIR / ".venv" / "bin" / "python"

# Ensure we run inside the project virtualenv so dependencies are available.
if VENV_PY.exists() and Path(sys.executable) != VENV_PY:
    os.execv(VENV_PY, [str(VENV_PY), __file__])

from engine_manager import DEFAULT_MODEL  # noqa: E402
from cpp_model import download_cpp_model  # noqa: E402
from whisper_server_client import server_manager  # noqa: E402


def _ensure_wav(audio_path: Path) -> Tuple[Path, bool]:
    """
    Convert non-WAV sources to 16kHz mono WAV via ffmpeg.
    Returns (path, is_temporary) so callers can clean up.
    """
    if audio_path.suffix.lower() == ".wav":
        return audio_path, False
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        raise RuntimeError(
            "ffmpeg is required to convert non-WAV inputs for the whisper server test."
        )
    fd, tmp_name = tempfile.mkstemp(suffix=".wav", prefix="whisper-test-")
    os.close(fd)
    tmp_path = Path(tmp_name)
    cmd = [
        ffmpeg_path,
        "-y",
        "-i",
        str(audio_path),
        "-ar",
        "16000",
        "-ac",
        "1",
        str(tmp_path),
    ]
    try:
        subprocess.run(
            cmd,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError as exc:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise RuntimeError(f"ffmpeg conversion failed: {exc}") from exc
    return tmp_path, True


def main() -> None:
    model = os.getenv("WHISPER_MODEL_SIZE", DEFAULT_MODEL)
    print(f"[test] ensuring ggml model '{model}' is available...")
    download_cpp_model(model, os.getenv("WHISPER_MODELS_DIR"))

    audio_path = REPO_ROOT / "voicememo.m4a"
    if not audio_path.exists():
        raise FileNotFoundError(f"Sample audio not found at {audio_path}")

    wav_path, is_tmp = _ensure_wav(audio_path)
    try:
        print("[test] starting whisper-server (if needed)...")
        result = server_manager.transcribe_file(model, str(wav_path))
    finally:
        if is_tmp:
            try:
                wav_path.unlink()
            except OSError:
                pass
        server_manager.stop_all()

    text = ""
    if isinstance(result, dict):
        text = (result.get("text") or "").strip()
        if not text and isinstance(result.get("segments"), list):
            parts = [seg.get("text", "").strip() for seg in result["segments"]]
            text = " ".join(part for part in parts if part)

    if not text:
        raise SystemExit("Transcription text is empty – whisper-server may have failed.")

    print("[test] transcription output:")
    print(text)
    print("OK")


if __name__ == "__main__":
    main()
