#!/usr/bin/env python3
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import requests

BACKEND_DIR = Path(__file__).resolve().parent
VENV_PY = BACKEND_DIR / ".venv" / "bin" / "python"

# Re-exec using the virtualenv python if available and not already used
if VENV_PY.exists() and Path(sys.executable) != VENV_PY:
    os.execv(VENV_PY, [str(VENV_PY), __file__])

SERVER_URL = "http://127.0.0.1:8000"


def server_available() -> bool:
    try:
        resp = requests.get(f"{SERVER_URL}/health", timeout=2)
        return resp.status_code == 200
    except Exception:
        return False


def start_server() -> subprocess.Popen:
    env = os.environ.copy()
    env.setdefault("WHISPER_DEVICE", "metal")
    cmd = [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"]
    proc = subprocess.Popen(cmd, cwd=BACKEND_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, env=env)
    return proc


def wait_for_server(timeout: float = 60.0) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        if server_available():
            return True
        time.sleep(1)
    return False


def main() -> None:
    spawned = None
    if not server_available():
        spawned = start_server()
        if not wait_for_server():
            raise RuntimeError("Backend server did not start in time")

    audio_path = BACKEND_DIR.parent / "voicememo.m4a"
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found at {audio_path}")

    with audio_path.open("rb") as f:
        files = {"file": (audio_path.name, f, "audio/mp4")}
        resp = requests.post(f"{SERVER_URL}/transcribe", files=files, timeout=600)

    if resp.status_code != 200:
        if spawned:
            spawned.terminate()
        raise SystemExit(f"Unexpected status code: {resp.status_code} - {resp.text}")

    data = resp.json()
    text = data.get("text", "")
    if not text:
        if spawned:
            spawned.terminate()
        raise SystemExit("Transcription is empty")

    print("OK")

    if spawned:
        spawned.send_signal(signal.SIGTERM)
        try:
            spawned.wait(timeout=5)
        except subprocess.TimeoutExpired:
            spawned.kill()


if __name__ == "__main__":
    main()
