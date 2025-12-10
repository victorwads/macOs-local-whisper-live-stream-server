import os
import tempfile
import threading
import subprocess
import socket
import time
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
            ]
            self.proc = subprocess.Popen(
                cmd,
                stdout=log_file.open("ab"),
                stderr=subprocess.STDOUT,
            )
        # wait for server to bind or die
        timeout = float(os.getenv("WHISPER_SERVER_START_TIMEOUT", "60"))
        start_time = time.time()
        while time.time() - start_time < timeout:
            if self.proc and self.proc.poll() is not None:
                raise RuntimeError(f"whisper-server exited immediately, see log {log_file}")
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.2):
                    return
            except Exception:
                pass
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
        self.models_dir = Path(os.getenv("WHISPER_MODELS_DIR") or Path(__file__).resolve().parent / "models")
        self.server_bin = self._resolve_server_bin()
        self.processes: Dict[str, WhisperServerProcess] = {}
        self.session = requests.Session()
        self.language = os.getenv("WHISPER_LANGUAGE", "auto")
        self.response_format = os.getenv("WHISPER_SERVER_RESPONSE", "json")

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
        if not self.server_bin or not self.server_bin.exists():
            raise FileNotFoundError("whisper-server binary not found. Run install.sh to build it.")
        port = self._reserve_port()
        proc = WhisperServerProcess(model_path=model_path, server_bin=self.server_bin, port=port)
        proc.start()
        self.processes[model_name] = proc
        print(f"[server-manager] started whisper-server for {model_name} on port {port}")
        return proc

    def _reserve_port(self) -> int:
        # try sequential from base_port, then fallback to OS-assigned free port
        for p in range(self.base_port, self.base_port + 100):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(("127.0.0.1", p))
                    return p
                except OSError:
                    continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    def transcribe_array(self, model_name: str, audio: np.ndarray, language: str = None) -> Dict:
        proc = self._get_or_start(model_name)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio, samplerate=16000)
            tmp_path = Path(tmp.name)
        try:
            files = {"file": (tmp_path.name, tmp_path.open("rb"), "audio/wav")}
            data = {
                "language": language or self.language,
                "response_format": self.response_format,
            }
            url = f"http://127.0.0.1:{proc.port}/inference"
            print(f"[server-manager] POST {url} audio={tmp_path.name} lang={data['language']}")
            resp = self.session.post(url, files=files, data=data, timeout=120)
            print(f"[server-manager] Response {resp.status_code}: {resp.text[:200]}")
            resp.raise_for_status()
            return resp.json()
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass

    def transcribe_file(self, model_name: str, file_path: str, language: str = None) -> Dict:
        data, sr = sf.read(file_path, always_2d=False)
        if data.ndim > 1:
            data = np.mean(data, axis=1)
        if sr != 16000:
            x_old = np.linspace(0, len(data) - 1, num=len(data))
            x_new = np.linspace(0, len(data) - 1, num=int(len(data) * 16000 / sr))
            data = np.interp(x_new, x_old, data)
        data = data.astype(np.float32)
        return self.transcribe_array(model_name, data, language=language)

    def stop_all(self) -> None:
        for proc in self.processes.values():
            proc.stop()


server_manager = WhisperServerManager()
