"""Watermark generation and RGBA preparation utilities."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from pipeline.models import WatermarkConfig

logger = logging.getLogger("vertical_pipeline.watermark")


class WatermarkHelper:
    """Prepares crisp RGBA watermark overlays positioned within safe margins."""

    def prepare_watermark(
        self,
        config: WatermarkConfig,
        frame_size: Tuple[int, int],
        out_path: Path,
    ) -> Optional[Path]:
        """Return path to an RGBA watermark PNG sized relative to frame width, or None if disabled."""
        if not config.enabled:
            return None

        frame_w, _ = frame_size
        target_w = max(80, int(frame_w * (config.width_pct / 100.0)))
        out_path.parent.mkdir(parents=True, exist_ok=True)

        if config.path and Path(config.path).is_file():
            with Image.open(config.path) as src:
                rgba = src.convert("RGBA")
                aspect = rgba.height / max(1, rgba.width)
                target_h = max(24, int(target_w * aspect))
                resized = rgba.resize((target_w, target_h), Image.Resampling.LANCZOS)
                resized = self._apply_opacity(resized, config.opacity)
                resized.save(out_path, format="PNG")
                return out_path

        # Generate crisp minimal editorial badge PNG when no custom PNG is supplied
        text = (config.label_text or "PASSIONS PEAK").strip().upper()
        font = ImageFont.load_default()
        pad_x = 18
        pad_y = 10
        dummy = Image.new("RGBA", (10, 10))
        d_draw = ImageDraw.Draw(dummy)
        bbox = d_draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

        w = max(target_w, text_w + pad_x * 2)
        h = text_h + pad_y * 2
        img = Image.new("RGBA", (w, h), (15, 23, 42, 0))
        draw = ImageDraw.Draw(img)
        draw.rounded_rectangle(
            [1, 1, w - 2, h - 2],
            radius=6,
            fill=(15, 23, 42, int(210 * config.opacity)),
            outline=(217, 119, 6, int(235 * config.opacity)),
            width=2,
        )
        text_x = (w - text_w) // 2
        text_y = (h - text_h) // 2
        draw.text((text_x, text_y), text, fill=(248, 250, 252, int(255 * config.opacity)), font=font)
        img.save(out_path, format="PNG")
        logger.debug("Generated editorial watermark PNG at %s", out_path)
        return out_path

    @staticmethod
    def _apply_opacity(img: Image.Image, opacity: float) -> Image.Image:
        """Multiply image alpha channel by normalized opacity (0..1)."""
        clamped = max(0.0, min(1.0, opacity))
        r, g, b, a = img.split()
        a = a.point(lambda px: int(px * clamped))
        return Image.merge("RGBA", (r, g, b, a))

    @staticmethod
    def compute_position(
        position: str,
        frame_size: Tuple[int, int],
        wm_size: Tuple[int, int],
        margin_x: int = 36,
        margin_y: int = 48,
    ) -> Tuple[int, int]:
        """Compute pixel (x, y) top-left offset for a corner watermark."""
        fw, fh = frame_size
        ww, wh = wm_size
        if position == "top_left":
            return (margin_x, margin_y)
        if position == "top_right":
            return (max(0, fw - ww - margin_x), margin_y)
        if position == "bottom_left":
            return (margin_x, max(0, fh - wh - margin_y))
        return (max(0, fw - ww - margin_x), max(0, fh - wh - margin_y))
