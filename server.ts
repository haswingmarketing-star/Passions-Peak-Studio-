import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import JSZip from "jszip";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { ELEVENLABS_VOICE_PRESETS, elevenlabsAdapter } from "./server/adapters/elevenlabsAdapter.ts";
import { geminiAdapter } from "./server/adapters/geminiAdapter.ts";
import { assetStore } from "./server/assetStore.ts";
import { jobEngine } from "./server/jobEngine.ts";
import { projectDb } from "./server/projectDb.ts";
import { canonService } from "./server/services/canonService.ts";
import { characterRegistry } from "./server/services/characterRegistry.ts";
import { exportService } from "./server/services/exportService.ts";
import { kitService } from "./server/services/kitService.ts";
import { scriptService } from "./server/services/scriptService.ts";
import { visualService } from "./server/services/visualService.ts";
import { voiceService } from "./server/services/voiceService.ts";
import {
  CarryForwardDiffSchema,
  type OutputProfile,
  OutputProfileSchema,
  ProjectFolderSchema,
} from "./src/contracts/schemas.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function parseProfile(raw: unknown): OutputProfile {
  return raw === "16x9" ? "16x9" : "9x16";
}

function serializeError(err: unknown): { message: string; traceback?: string } {
  if (err instanceof Error) {
    return { message: err.message, traceback: err.stack };
  }
  return { message: String(err) };
}

