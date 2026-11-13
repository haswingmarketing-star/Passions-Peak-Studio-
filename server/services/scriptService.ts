import { z } from "zod";
import {
  BeatTypeSchema,
  CameraMoveSchema,
  type Episode,
  MotionPromptSchema,
  type OutputProfile,
  type ProjectFolder,
  type Scene,
  TransitionOutSchema,
} from "../../src/contracts/schemas.ts";
import { geminiAdapter } from "../adapters/geminiAdapter.ts";
import { characterRegistry } from "./characterRegistry.ts";

const RawSceneSchema = z.object({
  id: z.number().int().min(1),
  title: z.string().default(""),
  beat: BeatTypeSchema.catch("tension"),
  durationSeconds: z.number().min(2).max(90).default(6),
  speaker: z.string().min(1),
  rawCharacterMentions: z.array(z.string()).default([]),
  locationId: z.string().optional(),
  narration: z.string().min(1),
  visualDirection: z.string().min(1),
  camera: CameraMoveSchema.catch("slow_zoom"),
  transitionOut: TransitionOutSchema.catch("cut"),
  cliffhangerLine: z.string().nullable().optional(),
  motionPrompt: MotionPromptSchema,
  lyriaBgmPrompt: z.string().min(1),
});

const GeneratedScriptPayloadSchema = z.object({
  title: z.string().min(1),
  durationSeconds: z.number().int().min(10),
  hook: z.string().min(1),
  scenes: z.array(RawSceneSchema).min(1),
});

