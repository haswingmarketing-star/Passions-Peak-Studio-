"""End-to-end mocked orchestrator test verifying script -> images -> TTS -> captions -> mix -> MP4."""

from __future__ import annotations

import shutil
from pathlib import Path
from unittest.mock import patch

import pytest
from pydub import AudioSegment

from pipeline.models import RenderJob, Scene, Script
from pipeline.orchestrator import PipelineOrchestrator


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg binary not installed")
def test_pipeline_orchestrator_end_to_end(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from config import settings

    monkeypatch.setattr(settings, "output_dir", tmp_path / "output")
    script = Script(
        title="Chicago Rain",
        duration_seconds=5,
        hook="Why is her bag still packed?",
        scenes=[
            Scene(
                id=1,
                beat="hook",
                duration_seconds=2.5,
                speaker="Kena",
                narration="Why is your bag still packed?",
                visual_direction="Adult woman near doorway, rain light",
                camera="static",
            ),
            Scene(
                id=2,
                beat="cliffhanger",
                duration_seconds=2.5,
                speaker="Roberto",
                narration="Because I wasn't staying for breakfast.",
                visual_direction="Adult man reaching for keys",
                camera="static",
                cliffhanger_line="Wait until tomorrow.",
            ),
        ],
        total_scenes=2,
    )

    orch = PipelineOrchestrator()
    # Force Pillow placeholder frames (empty key) + local synthetic VO + fallback SRT
    orch.image_gen.api_key = ""

    def _fake_tts(scenes, out_wav, **_kwargs):
        AudioSegment.silent(duration=5000, frame_rate=24000).export(out_wav, format="wav")
        return out_wav, []

    with patch.object(orch.tts_engine, "synthesize_scenes", side_effect=_fake_tts):
        with patch.object(orch.captioner, "transcribe_to_srt", side_effect=RuntimeError("mock skip whisper")):
            res = orch.run(
                RenderJob(
                    job_id="e2e_test",
                    output_profile="9x16",
                    fps=24,
                    crf=28,
                    script=script,
                ),
                preview_seconds=2.0,
            )

    assert res.status == "completed"
    assert res.video_path and Path(res.video_path).is_file()
    assert res.srt_path and Path(res.srt_path).is_file()
    assert len(res.scene_images) == 2
