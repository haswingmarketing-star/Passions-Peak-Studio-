"""Unit tests for VideoAssembler using real local synthetic assets and ffmpeg."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from PIL import Image
from pydub import AudioSegment

from pipeline.models import CaptionStyle, Scene, WatermarkConfig
from pipeline.video_assembler import VideoAssembler


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg binary not installed")
def test_video_assembler_produces_valid_mp4(tmp_path: Path) -> None:
    frame_path = tmp_path / "frame_1.png"
    Image.new("RGB", (360, 640), color=(24, 34, 54)).save(frame_path)

    wav_path = tmp_path / "mix.wav"
    AudioSegment.silent(duration=1500, frame_rate=44100).export(wav_path, format="wav")

    scenes = [
        Scene(
            id=1,
            beat="hook",
            duration_seconds=1.5,
            speaker="Kena",
            narration="Don't walk out that door.",
            visual_direction="Adult woman in dimly lit hallway",
            camera="static",
            image_path=str(frame_path),
        )
    ]

    out_mp4 = tmp_path / "test_out.mp4"
    assembler = VideoAssembler()
    result = assembler.assemble(
        scenes=scenes,
        audio_mix_path=wav_path,
        out_mp4=out_mp4,
        resolution=(360, 640),
        fps=24,
        crf=28,
        cues=[(0.0, 1.5, "Don't walk out that door.")],
        caption_style=CaptionStyle(enabled=True, font_size=24),
        watermark_config=WatermarkConfig(enabled=True, label_text="PASSIONS PEAK"),
    )

    assert result.is_file()
    assert result.stat().st_size > 1000