export const scriptService = {
  async generateScriptFromInput(params: {
    project: ProjectFolder;
    chapterNumber: number;
    episodeCode: string;
    chapterText?: string;
    genre: string;
    tone: string;
    targetDurationSeconds: number;
    focusArc: string;
    extraInstructions?: string;
    outputProfile: OutputProfile;
  }): Promise<{
    episode: Episode;
    unresolvedCharacters: ProjectFolder["unresolvedCharacters"];
    tokensUsed: number;
  }> {
    const { project } = params;
    const isVertical = params.outputProfile === "9x16";

    const systemInstruction = `You are a micro-drama screenwriter and visual director adapting serialized fiction for ${
      isVertical ? "vertical 9:16 short-form video (TikTok, Reels, Shorts)" : "widescreen 16:9 YouTube episodic drama"
    }.

Produce a strict JSON script matching this exact schema:
{
  "title": string,
  "durationSeconds": number,
  "hook": string,
  "scenes": [
    {
      "id": number (1..N),
      "title": string,
      "beat": "hook" | "orientation" | "setup" | "confrontation" | "tension" | "turn" | "twist" | "payoff" | "climax" | "cliffhanger",
      "durationSeconds": number (3-15s),
      "speaker": string (character name or "Narrator"),
      "rawCharacterMentions": string[] (ALL named characters visible or speaking in this scene),
      "locationId": string (prefer one of the project's locked location IDs if matching),
      "narration": string (dialogue/VO line, <= 22 words per beat for crisp vertical pacing),
      "visualDirection": string (concrete 1-2 sentence image prompt: adult subject, setting, lighting, mood, ${
        isVertical ? "9:16 vertical composition" : "16:9 cinematic widescreen"
      }; NO embedded text or captions),
      "camera": "static" | "slow_zoom" | "pan" | "cut" | "dolly_in" | "rack_focus" | "tracking",
      "transitionOut": "cut" | "fade" | "slide_left" | "slide_up" | "match_cut" | "dissolve",
      "cliffhangerLine": string | null (only on final scene),
      "motionPrompt": {
        "primaryMotion": string,
        "cameraMovement": string,
        "motionSpeed": string,
        "secondaryMotion": string,
        "startState": string,
        "endState": string,
        "transitionHint": string
      },
      "lyriaBgmPrompt": string (specific instrumental/tempo/mood prompt for Lyria music generation matching this exact scene's energy and city color grade)
    }
  ]
}

CRITICAL RULES:
- Total scene durations must sum within ±4s of targetDurationSeconds (${params.targetDurationSeconds}s).
- Open with immediate conflict/pressure (0-3s hook), NEVER greetings or slow introductions.
- Preserve Series Bible canon, prior completed chapters, and the Who-Knows-What (WKW) ledger strictly.
- All depicted characters must be clearly adults.
- Include accurate rawCharacterMentions[] for every person in each scene so the Character Registry can verify them.`;

    const contextPayload = {
      seriesBible: project.seriesBible,
      bibleVersion: project.bibleVersion,
      registeredCharacters: project.characters.map((c) => ({
        id: c.id,
        name: c.name,
        aliases: c.aliases,
        role: c.role,
        goal: c.goal,
        secret: c.secret,
      })),
      lockedLocations: project.locations.map((l) => ({
        id: l.id,
        name: l.name,
        city: l.city,
        description: l.description,
      })),
      wkwLedger: project.wkwLedger,
      priorCompletedChapters: project.completedChapters.map((c) => ({
        chapterNumber: c.chapterNumber,
        title: c.title,
        summary: c.summary,
        newCanonFacts: c.newCanonFacts,
      })),
      request: {
        chapterNumber: params.chapterNumber,
        episodeCode: params.episodeCode,
        focusArc: params.focusArc,
        genre: params.genre,
        tone: params.tone,
        targetDurationSeconds: params.targetDurationSeconds,
        extraInstructions: params.extraInstructions ?? "",
        chapterSourceText: params.chapterText?.slice(0, 28000) ?? "",
      },
    };

    const result = await geminiAdapter.generateJson({
      systemInstruction,
      prompt: JSON.stringify(contextPayload),
      validate: (raw) => GeneratedScriptPayloadSchema.parse(raw),
    });

    const scenes: Scene[] = result.data.scenes.map((s) => ({
      id: s.id,
      title: s.title || `Scene ${s.id}`,
      beat: s.beat,
      durationSeconds: s.durationSeconds,
      speaker: s.speaker,
      charactersPresent: [],
      rawCharacterMentions: s.rawCharacterMentions,
      locationId: s.locationId,
      wardrobeMap: {},
      narration: s.narration,
      visualDirection: s.visualDirection,
      camera: s.camera,
      transitionOut: s.transitionOut,
      cliffhangerLine: s.cliffhangerLine ?? null,
      motionPrompt: s.motionPrompt,
      lyriaBgmPrompt: s.lyriaBgmPrompt,
      renders: {},
      overlayConfig: { xPct: 56, yPct: 6, widthPct: 38, opacity: 0.85 },
      srtCueText: `${s.speaker !== "Narrator" ? `${s.speaker.toUpperCase()}: ` : ""}${s.narration}`,
    }));

    const { resolvedScenes, unresolvedCharacters } = characterRegistry.resolveCharactersInScenes(
      project,
      scenes
    );

    const episode: Episode = {
      ...project.activeEpisode,
      chapterNumber: params.chapterNumber,
      title: result.data.title,
      episodeCode: params.episodeCode,
      bibleVersion: project.bibleVersion,
      activeProfile: params.outputProfile,
      renderTargets: project.activeEpisode.renderTargets.includes(params.outputProfile)
        ? project.activeEpisode.renderTargets
        : [...project.activeEpisode.renderTargets, params.outputProfile],
      hook: result.data.hook,
      status: "draft",
      sourceChapterText: params.chapterText ?? project.activeEpisode.sourceChapterText,
      scenes: resolvedScenes,
      telemetry: {
        ...project.activeEpisode.telemetry,
        textTokens: project.activeEpisode.telemetry.textTokens + result.totalTokens,
      },
      updatedAt: new Date().toISOString(),
    };

    return {
      episode,
      unresolvedCharacters,
      tokensUsed: result.totalTokens,
    };
  },

  async regenerateScene(params: {
    project: ProjectFolder;
    episode: Episode;
    sceneId: number;
    instruction?: string;
  }): Promise<{ scene: Scene; tokensUsed: number }> {
    const target = params.episode.scenes.find((s) => s.id === params.sceneId);
    if (!target) throw new Error(`Scene ${params.sceneId} not found.`);

    const sys = `You are revising a single scene in a micro-drama episode script while preserving continuity with surrounding scenes and the Series Bible.
Return JSON strictly matching a single Scene object:
{
  "id": ${target.id},
  "title": string,
  "beat": "hook" | "orientation" | "setup" | "confrontation" | "tension" | "turn" | "twist" | "payoff" | "climax" | "cliffhanger",
  "durationSeconds": number,
  "speaker": string,
  "rawCharacterMentions": string[],
  "locationId": string | null,
  "narration": string,
  "visualDirection": string,
  "camera": "static" | "slow_zoom" | "pan" | "cut" | "dolly_in" | "rack_focus" | "tracking",
  "transitionOut": "cut" | "fade" | "slide_left" | "slide_up" | "match_cut" | "dissolve",
  "cliffhangerLine": string | null,
  "motionPrompt": {
    "primaryMotion": string,
    "cameraMovement": string,
    "motionSpeed": string,
    "secondaryMotion": string,
    "startState": string,
    "endState": string,
    "transitionHint": string
  },
  "lyriaBgmPrompt": string
}`;

    const res = await geminiAdapter.generateJson({
      systemInstruction: sys,
      prompt: JSON.stringify({
        seriesBible: params.project.seriesBible,
        characters: params.project.characters.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases })),
        surroundingScenes: params.episode.scenes.map((s) => ({
          id: s.id,
          beat: s.beat,
          narration: s.narration,
        })),
        targetScene: target,
        revisionInstruction: params.instruction || "Sharpen dramatic tension, subtext, and visual specificity.",
      }),
      validate: (raw) => RawSceneSchema.parse(raw),
    });

    const updatedScene: Scene = {
      ...target,
      title: res.data.title || target.title,
      beat: res.data.beat,
      durationSeconds: res.data.durationSeconds,
      speaker: res.data.speaker,
      rawCharacterMentions: res.data.rawCharacterMentions,
      locationId: res.data.locationId ?? target.locationId,
      narration: res.data.narration,
      visualDirection: res.data.visualDirection,
      camera: res.data.camera,
      transitionOut: res.data.transitionOut,
      cliffhangerLine: res.data.cliffhangerLine ?? null,
      motionPrompt: res.data.motionPrompt,
      lyriaBgmPrompt: res.data.lyriaBgmPrompt,
      srtCueText: `${res.data.speaker !== "Narrator" ? `${res.data.speaker.toUpperCase()}: ` : ""}${res.data.narration}`,
    };

    const { resolvedScenes } = characterRegistry.resolveCharactersInScenes(params.project, [updatedScene]);
    return { scene: resolvedScenes[0], tokensUsed: res.totalTokens };
  },
};
