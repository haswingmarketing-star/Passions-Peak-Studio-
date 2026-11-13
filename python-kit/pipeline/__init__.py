"""Vertical Video Assembly Pipeline package for the Passions Peak Creator Kit."""

from pipeline.audio_mixer import AudioMixer
from pipeline.batch_processor import BatchProcessor
from pipeline.captioner import Captioner
from pipeline.image_generator import ImageGenerator
from pipeline.models import (
    CaptionStyle,
    MotionPrompt,
    PipelineError,
    RenderJob,
    RenderManifestV1,
    RenderResult,
    Scene,
    Script,
    WatermarkConfig,
)
from pipeline.orchestrator import PipelineOrchestrator
from pipeline.script_generator import ScriptGenerator
from pipeline.tts_engine import TOP_EDGE_VOICES, TTSEngine
from pipeline.video_assembler import VideoAssembler
from pipeline.watermark import WatermarkHelper

__all__ = [
    "AudioMixer",
    "BatchProcessor",
    "CaptionStyle",
    "Captioner",
    "ImageGenerator",
    "MotionPrompt",
    "PipelineError",
    "PipelineOrchestrator",
    "RenderJob",
    "RenderManifestV1",
    "RenderResult",
    "Scene",
    "Script",
    "ScriptGenerator",
    "TOP_EDGE_VOICES",
    "TTSEngine",
    "VideoAssembler",
    "WatermarkConfig",
    "WatermarkHelper",
]