async function startServer() {
  await assetStore.init();
  await projectDb.init();
  await jobEngine.init();

  const app = express();
  app.use(express.json({ limit: "25mb" }));

  // 1. Health & Provider Capabilities (NEVER exposes secret key values)
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      geminiConfigured: geminiAdapter.isConfigured(),
      elevenlabsConfigured: elevenlabsAdapter.isConfigured(),
      elevenlabsPresets: ELEVENLABS_VOICE_PRESETS,
    });
  });

  // 2. Single Resumable SSE Hub & Job Polling
  app.get("/api/events", (req, res) => {
    jobEngine.attachSseClient(req, res);
  });

  app.get("/api/jobs", async (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const jobs = await jobEngine.listJobs(projectId);
    res.json({ jobs });
  });

  app.get("/api/jobs/:id", async (req, res) => {
    const job = await jobEngine.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ job });
  });

  // 3. Content-Addressed Asset Serving & Upload
  app.get("/api/assets/:assetId", async (req, res) => {
    const found = await assetStore.getBuffer(req.params.assetId);
    if (!found) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    res.setHeader("Content-Type", found.record.mimeType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(found.buffer);
  });

  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }
      const kindRaw = String(req.body.kind || "other");
      const allowedKinds = new Set([
        "character_ref",
        "location_plate",
        "scene_frame",
        "thumbnail",
        "voiceover",
        "bgm",
        "watermark",
        "overlay",
        "srt",
        "video",
        "other",
      ]);
      const kind = (allowedKinds.has(kindRaw) ? kindRaw : "other") as Parameters<typeof assetStore.putBuffer>[0]["kind"];
      const rec = await assetStore.putBuffer({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype || "application/octet-stream",
        kind,
        label: req.file.originalname,
      });
      res.json({ asset: rec, url: `/api/assets/${rec.assetId}` });
    } catch (err) {
      res.status(400).json({ error: serializeError(err) });
    }
  });

  // 4. Multi-Project Folders & Persistence
  app.get("/api/projects", async (_req, res) => {
    const data = await projectDb.listProjects();
    res.json(data);
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const { name, genre, logline, targetRuntimeSeconds } = req.body ?? {};
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: { message: "Project name is required." } });
        return;
      }
      const project = await projectDb.createProject({
        name: name.trim(),
        genre: String(genre || "Serialized Drama"),
        logline: String(logline || "High-stakes interpersonal serialized drama."),
        targetRuntimeSeconds: Number(targetRuntimeSeconds || 75),
      });
      res.json({ project });
    } catch (err) {
      res.status(400).json({ error: serializeError(err) });
    }
  });

  app.post("/api/projects/select", async (req, res) => {
    try {
      const { projectId } = req.body ?? {};
      const project = await projectDb.setActiveProject(String(projectId));
      res.json({ project });
    } catch (err) {
      res.status(404).json({ error: serializeError(err) });
    }
  });

  app.put("/api/projects/:id", async (req, res) => {
    try {
      const existing = await projectDb.getProject(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { message: "Project not found." } });
        return;
      }
      const parsed = ProjectFolderSchema.parse({ ...existing, ...req.body, id: existing.id });
      const saved = await projectDb.saveProject(parsed);
      res.json({ project: saved });
    } catch (err) {
      res.status(400).json({ error: serializeError(err) });
    }
  });

  app.post("/api/projects/:id/state", async (req, res) => {
    try {
      const existing = await projectDb.getProject(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { message: "Project not found." } });
        return;
      }
      const merged = ProjectFolderSchema.parse({
        ...existing,
        ...req.body,
        id: existing.id,
      });
      // Re-run alias resolution cleanly whenever characters/scenes update
      const { resolvedScenes, unresolvedCharacters } = characterRegistry.resolveCharactersInScenes(
        merged,
        merged.activeEpisode.scenes
      );
      merged.activeEpisode.scenes = resolvedScenes;
      merged.unresolvedCharacters = unresolvedCharacters;
      const saved = await projectDb.saveProject(merged);
      res.json({ project: saved });
    } catch (err) {
      res.status(400).json({ error: serializeError(err) });
    }
  });

  // 5. Character Reference Sheets, 3-Candidate Portraits & Location Plates
  app.post("/api/projects/:id/characters/ref", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    const { characterId, wardrobeId, outputProfile } = req.body ?? {};
    const char = project.characters.find((c) => c.id === characterId);
    if (!char) {
      res.status(404).json({ error: { message: `Character '${characterId}' not found.` } });
      return;
    }
    const profile = parseProfile(outputProfile);
    const job = await jobEngine.createJob({
      projectId: project.id,
      episodeId: project.activeEpisode.id,
      type: "character_ref",
      phase: "Generating Reference Sheet",
      message: `Generating neutral reference sheet for ${char.name}...`,
    });

    try {
      await jobEngine.updateJob(job.id, { status: "running", progress: 25 });
      const ref = await characterRegistry.generateCharacterReferenceSheet({
        character: char,
        wardrobeId: wardrobeId || char.wardrobeIds[0] || "day1",
        outputProfile: profile,
        seriesTitle: project.seriesBible.title,
      });
      const latest = (await projectDb.getProject(project.id)) ?? project;
      const wKey = wardrobeId || char.wardrobeIds[0] || "day1";
      latest.characters = latest.characters.map((c) =>
        c.id === char.id
          ? {
              ...c,
              approvedRefAssetId: ref.assetId,
              approvedRefVariants: { ...c.approvedRefVariants, [wKey]: ref.assetId },
            }
          : c
      );
      latest.activeEpisode.telemetry.imagesGenerated += 1;
      const saved = await projectDb.saveProject(latest);
      await jobEngine.updateJob(job.id, {
        status: "succeeded",
        progress: 100,
        message: `Approved reference sheet saved for ${char.name}.`,
        outputAssetIds: [ref.assetId],
      });
      res.json({ project: saved, assetId: ref.assetId, jobId: job.id });
    } catch (err) {
      const e = serializeError(err);
      await jobEngine.updateJob(job.id, {
        status: "failed",
        progress: 0,
        message: e.message,
        error: { stage: "character_ref", message: e.message, traceback: e.traceback },
      });
      res.status(500).json({ error: e });
    }
  });

  app.post("/api/projects/:id/characters/candidates", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    const { mentionName, contextExcerpt, outputProfile } = req.body ?? {};
    if (!mentionName) {
      res.status(400).json({ error: { message: "mentionName is required." } });
      return;
    }
    const job = await jobEngine.createJob({
      projectId: project.id,
      type: "character_candidates",
      phase: "Generating 3 Candidate Portraits",
      message: `Generating 3 adult candidate looks for "${mentionName}"...`,
    });

    try {
      await jobEngine.updateJob(job.id, { status: "running", progress: 20 });
      const candidateAssetIds = await characterRegistry.generateCandidatePortraits({
        mentionName: String(mentionName),
        contextExcerpt: String(contextExcerpt || `New character introduced in ${project.name}`),
        seriesTitle: project.seriesBible.title,
        cityContext: project.characters[0]?.city || "Chicago",
        outputProfile: parseProfile(outputProfile),
      });
      const latest = (await projectDb.getProject(project.id)) ?? project;
      latest.unresolvedCharacters = latest.unresolvedCharacters.map((u) =>
        u.mentionName.toLowerCase() === String(mentionName).toLowerCase()
          ? { ...u, candidateAssetIds }
          : u
      );
      latest.activeEpisode.telemetry.imagesGenerated += candidateAssetIds.length;
      const saved = await projectDb.saveProject(latest);
      await jobEngine.updateJob(job.id, {
        status: "succeeded",
        progress: 100,
        message: `Generated 3 candidate portraits for "${mentionName}".`,
        outputAssetIds: candidateAssetIds,
      });
      res.json({ project: saved, candidateAssetIds, jobId: job.id });
    } catch (err) {
      const e = serializeError(err);
      await jobEngine.updateJob(job.id, {
        status: "failed",
        progress: 0,
        message: e.message,
        error: { stage: "character_candidates", message: e.message, traceback: e.traceback },
      });
      res.status(500).json({ error: e });
    }
  });

  app.post("/api/projects/:id/characters/register", async (req, res) => {
    try {
      const project = await projectDb.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: { message: "Project not found." } });
        return;
      }
      const updated = characterRegistry.registerNewCharacterFromSelection(project, req.body);
      const saved = await projectDb.saveProject(updated);
      res.json({ project: saved });
    } catch (err) {
      res.status(400).json({ error: serializeError(err) });
    }
  });

  app.post("/api/projects/:id/locations/plate", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    const { locationId, outputProfile } = req.body ?? {};
    const loc = project.locations.find((l) => l.id === locationId);
    if (!loc) {
      res.status(404).json({ error: { message: `Location '${locationId}' not found.` } });
      return;
    }
    const job = await jobEngine.createJob({
      projectId: project.id,
      type: "location_plate",
      phase: "Generating Location Plate",
      message: `Generating empty plate for ${loc.name}...`,
    });
    try {
      await jobEngine.updateJob(job.id, { status: "running", progress: 30 });
      const plate = await visualService.generateLocationPlate({
        project,
        location: loc,
        outputProfile: parseProfile(outputProfile),
      });
      const latest = (await projectDb.getProject(project.id)) ?? project;
      latest.locations = latest.locations.map((l) =>
        l.id === loc.id ? { ...l, approvedPlateAssetId: plate.assetId } : l
      );
      latest.activeEpisode.telemetry.imagesGenerated += 1;
      const saved = await projectDb.saveProject(latest);
      await jobEngine.updateJob(job.id, {
        status: "succeeded",
        progress: 100,
        message: `Location plate approved for ${loc.name}.`,
        outputAssetIds: [plate.assetId],
      });
      res.json({ project: saved, assetId: plate.assetId });
    } catch (err) {
      const e = serializeError(err);
      await jobEngine.updateJob(job.id, {
        status: "failed",
        progress: 0,
        message: e.message,
        error: { stage: "location_plate", message: e.message, traceback: e.traceback },
      });
      res.status(500).json({ error: e });
    }
  });

  // 6. Script Generation, Scene Regen, Canon Audit & Carry-Forward Diff
  app.post("/api/projects/:id/script/generate", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    const {
      chapterNumber,
      episodeCode,
      chapterText,
      genre,
      tone,
      targetDurationSeconds,
      focusArc,
      extraInstructions,
      outputProfile,
    } = req.body ?? {};

    const job = await jobEngine.createJob({
      projectId: project.id,
      episodeId: project.activeEpisode.id,
      type: "script_generation",
      phase: "Drafting Episode Script",
      message: `Generating ${episodeCode || "EP 01"} script with Gemini 3.1 Flash Lite...`,
    });

    try {
      await jobEngine.updateJob(job.id, { status: "running", progress: 25 });
      const result = await scriptService.generateScriptFromInput({
        project,
        chapterNumber: Number(chapterNumber || project.activeEpisode.chapterNumber || 1),
        episodeCode: String(episodeCode || project.activeEpisode.episodeCode || "EP 01"),
        chapterText: typeof chapterText === "string" ? chapterText : undefined,
        genre: String(genre || project.seriesBible.genre),
        tone: String(tone || "Urgent, cinematic, high-stakes interpersonal drama"),
        targetDurationSeconds: Number(targetDurationSeconds || project.seriesBible.targetRuntimeSeconds || 75),
        focusArc: String(focusArc || project.seriesBible.seasonScope),
        extraInstructions: typeof extraInstructions === "string" ? extraInstructions : undefined,
        outputProfile: parseProfile(outputProfile),
      });

      const latest = (await projectDb.getProject(project.id)) ?? project;
      latest.activeEpisode = result.episode;
      latest.unresolvedCharacters = result.unresolvedCharacters;
      const saved = await projectDb.saveProject(latest);

      await jobEngine.updateJob(job.id, {
        status: "succeeded",
        progress: 100,
        message: `Generated ${result.episode.scenes.length} scenes (${result.unresolvedCharacters.length} unregistered character(s) flagged).`,
        outputMeta: { tokensUsed: result.tokensUsed },
      });

      res.json({ project: saved, tokensUsed: result.tokensUsed });
    } catch (err) {
      const e = serializeError(err);
      await jobEngine.updateJob(job.id, {
        status: "failed",
        progress: 0,
        message: e.message,
        error: { stage: "script_generation", message: e.message, traceback: e.traceback },
      });
      res.status(500).json({ error: e });
    }
  });

  app.post("/api/projects/:id/script/scene/:sceneId/regen", async (req, res) => {
    try {
      const project = await projectDb.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: { message: "Project not found." } });
        return;
      }
      const sceneId = Number(req.params.sceneId);
      const { scene, tokensUsed } = await scriptService.regenerateScene({
        project,
        episode: project.activeEpisode,
        sceneId,
        instruction: req.body?.instruction,
      });
      project.activeEpisode.scenes = project.activeEpisode.scenes.map((s) =>
        s.id === sceneId ? scene : s
      );
      project.activeEpisode.telemetry.textTokens += tokensUsed;
      const { resolvedScenes, unresolvedCharacters } = characterRegistry.resolveCharactersInScenes(
        project,
        project.activeEpisode.scenes
      );
      project.activeEpisode.scenes = resolvedScenes;
      project.unresolvedCharacters = unresolvedCharacters;
      const saved = await projectDb.saveProject(project);
      res.json({ project: saved, scene });
    } catch (err) {
      res.status(500).json({ error: serializeError(err) });
    }
  });

  app.post("/api/projects/:id/canon/audit", async (req, res) => {
    try {
      const project = await projectDb.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: { message: "Project not found." } });
        return;
      }
      const audit = await canonService.auditEpisodeAgainstCanon(project, project.activeEpisode);
      if (audit.tokensUsed > 0) {
        project.activeEpisode.telemetry.textTokens += audit.tokensUsed;
        await projectDb.saveProject(project);
      }
      res.json(audit);
    } catch (err) {
      res.status(500).json({ error: serializeError(err) });
    }
  });

  app.post("/api/projects/:id/canon/carry-forward/propose", async (req, res) => {
    try {
      const project = await projectDb.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: { message: "Project not found." } });
        return;
      }
      const proposal = await canonService.proposeCarryForwardDiff(project, project.activeEpisode);
      res.json(proposal);
    } catch (err) {
      res.status(500).json({ error: serializeError(err) });
    }
  });

  app.post("/api/projects/:id/canon/carry-forward/commit", async (req, res) => {
    try {
      const project = await projectDb.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: { message: "Project not found." } });
        return;
      }
      const diff = CarryForwardDiffSchema.parse(req.body?.diff);
      const updated = canonService.commitCarryForwardDiff(project, project.activeEpisode, diff);
      const saved = await projectDb.saveProject(updated);
      res.json({ project: saved });
    } catch (err) {
      res.status(400).json({ error: serializeError(err) });
    }
  });

  // 7. Visual Scene Frame Generation (Protected by Continuity Gate)
  app.post("/api/projects/:id/visuals/scene/:sceneId", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    const sceneId = Number(req.params.sceneId);
    const profile = parseProfile(req.body?.outputProfile);
    const scene = project.activeEpisode.scenes.find((s) => s.id === sceneId);
    if (!scene) {
      res.status(404).json({ error: { message: `Scene ${sceneId} not found.` } });
      return;
    }

    const gate = visualService.checkContinuityGate(project, [sceneId]);
    if (gate.blocked) {
      res.status(409).json({
        error: {
          message: "Continuity Gate blocked: approve or register missing character reference sheets first.",
        },
        gate,
      });
      return;
    }

    const job = await jobEngine.createJob({
      projectId: project.id,
      episodeId: project.activeEpisode.id,
      type: "scene_frames",
      phase: `Rendering Scene ${sceneId} Frame`,
      message: `Generating ${profile} reference-guided frame for Scene ${sceneId}...`,
    });

    try {
      await jobEngine.updateJob(job.id, { status: "running", progress: 30 });
      const resFrame = await visualService.generateSceneFrame({
        project,
        scene,
        outputProfile: profile,
      });
      const latest = (await projectDb.getProject(project.id)) ?? project;
      latest.activeEpisode.scenes = latest.activeEpisode.scenes.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              renders: {
                ...s.renders,
                [profile]: {
                  ...(s.renders[profile] ?? { thumbnailAssetIds: [] }),
                  frameAssetId: resFrame.frameAssetId,
                  provenance: resFrame.provenance,
                },
              },
            }
          : s
      );
      latest.activeEpisode.telemetry.imagesGenerated += 1;
      const saved = await projectDb.saveProject(latest);
      await jobEngine.updateJob(job.id, {
        status: "succeeded",
        progress: 100,
        message: `Scene ${sceneId} frame generated.`,
        outputAssetIds: [resFrame.frameAssetId],
      });
      res.json({ project: saved, ...resFrame });
    } catch (err) {
      const e = serializeError(err);
      await jobEngine.updateJob(job.id, {
        status: "failed",
        progress: 0,
        message: e.message,
        error: { stage: "scene_frames", message: e.message, traceback: e.traceback },
      });
      res.status(500).json({ error: e });
    }
  });

  app.post("/api/projects/:id/visuals/generate-all", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    const profile = parseProfile(req.body?.outputProfile);
    const gate = visualService.checkContinuityGate(project);
    if (gate.blocked) {
      res.status(409).json({
        error: {
          message: "Continuity Gate blocked: resolve unregistered characters or generate missing reference sheets first.",
        },
        gate,
      });
      return;
    }

    const job = await jobEngine.createJob({
      projectId: project.id,
      episodeId: project.activeEpisode.id,
      type: "scene_frames",
      phase: "Generating All Scene Frames",
      message: `Generating frames for ${project.activeEpisode.scenes.length} scenes (${profile})...`,
    });

    try {
      await jobEngine.updateJob(job.id, { status: "running", progress: 10 });
      const assetIds: string[] = [];
      let current = project;
      for (let i = 0; i < current.activeEpisode.scenes.length; i++) {
        const sc = current.activeEpisode.scenes[i];
        await jobEngine.updateJob(job.id, {
          progress: Math.round(15 + (i / Math.max(1, current.activeEpisode.scenes.length)) * 80),
          message: `Generating Scene ${sc.id}/${current.activeEpisode.scenes.length}...`,
        });
        const frame = await visualService.generateSceneFrame({
          project: current,
          scene: sc,
          outputProfile: profile,
        });
        assetIds.push(frame.frameAssetId);
        current = (await projectDb.getProject(project.id)) ?? current;
        current.activeEpisode.scenes = current.activeEpisode.scenes.map((s) =>
          s.id === sc.id
            ? {
                ...s,
                renders: {
                  ...s.renders,
                  [profile]: {
                    ...(s.renders[profile] ?? { thumbnailAssetIds: [] }),
                    frameAssetId: frame.frameAssetId,
                    provenance: frame.provenance,
                  },
                },
              }
            : s
        );
        current.activeEpisode.telemetry.imagesGenerated += 1;
        current = await projectDb.saveProject(current);
      }

      await jobEngine.updateJob(job.id, {
        status: "succeeded",
        progress: 100,
        message: `Generated ${assetIds.length} scene frames.`,
        outputAssetIds: assetIds,
      });
      res.json({ project: current, outputAssetIds: assetIds, jobId: job.id });
    } catch (err) {
      const e = serializeError(err);
      await jobEngine.updateJob(job.id, {
        status: "failed",
        progress: 0,
        message: e.message,
        error: { stage: "scene_frames", message: e.message, traceback: e.traceback },
      });
      res.status(500).json({ error: e });
    }
  });

  // 8. Thumbnail Studio Endpoint (Integrated Tab)
  app.post("/api/projects/:id/thumbnails/generate", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    const profile = parseProfile(req.body?.outputProfile);
    const job = await jobEngine.createJob({
      projectId: project.id,
      episodeId: project.activeEpisode.id,
      type: "thumbnail_generation",
      phase: "Generating Thumbnail",
      message: `Generating ${profile} episode thumbnail...`,
    });

    try {
      await jobEngine.updateJob(job.id, { status: "running", progress: 35 });
      const thumb = await visualService.generateEpisodeThumbnail({
        project,
        episode: project.activeEpisode,
        outputProfile: profile,
        conceptTitle: String(req.body?.conceptTitle || "High-Stakes Cliffhanger"),
        headlineText: String(req.body?.headlineText || "WHO LIED FIRST?"),
        emotion: String(req.body?.emotion || "Shock / Betrayal"),
        focusCharacterId: req.body?.focusCharacterId,
        visualBrief: req.body?.visualBrief,
      });

      const latest = (await projectDb.getProject(project.id)) ?? project;
      latest.activeEpisode.thumbnailRenders[profile] = [
        thumb,
        ...latest.activeEpisode.thumbnailRenders[profile],
      ];
      latest.activeEpisode.telemetry.imagesGenerated += 1;
      const saved = await projectDb.saveProject(latest);

      await jobEngine.updateJob(job.id, {
        status: "succeeded",
        progress: 100,
        message: "Thumbnail generated.",
        outputAssetIds: [thumb.assetId],
      });
      res.json({ project: saved, thumbnail: thumb });
    } catch (err) {
      const e = serializeError(err);
      await jobEngine.updateJob(job.id, {
        status: "failed",
        progress: 0,
        message: e.message,
        error: { stage: "thumbnail_generation", message: e.message, traceback: e.traceback },
      });
      res.status(500).json({ error: e });
    }
  });

  // 9. Audio, ElevenLabs / Edge-TTS Voice Synthesis, Lyria BGM & SRT Captions (NO Google TTS)
  app.post("/api/projects/:id/audio/tts", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    const { sceneId, preferFallback, overrideVoiceId } = req.body ?? {};
    const targetScenes = sceneId
      ? project.activeEpisode.scenes.filter((s) => s.id === Number(sceneId))
      : project.activeEpisode.scenes;

    if (targetScenes.length === 0) {
      res.status(400).json({ error: { message: "No scenes found to synthesize." } });
      return;
    }

    const warnings: string[] = [];
    let charsUsed = 0;
    let current = project;

    for (const sc of targetScenes) {
      const synth = await voiceService.synthesizeSceneVoice({
        project: current,
        scene: sc,
        overrideVoiceId: typeof overrideVoiceId === "string" && overrideVoiceId ? overrideVoiceId : undefined,
        preferFallback: Boolean(preferFallback),
      });
      if (synth.warning && !warnings.includes(synth.warning)) {
        warnings.push(synth.warning);
      }
      charsUsed += synth.charsUsed;
      current.activeEpisode.scenes = current.activeEpisode.scenes.map((s) =>
        s.id === sc.id
          ? {
              ...s,
              audioAssetId: synth.audioAssetId ?? s.audioAssetId,
              audioProviderUsed: synth.providerUsed,
            }
          : s
      );
    }

    current.activeEpisode.telemetry.elevenlabsChars += charsUsed;
    const saved = await projectDb.saveProject(current);
    res.json({ project: saved, warnings, charsUsed });
  });

  app.post("/api/projects/:id/audio/bgm", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    const sceneId = Number(req.body?.sceneId || project.activeEpisode.scenes[0]?.id);
    const scene = project.activeEpisode.scenes.find((s) => s.id === sceneId);
    if (!scene) {
      res.status(404).json({ error: { message: "Target scene not found." } });
      return;
    }

    const pro = Boolean(req.body?.pro);
    const customPrompt = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;
    const targetScene = customPrompt ? { ...scene, lyriaBgmPrompt: customPrompt } : scene;

    const job = await jobEngine.createJob({
      projectId: project.id,
      episodeId: project.activeEpisode.id,
      type: "lyria_bgm",
      phase: "Synthesizing Lyria BGM",
      message: `Synthesizing scene-matched music via ${pro ? "lyria-3-pro-preview" : "lyria-3-clip-preview"}...`,
    });

    try {
      await jobEngine.updateJob(job.id, { status: "running", progress: 35 });
      const bgm = await voiceService.generateSceneBgm({ scene: targetScene, pro });
      const latest = (await projectDb.getProject(project.id)) ?? project;
      latest.activeEpisode.scenes = latest.activeEpisode.scenes.map((s) =>
        s.id === scene.id
          ? { ...s, lyriaBgmPrompt: targetScene.lyriaBgmPrompt, bgmAssetId: bgm.bgmAssetId }
          : s
      );
      if (!latest.activeEpisode.bgmConfig.masterBgmAssetId) {
        latest.activeEpisode.bgmConfig.masterBgmAssetId = bgm.bgmAssetId;
      }
      latest.activeEpisode.telemetry.lyriaClips += 1;
      const saved = await projectDb.saveProject(latest);
      await jobEngine.updateJob(job.id, {
        status: "succeeded",
        progress: 100,
        message: "Lyria BGM clip ready.",
        outputAssetIds: [bgm.bgmAssetId],
      });
      res.json({ project: saved, bgmAssetId: bgm.bgmAssetId, model: bgm.model });
    } catch (err) {
      const e = serializeError(err);
      await jobEngine.updateJob(job.id, {
        status: "failed",
        progress: 0,
        message: e.message,
        error: { stage: "lyria_bgm", message: e.message, traceback: e.traceback },
      });
      res.status(500).json({ error: e });
    }
  });

  app.post("/api/projects/:id/audio/srt", async (req, res) => {
    try {
      const project = await projectDb.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: { message: "Project not found." } });
        return;
      }
      const srt = await voiceService.buildSrtForEpisode(project.activeEpisode);
      project.activeEpisode.srtContent = srt.srtContent;
      project.activeEpisode.srtAssetId = srt.srtAssetId;
      const saved = await projectDb.saveProject(project);
      res.json({ project: saved, ...srt });
    } catch (err) {
      res.status(500).json({ error: serializeError(err) });
    }
  });

  // 10. Exports: Motion Prompts Sheet (.txt), Project Bundle (.zip), Python Creator Kit (.zip)
  app.get("/api/projects/:id/export/motion-prompts", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    const profile = parseProfile(req.query.profile);
    const txt = exportService.compileMotionPromptsTxt(project, project.activeEpisode, profile);
    const slug = `${project.slug}_${project.activeEpisode.episodeCode.toLowerCase().replace(/\s+/g, "_")}_motion_prompts.txt`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${slug}"`);
    res.send(txt);
  });

  app.get("/api/projects/:id/export/bundle", async (req, res) => {
    try {
      const project = await projectDb.getProject(req.params.id);
      if (!project) {
        res.status(404).json({ error: { message: "Project not found." } });
        return;
      }
      const profile = parseProfile(req.query.profile);
      const bundle = await exportService.buildProjectBundleZip(project, project.activeEpisode, profile);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${bundle.filename}"`);
      res.send(bundle.buffer);
    } catch (err) {
      res.status(500).json({ error: serializeError(err) });
    }
  });

  app.get("/api/kit/download", async (_req, res) => {
    try {
      const kit = await kitService.buildCreatorKitZip();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${kit.filename}"`);
      res.send(kit.buffer);
    } catch (err) {
      res.status(500).json({ error: serializeError(err) });
    }
  });

  // 11. Server-Side MP4 Render (3s preview or full master) & Multi-Episode Batch Queue
  app.post("/api/projects/:id/render", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }
    if (project.activeEpisode.scenes.length === 0) {
      res.status(400).json({ error: { message: "Draft or load episode scenes before rendering." } });
      return;
    }

    const targetsRaw = Array.isArray(req.body?.targets)
      ? req.body.targets
      : [parseProfile(req.body?.outputProfile || project.activeEpisode.activeProfile)];
    const targets: OutputProfile[] = targetsRaw.map((t: unknown) => OutputProfileSchema.parse(parseProfile(t)));
    const previewOnly = Boolean(req.body?.previewOnly);

    const job = await jobEngine.createJob({
      projectId: project.id,
      episodeId: project.activeEpisode.id,
      type: "video_render",
      phase: previewOnly ? "Rendering 3-Sec Preview" : "Rendering Final MP4",
      message: `Queued ${targets.join(" + ")} MP4 render...`,
    });

    res.json({ job });

    // Background execution pushed over SSE
    void (async () => {
      try {
        await jobEngine.updateJob(job.id, { status: "running", progress: 5 });
        const assetIds: string[] = [];
        const outputs: Record<string, string> = {};

        for (let idx = 0; idx < targets.length; idx++) {
          const targetProfile = targets[idx];
          const manifest = exportService.compileRenderManifest(
            project,
            project.activeEpisode,
            targetProfile
          );
          if (previewOnly) {
            manifest.scenes = manifest.scenes.slice(0, 1).map((s) => ({
              ...s,
              durationMs: Math.min(3000, s.durationMs),
            }));
          }
          const rendered = await exportService.renderMp4WithFfmpeg(manifest, (pct, msg) => {
            const overall = Math.round(((idx + pct / 100) / targets.length) * 100);
            void jobEngine.updateJob(job.id, {
              progress: overall,
              message: `[${targetProfile}] ${msg}`,
            });
          });
          assetIds.push(rendered.assetId);
          outputs[targetProfile] = rendered.assetId;
        }

        await jobEngine.updateJob(job.id, {
          status: "succeeded",
          progress: 100,
          message: `Completed ${targets.join(" + ")} render.`,
          outputAssetIds: assetIds,
          outputMeta: { outputs, previewOnly },
        });
      } catch (err) {
        const e = serializeError(err);
        await jobEngine.updateJob(job.id, {
          status: "failed",
          progress: 0,
          message: e.message,
          error: { stage: "video_render", message: e.message, traceback: e.traceback },
        });
      }
    })();
  });

  app.post("/api/projects/:id/batch", async (req, res) => {
    const project = await projectDb.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: { message: "Project not found." } });
      return;
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      res.status(400).json({ error: { message: "Provide at least 1 batch episode specification." } });
      return;
    }

    const batchJob = await jobEngine.createJob({
      projectId: project.id,
      type: "batch_render",
      phase: "Batch Episode Queue",
      message: `Queued ${items.length} batch episodes...`,
    });

    res.json({ batchJob });

    void (async () => {
      try {
        await jobEngine.updateJob(batchJob.id, { status: "running", progress: 5 });
        const zip = new JSZip();
        const batchResults: Array<{ episodeCode: string; status: string; assetId?: string; error?: string }> = [];

        for (let i = 0; i < items.length; i++) {
          const spec = items[i];
          const epCode = String(spec.episodeCode || `BATCH ${i + 1}`);
          const profile = parseProfile(spec.outputProfile);

          await jobEngine.updateJob(batchJob.id, {
            progress: Math.round((i / items.length) * 90 + 5),
            message: `Processing batch item ${i + 1}/${items.length}: ${epCode}...`,
          });

          try {
            const generated = await scriptService.generateScriptFromInput({
              project,
              chapterNumber: Number(spec.chapterNumber || project.activeEpisode.chapterNumber + i),
              episodeCode: epCode,
              chapterText: typeof spec.chapterText === "string" ? spec.chapterText : undefined,
              genre: String(spec.genre || project.seriesBible.genre),
              tone: String(spec.tone || "Urgent serialized drama"),
              targetDurationSeconds: Number(spec.duration || 30),
              focusArc: String(spec.focusArc || project.seriesBible.seasonScope),
              extraInstructions: typeof spec.extra === "string" ? spec.extra : undefined,
              outputProfile: profile,
            });

            const manifest = exportService.compileRenderManifest(project, generated.episode, profile);
            const mp4 = await exportService.renderMp4WithFfmpeg(manifest);
            const found = await assetStore.getBuffer(mp4.assetId);
            if (found) {
              zip.file(`${epCode.replace(/\s+/g, "_")}/${mp4.filename}`, found.buffer);
            }
            const motionTxt = exportService.compileMotionPromptsTxt(project, generated.episode, profile);
            zip.file(`${epCode.replace(/\s+/g, "_")}/motion_prompts.txt`, motionTxt);
            batchResults.push({ episodeCode: epCode, status: "succeeded", assetId: mp4.assetId });
          } catch (itemErr) {
            batchResults.push({
              episodeCode: epCode,
              status: "failed",
              error: itemErr instanceof Error ? itemErr.message : String(itemErr),
            });
          }
        }

        const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
        const zipRec = await assetStore.putBuffer({
          buffer: zipBuf,
          mimeType: "application/zip",
          extOverride: "zip",
          kind: "other",
          label: `Batch ${batchJob.id}`,
        });

        await jobEngine.updateJob(batchJob.id, {
          status: "succeeded",
          progress: 100,
          message: `Batch complete (${batchResults.filter((r) => r.status === "succeeded").length}/${items.length}).`,
          outputAssetIds: [zipRec.assetId],
          outputMeta: { results: batchResults, zipAssetId: zipRec.assetId },
        });
      } catch (err) {
        const e = serializeError(err);
        await jobEngine.updateJob(batchJob.id, {
          status: "failed",
          progress: 0,
          message: e.message,
          error: { stage: "batch_render", message: e.message, traceback: e.traceback },
        });
      }
    })();
  });

  // 12. Vite Dev Middleware / Static Prod Serving
  if (process.env.NODE_ENV === "production") {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => {
    console.log(`Passions Peak Studio listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// Keep os/fs referenced safely if used in temporary diagnostics
void fs;
void os;
