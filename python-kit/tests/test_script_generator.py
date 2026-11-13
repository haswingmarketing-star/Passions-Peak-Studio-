"""Unit tests for ScriptGenerator (mocked Gemini client, zero network calls)."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from pipeline.models import PipelineError
from pipeline.script_generator import ScriptGenerator


def _valid_payload() -> dict:
    return {
        "title": "Midnight Alibi",
        "duration_seconds": 30,
        "hook": "He swore he never crossed town—then the receipt printed.",
        "scenes": [
            {
                "id": 1,
                "beat": "hook",
                "duration_seconds": 6,
                "speaker": "Kena",
                "narration": "You told me your phone died at ten.",
                "visual_direction": "Close-up adult woman in moody Chicago kitchen holding lit phone",
                "camera": "slow_zoom",
                "transition_out": "cut",
                "cliffhanger_line": None,
            },
            {
                "id": 2,
                "beat": "cliffhanger",
                "duration_seconds": 6,
                "speaker": "Roberto",
                "narration": "Check the timestamp on that receipt again.",
                "visual_direction": "Adult man standing in doorway rain shadows, tight vertical framing",
                "camera": "cut",
                "transition_out": "fade",
                "cliffhanger_line": "That wasn't my signature.",
            },
        ],
        "total_scenes": 2,
    }


def test_script_generator_parses_valid_json() -> None:
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(text=json.dumps(_valid_payload()))

    with patch("pipeline.script_generator.genai.Client", return_value=mock_client):
        gen = ScriptGenerator(api_key="dummy-test-key")
        script = gen.generate(genre="urban drama", tone="tense", duration=30, characters=["Kena", "Roberto"])

    assert script.title == "Midnight Alibi"
    assert len(script.scenes) == 2
    assert script.scenes[1].cliffhanger_line == "That wasn't my signature."


def test_script_generator_repairs_malformed_json_once() -> None:
    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = [
        SimpleNamespace(text="{not valid json"),
        SimpleNamespace(text=f"```json\n{json.dumps(_valid_payload())}\n```"),
    ]

    with patch("pipeline.script_generator.genai.Client", return_value=mock_client):
        gen = ScriptGenerator(api_key="dummy-test-key")
        script = gen.generate(genre="drama", tone="dark", duration=30, characters=["Kena"])

    assert script.total_scenes == 2
    assert mock_client.models.generate_content.call_count == 2


def test_script_generator_raises_without_api_key() -> None:
    gen = ScriptGenerator(api_key="")
    with pytest.raises(PipelineError) as exc_info:
        gen.generate(genre="drama", tone="tense", duration=30, characters=["Kena"])
    assert exc_info.value.stage == "script"
