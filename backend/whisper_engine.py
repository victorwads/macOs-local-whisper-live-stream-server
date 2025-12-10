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
        # Default: large-v3 for best accuracy (Metal preferred)
        self.model_size = model_size or os.getenv("WHISPER_MODEL_SIZE", "large-v3")
        env_model_dir = os.getenv("WHISPER_MODELS_DIR")
        resolved_dir = Path(env_model_dir) if env_model_dir else Path(__file__).resolve().parent / "models"
        self.model_dir = model_dir or resolved_dir
        self.device_preference = device_preference or os.getenv("WHISPER_DEVICE", "metal")
        self.strict_device = self._parse_bool(os.getenv("WHISPER_STRICT_DEVICE", "0"))
        self.compute_type = self._resolve_compute_type()
        self.active_device: str = ""
        self.active_compute_type: str = ""
        self.model = self._load_model()

    def _load_model(self) -> WhisperModel:
        available = self.available_models()
        preferred_path = self.model_dir / self.model_size
        if preferred_path.exists():
            model_path = preferred_path
        else:
            available_str = ", ".join(available) if available else "none"
            raise FileNotFoundError(
                f"Model '{self.model_size}' not found in {self.model_dir}. "
                f"Available models: {available_str}. Run install.sh to download."
            )

        devices_to_try = []
        if self.device_preference:
            devices_to_try.append(self.device_preference)
            if self.device_preference == "metal":
                devices_to_try.append("auto")  # let ctranslate2 decide best available
        if not self.strict_device:
            devices_to_try.append("cpu")
        last_exc: Optional[Exception] = None
        for device in devices_to_try:
            if device is None:
                continue
            compute_options = [self.compute_type]
            if "int8_float16" not in compute_options:
                compute_options.append("int8_float16")
            if "int8" not in compute_options:
                compute_options.append("int8")

            for ctype in compute_options:
                try:
                    logger.info(
                        "Loading Whisper model from %s on device %s with compute_type=%s",
                        model_path,
                        device,
                        ctype,
                    )
                    model = WhisperModel(
                        str(model_path),
                        device=device,
                        compute_type=ctype,
                    )
                    # Save the actual configuration that worked.
                    self.compute_type = ctype
                    self.device_preference = device
                    self.active_device = device
                    self.active_compute_type = ctype
                    return model
                except Exception as exc:  # pragma: no cover - best effort fallback
                    last_exc = exc
                    logger.warning(
                        "Failed loading on %s with compute_type=%s: %s", device, ctype, exc
                    )
                    continue
        raise RuntimeError(f"Unable to load Whisper model: {last_exc}")

    @staticmethod
    def _parse_bool(value: str) -> bool:
        return value.lower() in {"1", "true", "yes", "on"}

    @staticmethod
    def available_models() -> List[str]:
        env_model_dir = os.getenv("WHISPER_MODELS_DIR")
        model_dir = Path(env_model_dir) if env_model_dir else Path(__file__).resolve().parent / "models"
        if not model_dir.exists():
            return []
        names: List[str] = []
        for item in model_dir.iterdir():
            if item.is_dir():
                names.append(item.name)
            elif item.is_file() and item.name.startswith("ggml-") and item.suffix in {".bin", ".gguf"}:
                names.append(item.name)
        return sorted(names)

    def info(self) -> Dict[str, str]:
        return {
            "model": self.model_size,
            "device": self.active_device or self.device_preference,
            "compute_type": self.active_compute_type or self.compute_type,
        }

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
        # Skip inference on effectively silent buffers to avoid backend errors.
        if audio.size == 0 or float(np.max(np.abs(audio))) < 1e-5:
            return {"text": "", "segments": [], "language": language}
        try:
            return self._run_transcription(audio, language)
        except Exception as exc:  # pragma: no cover - runtime safeguard
            logger.warning("Streaming transcription failed: %s", exc)
            return {"text": "", "segments": [], "language": language}
