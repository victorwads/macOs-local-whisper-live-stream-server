import os
import tempfile
import threading
import subprocess
import socket
from pathlib import Path
from typing import Dict, Optional

import requests
import soundfile as sf
import numpy as np


class WhisperServerProcess:
    def __init__(self, model_path: Path, server_bin: Path, port: int, threads: int = 4) -> None:
        self.model_path = model_path
        self.server_bin = server_bin
        self.port = port
        self.threads = threads
        self.proc: Optional[subprocess.Popen] = None
        self.lock = threading.Lock()

    def start(self) -> None:
        if not self.server_bin or not Path(self.server_bin).exists():
            raise FileNotFoundError(f"whisper-server binary not found at {self.server_bin}")
        with self.lock:
            if self.proc and self.proc.poll() is None:
                return
            log_file = Path(tempfile.gettempdir()) / f"whisper-server-{self.port}.log"
            cmd = [
                str(self.server_bin),
                "-m",
                str(self.model_path),
                "--port",
                str(self.port),
                "--host",
                "127.0.0.1",
                "-t",
                str(self.threads),
                "--print-progress",
                "false",
            ]
            self.proc = subprocess.Popen(
                cmd,
                stdout=log_file.open("ab"),
                stderr=subprocess.STDOUT,
            )
        # wait for server to bind or die
        for _ in range(30):
            if self.proc and self.proc.poll() is not None:
                raise RuntimeError(f"whisper-server exited immediately, see log {log_file}")
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.2):
                    return
            except Exception:
                pass
            import time

            time.sleep(0.2)
        raise RuntimeError(f"whisper-server did not start on port {self.port}, see log {log_file}")

    def stop(self) -> None:
        with self.lock:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
            self.proc = None


class WhisperServerManager:
    def __init__(self) -> None:
        self.base_port = int(os.getenv("WHISPER_SERVER_BASE_PORT", "9000"))
        self.next_port = self.base_port
        self.models_dir = Path(os.getenv("WHISPER_MODELS_DIR") or Path(__file__).resolve().parent / "models")
        self.server_bin = self._resolve_server_bin()
        self.processes: Dict[str, WhisperServerProcess] = {}
        self.session = requests.Session()

    def _resolve_server_bin(self) -> Path:
        env_bin = os.getenv("WHISPER_SERVER_BIN")
        if env_bin:
            return Path(env_bin)
        base = Path(__file__).resolve().parent
        candidates = [
            base / "whisper.cpp" / "bin" / "whisper-server",
            base / "whisper.cpp" / "build" / "bin" / "whisper-server",
            base / "whisper.cpp" / "build" / "bin" / "Release" / "whisper-server",
        ]
        for c in candidates:
            if c.exists():
                return c
        return Path("")

    def _resolve_model(self, model_name: str) -> Path:
        name = model_name
        if not name.startswith("ggml-"):
            name = f"ggml-{name}.bin"
        path = self.models_dir / "cpp" / name
        if not path.exists():
            raise FileNotFoundError(f"Model not found for server: {path}")
        return path

    def _get_or_start(self, model_name: str) -> WhisperServerProcess:
        if model_name in self.processes:
            proc = self.processes[model_name]
            proc.start()
            return proc
        model_path = self._resolve_model(model_name)
        port = self.next_port
        self.next_port += 1
        if not self.server_bin or not self.server_bin.exists():
            raise FileNotFoundError("whisper-server binary not found. Run install.sh to build it.")
        proc = WhisperServerProcess(model_path=model_path, server_bin=self.server_bin, port=port)
        proc.start()
        self.processes[model_name] = proc
        return proc

    def transcribe_array(self, model_name: str, audio: np.ndarray) -> Dict:
        proc = self._get_or_start(model_name)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio, samplerate=16000)
            tmp_path = Path(tmp.name)
        try:
            files = {"file": (tmp_path.name, tmp_path.open("rb"), "audio/wav")}
            resp = self.session.post(f"http://127.0.0.1:{proc.port}/inference", files=files, timeout=120)
            resp.raise_for_status()
            return resp.json()
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass

    def transcribe_file(self, model_name: str, file_path: str) -> Dict:
        proc = self._get_or_start(model_name)
        files = {"file": (Path(file_path).name, open(file_path, "rb"), "audio/wav")}
        resp = self.session.post(f"http://127.0.0.1:{proc.port}/inference", files=files, timeout=120)
        resp.raise_for_status()
        return resp.json()


server_manager = WhisperServerManager()
