import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { z } from "zod";
import {
  type Episode,
  type OutputProfile,
  type ProjectFolder,
  type RenderManifestV1,
  RenderManifestV1Schema,
  SCHEMA_VERSION,
} from "../../src/contracts/schemas.ts";
import { assetStore } from "../assetStore.ts";

const execFileAsync = promisify(execFile);

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const exportService = {
  compileRenderManifest(
    project: ProjectFolder,
    episode: Episode,
    outputProfile: OutputProfile
  ): RenderManifestV1 {
    const resolution =
      outputProfile === "16x9" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };

    const firstLoc = project.locations.find((l) => l.id === episode.scenes[0]?.locationId);
    const colorGrade =
      project.seriesBible.cityColorGrades[firstLoc?.colorGradeId ?? "chicago"] ??
      "35mm cinematic film look";

    const manifest: RenderManifestV1 = {
      schemaVersion: SCHEMA_VERSION,
      projectId: project.id,
      projectName: project.name,
      episodeId: episode.id,
      title: episode.title || `${project.name} ${episode.episodeCode}`,
      episodeCode: episode.episodeCode,
      bibleVersion: episode.bibleVersion,
      outputProfile,
      resolution,
      fps: episode.renderConfig.fps,
      crf: episode.renderConfig.crf,
      colorGrade,
      scenes: episode.scenes.map((scene) => {
        const variant = scene.renders[outputProfile] ?? scene.renders["9x16"] ?? scene.renders["16x9"];
        return {
          id: scene.id,
          beat: scene.beat,
          durationMs: Math.round(scene.durationSeconds * 1000),
          frameAssetId: variant?.frameAssetId,
          audioAssetId: scene.audioAssetId,
          bgmAssetId: scene.bgmAssetId ?? episode.bgmConfig.masterBgmAssetId,
          overlayAssetId: scene.overlayAssetId,
          overlayConfig: scene.overlayConfig,
          speaker: scene.speaker,
          narration: scene.narration,
          captionText: scene.srtCueText || scene.narration,
          motionPrompt: scene.motionPrompt,
          lyriaBgmPrompt: scene.lyriaBgmPrompt,
          transitionOut: scene.transitionOut,
        };
      }),
      srtAssetId: episode.srtAssetId,
      srtContent: episode.srtContent,
      thumbnails: (episode.thumbnailRenders[outputProfile] ?? []).map((t) => ({
        assetId: t.assetId,
        headlineText: t.headlineText,
      })),
      watermarkConfig: episode.watermarkConfig,
      captionStyle: episode.captionStyle,
      bgmConfig: episode.bgmConfig,
      createdAt: new Date().toISOString(),
    };

    return RenderManifestV1Schema.parse(manifest);
  },

  compileMotionPromptsTxt(
    project: ProjectFolder,
    episode: Episode,
    outputProfile: OutputProfile
  ): string {
    const lines: string[] = [];
    const totalSec = episode.scenes.reduce((acc, s) => acc + s.durationSeconds, 0);

    lines.push("========================================================================");
    lines.push(`${project.name.toUpperCase()} — IMAGE-TO-VIDEO MOTION & VOICEOVER SHEET`);
    lines.push("========================================================================");
    lines.push(`Episode: ${episode.episodeCode} — ${episode.title || "Untitled Episode"}`);
    lines.push(`Output Profile: ${outputProfile === "9x16" ? "9:16 Vertical (1080x1920)" : "16:9 Widescreen (1920x1080)"}`);
    lines.push(`Canon Bible Version: v${episode.bibleVersion} | Total Runtime: ${formatClock(totalSec)} (${totalSec}s)`);
    lines.push(`Target Video Gen Tools: Gemini Omni 1.2 Flash / Runway / Flow`);
    lines.push("");

    let cursor = 0;
    for (const scene of episode.scenes) {
      const startTs = formatClock(cursor);
      const endTs = formatClock(cursor + scene.durationSeconds);
      cursor += scene.durationSeconds;

      const charNames = scene.charactersPresent
        .map((id) => project.characters.find((c) => c.id === id)?.name ?? id)
        .join(", ");

      lines.push("------------------------------------------------------------------------");
      lines.push(
        `SCENE ${String(scene.id).padStart(2, "0")} | ${scene.beat.toUpperCase()} | TIMESTAMP: [${startTs} - ${endTs}] (${scene.durationSeconds}s)`
      );
      lines.push(`Characters Present: ${charNames || scene.speaker}`);
      lines.push(`Camera / Transition: ${scene.camera} -> ${scene.transitionOut}`);
      lines.push("");
      lines.push("[VOICE-OVER / DIALOGUE SCRIPT]");
      lines.push(`  Speaker: ${scene.speaker}`);
      lines.push(`  Line: "${scene.narration}"`);
      lines.push("");
      lines.push("[STILL VISUAL DIRECTION]");
      lines.push(`  ${scene.visualDirection}`);
      lines.push("");
      lines.push("[IMAGE-TO-VIDEO MOTION PROMPT (Omni 1.2 Flash)]");
      lines.push(`  PRIMARY MOTION:   ${scene.motionPrompt.primaryMotion}`);
      lines.push(`  CAMERA MOVEMENT:  ${scene.motionPrompt.cameraMovement}`);
      lines.push(`  MOTION SPEED:     ${scene.motionPrompt.motionSpeed}`);
      lines.push(`  SECONDARY MOTION: ${scene.motionPrompt.secondaryMotion}`);
      lines.push(`  START STATE:      ${scene.motionPrompt.startState}`);
      lines.push(`  END STATE:        ${scene.motionPrompt.endState}`);
      lines.push(`  TRANSITION HINT:  ${scene.motionPrompt.transitionHint}`);
      lines.push("");
      lines.push("[LYRIA BGM PROMPT]");
      lines.push(`  ${scene.lyriaBgmPrompt}`);
      if (scene.cliffhangerLine) {
        lines.push("");
        lines.push(`[CLIFFHANGER HOOK] ${scene.cliffhangerLine}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  },

  async buildProjectBundleZip(
    project: ProjectFolder,
    episode: Episode,
    outputProfile: OutputProfile
  ): Promise<{ filename: string; buffer: Buffer }> {
    const manifest = this.compileRenderManifest(project, episode, outputProfile);
    const motionTxt = this.compileMotionPromptsTxt(project, episode, outputProfile);
    const manifestSchema = z.toJSONSchema(RenderManifestV1Schema);

    const zip = new JSZip();
    const slug = `${project.slug}_${episode.episodeCode.toLowerCase().replace(/\s+/g, "_")}_${outputProfile}`;

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("manifest.schema.json", JSON.stringify(manifestSchema, null, 2));
    zip.file(`${slug}_motion_prompts.txt`, motionTxt);
    zip.file("captions.srt", episode.srtContent || "");
    zip.file(
      "series_bible_snapshot.json",
      JSON.stringify(
        {
          projectName: project.name,
          bibleVersion: project.bibleVersion,
          seriesBible: project.seriesBible,
          characters: project.characters,
          locations: project.locations,
          wkwLedger: project.wkwLedger,
        },
        null,
        2
      )
    );

    // Collect all referenced assetIds from manifest & character refs
    const assetIds = new Set<string>();
    for (const s of manifest.scenes) {
      if (s.frameAssetId) assetIds.add(s.frameAssetId);
      if (s.audioAssetId) assetIds.add(s.audioAssetId);
      if (s.bgmAssetId) assetIds.add(s.bgmAssetId);
      if (s.overlayAssetId) assetIds.add(s.overlayAssetId);
    }
    for (const t of manifest.thumbnails) assetIds.add(t.assetId);
    if (manifest.srtAssetId) assetIds.add(manifest.srtAssetId);
    if (manifest.watermarkConfig.assetId) assetIds.add(manifest.watermarkConfig.assetId);
    for (const c of project.characters) {
      if (c.approvedRefAssetId) assetIds.add(c.approvedRefAssetId);
    }

    const assetsFolder = zip.folder("assets");
    for (const assetId of assetIds) {
      const found = await assetStore.getBuffer(assetId);
      if (found && assetsFolder) {
        assetsFolder.file(assetId, found.buffer);
      }
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return {
      filename: `${slug}_bundle.zip`,
      buffer,
    };
  },

  async renderMp4WithFfmpeg(
    manifest: RenderManifestV1,
    onProgress?: (pct: number, msg: string) => void
  ): Promise<{ assetId: string; filename: string }> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pp_render_"));
    try {
      const { width, height } = manifest.resolution;
      const fps = manifest.fps;
      const sceneClipPaths: string[] = [];

      for (let i = 0; i < manifest.scenes.length; i++) {
        const scene = manifest.scenes[i];
        onProgress?.(
          Math.round(10 + (i / Math.max(1, manifest.scenes.length)) * 65),
          `Encoding scene ${i + 1}/${manifest.scenes.length}...`
        );

        const durSec = Math.max(1, scene.durationMs / 1000);
        const clipOut = path.join(tmpDir, `scene_${i}.mp4`);

        let framePath: string | null = null;
        if (scene.frameAssetId) {
          const found = await assetStore.getBuffer(scene.frameAssetId);
          if (found) {
            framePath = path.join(tmpDir, `frame_${i}.${found.record.ext}`);
            await fs.writeFile(framePath, found.buffer);
          }
        }

        let audioPath: string | null = null;
        if (scene.audioAssetId) {
          const foundAudio = await assetStore.getBuffer(scene.audioAssetId);
          if (foundAudio) {
            audioPath = path.join(tmpDir, `audio_${i}.${foundAudio.record.ext}`);
            await fs.writeFile(audioPath, foundAudio.buffer);
          }
        }

        const args: string[] = ["-y"];
        if (framePath) {
          args.push("-loop", "1", "-t", String(durSec), "-i", framePath);
        } else {
          args.push("-f", "lavfi", "-i", `color=c=#0F172A:s=${width}x${height}:d=${durSec}`);
        }

        if (audioPath) {
          args.push("-i", audioPath);
        } else {
          args.push("-f", "lavfi", "-t", String(durSec), "-i", "anullsrc=r=44100:cl=stereo");
        }

        const safeCaption = scene.captionText.replace(/[':]/g, "").slice(0, 120);
        const vf = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},format=yuv420p`;

        args.push(
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          String(manifest.crf),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          "-t",
          String(durSec),
          clipOut
        );

        try {
          await execFileAsync("ffmpeg", args, { maxBuffer: 20 * 1024 * 1024 });
        } catch (err) {
          // Retry without complex caption issues if needed
          throw new Error(
            `ffmpeg failed on scene ${scene.id} (${safeCaption.slice(0, 20)}): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
        sceneClipPaths.push(clipOut);
      }

      onProgress?.(82, "Concatenating final MP4 master...");
      const concatListPath = path.join(tmpDir, "concat.txt");
      await fs.writeFile(
        concatListPath,
        sceneClipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
        "utf-8"
      );

      const finalOut = path.join(tmpDir, "final.mp4");
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          concatListPath,
          "-c:v",
          "libx264",
          "-crf",
          String(manifest.crf),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          finalOut,
        ],
        { maxBuffer: 20 * 1024 * 1024 }
      );

      onProgress?.(95, "Storing MP4 in Asset Store...");
      const mp4Buf = await fs.readFile(finalOut);
      const slug = `${manifest.episodeCode.toLowerCase().replace(/\s+/g, "_")}_${manifest.outputProfile}.mp4`;
      const stored = await assetStore.putBuffer({
        buffer: mp4Buf,
        mimeType: "video/mp4",
        kind: "video",
        label: `${manifest.title} (${manifest.outputProfile})`,
        meta: {
          episodeId: manifest.episodeId,
          outputProfile: manifest.outputProfile,
        },
      });

      onProgress?.(100, "MP4 render complete.");
      return { assetId: stored.assetId, filename: slug };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  },
};
