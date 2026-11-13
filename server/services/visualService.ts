import crypto from "node:crypto";
import type {
  ContinuityPack,
  Episode,
  LocationPlate,
  OutputProfile,
  ProjectFolder,
  Provenance,
  Scene,
  ThumbnailItem,
} from "../../src/contracts/schemas.ts";
import { assetStore } from "../assetStore.ts";
import { geminiAdapter } from "../adapters/geminiAdapter.ts";
import { characterRegistry } from "./characterRegistry.ts";

function sha256Short(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export interface ContinuityGateReport {
  blocked: boolean;
  unresolvedCharacters: ProjectFolder["unresolvedCharacters"];
  missingCharacterRefs: Array<{ characterId: string; name: string; sceneIds: number[] }>;
}

export const visualService = {
  checkContinuityGate(project: ProjectFolder, targetSceneIds?: number[]): ContinuityGateReport {
    const relevantScenes = targetSceneIds
      ? project.activeEpisode.scenes.filter((s) => targetSceneIds.includes(s.id))
      : project.activeEpisode.scenes;

    const relevantIds = new Set(relevantScenes.map((s) => s.id));
    const unresolved = project.unresolvedCharacters.filter((u) =>
      u.sceneIds.some((sid) => relevantIds.has(sid))
    );

    const missingMap = new Map<string, { characterId: string; name: string; sceneIds: number[] }>();
    for (const scene of relevantScenes) {
      for (const charId of scene.charactersPresent) {
        const ch = project.characters.find((c) => c.id === charId);
        if (ch && !ch.approvedRefAssetId) {
          const existing = missingMap.get(ch.id);
          if (existing) {
            if (!existing.sceneIds.includes(scene.id)) existing.sceneIds.push(scene.id);
          } else {
            missingMap.set(ch.id, { characterId: ch.id, name: ch.name, sceneIds: [scene.id] });
          }
        }
      }
    }

    const missingCharacterRefs = Array.from(missingMap.values());
    return {
      blocked: unresolved.length > 0 || missingCharacterRefs.length > 0,
      unresolvedCharacters: unresolved,
      missingCharacterRefs,
    };
  },

  buildContinuityPack(
    project: ProjectFolder,
    scene: Scene,
    outputProfile: OutputProfile
  ): ContinuityPack {
    const location = project.locations.find((l) => l.id === scene.locationId);
    const colorGradeId = location?.colorGradeId ?? "chicago";

    return {
      characterRefs: scene.charactersPresent.map((charId) => {
        const ch = project.characters.find((c) => c.id === charId);
        const wardrobeId = scene.wardrobeMap?.[charId] ?? ch?.wardrobeIds[0] ?? "day1";
        return {
          characterId: charId,
          refAssetId: ch?.approvedRefVariants?.[wardrobeId] ?? ch?.approvedRefAssetId,
          wardrobeId,
        };
      }),
      locationPlateId: location?.approvedPlateAssetId,
      colorGradeId,
      outputProfile,
      negativeConstraints: [
        "no embedded text or captions",
        "no watermarks or platform UI logos",
        "all depicted people must be clearly adults",
        "preserve exact facial identity and wardrobe continuity from attached references",
      ],
    };
  },

  async generateLocationPlate(params: {
    project: ProjectFolder;
    location: LocationPlate;
    outputProfile: OutputProfile;
  }): Promise<{ assetId: string; model: string }> {
    const colorGrade =
      params.project.seriesBible.cityColorGrades[params.location.colorGradeId] ??
      "35mm cinematic film look, balanced natural shadows";
    const aspectRatio = params.outputProfile === "16x9" ? "16:9" : "9:16";

    const prompt = [
      `Create a wide establishing location reference plate for "${params.location.name}" in ${params.location.city} for the series "${params.project.seriesBible.title}".`,
      `Setting details: ${params.location.description}`,
      `Lighting & atmosphere: ${params.location.lighting}`,
      `Color grading: ${colorGrade}`,
      `Composition: Empty architectural/interior plate with clear spatial layout, zero people, photorealistic 35mm cinema still, no text or signage clutter.`,
    ].join("\n");

    const img = await geminiAdapter.generateImage({ prompt, aspectRatio });
    const rec = await assetStore.putBase64({
      base64Data: img.base64Data,
      mimeType: img.mimeType,
      kind: "location_plate",
      label: `${params.location.name} (${params.outputProfile})`,
      meta: {
        locationId: params.location.id,
        outputProfile: params.outputProfile,
        model: img.model,
      },
    });
    return { assetId: rec.assetId, model: img.model };
  },

  async generateSceneFrame(params: {
    project: ProjectFolder;
    scene: Scene;
    outputProfile: OutputProfile;
  }): Promise<{
    frameAssetId: string;
    provenance: Provenance;
    continuityPackHash: string;
  }> {
    const gate = this.checkContinuityGate(params.project, [params.scene.id]);
    if (gate.blocked) {
      throw new Error(
        `CONTINUITY_GATE_BLOCKED: Resolve unregistered/unapproved characters before generating Scene ${params.scene.id}.`
      );
    }

    const pack = this.buildContinuityPack(params.project, params.scene, params.outputProfile);
    const packHash = sha256Short(JSON.stringify(pack));
    const colorGradeDesc =
      params.project.seriesBible.cityColorGrades[pack.colorGradeId] ??
      "35mm cinematic moody lighting";

    // Gather multimodal reference images from AssetStore
    const referenceImages: Array<{ mimeType: string; data: string; label?: string }> = [];
    const refAssetIds: string[] = [];
    const charSpecLines: string[] = [];

    for (const cref of pack.characterRefs) {
      const ch = params.project.characters.find((c) => c.id === cref.characterId);
      if (!ch) continue;
      characterRegistry.enforceAdultPolicy(ch.physicalDescription);
      charSpecLines.push(
        `- ${ch.name} (${ch.age}, wardrobe ${cref.wardrobeId}): ${ch.physicalDescription}`
      );
      if (cref.refAssetId) {
        const b64 = await assetStore.getBase64(cref.refAssetId);
        if (b64) {
          referenceImages.push({ ...b64, label: ch.name });
          refAssetIds.push(cref.refAssetId);
        }
      }
    }

    if (pack.locationPlateId) {
      const locB64 = await assetStore.getBase64(pack.locationPlateId);
      if (locB64) {
        referenceImages.push({ ...locB64, label: "location" });
        refAssetIds.push(pack.locationPlateId);
      }
    }

    const aspectRatio = params.outputProfile === "16x9" ? "16:9" : "9:16";
    const prompt = [
      `Use the attached character reference portrait(s) and location plate to preserve exact facial identity, hair, wardrobe, and room layout.`,
      `SHOT (${params.outputProfile === "9x16" ? "9:16 vertical phone-first framing" : "16:9 cinematic widescreen"}):`,
      params.scene.visualDirection,
      charSpecLines.length > 0 ? `CHARACTER CONTINUITY:\n${charSpecLines.join("\n")}` : "",
      `COLOR GRADE & MOOD: ${colorGradeDesc}`,
      `CAMERA: ${params.scene.camera}.`,
      `CONSTRAINTS: ${pack.negativeConstraints.join("; ")}.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const promptHash = sha256Short(prompt);
    const img = await geminiAdapter.generateImage({
      prompt,
      aspectRatio,
      referenceImages,
    });

    const rec = await assetStore.putBase64({
      base64Data: img.base64Data,
      mimeType: img.mimeType,
      kind: "scene_frame",
      label: `Scene ${params.scene.id} (${params.outputProfile})`,
      meta: {
        sceneId: params.scene.id,
        outputProfile: params.outputProfile,
        promptHash,
        continuityPackHash: packHash,
        refAssetIds,
      },
    });

    const provenance: Provenance = {
      model: img.model,
      promptHash,
      continuityPackHash: packHash,
      refAssetIds,
      createdAt: new Date().toISOString(),
      costUnits: 1,
    };

    return {
      frameAssetId: rec.assetId,
      provenance,
      continuityPackHash: packHash,
    };
  },

  async generateEpisodeThumbnail(params: {
    project: ProjectFolder;
    episode: Episode;
    outputProfile: OutputProfile;
    conceptTitle: string;
    headlineText: string;
    emotion: string;
    focusCharacterId?: string;
    visualBrief?: string;
  }): Promise<ThumbnailItem> {
    const aspectRatio = params.outputProfile === "16x9" ? "16:9" : "9:16";
    const referenceImages: Array<{ mimeType: string; data: string }> = [];

    const targetChar =
      params.project.characters.find((c) => c.id === params.focusCharacterId) ??
      params.project.characters.find((c) => Boolean(c.approvedRefAssetId));

    if (targetChar?.approvedRefAssetId) {
      const b64 = await assetStore.getBase64(targetChar.approvedRefAssetId);
      if (b64) referenceImages.push(b64);
    }

    const prompt = [
      `Create a high-impact, cinematic episode thumbnail / cover image for "${params.project.seriesBible.title}" (${params.episode.episodeCode}: "${params.episode.title || "New Episode"}").`,
      targetChar
        ? `Keep exact facial identity of ${targetChar.name} from the attached character reference (${targetChar.physicalDescription}).`
        : "",
      `Visual Concept: ${params.visualBrief || params.episode.hook || params.project.seriesBible.logline}`,
      `Dominant Emotion: ${params.emotion}.`,
      `Framing: ${
        params.outputProfile === "9x16"
          ? "9:16 vertical short-form cover composition with clean breathing room in upper/lower safe zones."
          : "16:9 YouTube CTR composition, dramatic half-shadow half-warm lighting, shallow depth of field, clear focal face."
      }`,
      `Strict rule: Do NOT render embedded text, captions, or logos inside the generated image (the studio overlays typography cleanly). All characters must be clearly adults.`,
    ]
      .filter(Boolean)
      .join("\n");

    const img = await geminiAdapter.generateImage({
      prompt,
      aspectRatio,
      referenceImages,
    });

    const rec = await assetStore.putBase64({
      base64Data: img.base64Data,
      mimeType: img.mimeType,
      kind: "thumbnail",
      label: `${params.episode.episodeCode} Thumbnail (${params.outputProfile})`,
      meta: {
        outputProfile: params.outputProfile,
        conceptTitle: params.conceptTitle,
        headlineText: params.headlineText,
      },
    });

    return {
      id: `thumb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      assetId: rec.assetId,
      outputProfile: params.outputProfile,
      conceptTitle: params.conceptTitle,
      headlineText: params.headlineText,
      emotion: params.emotion,
      rationale:
        params.outputProfile === "16x9"
          ? "High-contrast focal expression designed for YouTube CTR clarity."
          : "Vertical 9:16 feed-stopping portrait framing avoiding platform UI edges.",
      createdAt: new Date().toISOString(),
    };
  },
};
