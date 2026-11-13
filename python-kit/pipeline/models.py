"""Pydantic data models shared across the Python pipeline and RenderManifest v1."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import jsonschema
from pydantic import BaseModel, Field


class PipelineError(Exception):
    """Structured pipeline exception surfaced to the UI and logs."""

    def __init__(self, stage: str, message: str, retryable: bool = False, traceback_str: str = "") -> None:
        super().__init__(f"[{stage}] {message}")
        self.stage = stage
        self.message = message
        self.retryable = retryable
        self.traceback_str = traceback_str

    def to_dict(self) -> Dict[str, Any]:
        """Serialize error into JSON-friendly dictionary."""
        return {
            "stage": self.stage,
            "message": self.message,
            "retryable": self.retryable,
            "traceback": self.traceback_str,
        }


class MotionPrompt(BaseModel):
    """Structured image-to-video motion parameters for Omni 1.2 Flash."""

    primaryMotion: str = "Subtle character expression shift"
    cameraMovement: str = "Slow push-in (5%)"
    motionSpeed: str = "Contemplative and measured"
    secondaryMotion: str = "Ambient light flicker"
    startState: str = "Opening medium frame"
    endState: str = "Closer emotional hold"
    transitionHint: str = "Cut on eye movement"


class Scene(BaseModel):
    """Single beat/scene inside a micro-drama episode script."""

    id: int = Field(..., ge=1)
    beat: Literal[
        "setup",
        "tension",
        "twist",
        "climax",
        "cliffhanger",
        "hook",
        "orientation",
        "confrontation",
        "turn",
        "payoff",
    ] = "tension"
    duration_seconds: float = Field(default=5.0, gt=0)
    speaker: str = "Narrator"
    narration: str
    visual_direction: str
    camera: Literal["static", "slow_zoom", "pan", "cut", "dolly_in", "rack_focus", "tracking"] = "slow_zoom"
    transition_out: Literal["cut", "fade", "slide_left", "slide_up", "match_cut", "dissolve"] = "cut"
    cliffhanger_line: Optional[str] = None
    image_path: Optional[str] = None
    reference_overlay_path: Optional[str] = None
    audio_path: Optional[str] = None
    motion_prompt: MotionPrompt = Field(default_factory=MotionPrompt)


class Script(BaseModel):
    """Validated episode script returned by Gemini or loaded from manifest."""

    title: str
    duration_seconds: int = Field(..., ge=5)
    hook: str
    scenes: List[Scene] = Field(..., min_length=1)
    total_scenes: int = Field(default=1, ge=1)


class CaptionStyle(BaseModel):
    """Styling options for burned-in captions."""

    enabled: bool = True
    font_name: str = "Arial"
    font_size: int = 44
    position_y: int = 84
    outline_width: int = 3


class WatermarkConfig(BaseModel):
    """Configuration for alpha-blended PNG watermark."""

    enabled: bool = True
    path: Optional[str] = None
    label_text: str = "PASSIONS PEAK"
    position: Literal["top_left", "top_right", "bottom_left", "bottom_right"] = "top_right"
    opacity: float = 0.3
    width_pct: float = 20.0


class RenderJob(BaseModel):
    """Input configuration for a single pipeline execution."""

    job_id: str
    genre: str = "urban drama"
    tone: str = "tense"
    duration: int = 30
    characters: List[str] = Field(default_factory=lambda: ["Kena", "Roberto"])
    extra: str = ""
    output_profile: Literal["9x16", "16x9"] = "9x16"
    tts_engine: Literal["edge_tts", "elevenlabs"] = "edge_tts"
    edge_voice: str = "en-US-AriaNeural"
    elevenlabs_voice_id: str = "21m00Tcm4TlvDq8ikWAM"
    bgm_path: Optional[str] = None
    bgm_volume: float = 0.32
    ducking_db: float = 12.0
    watermark: WatermarkConfig = Field(default_factory=WatermarkConfig)
    caption_style: CaptionStyle = Field(default_factory=CaptionStyle)
    fps: int = 30
    crf: int = 18
    script: Optional[Script] = None


class RenderResult(BaseModel):
    """Outputs produced by a completed pipeline job."""

    job_id: str
    status: Literal["completed", "failed"]
    video_path: Optional[str] = None
    srt_path: Optional[str] = None
    audio_mix_path: Optional[str] = None
    voiceover_path: Optional[str] = None
    scene_images: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    error: Optional[Dict[str, Any]] = None


class RenderManifestV1(BaseModel):
    """Portable manifest exported by the browser studio and validated against manifest.schema.json."""

    schemaVersion: str
    projectId: str
    projectName: str
    episodeId: str
    title: str
    episodeCode: str
    bibleVersion: int
    outputProfile: Literal["9x16", "16x9"]
    resolution: Dict[str, int]
    fps: int
    crf: int
    colorGrade: str
    scenes: List[Dict[str, Any]]
    srtAssetId: Optional[str] = None
    srtContent: str = ""
    thumbnails: List[Dict[str, Any]] = Field(default_factory=list)
    watermarkConfig: Dict[str, Any] = Field(default_factory=dict)
    captionStyle: Dict[str, Any] = Field(default_factory=dict)
    bgmConfig: Dict[str, Any] = Field(default_factory=dict)
    createdAt: str

    @classmethod
    def load_and_validate(cls, manifest_path: Path, schema_path: Optional[Path] = None) -> "RenderManifestV1":
        """Load a Project Bundle manifest.json and validate it against JSON Schema if present."""
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        if schema_path and schema_path.is_file():
            schema = json.loads(schema_path.read_text(encoding="utf-8"))
            jsonschema.validate(instance=raw, schema=schema)
        return cls.model_validate(raw)
