"""TTS synthesis engine supporting Edge-TTS (free default) and ElevenLabs (optional paid)."""

from __future__ import annotations

import asyncio
import logging
import tempfile
import time
import traceback
from pathlib import Path
from typing import List, Optional, Tuple

import edge_tts
from pydub import AudioSegment

from config import settings
from pipeline.models import PipelineError, Scene

logger = logging.getLogger("vertical_pipeline.tts")

TOP_EDGE_VOICES: List[str] = [
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "en-US-JennyNeural",
    "en-US-ChristopherNeural",
    "en-US-MichelleNeural",
    "en-US-EricNeural",
    "en-US-AvaNeural",
    "en-US-AndrewNeural",
    "en-US-BrianNeural",
    "en-US-SteffanNeural",
    "en-US-EmmaNeural",
    "en-US-RogerNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
    "en-GB-LibbyNeural",
    "en-CA-ClaraNeural",
    "en-CA-LiamNeural",
    "en-AU-NatashaNeural",
    "en-AU-WilliamNeural",
    "en-IE-EmilyNeural",
]


class TTSEngine:
    """Synthesizes scene voiceovers and combines them into a 24 kHz mono WAV track."""

    def __init__(self, elevenlabs_api_key: str | None = None) -> None:
        self.elevenlabs_api_key = (
            elevenlabs_api_key if elevenlabs_api_key is not None else settings.elevenlabs_api_key
        )

    def synthesize_scenes(
        self,
        scenes: List[Scene],
        out_wav: Path,
        engine: str = "edge_tts",
        edge_voice: str = "en-US-AriaNeural",
        elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM",
        rate: str = "+0%",
    ) -> Tuple[Path, List[str]]:
        """Synthesize each scene narration and concatenate with 0.3s gaps."""
        out_wav.parent.mkdir(parents=True, exist_ok=True)
        warnings: List[str] = []
        combined = AudioSegment.empty()
        gap = AudioSegment.silent(duration=300, frame_rate=24000)

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            for idx, scene in enumerate(scenes):
                clip_path = tmp_dir / f"clip_{idx}.wav"
                use_eleven = engine == "elevenlabs"

                if use_eleven:
                    try:
                        self._synth_elevenlabs(scene.narration, elevenlabs_voice_id, clip_path)
                    except Exception as exc:  # noqa: BLE001
                        msg = f"ElevenLabs failed ({exc}); falling back to Edge-TTS for scene {scene.id}."
                        logger.warning(msg)
                        if msg not in warnings:
                            warnings.append(msg)
                        self._synth_edge_with_retry(scene.narration, edge_voice, rate, clip_path)
                else:
                    self._synth_edge_with_retry(scene.narration, edge_voice, rate, clip_path)

                seg = AudioSegment.from_file(clip_path).set_frame_rate(24000).set_channels(1)
                combined += seg
                if idx < len(scenes) - 1:
                    combined += gap

        combined.export(out_wav, format="wav")
        logger.info("Voiceover written to %s (%.2fs)", out_wav, len(combined) / 1000.0)
        return out_wav, warnings

    def _synth_elevenlabs(self, text: str, voice_id: str, out_path: Path) -> None:
        """Synthesize speech using ElevenLabs SDK with 2x retry."""
        if not self.elevenlabs_api_key:
            raise RuntimeError("ELEVENLABS_API_KEY missing")

        from elevenlabs.client import ElevenLabs

        client = ElevenLabs(api_key=self.elevenlabs_api_key)
        delays = [1, 3]
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                audio_iter = client.text_to_speech.convert(
                    text=text,
                    voice_id=voice_id,
                    model_id="eleven_multilingual_v2",
                )
                mp3_path = out_path.with_suffix(".mp3")
                with open(mp3_path, "wb") as fh:
                    for chunk in audio_iter:
                        if chunk:
                            fh.write(chunk)
                AudioSegment.from_file(mp3_path).set_frame_rate(24000).set_channels(1).export(
                    out_path, format="wav"
                )
                return
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                status = getattr(exc, "status_code", None)
                if status in (401, 403):
                    raise RuntimeError(f"ElevenLabs unauthorized ({status})") from exc
                if attempt < 2:
                    time.sleep(delays[attempt])
        raise RuntimeError(f"ElevenLabs synthesis failed: {last_exc}")

    def _synth_edge_with_retry(self, text: str, voice: str, rate: str, out_path: Path) -> None:
        """Run Edge-TTS async communicator with 1x retry."""
        for attempt in range(2):
            try:
                mp3_path = out_path.with_suffix(".mp3")
                asyncio.run(self._async_edge(text, voice, rate, mp3_path))
                AudioSegment.from_file(mp3_path).set_frame_rate(24000).set_channels(1).export(
                    out_path, format="wav"
                )
                return
            except Exception as exc:  # noqa: BLE001
                logger.warning("Edge-TTS failed (attempt %d): %s", attempt + 1, exc)
                if attempt == 1:
                    raise PipelineError(
                        "tts",
                        f"Edge-TTS failed after retry: {exc}",
                        retryable=True,
                        traceback_str=traceback.format_exc(),
                    ) from exc

    @staticmethod
    async def _async_edge(text: str, voice: str, rate: str, out_mp3: Path) -> None:
        """Async Edge-TTS helper."""
        communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, volume="+0%")
        await communicate.save(str(out_mp3))
