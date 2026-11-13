import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0" as const;

export const OutputProfileSchema = z.enum(["9x16", "16x9"]);
export type OutputProfile = z.infer<typeof OutputProfileSchema>;

export const BeatTypeSchema = z.enum([
  "hook",
  "orientation",
  "setup",
  "confrontation",
  "tension",
  "turn",
  "twist",
  "payoff",
  "climax",
  "cliffhanger",
]);
export type BeatType = z.infer<typeof BeatTypeSchema>;

export const CameraMoveSchema = z.enum([
  "static",
  "slow_zoom",
  "pan",
  "cut",
  "dolly_in",
  "rack_focus",
  "tracking",
]);
export type CameraMove = z.infer<typeof CameraMoveSchema>;

export const TransitionOutSchema = z.enum([
  "cut",
  "fade",
  "slide_left",
  "slide_up",
  "match_cut",
  "dissolve",
]);
export type TransitionOut = z.infer<typeof TransitionOutSchema>;

/**
 * Provider-aware voice casting profile.
 * Intentionally excludes Google TTS per studio cost architecture.
 */
export const VoiceProfileSchema = z.object({
  elevenlabsVoiceId: z.string().optional(),
  elevenlabsVoiceLabel: z.string().optional(),
  edgeTtsVoice: z.string().optional(),
  deliveryStyle: z.string().optional(),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  age: z.string().min(1),
  role: z.string().min(1),
  city: z.string().default("Chicago"),
  physicalDescription: z.string().min(1),
  goal: z.string().min(1),
  fear: z.string().default(""),
  secret: z.string().default(""),
  contradiction: z.string().default(""),
  moralBoundary: z.string().default(""),
  aliases: z.array(z.string()).default([]),
  wardrobeIds: z.array(z.string()).default(["day1"]),
  voiceProfile: VoiceProfileSchema.default({}),
  approvedRefAssetId: z.string().optional(),
  approvedRefVariants: z.record(z.string(), z.string()).default({}),
  registeredInChapter: z.string().optional(),
  bibleVersionAdded: z.number().int().min(1).default(1),
  isAdultConfirmed: z.boolean().default(true),
});
export type Character = z.infer<typeof CharacterSchema>;

export const LocationPlateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  city: z.string().min(1),
  description: z.string().min(1),
  lighting: z.string().default("Natural cinematic lighting"),
  colorGradeId: z.string().default("chicago"),
  approvedPlateAssetId: z.string().optional(),
});
export type LocationPlate = z.infer<typeof LocationPlateSchema>;

export const WKWEntrySchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  sceneId: z.number().int().optional(),
  characterId: z.string().min(1),
  factId: z.string().min(1),
  factSummary: z.string().min(1),
  knows: z.boolean(),
  revealedAt: z.string().min(1),
  createdAt: z.string().min(1),
});
export type WKWEntry = z.infer<typeof WKWEntrySchema>;

export const CompletedChapterSchema = z.object({
  id: z.string().min(1),
  chapterNumber: z.number().int().min(1),
  title: z.string().min(1),
  bibleVersionBefore: z.number().int().min(1),
  bibleVersionAfter: z.number().int().min(1),
  summary: z.string().min(1),
  newCanonFacts: z.array(z.string()).default([]),
  wkwAdded: z.array(WKWEntrySchema).default([]),
  completedAt: z.string().min(1),
});
export type CompletedChapter = z.infer<typeof CompletedChapterSchema>;

export const CanonVersionSchema = z.object({
  version: z.number().int().min(1),
  createdAt: z.string().min(1),
  sourceChapterId: z.string().optional(),
  summary: z.string().min(1),
  diff: z.object({
    addedFacts: z.array(z.string()).default([]),
    addedCharacters: z.array(z.string()).default([]),
    wkwEntriesCount: z.number().int().min(0).default(0),
  }),
});
export type CanonVersion = z.infer<typeof CanonVersionSchema>;

