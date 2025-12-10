import asyncio
import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ws import router as ws_router
from engine_manager import (
    DEFAULT_MODEL,
    available_models,
    ensure_engine,
    installed_models,
    supported_models,
)
from whisper_server_client import server_manager

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


@app.on_event("startup")
async def load_model() -> None:
    try:
        ensure_engine(DEFAULT_MODEL, download=False)
        logger.info("Whisper model loaded and ready.")
    except FileNotFoundError:
        logger.info("Model %s not found at startup; will load on demand.", DEFAULT_MODEL)


@app.get("/servers")
async def list_servers(request: Request) -> dict:
    """Listar servidores Whisper em execução gerenciados pelo server_manager."""
    servers = server_manager.running_servers()
    results = {}
    for name, info in servers.items():
        server_info = info.copy()
        server_info["stop_url"] = str(request.url_for("stop_server", model_name=name))
        results[name] = server_info
    return {"servers": results}


@app.get("/servers/{model_name}/stop")
async def stop_server(model_name: str) -> dict:
    """Encerrar o servidor Whisper associado a um determinado modelo."""
    try:
        if not server_manager.stop_server(model_name):
            raise HTTPException(status_code=404, detail="Server not found or not running")
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"status": "stopped", "model": model_name}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/models")
async def list_models() -> dict:
    return {
        "installed": installed_models(),
        "supported": supported_models(),
        "default": DEFAULT_MODEL,
    }


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model: Optional[str] = Form(None),
) -> JSONResponse:
    engine = ensure_engine(model, download=False)

    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    suffix = Path(file.filename).suffix or ".wav"
    
    # Use tempfile to avoid loading entire file into RAM
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        try:
            # Stream file content to disk
            file.file.seek(0)
            shutil.copyfileobj(file.file, tmp)
            temp_path = tmp.name
        except Exception as exc:
            os.unlink(tmp.name)
            raise HTTPException(status_code=400, detail=f"Failed to save upload: {exc}") from exc

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, engine.transcribe_file, temp_path)
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            logger.warning("Temporary file %s could not be removed", temp_path)

    return JSONResponse(result)
