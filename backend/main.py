import asyncio
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from whisper_engine import WhisperEngine
from ws import router as ws_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Whisper Local App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ws_router)

engine: Optional[WhisperEngine] = None


@app.on_event("startup")
async def load_model() -> None:
    global engine
    if engine is None:
        engine = WhisperEngine()
        logger.info("Whisper model loaded and ready.")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> JSONResponse:
    if engine is None:
        await load_model()
    assert engine is not None

    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    suffix = Path(file.filename).suffix or ".wav"
    try:
        contents = await file.read()
    except Exception as exc:  # pragma: no cover - FastAPI handles validation
        raise HTTPException(status_code=400, detail=f"Failed to read file: {exc}") from exc

    if not contents:
        raise HTTPException(status_code=400, detail="File is empty")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(contents)
        temp_path = tmp.name

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, engine.transcribe_file, temp_path)
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            logger.warning("Temporary file %s could not be removed", temp_path)

    return JSONResponse(result)
