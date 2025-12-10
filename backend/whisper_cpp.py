import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import soundfile as sf


class WhisperCppEngine:
    """
    Minimal wrapper around whisper.cpp CLI using ggml/gguf models.
    Requires whisper.cpp built with Metal (WHISPER_METAL=1 make main).
    """

    def __init__(self, model_name: str, models_dir: Optional[Path] = None, cpp_dir: Optional[Path] = None):
        self.model_name = model_name
        self.models_dir = models_dir or Path(__file__).resolve().parent / "models"
        self.cpp_dir = cpp_dir or Path(__file__).resolve().parent / "whisper.cpp"
        self.binary = os.getenv("WHISPER_CPP_BIN") or str(self.cpp_dir / "main")
        self.model_path = self._resolve_model_path()
        if not Path(self.binary).exists():
            raise FileNotFoundError(f"whisper.cpp binary not found at {self.binary}. Run install.sh.")

    def _resolve_model_path(self) -> Path:
        names_to_try = []
        if self.model_name.startswith("ggml-"):
            names_to_try.append(self.model_name)
        else:
            names_to_try.append(f"ggml-{self.model_name}.bin")
        names_to_try.append(self.model_name)
        for name in names_to_try:
            candidate = self.models_dir / name
            if candidate.exists():
                return candidate
        raise FileNotFoundError(f"Model for whisper.cpp not found: {candidate}")

    def _run_cli(self, audio_path: Path) -> Dict:
        with tempfile.TemporaryDirectory() as tmpdir:
            out_prefix = Path(tmpdir) / "out"
            cmd = [
                self.binary,
                "-m",
                str(self.model_path),
                "-f",
                str(audio_path),
                "-l",
                "auto",
                "-of",
                str(out_prefix),
                "-oj",
                "--print-progress",
                "false",
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError(f"whisper.cpp failed: {proc.stderr or proc.stdout}")
            json_path = out_prefix.with_suffix(".json")
            if not json_path.exists():
                raise RuntimeError(f"JSON output not found at {json_path}")
            data = json.loads(json_path.read_text())
            segments_raw: List[Dict] = data.get("segments", [])
            segments: List[Dict] = []
            texts: List[str] = []
            for seg in segments_raw:
                text = seg.get("text", "").strip()
                segments.append(
                    {
                        "start": float(seg.get("t0", 0)) / 1000.0,
                        "end": float(seg.get("t1", 0)) / 1000.0,
                        "text": text,
                    }
                )
                if text:
                    texts.append(text)
            return {"text": " ".join(texts).strip(), "segments": segments}

    def transcribe_file(self, file_path: str) -> Dict:
        return self._run_cli(Path(file_path))

    def transcribe_array(self, audio: np.ndarray) -> Dict:
        if audio.ndim != 1:
            audio = np.mean(audio, axis=1)
        audio = audio.astype(np.float32)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio, samplerate=16000)
            tmp_path = Path(tmp.name)
        try:
            return self._run_cli(tmp_path)
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass
