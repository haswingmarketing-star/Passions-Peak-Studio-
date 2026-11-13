"""Audio mixing module: mixes voiceover + BGM with envelope ducking and loudness normalization."""

from __future__ import annotations

import logging
import math
import subprocess
import traceback
from pathlib import Path
from typing import Optional

from pydub import AudioSegment

from pipeline.models import PipelineError

logger = logging.getLogger("vertical_pipeline.audio_mixer")


class AudioMixer:
    """Combines narration WAV and background music with automatic ducking."""

    def mix(
        self,
        voice_wav: Path,
        out_path: Path,
        bgm_path: Optional[Path] = None,
        bgm_volume: float = 0.32,
        ducking_db: float = 12.0,
        target_duration_ms: Optional[int] = None,
    ) -> Path:
        """Mix VO + optional looped BGM, ducking BGM wherever speech energy is present."""
        if not voice_wav.is_file():
            raise PipelineError("audio_mix", f"Voiceover file not found: {voice_wav}")

        out_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            vo = AudioSegment.from_file(voice_wav).set_frame_rate(44100).set_channels(2)
            vo = self._normalize_segment(vo, target_dbfs=-14.0)

            total_ms = max(len(vo), target_duration_ms or len(vo))
            if len(vo) < total_ms:
                vo = vo + AudioSegment.silent(duration=total_ms - len(vo), frame_rate=44100).set_channels(2)

            if not bgm_path or not bgm_path.is_file():
                vo.export(out_path, format="wav")
                logger.info("Exported voice-only mix to %s (%.2fs)", out_path, len(vo) / 1000.0)
                return out_path

            bgm_raw = AudioSegment.from_file(bgm_path).set_frame_rate(44100).set_channels(2)
            if len(bgm_raw) == 0:
                vo.export(out_path, format="wav")
                return out_path

            # Loop BGM to cover total duration + fade out last 1.2s
            loops = max(1, math.ceil(total_ms / len(bgm_raw)))
            bgm = (bgm_raw * loops)[:total_ms]

            base_gain_db = self._ratio_to_db(max(0.02, min(1.0, bgm_volume)))
            bgm = bgm.apply_gain(base_gain_db)

            # Frame-by-frame sidechain ducking in 150ms windows
            ducked_bgm = self._apply_ducking(vo, bgm, ducking_db=ducking_db, window_ms=150)
            if len(ducked_bgm) > 1200:
                ducked_bgm = ducked_bgm.fade_out(1200)

            mixed = ducked_bgm.overlay(vo)
            mixed = self._normalize_segment(mixed, target_dbfs=-14.0)
            mixed.export(out_path, format="wav")
            logger.info("Exported ducked VO+BGM mix to %s (%.2fs)", out_path, len(mixed) / 1000.0)
            return out_path
        except PipelineError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise PipelineError(
                "audio_mix",
                f"Failed to mix voiceover and BGM: {exc}",
                retryable=False,
                traceback_str=traceback.format_exc(),
            ) from exc

    @staticmethod
    def _ratio_to_db(ratio: float) -> float:
        """Convert linear volume ratio (0..1) into decibels."""
        return 20.0 * math.log10(max(0.001, ratio))

    @staticmethod
    def _normalize_segment(seg: AudioSegment, target_dbfs: float = -14.0) -> AudioSegment:
        """Apply safe peak-limited gain adjustment toward target dBFS."""
        if seg.dBFS == float("-inf"):
            return seg
        change = target_dbfs - seg.dBFS
        # Cap boost to prevent clipping noise floor
        change = max(-18.0, min(12.0, change))
        normalized = seg.apply_gain(change)
        if normalized.max_dBFS > -1.0:
            normalized = normalized.apply_gain(-1.0 - normalized.max_dBFS)
        return normalized

    @staticmethod
    def _apply_ducking(
        vo: AudioSegment,
        bgm: AudioSegment,
        ducking_db: float = 12.0,
        window_ms: int = 150,
    ) -> AudioSegment:
        """Reduce BGM gain over chunks where VO RMS exceeds silence threshold."""
        if ducking_db <= 0:
            return bgm

        chunks = []
        threshold_dbfs = -40.0
        for start in range(0, len(bgm), window_ms):
            end = min(len(bgm), start + window_ms)
            bgm_chunk = bgm[start:end]
            vo_chunk = vo[start:end]
            if vo_chunk.dBFS > threshold_dbfs:
                bgm_chunk = bgm_chunk.apply_gain(-ducking_db)
            chunks.append(bgm_chunk)

        out = AudioSegment.empty()
        for chunk in chunks:
            out += chunk
        return out

    @staticmethod
    def transcode_aac(wav_path: Path, out_m4a: Path, bitrate: str = "192k") -> Path:
        """Optional direct ffmpeg AAC encode helper for standalone audio verification."""
        out_m4a.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(wav_path),
            "-c:a",
            "aac",
            "-b:a",
            bitrate,
            "-ar",
            "44100",
            str(out_m4a),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        return out_m4a