export const SeriesBibleSchema = z.object({
  title: z.string().min(1),
  genre: z.string().min(1),
  logline: z.string().min(1),
  emotionalPromise: z.string().min(1),
  centralQuestion: z.string().min(1),
  seasonScope: z.string().min(1),
  targetRuntimeSeconds: z.number().int().min(15).max(1800).default(75),
  storyEngineFormula: z.string().min(1),
  worldRules: z.array(z.string()).default([]),
  cityColorGrades: z.record(z.string(), z.string()).default({}),
  canonFacts: z.array(z.string()).default([]),
});
export type SeriesBible = z.infer<typeof SeriesBibleSchema>;

export const MotionPromptSchema = z.object({
  primaryMotion: z.string().min(1),
  cameraMovement: z.string().min(1),
  motionSpeed: z.string().min(1),
  secondaryMotion: z.string().min(1),
  startState: z.string().min(1),
  endState: z.string().min(1),
  transitionHint: z.string().min(1),
});
export type MotionPrompt = z.infer<typeof MotionPromptSchema>;

export const ContinuityPackSchema = z.object({
  characterRefs: z.array(
    z.object({
      characterId: z.string(),
      refAssetId: z.string().optional(),
      wardrobeId: z.string(),
    })
  ),
  locationPlateId: z.string().optional(),
  colorGradeId: z.string(),
  outputProfile: OutputProfileSchema,
  negativeConstraints: z.array(z.string()).default([
    "no embedded text or captions",
    "no watermarks",
    "no underage characters",
    "no mutated facial structure",
  ]),
});
export type ContinuityPack = z.infer<typeof ContinuityPackSchema>;

