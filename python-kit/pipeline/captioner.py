"""Whisper-based transcription producing SRT files and (start, end, text) cues."""

from __future__ import annotations

import logging
import traceback
from pathlib import Path
from typing import Any, List, Tuple

import whisper

from config import settings
from pipeline.models import PipelineError

logger = logging.getLogger("vertical_pipeline.captioner")

_WHISPER_CACHE: dict[str, Any] = {}


def format_srt_timestamp(seconds: float) -> str:
    """Format seconds as `HH:MM:SS,mmm`."""
    ms_total = max(0, int(round(seconds * 1000)))
    hrs, rem = divmod(ms_total, 3_600_000)
    mins, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{ms:03d}"


class Captioner:
    """Generates SRT captions and timed cue tuples via local Whisper."""

    def __init__(self, model_name: str | None = None) -> None:
        self.model_name = model_name or settings.whisper_model

    def _get_model(self) -> Any:
        """Lazy-load and cache Whisper model."""
        if self.model_name not in _WHISPER_CACHE:
            logger.info("Loading Whisper '%s' model...", self.model_name)
            _WHISPER_CACHE[self.model_name] = whisper.load_model(self.model_name)
        return _WHISPER_CACHE[self.model_name]

    def transcribe_to_srt(
        self,
        wav_path: Path,
        out_srt: Path,
    ) -> Tuple[Path, List[Tuple[float, float, str]]]:
        """Transcribe WAV audio and write SRT file."""
        if not wav_path.is_file():
            raise PipelineError("captions", f"Audio file not found: {wav_path}")

        try:
            model = self._get_model()
            result = model.transcribe(str(wav_path), word_timestamps=True)
        except Exception as exc:  # noqa: BLE001
            raise PipelineError(
                "captions",
                f"Whisper transcription failed: {exc}",
                retryable=False,
                traceback_str=traceback.format_exc(),
            ) from exc

        cues: List[Tuple[float, float, str]] = []
        srt_blocks: List[str] = []
        for idx, seg in enumerate(result.get("segments", []), start=1):
            start = float(seg.get("start", 0.0))
            end = float(seg.get("end", start + 1.0))
            text = str(seg.get("text", "")).strip()
            if not text:
                continue
            cues.append((start, end, text))
            srt_blocks.append(
                f"{idx}\n{format_srt_timestamp(start)} --> {format_srt_timestamp(end)}\n{text}"
            )

        out_srt.parent.mkdir(parents=True, exist_ok=True)
        out_srt.write_text("\n\n".join(srt_blocks) + "\n", encoding="utf-8")
        logger.info("Saved %d SRT cues to %s", len(cues), out_srt)
        return out_srt, cues
