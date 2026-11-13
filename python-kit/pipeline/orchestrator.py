"""End-to-end pipeline orchestrator tying together script, images, TTS, captions, mix, and assembly."""

from __future__ import annotations

import atexit
import logging
import shutil
import traceback
from pathlib import Path
from typing import Callable, List, Optional

from config import settings
from pipeline.audio_mixer import AudioMixer
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
from pipeline.script_generator import ScriptGenerator
from pipeline.tts_engine import TTSEngine
from pipeline.video_assembler import VideoAssembler

logger = logging.getLogger("vertical_pipeline.orchestrator")

_TEMP_PATHS: List[Path] = []


def _cleanup_temp_paths() -> None:
    """Clean up registered scratch directories on interpreter exit."""
    for p in _TEMP_PATHS:
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)


atexit.register(_cleanup_temp_paths)


class PipelineOrchestrator:
    """Executes either prompt-driven RenderJob pipelines or portable RenderManifestV1 bundles."""

    def __init__(self) -> None:
        self.script_gen = ScriptGenerator()
        self.image_gen = ImageGenerator()
        self.tts_engine = TTSEngine()
        self.captioner = Captioner()
        self.audio_mixer = AudioMixer()
        self.video_assembler = VideoAssembler()

    def run(
        self,
        job: RenderJob,
        preview_seconds: Optional[float] = None,
        on_progress: Optional[Callable[[int, str], None]] = None,
        reference_paths: Optional[List[Path]] = None,
    ) -> RenderResult:
        """Run full pipeline for a single RenderJob and return RenderResult."""
        settings.ensure_directories()
        job_dir = settings.output_dir / job.job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        warnings: List[str] = []

        def emit(pct: int, msg: str) -> None:
            logger.info("[%s] %d%% %s", job.job_id, pct, msg)
            if on_progress:
                on_progress(pct, msg)

        try:
            emit(5, "Preparing episode script...")
            script: Script
            if job.script is not None:
                script = job.script
            else:
                script = self.script_gen.generate(
                    genre=job.genre,
                    tone=job.tone,
                    duration=job.duration,
                    characters=job.characters,
                    extra=job.extra,
                )

            resolution = (1920, 1080) if job.output_profile == "16x9" else (1080, 1920)

            emit(18, "Generating or verifying scene visual frames...")
            missing_visuals = [s for s in script.scenes if not s.image_path or not Path(s.image_path).is_file()]
            if missing_visuals:
                generated_imgs = self.image_gen.generate_scene_images(
                    scenes=missing_visuals,
                    out_dir=job_dir / "frames",
                    resolution=resolution,
                    reference_paths=reference_paths,
                )
                for s, img_path in zip(missing_visuals, generated_imgs):
                    s.image_path = str(img_path)

            emit(30, f"Synthesizing voiceover ({job.tts_engine})...")
            vo_wav = job_dir / "voiceover.wav"
            _, tts_warnings = self.tts_engine.synthesize_scenes(
                scenes=script.scenes,
                out_wav=vo_wav,
                engine=job.tts_engine,
                edge_voice=job.edge_voice,
                elevenlabs_voice_id=job.elevenlabs_voice_id,
            )
            warnings.extend(tts_warnings)

            emit(40, "Transcribing voiceover into SRT captions...")
            srt_path = job_dir / "captions.srt"
            cues = []
            try:
                _, cues = self.captioner.transcribe_to_srt(vo_wav, srt_path)
            except Exception as cap_exc:  # noqa: BLE001
                warn_msg = f"Whisper unavailable ({cap_exc}); synthesizing timed SRT from script lines."
                warnings.append(warn_msg)
                cues = self._fallback_script_srt(script.scenes, srt_path)

            emit(48, "Mixing voiceover and BGM with ducking...")
            mix_wav = job_dir / "audio_mix.wav"
            bgm_file = Path(job.bgm_path) if job.bgm_path else None
            self.audio_mixer.mix(
                voice_wav=vo_wav,
                out_path=mix_wav,
                bgm_path=bgm_file,
                bgm_volume=job.bgm_volume,
                ducking_db=job.ducking_db,
            )

            out_mp4 = job_dir / ("preview_3s.mp4" if preview_seconds else f"{job.job_id}_{job.output_profile}.mp4")
            self.video_assembler.assemble(
                scenes=script.scenes,
                audio_mix_path=mix_wav,
                out_mp4=out_mp4,
                resolution=resolution,
                fps=job.fps,
                crf=job.crf,
                cues=cues,
                caption_style=job.caption_style,
                watermark_config=job.watermark,
                preview_seconds=preview_seconds,
                on_progress=emit,
            )

            return RenderResult(
                job_id=job.job_id,
                status="completed",
                video_path=str(out_mp4),
                srt_path=str(srt_path),
                audio_mix_path=str(mix_wav),
                voiceover_path=str(vo_wav),
                scene_images=[s.image_path for s in script.scenes if s.image_path],
                warnings=warnings,
            )
        except PipelineError as p_err:
            logger.error("Pipeline error in %s: %s", job.job_id, p_err.message)
            return RenderResult(job_id=job.job_id, status="failed", error=p_err.to_dict(), warnings=warnings)
        except Exception as exc:  # noqa: BLE001
            tb = traceback.format_exc()
            logger.error("Unexpected orchestrator failure: %s\n%s", exc, tb)
            return RenderResult(
                job_id=job.job_id,
                status="failed",
                error={"stage": "orchestrator", "message": str(exc), "traceback": tb},
                warnings=warnings,
            )

    def run_from_manifest_path(
        self,
        manifest_path: Path,
        schema_path: Optional[Path] = None,
        on_progress: Optional[Callable[[int, str], None]] = None,
    ) -> RenderResult:
        """Consume an exported Passions Peak Project Bundle (`manifest.json` + `assets/`) and render MP4."""
        manifest = RenderManifestV1.load_and_validate(manifest_path, schema_path=schema_path)
        bundle_assets_dir = manifest_path.parent / "assets"
        job_id = f"{manifest.episodeCode.lower().replace(' ', '_')}_{manifest.outputProfile}"
        job_dir = settings.output_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        scenes: List[Scene] = []
        for idx, raw_s in enumerate(manifest.scenes, start=1):
            frame_id = raw_s.get("frameAssetId")
            audio_id = raw_s.get("audioAssetId")
            overlay_id = raw_s.get("overlayAssetId")
            frame_path = str(bundle_assets_dir / frame_id) if frame_id and (bundle_assets_dir / frame_id).is_file() else None
            audio_path = str(bundle_assets_dir / audio_id) if audio_id and (bundle_assets_dir / audio_id).is_file() else None
            overlay_path = str(bundle_assets_dir / overlay_id) if overlay_id and (bundle_assets_dir / overlay_id).is_file() else None

            scenes.append(
                Scene(
                    id=int(raw_s.get("id", idx)),
                    beat=raw_s.get("beat", "tension"),
                    duration_seconds=max(1.0, float(raw_s.get("durationMs", 5000)) / 1000.0),
                    speaker=str(raw_s.get("speaker", "Narrator")),
                    narration=str(raw_s.get("narration", "")),
                    visual_direction=str(raw_s.get("captionText", "")),
                    transition_out=raw_s.get("transitionOut", "cut"),
                    image_path=frame_path,
                    audio_path=audio_path,
                    reference_overlay_path=overlay_path,
                    motion_prompt=MotionPrompt.model_validate(raw_s.get("motionPrompt") or {}),
                )
            )

        wm_raw = manifest.watermarkConfig or {}
        wm_asset = wm_raw.get("assetId")
        wm_path = str(bundle_assets_dir / wm_asset) if wm_asset and (bundle_assets_dir / wm_asset).is_file() else None
        watermark = WatermarkConfig(
            enabled=bool(wm_raw.get("enabled", True)),
            path=wm_path,
            label_text=str(wm_raw.get("labelText", manifest.projectName)),
            position=wm_raw.get("position", "top_right"),
            opacity=float(wm_raw.get("opacity", 0.3)),
            width_pct=float(wm_raw.get("widthPct", 20.0)),
        )

        cap_raw = manifest.captionStyle or {}
        caption_style = CaptionStyle(
            enabled=bool(cap_raw.get("enabled", True)),
            font_size=int(cap_raw.get("fontSize", 44)),
            position_y=int(cap_raw.get("positionY", 84)),
            outline_width=int(cap_raw.get("outlineWidth", 3)),
        )

        bgm_raw = manifest.bgmConfig or {}
        bgm_asset = bgm_raw.get("masterBgmAssetId")
        bgm_path = str(bundle_assets_dir / bgm_asset) if bgm_asset and (bundle_assets_dir / bgm_asset).is_file() else None

        total_dur = max(5, int(round(sum(s.duration_seconds for s in scenes))))
        script = Script(
            title=manifest.title,
            duration_seconds=total_dur,
            hook=scenes[0].narration if scenes else manifest.title,
            scenes=scenes,
            total_scenes=len(scenes),
        )

        job = RenderJob(
            job_id=job_id,
            output_profile=manifest.outputProfile,
            bgm_path=bgm_path,
            bgm_volume=float(bgm_raw.get("volume", 0.32)),
            ducking_db=float(bgm_raw.get("duckingDb", 12.0)),
            watermark=watermark,
            caption_style=caption_style,
            fps=manifest.fps,
            crf=manifest.crf,
            script=script,
        )
        return self.run(job, on_progress=on_progress)

    @staticmethod
    def _fallback_script_srt(scenes: List[Scene], out_srt: Path) -> List[tuple[float, float, str]]:
        """Generate clean SRT timings directly from scene durations if Whisper fails."""
        from pipeline.captioner import format_srt_timestamp

        cursor = 0.0
        blocks: List[str] = []
        cues: List[tuple[float, float, str]] = []
        for idx, scene in enumerate(scenes, start=1):
            start = cursor
            end = cursor + scene.duration_seconds
            cursor = end
            cues.append((start, end, scene.narration))
            blocks.append(
                f"{idx}\n{format_srt_timestamp(start)} --> {format_srt_timestamp(end)}\n{scene.narration}"
            )
        out_srt.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
        return cues
