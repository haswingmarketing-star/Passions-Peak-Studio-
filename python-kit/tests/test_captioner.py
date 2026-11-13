"""Unit tests for Captioner SRT formatting and mocked Whisper transcription."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from pydub import AudioSegment

from pipeline.captioner import Captioner, format_srt_timestamp


def test_format_srt_timestamp() -> None:
    assert format_srt_timestamp(0.0) == "00:00:00,000"
    assert format_srt_timestamp(65.432) == "00:01:05,432"


def test_captioner_transcribe_to_srt(tmp_path: Path) -> None:
    wav_path = tmp_path / "voice.wav"
    AudioSegment.silent(duration=1500, frame_rate=24000).export(wav_path, format="wav")
    srt_path = tmp_path / "out.srt"

    mock_model = MagicMock()
    mock_model.transcribe.return_value = {
        "segments": [
            {"start": 0.0, "end": 1.2, "text": "Who gave you that key?"},
            {"start": 1.3, "end": 2.4, "text": "You already know."},
        ]
    }

    cap = Captioner(model_name="base")
    with patch.object(cap, "_get_model", return_value=mock_model):
        out, cues = cap.transcribe_to_srt(wav_path, srt_path)

    assert out.is_file()
    assert len(cues) == 2
    content = out.read_text(encoding="utf-8")
    assert "00:00:00,000 --> 00:00:01,200" in content
    assert "Who gave you that key?" in content
