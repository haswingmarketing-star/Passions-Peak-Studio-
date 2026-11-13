import { Episode, OutputProfile, ProjectFolder } from "../contracts/schemas";

export interface PreviewLayerToggles {
  showBackground: boolean;
  showOverlay: boolean;
  showCaptions: boolean;
  showWatermark: boolean;
}

const imageCache = new Map<string, HTMLImageElement>();

export function loadAssetImage(assetId: string): Promise<HTMLImageElement | null> {
  if (imageCache.has(assetId)) {
    return Promise.resolve(imageCache.get(assetId)!);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageCache.set(assetId, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = `/api/assets/${encodeURIComponent(assetId)}`;
  });
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  zoomScale = 1.0
) {
  const imgRatio = img.width / Math.max(1, img.height);
  const canvasRatio = w / Math.max(1, h);
  let drawW = w;
  let drawH = h;
  if (imgRatio > canvasRatio) {
    drawH = h * zoomScale;
    drawW = drawH * imgRatio;
  } else {
    drawW = w * zoomScale;
    drawH = drawW / imgRatio;
  }
  const dx = (w - drawW) / 2;
  const dy = (h - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) {
      line = test;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export async function renderManifestFrameToCanvas(params: {
  canvas: HTMLCanvasElement;
  project: ProjectFolder;
  episode: Episode;
  profile: OutputProfile;
  playheadSec: number;
  layers: PreviewLayerToggles;
}): Promise<void> {
  const { canvas, project, episode, profile, playheadSec, layers } = params;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#0F172A";
  ctx.fillRect(0, 0, w, h);

  if (episode.scenes.length === 0) {
    ctx.fillStyle = "#94A3B8";
    ctx.font = "600 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Draft or upload chapter scenes to preview.", w / 2, h / 2);
    return;
  }

  let cursor = 0;
  let activeScene = episode.scenes[episode.scenes.length - 1];
  let sceneElapsed = 0;
  for (const sc of episode.scenes) {
    if (playheadSec >= cursor && playheadSec <= cursor + sc.durationSeconds) {
      activeScene = sc;
      sceneElapsed = playheadSec - cursor;
      break;
    }
    cursor += sc.durationSeconds;
  }

  const progressInScene = Math.min(1, sceneElapsed / Math.max(0.5, activeScene.durationSeconds));
  const zoomScale = activeScene.camera === "slow_zoom" || activeScene.camera === "dolly_in"
    ? 1 + progressInScene * 0.08
    : 1.0;

  // 1. Background / Generated Scene Frame
  const variant =
    activeScene.renders[profile] ?? activeScene.renders["9x16"] ?? activeScene.renders["16x9"];
  if (layers.showBackground && variant?.frameAssetId) {
    const bg = await loadAssetImage(variant.frameAssetId);
    if (bg) {
      drawCoverImage(ctx, bg, w, h, zoomScale);
    }
  } else if (layers.showBackground) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#1E293B");
    grad.addColorStop(1, "#090D16");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#F59E0B";
    ctx.font = "600 14px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`SCENE ${activeScene.id} · ${activeScene.beat.toUpperCase()}`, 28, 44);
    ctx.fillStyle = "#CBD5E1";
    ctx.font = "400 15px sans-serif";
    const dirLines = wrapTextLines(ctx, activeScene.visualDirection, w - 56);
    dirLines.forEach((l, i) => ctx.fillText(l, 28, 76 + i * 22));
  }

  // 2. Reference Overlay
  if (layers.showOverlay && activeScene.overlayAssetId) {
    const ov = await loadAssetImage(activeScene.overlayAssetId);
    if (ov) {
      const cfg = activeScene.overlayConfig;
      const ovW = (w * cfg.widthPct) / 100;
      const ovH = ovW * (ov.height / Math.max(1, ov.width));
      const ovX = (w * cfg.xPct) / 100;
      const ovY = (h * cfg.yPct) / 100;
      ctx.save();
      ctx.globalAlpha = cfg.opacity;
      ctx.drawImage(ov, ovX, ovY, ovW, ovH);
      ctx.restore();
    }
  }

  // 3. Watermark Layer
  if (layers.showWatermark && episode.watermarkConfig.enabled) {
    const wmCfg = episode.watermarkConfig;
    ctx.save();
    ctx.globalAlpha = wmCfg.opacity;
    if (wmCfg.assetId) {
      const wmImg = await loadAssetImage(wmCfg.assetId);
      if (wmImg) {
        const wmW = (w * wmCfg.widthPct) / 100;
        const wmH = wmW * (wmImg.height / Math.max(1, wmImg.width));
        const pad = 20;
        const wx = wmCfg.position.includes("right") ? w - wmW - pad : pad;
        const wy = wmCfg.position.includes("bottom") ? h - wmH - pad : pad;
        ctx.drawImage(wmImg, wx, wy, wmW, wmH);
      }
    } else {
      const label = (wmCfg.labelText || project.name).toUpperCase();
      ctx.font = "600 12px monospace";
      const textW = ctx.measureText(label).width;
      const boxW = textW + 20;
      const boxH = 26;
      const pad = 18;
      const wx = wmCfg.position.includes("right") ? w - boxW - pad : pad;
      const wy = wmCfg.position.includes("bottom") ? h - boxH - pad : pad;
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.strokeStyle = "rgba(217, 119, 6, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(wx, wy, boxW, boxH);
      ctx.strokeRect(wx, wy, boxW, boxH);
      ctx.fillStyle = "#F8FAFC";
      ctx.textAlign = "left";
      ctx.fillText(label, wx + 10, wy + 17);
    }
    ctx.restore();
  }

  // 4. Burned-in Caption Layer
  if (layers.showCaptions && episode.captionStyle.enabled) {
    const text = (activeScene.srtCueText || activeScene.narration).trim();
    if (text) {
      const scaledFont = Math.max(13, Math.round((episode.captionStyle.fontSize / 1080) * w));
      ctx.font = `700 ${scaledFont}px sans-serif`;
      const lines = wrapTextLines(ctx, text, w * 0.84);
      const lineHeight = Math.round(scaledFont * 1.32);
      const blockH = lines.length * lineHeight + 16;
      const blockW = Math.min(
        w * 0.9,
        Math.max(...lines.map((l) => ctx.measureText(l).width)) + 32
      );
      const centerY = (h * episode.captionStyle.positionY) / 100;
      const boxX = (w - blockW) / 2;
      const boxY = Math.max(20, Math.min(h - blockH - 20, centerY - blockH / 2));

      ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
      ctx.fillRect(boxX, boxY, blockW, blockH);

      ctx.textAlign = "center";
      ctx.lineWidth = Math.max(1, episode.captionStyle.outlineWidth);
      ctx.strokeStyle = "#000000";
      ctx.fillStyle = "#F8FAFC";
      lines.forEach((line, idx) => {
        const ty = boxY + 12 + (idx + 0.78) * lineHeight;
        ctx.strokeText(line, w / 2, ty);
        ctx.fillText(line, w / 2, ty);
      });
    }
  }
}
