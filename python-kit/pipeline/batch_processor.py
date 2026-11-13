"""Concurrent batch manifest processor writing per-job status files and summary ZIPs."""

from __future__ import annotations

import csv
import json
import logging
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List

from config import settings
from pipeline.models import RenderJob

logger = logging.getLogger("vertical_pipeline.batch")


def _run_batch_item(job_payload: Dict[str, Any]) -> Dict[str, Any]:
    """Worker entrypoint executed in ProcessPoolExecutor."""
    from pipeline.orchestrator import PipelineOrchestrator

    job = RenderJob.model_validate(job_payload)
    orchestrator = PipelineOrchestrator()
    status_file = settings.output_dir / "batch_status" / f"{job.job_id}.json"
    status_file.parent.mkdir(parents=True, exist_ok=True)

    def _on_progress(pct: int, msg: str) -> None:
        status_file.write_text(
            json.dumps({"job_id": job.job_id, "status": "running", "progress": pct, "message": msg}),
            encoding="utf-8",
        )

    result = orchestrator.run(job, on_progress=_on_progress)
    payload = result.model_dump()
    status_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


class BatchProcessor:
    """Loads JSON or CSV manifests and processes N episodes concurrently."""

    def load_manifest(self, manifest_path: Path) -> List[RenderJob]:
        """Parse JSON array or CSV manifest into validated RenderJob items."""
        if not manifest_path.is_file():
            raise FileNotFoundError(f"Manifest not found: {manifest_path}")

        suffix = manifest_path.suffix.lower()
        items: List[Dict[str, Any]] = []
        if suffix == ".json":
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
            items = raw if isinstance(raw, list) else raw.get("episodes", [])
        elif suffix == ".csv":
            with open(manifest_path, "r", encoding="utf-8") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    items.append(dict(row))
        else:
            raise ValueError(f"Unsupported manifest format '{suffix}'. Expected .json or .csv.")

        jobs: List[RenderJob] = []
        for idx, row in enumerate(items, start=1):
            chars_raw = row.get("characters", ["Kena", "Roberto"])
            if isinstance(chars_raw, str):
                chars = [c.strip() for c in chars_raw.split(",") if c.strip()]
            else:
                chars = list(chars_raw)

            jobs.append(
                RenderJob(
                    job_id=str(row.get("job_id") or f"batch_{idx:03d}"),
                    genre=str(row.get("genre") or "urban drama"),
                    tone=str(row.get("tone") or "tense"),
                    duration=int(row.get("duration") or 30),
                    characters=chars or ["Kena", "Roberto"],
                    extra=str(row.get("extra") or ""),
                    output_profile="16x9" if row.get("output_profile") == "16x9" else "9x16",
                    tts_engine="elevenlabs" if row.get("tts_engine") == "elevenlabs" else "edge_tts",
                    edge_voice=str(row.get("edge_voice") or settings.edge_tts_voice),
                    elevenlabs_voice_id=str(row.get("elevenlabs_voice_id") or settings.elevenlabs_voice_id),
                )
            )
        return jobs

    def run_batch(
        self,
        jobs: List[RenderJob],
        batch_id: str,
        max_workers: int | None = None,
    ) -> Dict[str, Any]:
        """Execute batch jobs concurrently and bundle resulting MP4s + SRTs into a ZIP archive."""
        workers = max(1, min(max_workers or settings.max_batch_workers, len(jobs) or 1))
        results: List[Dict[str, Any]] = []

        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_run_batch_item, job.model_dump()): job.job_id for job in jobs}
            for fut in as_completed(futures):
                jid = futures[fut]
                try:
                    results.append(fut.result())
                except Exception as exc:  # noqa: BLE001
                    logger.error("Batch item %s failed: %s", jid, exc)
                    results.append({"job_id": jid, "status": "failed", "error": {"message": str(exc)}})

        zip_path = settings.output_dir / f"batch_{batch_id}.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for item in results:
                for key in ("video_path", "srt_path"):
                    fpath = item.get(key)
                    if fpath and Path(fpath).is_file():
                        zf.write(fpath, arcname=f"{item['job_id']}/{Path(fpath).name}")

        return {
            "batch_id": batch_id,
            "total": len(jobs),
            "succeeded": sum(1 for r in results if r.get("status") == "completed"),
            "failed": sum(1 for r in results if r.get("status") != "completed"),
            "results": results,
            "zip_path": str(zip_path),
        }
