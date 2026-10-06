from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

from .jobs import JobManager
from .processor import PresentationValidationError, process_presentation, validate_presentation_package

APP_NAME = "Force RussianProofing4PPTX"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(100 * 1024 * 1024)))
JOB_TTL_SECONDS = int(os.getenv("JOB_TTL_SECONDS", "3600"))
STATIC_DIR = Path(os.getenv("STATIC_DIR", "/app/static"))

app = FastAPI(title=APP_NAME, version="1.0.0")
manager = JobManager(ttl_seconds=JOB_TTL_SECONDS)
processing_tasks: set[asyncio.Task] = set()

origins = [
    item.strip()
    for item in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def sanitize_filename(name: str) -> str:
    base = Path(name).name or "presentation.pptx"
    base = re.sub(r"[\x00-\x1f<>:\"/\\|?*]+", "_", base).strip(" .")
    return base or "presentation.pptx"


def output_filename(name: str) -> str:
    source = Path(name)
    suffix = source.suffix.lower()
    stem = source.stem or "presentation"
    return f"{stem}_RU_FIXED{suffix}"


def run_processing(job_id: str) -> None:
    job = manager.get(job_id)
    if not job:
        return

    manager.update(job_id, state="processing", progress=1, current_part="Starting")

    def progress(current: int, total: int, part: str) -> None:
        pct = 5 if total <= 0 else 5 + int((current / total) * 90)
        manager.update(
            job_id,
            state="processing",
            progress=min(95, max(5, pct)),
            current_part=part,
        )

    try:
        stats = process_presentation(Path(job.input_path), Path(job.output_path), progress)
        manager.update(
            job_id,
            state="ready",
            progress=100,
            current_part="Completed",
            stats=stats,
        )
    except Exception as exc:
        manager.update(
            job_id,
            state="error",
            progress=100,
            current_part="Failed",
            error=str(exc),
        )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": APP_NAME}


@app.post("/api/jobs", status_code=202)
async def create_job(file: UploadFile = File(...)) -> dict:
    original = sanitize_filename(file.filename or "presentation.pptx")
    suffix = Path(original).suffix.lower()
    if suffix not in {".pptx", ".pptm"}:
        raise HTTPException(status_code=415, detail="Only .pptx and .pptm files are supported.")

    job = manager.create(original, output_filename(original))
    written = 0

    try:
        with open(job.input_path, "wb") as target:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
                    )
                target.write(chunk)

        try:
            validate_presentation_package(Path(job.input_path))
        except PresentationValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        task = asyncio.create_task(asyncio.to_thread(run_processing, job.id))
        processing_tasks.add(task)
        task.add_done_callback(processing_tasks.discard)
        return job.public()

    except HTTPException:
        manager.delete(job.id)
        raise
    except Exception as exc:
        manager.delete(job.id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        await file.close()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    return job.public()


@app.get("/api/jobs/{job_id}/download")
def download_job(job_id: str) -> FileResponse:
    job = manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    if job.state != "ready":
        raise HTTPException(status_code=409, detail="The corrected presentation is not ready yet.")

    output_path = Path(job.output_path)
    if not output_path.exists():
        raise HTTPException(status_code=410, detail="The generated file is no longer available.")

    media_type = (
        "application/vnd.ms-powerpoint.presentation.macroEnabled.12"
        if output_path.suffix.lower() == ".pptm"
        else "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
    headers = {
        "X-Proofing-Language": "ru-RU",
        "X-Proofing-Stats": quote(str(job.stats)),
    }
    return FileResponse(
        output_path,
        media_type=media_type,
        filename=job.output_name,
        headers=headers,
        background=BackgroundTask(manager.delete, job_id),
    )


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