export const ProvenanceSchema = z.object({
  model: z.string(),
  promptHash: z.string(),
  continuityPackHash: z.string(),
  refAssetIds: z.array(z.string()),
  seed: z.number().optional(),
  createdAt: z.string(),
  costUnits: z.number().default(1),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const SceneRenderVariantSchema = z.object({
  frameAssetId: z.string().optional(),
  thumbnailAssetIds: z.array(z.string()).default([]),
  bgmAssetId: z.string().optional(),
  bgmPrompt: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
});
export type SceneRenderVariant = z.infer<typeof SceneRenderVariantSchema>;

export const SceneSchema = z.object({
  id: z.number().int().min(1),
  title: z.string().default(""),
  beat: BeatTypeSchema,
  durationSeconds: z.number().min(1).max(120),
  speaker: z.string().min(1),
  charactersPresent: z.array(z.string()).default([]),
  rawCharacterMentions: z.array(z.string()).default([]),
  locationId: z.string().optional(),
  wardrobeMap: z.record(z.string(), z.string()).default({}),
  narration: z.string().min(1),
  visualDirection: z.string().min(1),
  camera: CameraMoveSchema.default("slow_zoom"),
  transitionOut: TransitionOutSchema.default("cut"),
  cliffhangerLine: z.string().nullable().optional(),
  motionPrompt: MotionPromptSchema,
  lyriaBgmPrompt: z.string().min(1),
  renders: z
    .object({
      "9x16": SceneRenderVariantSchema.optional(),
      "16x9": SceneRenderVariantSchema.optional(),
    })
    .default({}),
  audioAssetId: z.string().optional(),
  audioProviderUsed: z.enum(["elevenlabs", "edge_tts", "uploaded", "browser_fallback"]).optional(),
  bgmAssetId: z.string().optional(),
  overlayAssetId: z.string().optional(),
  overlayConfig: z
    .object({
      xPct: z.number().min(0).max(100).default(56),
      yPct: z.number().min(0).max(100).default(6),
      widthPct: z.number().min(10).max(100).default(38),
      opacity: z.number().min(0).max(1).default(0.85),
    })
    .default({ xPct: 56, yPct: 6, widthPct: 38, opacity: 0.85 }),
  srtCueText: z.string().optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ThumbnailItemSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  outputProfile: OutputProfileSchema,
  conceptTitle: z.string(),
  headlineText: z.string(),
  emotion: z.string(),
  rationale: z.string(),
  createdAt: z.string(),
});
export type ThumbnailItem = z.infer<typeof ThumbnailItemSchema>;

export const EpisodeTelemetrySchema = z.object({
  textTokens: z.number().int().min(0).default(0),
  imagesGenerated: z.number().int().min(0).default(0),
  lyriaClips: z.number().int().min(0).default(0),
  elevenlabsChars: z.number().int().min(0).default(0),
});
export type EpisodeTelemetry = z.infer<typeof EpisodeTelemetrySchema>;

export const EpisodeSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  chapterNumber: z.number().int().min(1).default(1),
  title: z.string().default("Untitled Episode"),
  episodeCode: z.string().default("EP 01"),
  bibleVersion: z.number().int().min(1).default(1),
  renderTargets: z.array(OutputProfileSchema).default(["9x16"]),
  activeProfile: OutputProfileSchema.default("9x16"),
  hook: z.string().default(""),
  status: z.enum(["draft", "audited", "completed"]).default("draft"),
  sourceChapterText: z.string().default(""),
  scenes: z.array(SceneSchema).default([]),
  srtAssetId: z.string().optional(),
  srtContent: z.string().default(""),
  thumbnailRenders: z
    .object({
      "9x16": z.array(ThumbnailItemSchema).default([]),
      "16x9": z.array(ThumbnailItemSchema).default([]),
    })
    .default({ "9x16": [], "16x9": [] }),
  bgmConfig: z
    .object({
      masterBgmAssetId: z.string().optional(),
      volume: z.number().min(0).max(1).default(0.32),
      duckingDb: z.number().min(0).max(24).default(12),
    })
    .default({ volume: 0.32, duckingDb: 12 }),
  watermarkConfig: z
    .object({
      enabled: z.boolean().default(true),
      assetId: z.string().optional(),
      labelText: z.string().default("PASSIONS PEAK"),
      position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).default("top_right"),
      opacity: z.number().min(0).max(1).default(0.3),
      widthPct: z.number().min(8).max(40).default(20),
    })
    .default({
      enabled: true,
      labelText: "PASSIONS PEAK",
      position: "top_right",
      opacity: 0.3,
      widthPct: 20,
    }),
  captionStyle: z
    .object({
      enabled: z.boolean().default(true),
      fontSize: z.number().int().min(20).max(84).default(44),
      positionY: z.number().int().min(50).max(95).default(84),
      outlineWidth: z.number().int().min(0).max(8).default(3),
    })
    .default({ enabled: true, fontSize: 44, positionY: 84, outlineWidth: 3 }),
  renderConfig: z
    .object({
      fps: z.number().int().min(24).max(60).default(30),
      crf: z.number().int().min(12).max(28).default(18),
      transitionDurationSec: z.number().min(0).max(2).default(0.35),
    })
    .default({ fps: 30, crf: 18, transitionDurationSec: 0.35 }),
  telemetry: EpisodeTelemetrySchema.default({
    textTokens: 0,
    imagesGenerated: 0,
    lyriaClips: 0,
    elevenlabsChars: 0,
  }),
  updatedAt: z.string(),
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const UnresolvedCharacterSchema = z.object({
  mentionName: z.string().min(1),
  suggestedId: z.string().min(1),
  sceneIds: z.array(z.number().int()).default([]),
  contextExcerpt: z.string().default(""),
  candidateAssetIds: z.array(z.string()).default([]),
  status: z.enum(["pending", "resolved"]).default("pending"),
});
export type UnresolvedCharacter = z.infer<typeof UnresolvedCharacterSchema>;

export const AuditIssueSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  sceneId: z.number().int().optional(),
  category: z.string(),
  message: z.string(),
  suggestedFix: z.string(),
});
export type AuditIssue = z.infer<typeof AuditIssueSchema>;

