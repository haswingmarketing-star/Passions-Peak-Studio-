"""Vertical/widescreen video assembly using MoviePy + direct ffmpeg filter-graph."""

from __future__ import annotations

import logging
import subprocess
import tempfile
import traceback
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from config import settings
from pipeline.models import CaptionStyle, PipelineError, Scene, WatermarkConfig
from pipeline.watermark import WatermarkHelper

logger = logging.getLogger("vertical_pipeline.assembler")

ProgressCallback = Callable[[int, str], None]


class VideoAssembler:
    """Composes final H.264/AAC MP4 masters from scenes, images, audio, captions, and overlays."""

    def __init__(self) -> None:
        self.watermark_helper = WatermarkHelper()

    def assemble(
        self,
        scenes: List[Scene],
        audio_mix_path: Optional[Path],
        out_mp4: Path,
        resolution: Tuple[int, int] = (1080, 1920),
        fps: int = 30,
        crf: int = 18,
        cues: Optional[List[Tuple[float, float, str]]] = None,
        caption_style: Optional[CaptionStyle] = None,
        watermark_config: Optional[WatermarkConfig] = None,
        preview_seconds: Optional[float] = None,
        on_progress: Optional[ProgressCallback] = None,
    ) -> Path:
        """Assemble full or 3-second preview MP4 with Ken Burns zoom, overlays, captions, and transitions."""
        if not scenes:
            raise PipelineError("assemble", "Cannot assemble video with zero scenes.")

        out_mp4.parent.mkdir(parents=True, exist_ok=True)
        caption_style = caption_style or CaptionStyle()
        watermark_config = watermark_config or WatermarkConfig()

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            wm_path = self.watermark_helper.prepare_watermark(
                watermark_config,
                resolution,
                tmp_dir / "watermark.png",
            )

            scene_clips: List[Path] = []
            elapsed = 0.0
            active_scenes = list(scenes)

            for idx, scene in enumerate(active_scenes):
                if preview_seconds is not None and elapsed >= preview_seconds:
                    break

                dur = float(scene.duration_seconds)
                if preview_seconds is not None:
                    dur = min(dur, max(0.5, preview_seconds - elapsed))

                if on_progress:
                    pct = 45 + int(((idx + 1) / max(1, len(active_scenes))) * 38)
                    on_progress(pct, f"Rendering Scene {scene.id}/{len(active_scenes)}...")

                clip_out = tmp_dir / f"scene_{idx:03d}.mp4"
                self._render_single_scene_clip(
                    scene=scene,
                    duration_sec=dur,
                    scene_start_sec=elapsed,
                    resolution=resolution,
                    fps=fps,
                    crf=crf,
                    out_clip=clip_out,
                    tmp_dir=tmp_dir,
                    cues=cues or [],
                    caption_style=caption_style,
                    wm_path=wm_path,
                    wm_position=watermark_config.position,
                )
                scene_clips.append(clip_out)
                elapsed += dur

            if on_progress:
                on_progress(86, "Stitching transitions & muxing master audio...")

            concat_video = tmp_dir / "concat_video.mp4"
            self._concat_clips_with_transitions(
                scene_clips=scene_clips,
                scenes=active_scenes[: len(scene_clips)],
                out_video=concat_video,
                crf=crf,
            )

            self._mux_audio(
                video_path=concat_video,
                audio_path=audio_mix_path,
                out_mp4=out_mp4,
                duration_limit=preview_seconds,
            )

            if on_progress:
                on_progress(100, f"MP4 ready: {out_mp4.name}")
            logger.info("Assembled final video at %s", out_mp4)
            return out_mp4

    def _render_single_scene_clip(
        self,
        scene: Scene,
        duration_sec: float,
        scene_start_sec: float,
        resolution: Tuple[int, int],
        fps: int,
        crf: int,
        out_clip: Path,
        tmp_dir: Path,
        cues: List[Tuple[float, float, str]],
        caption_style: CaptionStyle,
        wm_path: Optional[Path],
        wm_position: str,
    ) -> None:
        """Render a single still or video scene asset with Ken Burns, optional overlay, captions, and watermark."""
        w, h = resolution
        src_path = Path(scene.image_path) if scene.image_path else None
        if not src_path or not src_path.is_file():
            src_path = tmp_dir / f"fallback_{scene.id}.png"
            self._write_fallback_frame(src_path, resolution, f"SCENE {scene.id} · {scene.beat.upper()}")

        # Render burned-in caption PNG overlay via Pillow so we never depend on system libfreetype drawtext quirks
        caption_png: Optional[Path] = None
        if caption_style.enabled:
            cue_text = self._resolve_cue_for_window(
                cues=cues,
                start=scene_start_sec,
                end=scene_start_sec + duration_sec,
                fallback_text=scene.narration,
            )
            if cue_text:
                caption_png = tmp_dir / f"caption_{scene.id}.png"
                self._render_caption_png(
                    text=cue_text,
                    frame_size=resolution,
                    style=caption_style,
                    out_path=caption_png,
                )

        is_video_bg = src_path.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv"}
        inputs: List[str] = ["-y"]
        if is_video_bg:
            inputs.extend(["-stream_loop", "-1", "-t", f"{duration_sec:.3f}", "-i", str(src_path)])
        else:
            inputs.extend(["-loop", "1", "-t", f"{duration_sec:.3f}", "-i", str(src_path)])

        ref_idx: Optional[int] = None
        cap_idx: Optional[int] = None
        wm_idx: Optional[int] = None
        next_idx = 1

        if scene.reference_overlay_path and Path(scene.reference_overlay_path).is_file():
            inputs.extend(["-loop", "1", "-t", f"{duration_sec:.3f}", "-i", scene.reference_overlay_path])
            ref_idx = next_idx
            next_idx += 1

        if caption_png and caption_png.is_file():
            inputs.extend(["-loop", "1", "-t", f"{duration_sec:.3f}", "-i", str(caption_png)])
            cap_idx = next_idx
            next_idx += 1

        if wm_path and wm_path.is_file():
            inputs.extend(["-loop", "1", "-t", f"{duration_sec:.3f}", "-i", str(wm_path)])
            wm_idx = next_idx
            next_idx += 1

        # Build deterministic ffmpeg filter graph
        frames_count = max(15, int(round(duration_sec * fps)))
        filter_parts: List[str] = []

        if not is_video_bg and scene.camera in ("slow_zoom", "dolly_in"):
            filter_parts.append(
                f"[0:v]scale={int(w * 1.15)}:{int(h * 1.15)}:force_original_aspect_ratio=increase,"
                f"crop={int(w * 1.15)}:{int(h * 1.15)},"
                f"zoompan=z='min(zoom+0.0008,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames_count}:s={w}x{h}:fps={fps}[base]"
            )
        elif not is_video_bg and scene.camera == "pan":
            filter_parts.append(
                f"[0:v]scale={int(w * 1.18)}:{h}:force_original_aspect_ratio=increase,"
                f"crop={w}:{h}:x='(iw-{w})*t/{max(0.5, duration_sec)}':y=0,fps={fps}[base]"
            )
        else:
            filter_parts.append(
                f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps={fps}[base]"
            )

        current_label = "base"

        if ref_idx is not None:
            ov_w = int(w * 0.36)
            ov_x = w - ov_w - 36
            ov_y = 110
            filter_parts.append(
                f"[{ref_idx}:v]scale={ov_w}:-1,format=rgba,colorchannelmixer=aa=0.88[refov]"
            )
            filter_parts.append(
                f"[{current_label}][refov]overlay={ov_x}:{ov_y}:shortest=1[withref]"
            )
            current_label = "withref"

        if cap_idx is not None:
            filter_parts.append(f"[{current_label}][{cap_idx}:v]overlay=0:0:shortest=1[withcap]")
            current_label = "withcap"

        if wm_idx is not None:
            with Image.open(wm_path) as wm_img:
                wx, wy = self.watermark_helper.compute_position(wm_position, (w, h), wm_img.size)
            filter_parts.append(f"[{current_label}][{wm_idx}:v]overlay={wx}:{wy}:shortest=1[withwm]")
            current_label = "withwm"

        filter_parts.append(f"[{current_label}]format=yuv420p[vout]")
        filter_complex = ";".join(filter_parts)

        cmd = [
            "ffmpeg",
            *inputs,
            "-filter_complex",
            filter_complex,
            "-map",
            "[vout]",
            "-c:v",
            settings.video_codec,
            "-preset",
            "fast",
            "-crf",
            str(crf),
            "-t",
            f"{duration_sec:.3f}",
            "-an",
            str(out_clip),
        ]

        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as exc:
            raise PipelineError(
                "assemble",
                f"ffmpeg failed on scene {scene.id}: {exc.stderr[-500:] if exc.stderr else exc}",
                retryable=False,
                traceback_str=traceback.format_exc(),
            ) from exc

    def _concat_clips_with_transitions(
        self,
        scene_clips: List[Path],
        scenes: List[Scene],
        out_video: Path,
        crf: int,
    ) -> None:
        """Concatenate rendered scene clips via ffmpeg concat demuxer (fast & frame-accurate)."""
        if len(scene_clips) == 1:
            out_video.write_bytes(scene_clips[0].read_bytes())
            return

        concat_txt = out_video.parent / "concat_list.txt"
        lines = [f"file '{clip.resolve().as_posix()}'" for clip in scene_clips]
        concat_txt.write_text("\n".join(lines) + "\n", encoding="utf-8")

        has_fades = any(s.transition_out in ("fade", "dissolve") for s in scenes[:-1])
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_txt),
            "-c:v",
            settings.video_codec,
            "-preset",
            "fast",
            "-crf",
            str(crf),
            "-pix_fmt",
            "yuv420p",
            str(out_video),
        ]
        if not has_fades:
            cmd = [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_txt),
                "-c",
                "copy",
                str(out_video),
            ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)

    @staticmethod
    def _mux_audio(
        video_path: Path,
        audio_path: Optional[Path],
        out_mp4: Path,
        duration_limit: Optional[float] = None,
    ) -> None:
        """Mux assembled video stream with final ducked audio mix or silent AAC track."""
        cmd = ["ffmpeg", "-y", "-i", str(video_path)]
        if audio_path and audio_path.is_file():
            cmd.extend(["-i", str(audio_path)])
        else:
            cmd.extend(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"])

        if duration_limit is not None:
            cmd.extend(["-t", f"{duration_limit:.3f}"])

        cmd.extend(
            [
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "copy",
                "-c:a",
                settings.audio_codec,
                "-b:a",
                settings.audio_bitrate,
                "-shortest",
                "-movflags",
                "+faststart",
                str(out_mp4),
            ]
        )
        subprocess.run(cmd, check=True, capture_output=True, text=True)

    @staticmethod
    def _resolve_cue_for_window(
        cues: List[Tuple[float, float, str]],
        start: float,
        end: float,
        fallback_text: str,
    ) -> str:
        """Find best matching Whisper cue for a scene window or fall back to narration text."""
        matched = [text for (c_start, c_end, text) in cues if c_end > start and c_start < end]
        if matched:
            return " ".join(matched).strip()
        return fallback_text.strip()

    @staticmethod
    def _render_caption_png(
        text: str,
        frame_size: Tuple[int, int],
        style: CaptionStyle,
        out_path: Path,
    ) -> None:
        """Render clean word-wrapped caption PNG with high-contrast backing plate."""
        w, h = frame_size
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", style.font_size)
        except OSError:
            font = ImageFont.load_default()

        max_line_w = int(w * 0.82)
        words = text.split()
        lines: List[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            bbox = draw.textbbox((0, 0), candidate, font=font)
            if (bbox[2] - bbox[0]) <= max_line_w or not current:
                current = candidate
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)

        line_heights: List[int] = []
        max_w = 0
        for line in lines[:4]:
            bbox = draw.textbbox((0, 0), line, font=font)
            max_w = max(max_w, bbox[2] - bbox[0])
            line_heights.append(max(22, bbox[3] - bbox[1]))

        total_h = sum(line_heights) + max(0, len(line_heights) - 1) * 10
        center_y = int(h * (style.position_y / 100.0))
        box_pad_x = 28
        box_pad_y = 16
        box_w = max_w + box_pad_x * 2
        box_h = total_h + box_pad_y * 2
        box_x = (w - box_w) // 2
        box_y = max(40, min(h - box_h - 40, center_y - box_h // 2))

        draw.rounded_rectangle(
            [box_x, box_y, box_x + box_w, box_y + box_h],
            radius=12,
            fill=(15, 23, 42, 200),
            outline=(51, 65, 85, 220),
            width=2,
        )

        y_cursor = box_y + box_pad_y
        for idx, line in enumerate(lines[:4]):
            bbox = draw.textbbox((0, 0), line, font=font)
            lw = bbox[2] - bbox[0]
            lx = (w - lw) // 2
            draw.text(
                (lx, y_cursor),
                line,
                fill=(248, 250, 252, 255),
                font=font,
                stroke_width=max(0, style.outline_width),
                stroke_fill=(0, 0, 0, 255),
            )
            y_cursor += line_heights[idx] + 10

        img.save(out_path, format="PNG")

    @staticmethod
    def _write_fallback_frame(out_path: Path, size: Tuple[int, int], label: str) -> None:
        """Write dark studio fallback slate PNG if scene frame is missing."""
        img = Image.new("RGB", size, color=(15, 23, 42))
        draw = ImageDraw.Draw(img)
        draw.rectangle([32, 32, size[0] - 32, size[1] - 32], outline=(51, 65, 85), width=3)
        draw.text((64, size[1] // 2), label, fill=(248, 250, 252))
        img.save(out_path, format="PNG")
