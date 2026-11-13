"""Centralized Pydantic settings and studio constants for the Python Creator Kit."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Tuple

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and `.env`."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    elevenlabs_api_key: str = Field(default="", alias="ELEVENLABS_API_KEY")
    elevenlabs_voice_id: str = Field(default="21m00Tcm4TlvDq8ikWAM", alias="ELEVENLABS_VOICE_ID")
    edge_tts_voice: str = Field(default="en-US-AriaNeural", alias="EDGE_TTS_VOICE")
    whisper_model: str = Field(default="base", alias="WHISPER_MODEL")
    output_dir: Path = Field(default=Path("output"), alias="OUTPUT_DIR")
    assets_dir: Path = Field(default=Path("assets"), alias="ASSETS_DIR")
    uploads_dir: Path = Field(default=Path("static/uploads"))
    projects_dir: Path = Field(default=Path("projects"))
    logs_dir: Path = Field(default=Path("logs"))
    default_resolution: str = Field(default="1080x1920", alias="DEFAULT_RESOLUTION")
    default_fps: int = Field(default=30, alias="DEFAULT_FPS")
    default_crf: int = Field(default=18, alias="DEFAULT_CRF")
    watermark_opacity: float = Field(default=0.3, alias="WATERMARK_OPACITY")
    max_batch_workers: int = Field(default=2, alias="MAX_BATCH_WORKERS")
    flask_port: int = Field(default=5000, alias="FLASK_PORT")

    script_model: str = "gemini-3.1-flash-lite"
    image_model: str = "gemini-3.1-flash-lite-image"
    video_codec: str = "libx264"
    video_preset: str = "slow"
    audio_codec: str = "aac"
    audio_bitrate: str = "192k"
    audio_sample_rate: int = 44100

    def parse_resolution(self, resolution_str: str | None = None) -> Tuple[int, int]:
        """Parse a `WIDTHxHEIGHT` string into an integer tuple."""
        raw = (resolution_str or self.default_resolution).lower().strip()
        parts = raw.split("x")
        if len(parts) != 2:
            return (1080, 1920)
        return (int(parts[0]), int(parts[1]))

    def ensure_directories(self) -> None:
        """Create required runtime directories relative to project root."""
        for folder in (
            self.output_dir,
            self.assets_dir,
            self.assets_dir / "watermarks",
            self.assets_dir / "bgm",
            self.assets_dir / "stock",
            self.uploads_dir,
            self.projects_dir,
            self.logs_dir,
        ):
            folder.mkdir(parents=True, exist_ok=True)


def configure_logging(logs_dir: Path) -> logging.Logger:
    """Configure root pipeline logging to file and console."""
    logs_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("vertical_pipeline")
    if logger.handlers:
        return logger
    logger.setLevel(logging.DEBUG)

    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    file_handler = logging.FileHandler(logs_dir / "pipeline.log", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)

    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(logging.INFO)
    stream_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)
    return logger


settings = Settings()
