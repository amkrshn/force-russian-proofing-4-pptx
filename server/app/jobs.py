from __future__ import annotations

import shutil
import tempfile
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional


@dataclass
class Job:
    id: str
    original_name: str
    output_name: str
    workdir: str
    input_path: str
    output_path: str
    state: str = "queued"
    progress: int = 0
    current_part: str = ""
    stats: Dict[str, int] = field(default_factory=dict)
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def public(self) -> Dict[str, Any]:
        data = asdict(self)
        for key in ("workdir", "input_path", "output_path"):
            data.pop(key, None)
        data["download_ready"] = self.state == "ready"
        return data


class JobManager:
    def __init__(self, ttl_seconds: int = 3600):
        self.ttl_seconds = ttl_seconds
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, original_name: str, output_name: str) -> Job:
        self.cleanup_expired()
        job_id = uuid.uuid4().hex
        workdir = tempfile.mkdtemp(prefix=f"pptx-proofing-{job_id[:8]}-")
        input_path = str(Path(workdir) / original_name)
        output_path = str(Path(workdir) / output_name)
        job = Job(
            id=job_id,
            original_name=original_name,
            output_name=output_name,
            workdir=workdir,
            input_path=input_path,
            output_path=output_path,
        )
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        self.cleanup_expired()
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **changes: Any) -> Optional[Job]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            for key, value in changes.items():
                setattr(job, key, value)
            job.updated_at = time.time()
            return job

    def delete(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job:
            shutil.rmtree(job.workdir, ignore_errors=True)

    def cleanup_expired(self) -> None:
        cutoff = time.time() - self.ttl_seconds
        expired = []
        with self._lock:
            for job_id, job in list(self._jobs.items()):
                if job.updated_at < cutoff:
                    expired.append((job_id, job.workdir))
                    self._jobs.pop(job_id, None)
        for _, workdir in expired:
            shutil.rmtree(workdir, ignore_errors=True)
