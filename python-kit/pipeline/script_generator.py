"""Script generator calling Gemini 3.1 Flash Lite with JSON repair retry."""

from __future__ import annotations

import json
import logging
import time
import traceback
from typing import List

from google import genai
from google.genai import types
from pydantic import ValidationError

from config import settings
from pipeline.models import PipelineError, Script

logger = logging.getLogger("vertical_pipeline.script")

SYSTEM_PROMPT = """You are a micro-drama screenwriter for vertical short-form video (TikTok, Reels, Shorts).
Given the user's genre, tone, target duration, and character count, produce a JSON script:

{
  "title": str,
  "duration_seconds": int,
  "hook": str,
  "scenes": [
    {
      "id": int,
      "beat": "setup" | "tension" | "twist" | "climax" | "cliffhanger",
      "duration_seconds": int,
      "speaker": str,
      "narration": str,
      "visual_direction": str,
      "camera": "static" | "slow_zoom" | "pan" | "cut",
      "transition_out": "cut" | "fade" | "slide_left" | "slide_up",
      "cliffhanger_line": str | null
    }
  ],
  "total_scenes": int
}

Rules:
- Total duration must match target (+/- 2 s).
- Hook must be a question, contradiction, or bold claim.
- Cliffhanger must cut mid-sentence or reveal a twist.
- Narration per scene <= 15 words (fits 3-5 s at natural pace).
- visual_direction must be a concrete image prompt (adult subject, setting, lighting, mood, aspect 9:16).
"""


class ScriptGenerator:
    """Generates structured micro-drama scripts via Gemini."""

    def __init__(self, api_key: str | None = None, model_name: str | None = None) -> None:
        self.api_key = api_key if api_key is not None else settings.gemini_api_key
        self.model_name = model_name or settings.script_model

    def generate(
        self,
        genre: str,
        tone: str,
        duration: int,
        characters: List[str],
        extra: str = "",
    ) -> Script:
        """Generate and validate a micro-drama Script object."""
        if not self.api_key:
            raise PipelineError("script", "GEMINI_API_KEY is missing in .env", retryable=False)

        client = genai.Client(api_key=self.api_key)
        char_str = ", ".join(characters) if characters else "2 leads"
        user_prompt = (
            f"Genre: {genre}. Tone: {tone}. Duration: {duration}s. "
            f"Characters: {char_str}. Extra: {extra}"
        )

        raw_text = self._call_with_retry(client, user_prompt)
        try:
            return self._parse_script(raw_text)
        except (json.JSONDecodeError, ValidationError) as err:
            logger.warning("Malformed script JSON from Gemini; retrying with repair prompt: %s", err)
            repair_prompt = (
                f"Fix your JSON to match the required schema. Error: {err}\n\nPrevious output:\n{raw_text}"
            )
            repaired_text = self._call_with_retry(client, repair_prompt)
            try:
                return self._parse_script(repaired_text)
            except (json.JSONDecodeError, ValidationError) as second_err:
                raise PipelineError(
                    "script",
                    f"Failed to parse valid script JSON after retry: {second_err}",
                    retryable=True,
                    traceback_str=traceback.format_exc(),
                ) from second_err

    def _call_with_retry(self, client: genai.Client, prompt: str) -> str:
        """Call Gemini with 2 retries and exponential backoff (1s, 3s)."""
        delays = [1, 3]
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                logger.info("Requesting script from %s (attempt %d)", self.model_name, attempt + 1)
                response = client.models.generate_content(
                    model=self.model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        response_mime_type="application/json",
                    ),
                )
                return (response.text or "").strip()
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                logger.warning("Gemini script call failed (attempt %d): %s", attempt + 1, exc)
                if attempt < 2:
                    time.sleep(delays[attempt])

        raise PipelineError(
            "script",
            f"Gemini script generation failed: {last_exc}",
            retryable=True,
            traceback_str=traceback.format_exc(),
        )

    @staticmethod
    def _parse_script(raw_text: str) -> Script:
        """Strip markdown fences if any and validate against Pydantic Script."""
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        data = json.loads(cleaned.strip())
        if "total_scenes" not in data and isinstance(data.get("scenes"), list):
            data["total_scenes"] = len(data["scenes"])
        return Script.model_validate(data)
