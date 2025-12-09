#!/usr/bin/env python3
import argparse
import os
from pathlib import Path

from faster_whisper.utils import download_model

SUPPORTED = {
    "tiny.en",
    "tiny",
    "base.en",
    "base",
    "small.en",
    "small",
    "medium.en",
    "medium",
    "large-v1",
    "large-v2",
    "large-v3",
    "large",
    "distil-large-v2",
    "distil-medium.en",
    "distil-small.en",
    "distil-large-v3",
}


def fetch_model(model_size: str, models_dir: str | None = None) -> Path:
    if model_size not in SUPPORTED:
        available = ", ".join(sorted(SUPPORTED))
        raise ValueError(f"Invalid model '{model_size}'. Choose one of: {available}")
    base_dir = Path(models_dir) if models_dir else Path(__file__).resolve().parent / "models"
    target_dir = base_dir / model_size
    target_dir.mkdir(parents=True, exist_ok=True)
    download_model(model_size, target_dir)
    return target_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download a faster-whisper model.")
    parser.add_argument(
        "--model-size",
        default=os.getenv("WHISPER_MODEL_SIZE") or os.getenv("MODEL_SIZE") or "large-v3",
        help="Model size/id to download (default: env WHISPER_MODEL_SIZE or large-v3).",
    )
    parser.add_argument(
        "--models-dir",
        default=os.getenv("WHISPER_MODELS_DIR"),
        help="Directory to store models (default: backend/models).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    base_dir = (
        Path(args.models_dir)
        if args.models_dir
        else Path(__file__).resolve().parent / "models"
    )
    model_size = args.model_size

    target_dir = base_dir / model_size
    target_dir.mkdir(parents=True, exist_ok=True)

    if model_size not in SUPPORTED:
        available = ", ".join(sorted(SUPPORTED))
        raise SystemExit(
            f"Invalid model '{model_size}'. Choose one of: {available}"
        )

    print(f"Downloading Whisper model '{model_size}' to {target_dir} ...")
    download_model(model_size, target_dir)

    available = sorted([p.name for p in base_dir.iterdir() if p.is_dir()])
    print(f"Available models after download: {', '.join(available) if available else 'none'}")
    print("Model download complete.")


if __name__ == "__main__":
    main()
