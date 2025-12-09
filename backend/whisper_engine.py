import logging
import os
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from faster_whisper import WhisperModel


logger = logging.getLogger(__name__)


class WhisperEngine:
    def __init__(
        self,
        model_size: str = None,
        model_dir: Optional[Path] = None,
        device_preference: Optional[str] = None,
    ) -> None:
        self.model_size = model_size or os.getenv("WHISPER_MODEL_SIZE", "large-v3")
        self.model_dir = model_dir or Path(__file__).resolve().parent / "models"
        self.device_preference = device_preference or os.getenv("WHISPER_DEVICE", "metal")
        self.compute_type = self._resolve_compute_type()
        self.model = self._load_model()

    def _load_model(self) -> WhisperModel:
        preferred_path = self.model_dir / self.model_size
        if preferred_path.exists():
            model_path = preferred_path
        elif self.model_dir.exists():
            model_path = self.model_dir
        else:
            raise FileNotFoundError(
                f"Model path {preferred_path} not found. Run install.sh to download models."
            )

        devices_to_try = [self.device_preference, "cpu"]
        last_exc: Optional[Exception] = None
        for device in devices_to_try:
            if device is None:
                continue
            try:
                logger.info("Loading Whisper model from %s on device %s", model_path, device)
                model = WhisperModel(
                    str(model_path),
                    device=device,
                    compute_type=self.compute_type,
                )
                return model
            except Exception as exc:  # pragma: no cover - best effort fallback
                last_exc = exc
                logger.warning("Failed loading on %s: %s", device, exc)
                continue
        raise RuntimeError(f"Unable to load Whisper model: {last_exc}")

    def _resolve_compute_type(self) -> str:
        override = os.getenv("WHISPER_COMPUTE_TYPE")
        if override:
            return override
        # Prefer mixed precision on accelerators, int8 on CPU for speed.
        if (os.getenv("WHISPER_DEVICE") or "metal").lower() in {"metal", "cuda", "gpu"}:
            return "float16"
        return "int8_float16"

    def _run_transcription(self, source, language: Optional[str]) -> Dict:
        segments_iter, info = self.model.transcribe(
            source,
            language=language,
            beam_size=1,
            vad_filter=True,
        )
        text_parts: List[str] = []
        segments: List[Dict] = []
        for segment in segments_iter:
            seg_text = segment.text.strip()
            segments.append(
                {
                    "start": float(segment.start),
                    "end": float(segment.end),
                    "text": seg_text,
                }
            )
            if seg_text:
                text_parts.append(seg_text)
        return {"text": " ".join(text_parts).strip(), "segments": segments, "language": info.language}

    def transcribe_file(self, file_path: str, language: Optional[str] = None) -> Dict:
        return self._run_transcription(file_path, language)

    def transcribe_array(
        self, audio: np.ndarray, language: Optional[str] = None
    ) -> Dict:
        if audio.ndim != 1:
            audio = np.mean(audio, axis=1)
        audio = audio.astype(np.float32)
        return self._run_transcription(audio, language)