export const CarryForwardDiffSchema = z.object({
  chapterNumber: z.number().int().min(1),
  chapterTitle: z.string(),
  summary: z.string(),
  proposedFacts: z.array(z.string()),
  proposedWkwEntries: z.array(
    z.object({
      characterId: z.string(),
      factId: z.string(),
      factSummary: z.string(),
      knows: z.boolean(),
      revealedAt: z.string(),
    })
  ),
});
export type CarryForwardDiff = z.infer<typeof CarryForwardDiffSchema>;

export const RenderManifestV1Schema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  projectId: z.string(),
  projectName: z.string(),
  episodeId: z.string(),
  title: z.string(),
  episodeCode: z.string(),
  bibleVersion: z.number().int().min(1),
  outputProfile: OutputProfileSchema,
  resolution: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  fps: z.number().int().min(24).max(60),
  crf: z.number().int().min(12).max(28),
  colorGrade: z.string(),
  scenes: z.array(
    z.object({
      id: z.number().int(),
      beat: BeatTypeSchema,
      durationMs: z.number().int().positive(),
      frameAssetId: z.string().optional(),
      audioAssetId: z.string().optional(),
      bgmAssetId: z.string().optional(),
      overlayAssetId: z.string().optional(),
      overlayConfig: z
        .object({
          xPct: z.number(),
          yPct: z.number(),
          widthPct: z.number(),
          opacity: z.number(),
        })
        .optional(),
      speaker: z.string(),
      narration: z.string(),
      captionText: z.string(),
      motionPrompt: MotionPromptSchema,
      lyriaBgmPrompt: z.string(),
      transitionOut: TransitionOutSchema,
    })
  ),
  srtAssetId: z.string().optional(),
  srtContent: z.string().default(""),
  thumbnails: z.array(
    z.object({
      assetId: z.string(),
      headlineText: z.string(),
    })
  ),
  watermarkConfig: EpisodeSchema.shape.watermarkConfig,
  captionStyle: EpisodeSchema.shape.captionStyle,
  bgmConfig: EpisodeSchema.shape.bgmConfig,
  createdAt: z.string(),
});
export type RenderManifestV1 = z.infer<typeof RenderManifestV1Schema>;

export const JobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  id: z.string(),
  parentJobId: z.string().optional(),
  projectId: z.string(),
  episodeId: z.string().optional(),
  type: z.enum([
    "script_generation",
    "character_candidates",
    "character_ref",
    "location_plate",
    "scene_frames",
    "thumbnail_generation",
    "voice_synthesis",
    "lyria_bgm",
    "video_render",
    "batch_render",
  ]),
  status: JobStatusSchema,
  progress: z.number().min(0).max(100),
  phase: z.string(),
  message: z.string(),
  idempotencyKey: z.string().optional(),
  outputAssetIds: z.array(z.string()).default([]),
  outputMeta: z.record(z.string(), z.unknown()).default({}),
  error: z
    .object({
      stage: z.string(),
      message: z.string(),
      traceback: z.string().optional(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Job = z.infer<typeof JobSchema>;

export const ProjectFolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
  bibleVersion: z.number().int().min(1).default(1),
  seriesBible: SeriesBibleSchema,
  canonVersions: z.array(CanonVersionSchema).default([]),
  characters: z.array(CharacterSchema).default([]),
  locations: z.array(LocationPlateSchema).default([]),
  wkwLedger: z.array(WKWEntrySchema).default([]),
  completedChapters: z.array(CompletedChapterSchema).default([]),
  activeEpisode: EpisodeSchema,
  episodeArchive: z.array(EpisodeSchema).default([]),
  unresolvedCharacters: z.array(UnresolvedCharacterSchema).default([]),
});
export type ProjectFolder = z.infer<typeof ProjectFolderSchema>;
