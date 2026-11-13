import type { Episode, ProjectFolder, Scene } from "../../src/contracts/schemas.ts";
import { assetStore } from "../assetStore.ts";
import { elevenlabsAdapter } from "../adapters/elevenlabsAdapter.ts";
import { geminiAdapter } from "../adapters/geminiAdapter.ts";
import { characterRegistry } from "./characterRegistry.ts";

function formatSrtTime(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const ms = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(
    ms
  ).padStart(3, "0")}`;
}

export const voiceService = {
  resolveVoiceForScene(project: ProjectFolder, scene: Scene): {
    elevenlabsVoiceId: string;
    edgeTtsVoice: string;
    characterName: string;
  } {
    const matched = characterRegistry.resolveMention(project.characters, scene.speaker);
    if (matched) {
      return {
        elevenlabsVoiceId:
          matched.voiceProfile?.elevenlabsVoiceId ||
          process.env.ELEVENLABS_VOICE_ID ||
          "21m00Tcm4TlvDq8ikWAM",
        edgeTtsVoice: matched.voiceProfile?.edgeTtsVoice || "en-US-AriaNeural",
        characterName: matched.name,
      };
    }
    return {
      elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
      edgeTtsVoice: process.env.EDGE_TTS_VOICE || "en-US-AriaNeural",
      characterName: scene.speaker || "Narrator",
    };
  },

  async synthesizeSceneVoice(params: {
    project: ProjectFolder;
    scene: Scene;
    overrideVoiceId?: string;
    preferFallback?: boolean;
  }): Promise<{
    audioAssetId?: string;
    providerUsed: "elevenlabs" | "browser_fallback";
    charsUsed: number;
    warning?: string;
  }> {
    const resolved = this.resolveVoiceForScene(params.project, params.scene);
    const voiceId = params.overrideVoiceId || resolved.elevenlabsVoiceId;

    if (!params.preferFallback) {
      const elResult = await elevenlabsAdapter.synthesize({
        text: params.scene.narration,
        voiceId,
      });

      if (elResult.ok) {
        const rec = await assetStore.putBuffer({
          buffer: elResult.audioBuffer,
          mimeType: elResult.mimeType,
          kind: "voiceover",
          label: `Scene ${params.scene.id} VO (${resolved.characterName})`,
          meta: {
            sceneId: params.scene.id,
            provider: "elevenlabs",
            voiceId: elResult.voiceId,
          },
        });
        return {
          audioAssetId: rec.assetId,
          providerUsed: "elevenlabs",
          charsUsed: elResult.charsUsed,
        };
      }

      return {
        providerUsed: "browser_fallback",
        charsUsed: 0,
        warning: `${elResult.message} (Edge-TTS voice '${resolved.edgeTtsVoice}' is mapped for the Python Creator Kit; browser speech synthesis preview active in studio.)`,
      };
    }

    return {
      providerUsed: "browser_fallback",
      charsUsed: 0,
      warning: `Browser preview / Edge-TTS (${resolved.edgeTtsVoice}) selected.`,
    };
  },

  async generateSceneBgm(params: {
    scene: Scene;
    pro?: boolean;
  }): Promise<{ bgmAssetId: string; model: string }> {
    const lyriaResult = await geminiAdapter.generateLyriaMusic({
      prompt: params.scene.lyriaBgmPrompt,
      pro: params.pro,
    });

    const rec = await assetStore.putBuffer({
      buffer: lyriaResult.audioBuffer,
      mimeType: lyriaResult.mimeType,
      kind: "bgm",
      label: `Scene ${params.scene.id} Lyria BGM`,
      meta: {
        sceneId: params.scene.id,
        model: lyriaResult.model,
        prompt: params.scene.lyriaBgmPrompt,
      },
    });

    return {
      bgmAssetId: rec.assetId,
      model: lyriaResult.model,
    };
  },

  async buildSrtForEpisode(episode: Episode): Promise<{ srtContent: string; srtAssetId: string }> {
    let cursor = 0;
    const blocks: string[] = [];

    episode.scenes.forEach((scene, index) => {
      const start = cursor;
      const end = cursor + scene.durationSeconds;
      cursor = end;
      const text = (scene.srtCueText || scene.narration).trim();
      blocks.push(`${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}`);
    });

    const srtContent = blocks.join("\n\n") + "\n";
    const rec = await assetStore.putBuffer({
      buffer: Buffer.from(srtContent, "utf-8"),
      mimeType: "text/plain",
      extOverride: "srt",
      kind: "srt",
      label: `${episode.episodeCode} Captions`,
    });

    return { srtContent, srtAssetId: rec.assetId };
  },
};
