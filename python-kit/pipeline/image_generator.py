"""Reference-first image generation via Gemini 3.1 Flash Lite Image with Pillow fallback."""

from __future__ import annotations

import base64
import io
import logging
import time
from pathlib import Path
from typing import List, Optional, Tuple

from google import genai
from google.genai import types
from PIL import Image, ImageDraw, ImageFont

from config import settings
from pipeline.models import Scene

logger = logging.getLogger("vertical_pipeline.images")


class ImageGenerator:
    """Generates scene images with optional character/location reference sheets."""

    def __init__(self, api_key: str | None = None, model_name: str | None = None) -> None:
        self.api_key = api_key if api_key is not None else settings.gemini_api_key
        self.model_name = model_name or settings.image_model

    def generate_scene_images(
        self,
        scenes: List[Scene],
        out_dir: Path,
        resolution: Tuple[int, int] = (1080, 1920),
        reference_paths: Optional[List[Path]] = None,
    ) -> List[Path]:
        """Generate PNG assets for each scene, falling back to Pillow placeholders if unavailable."""
        out_dir.mkdir(parents=True, exist_ok=True)
        aspect_label = "9:16" if resolution[1] > resolution[0] else "16:9"
        generated: List[Path] = []

        for scene in scenes:
            target_size = (1200, 2133) if (scene.camera == "slow_zoom" and aspect_label == "9:16") else resolution
            out_path = out_dir / f"scene_{scene.id:02d}.png"
            prompt = (
                f"{scene.visual_direction}. Aspect ratio {aspect_label}, cinematic, photorealistic, "
                f"{'vertical composition' if aspect_label == '9:16' else 'widescreen composition'}. "
                "All characters clearly adults. No embedded text or watermarks."
            )

            if self.api_key:
                try:
                    img_bytes = self._call_gemini_image(
                        prompt=prompt,
                        aspect_ratio=aspect_label,
                        reference_paths=reference_paths or [],
                    )
                    with Image.open(io.BytesIO(img_bytes)) as img:
                        resized = img.convert("RGB").resize(target_size, Image.Resampling.LANCZOS)
                        resized.save(out_path, format="PNG")
                    generated.append(out_path)
                    continue
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Gemini image failed for scene %d (%s); using placeholder.", scene.id, exc)

            self._create_placeholder(out_path, target_size, f"SCENE {scene.id} · {scene.beat.upper()}")
            generated.append(out_path)

        return generated

    def _call_gemini_image(
        self,
        prompt: str,
        aspect_ratio: str,
        reference_paths: List[Path],
    ) -> bytes:
        """Invoke Gemini image model with retry and optional reference images."""
        client = genai.Client(api_key=self.api_key)
        parts: List[types.Part] = []
        for ref_path in reference_paths:
            if ref_path.is_file():
                parts.append(
                    types.Part.from_bytes(
                        data=ref_path.read_bytes(),
                        mime_type="image/png" if ref_path.suffix.lower() == ".png" else "image/jpeg",
                    )
                )
        parts.append(types.Part.from_text(text=prompt))

        delays = [1, 3]
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model=self.model_name,
                    contents=parts,
                    config=types.GenerateContentConfig(
                        image_config=types.ImageConfig(aspect_ratio=aspect_ratio)
                    ),
                )
                for candidate in response.candidates or []:
                    for part in candidate.content.parts or []:
                        if getattr(part, "inline_data", None) and part.inline_data.data:
                            raw = part.inline_data.data
                            return raw if isinstance(raw, bytes) else base64.b64decode(raw)
                raise RuntimeError("No image bytes in Gemini response.")
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < 2:
                    time.sleep(delays[attempt])
        raise RuntimeError(f"Gemini image generation failed: {last_exc}")

    @staticmethod
    def _create_placeholder(out_path: Path, size: Tuple[int, int], label: str) -> None:
        """Create a clean dark slate placeholder PNG so the pipeline never blocks."""
        img = Image.new("RGB", size, color=(15, 23, 42))
        draw = ImageDraw.Draw(img)
        font = ImageFont.load_default()
        draw.rectangle([40, 40, size[0] - 40, size[1] - 40], outline=(51, 65, 85), width=4)
        draw.text((80, size[1] // 2), label, fill=(248, 250, 252), font=font)
        img.save(out_path, format="PNG")
