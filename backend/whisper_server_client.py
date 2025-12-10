import os
import tempfile
import threading
import subprocess
import socket
import time
from pathlib import Path
from typing import Dict, Optional

import psutil
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
        self.active_requests = 0
        self.average_latency: Optional[float] = None
        self.model_size_mb = self._get_model_size_mb()
        self.total_requests = 0
        self.total_partials = 0
        self.total_finals = 0
        self.open_sockets = 0

    def _get_model_size_mb(self) -> str:
        try:
            size_bytes = self.model_path.stat().st_size
            size_mb = size_bytes / (1024 * 1024)
            return f"{int(size_mb)} MB"
        except Exception:
            return "Unknown"

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
            f = log_file.open("ab")
            try:
                self.proc = subprocess.Popen(
                    cmd,
                    stdout=f,
                    stderr=subprocess.STDOUT,
                )
            finally:
                f.close()
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

    def is_running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def update_latency(self, duration: float) -> None:
        duration_ms = duration * 1000
        with self.lock:
            if self.average_latency is None:
                self.average_latency = duration_ms
            else:
                self.average_latency = (self.average_latency + duration_ms) / 2

    def increment_stats(self, is_partial: bool) -> None:
        with self.lock:
            self.total_requests += 1
            if is_partial:
                self.total_partials += 1
            else:
                self.total_finals += 1

    def update_socket_count(self, delta: int) -> None:
        with self.lock:
            self.open_sockets += delta

    def info(self) -> Dict:
        log_file = Path(tempfile.gettempdir()) / f"whisper-server-{self.port}.log"
        latency_str = f"{int(self.average_latency)}ms" if self.average_latency is not None else None
        return {
            "model_path": str(self.model_path),
            "model_size": self.model_size_mb,
            "port": self.port,
            "threads": self.threads,
            "running": self.is_running(),
            "log_file": str(log_file),
            "active_requests": self.active_requests,
            "average_latency": latency_str,
            "total_requests": self.total_requests,
            "total_partials": self.total_partials,
            "total_finals": self.total_finals,
            "open_sockets": self.open_sockets,
        }


class WhisperServerManager:
    def __init__(self) -> None:
        self.base_port = int(os.getenv("WHISPER_SERVER_BASE_PORT", "9000"))
        self.models_dir = Path(os.getenv("WHISPER_MODELS_DIR") or Path(__file__).resolve().parent / "models")
        self.server_bin = self._resolve_server_bin()
        self.processes: Dict[str, WhisperServerProcess] = {}
        self.session = requests.Session()
        self.language = os.getenv("WHISPER_LANGUAGE", "auto")
        self.response_format = os.getenv("WHISPER_SERVER_RESPONSE", "json")
        self.manager_lock = threading.Lock()
        self.socket_counts: Dict[str, int] = {}

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
        with self.manager_lock:
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

    def transcribe_array(self, model_name: str, audio: np.ndarray, language: str = None, is_partial: bool = False) -> Dict:
        proc = self._get_or_start(model_name)
        with proc.lock:
            proc.active_requests += 1

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio, samplerate=16000)
            tmp_path = Path(tmp.name)
        try:
            with tmp_path.open("rb") as f:
                files = {"file": (tmp_path.name, f, "audio/wav")}
                data = {
                    "language": language or self.language,
                    "response_format": self.response_format,
                }
                url = f"http://127.0.0.1:{proc.port}/inference"
                print(f"[server-manager] POST {url} audio={tmp_path.name} lang={data['language']}")
                start_time = time.time()
                resp = self.session.post(url, files=files, data=data, timeout=120)
                duration = time.time() - start_time
                proc.update_latency(duration)
                proc.increment_stats(is_partial)
                print(f"[server-manager] Response {resp.status_code}: {resp.text[:200]}")
                resp.raise_for_status()
                return resp.json()
        finally:
            with proc.lock:
                proc.active_requests -= 1
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

    def running_servers(self) -> Dict[str, Dict]:
        results = {}
        for name, proc in self.processes.items():
            if proc.is_running():
                info = proc.info()
                info["open_sockets"] = self.socket_counts.get(name, 0)
                results[name] = info
        return results

    def stop_server(self, model_name: str) -> bool:
        proc = self.processes.get(model_name)
        if not proc or not proc.is_running():
            return False
        if proc.active_requests > 0:
            raise RuntimeError(f"Cannot stop server {model_name}: {proc.active_requests} active requests")
        proc.stop()
        return True

    def update_socket_count(self, model_name: str, delta: int) -> None:
        with self.manager_lock:
            current = self.socket_counts.get(model_name, 0)
            self.socket_counts[model_name] = max(0, current + delta)


server_manager = WhisperServerManager()
