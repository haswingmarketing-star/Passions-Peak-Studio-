"""Unit tests for TTSEngine supporting Edge-TTS and ElevenLabs fallback (zero network calls)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from pydub import AudioSegment

from pipeline.models import Scene
from pipeline.tts_engine import TTSEngine


def _write_silence_wav(path: Path) -> None:
    AudioSegment.silent(duration=400, frame_rate=24000).export(path, format="wav")


def test_tts_engine_elevenlabs_falls_back_cleanly_to_edge_tts(tmp_path: Path) -> None:
    scenes = [
        Scene(
            id=1,
            beat="hook",
            duration_seconds=5,
            speaker="Kena",
            narration="Tell me the truth before she wakes up.",
            visual_direction="Moody apartment corridor, adult woman",
        )
    ]
    out_wav = tmp_path / "vo.wav"
    engine = TTSEngine(elevenlabs_api_key="")

    with patch.object(engine, "_synth_edge_with_retry", side_effect=lambda _t, _v, _r, p: _write_silence_wav(p)):
        result_path, warnings = engine.synthesize_scenes(
            scenes=scenes,
            out_wav=out_wav,
            engine="elevenlabs",
            edge_voice="en-US-AriaNeural",
            elevenlabs_voice_id="21m00Tcm4TlvDq8ikWAM",
        )

    assert result_path.is_file()
    assert len(warnings) == 1
    assert "falling back to Edge-TTS" in warnings[0]
