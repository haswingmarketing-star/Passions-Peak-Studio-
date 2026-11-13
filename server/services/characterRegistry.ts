import type {
  Character,
  OutputProfile,
  ProjectFolder,
  Scene,
  UnresolvedCharacter,
} from "../../src/contracts/schemas.ts";
import { assetStore } from "../assetStore.ts";
import { geminiAdapter } from "../adapters/geminiAdapter.ts";

const UNDERAGE_BLOCK_TERMS = [
  "child",
  "toddler",
  "minor",
  "kid ",
  "elementary school",
  "middle school",
  "high school freshman",
  "teenager",
  "underage",
  "preteen",
];

function slugifyId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || `char_${Date.now()}`
  );
}

export const characterRegistry = {
  enforceAdultPolicy(description: string): void {
    const lower = description.toLowerCase();
    for (const term of UNDERAGE_BLOCK_TERMS) {
      if (lower.includes(term)) {
        throw new Error(
          `Character policy violation: all depicted characters must be clearly adults (matched restricted term '${term.trim()}').`
        );
      }
    }
  },

  resolveMention(characters: Character[], rawName: string): Character | null {
    const norm = rawName.trim().toLowerCase();
    if (!norm || norm === "narrator" || norm === "v.o." || norm === "voiceover" || norm === "none") {
      return null;
    }
    for (const ch of characters) {
      if (ch.id.toLowerCase() === norm || ch.name.toLowerCase() === norm) {
        return ch;
      }
      if (ch.aliases.some((a) => a.trim().toLowerCase() === norm)) {
        return ch;
      }
    }
    // Partial first-name / token match fallback if unambiguous
    const matches = characters.filter((ch) => {
      const first = ch.name.toLowerCase().split(/\s+/)[0];
      return first === norm || ch.aliases.some((a) => a.toLowerCase().split(/\s+/)[0] === norm);
    });
    return matches.length === 1 ? matches[0] : null;
  },

  resolveCharactersInScenes(
    project: ProjectFolder,
    scenes: Scene[]
  ): {
    resolvedScenes: Scene[];
    unresolvedCharacters: UnresolvedCharacter[];
  } {
    const unresolvedMap = new Map<string, UnresolvedCharacter>();
    const existingPending = new Map<string, UnresolvedCharacter>();
    for (const u of project.unresolvedCharacters) {
      existingPending.set(u.mentionName.toLowerCase(), u);
    }

    const resolvedScenes = scenes.map((scene) => {
      const mentions = new Set<string>();
      if (scene.speaker && scene.speaker.trim()) {
        mentions.add(scene.speaker.trim());
      }
      for (const m of scene.rawCharacterMentions ?? []) {
        if (m && m.trim()) mentions.add(m.trim());
      }

      const presentIds = new Set<string>();
      for (const mention of mentions) {
        const lower = mention.toLowerCase();
        if (lower === "narrator" || lower === "voiceover" || lower === "off-screen" || lower === "none") {
          continue;
        }
        const matched = this.resolveMention(project.characters, mention);
        if (matched) {
          presentIds.add(matched.id);
        } else {
          const prev = existingPending.get(lower);
          const current = unresolvedMap.get(lower);
          if (current) {
            if (!current.sceneIds.includes(scene.id)) current.sceneIds.push(scene.id);
          } else {
            unresolvedMap.set(lower, {
              mentionName: mention,
              suggestedId: slugifyId(mention),
              sceneIds: [scene.id],
              contextExcerpt: `${scene.title || `Scene ${scene.id}`}: ${scene.visualDirection} — "${scene.narration}"`,
              candidateAssetIds: prev?.candidateAssetIds ?? [],
              status: "pending",
            });
          }
        }
      }

      return {
        ...scene,
        charactersPresent: Array.from(presentIds),
      };
    });

    return {
      resolvedScenes,
      unresolvedCharacters: Array.from(unresolvedMap.values()),
    };
  },

  async generateCharacterReferenceSheet(params: {
    character: Character;
    wardrobeId?: string;
    outputProfile: OutputProfile;
    seriesTitle: string;
  }): Promise<{ assetId: string; model: string }> {
    this.enforceAdultPolicy(params.character.physicalDescription);

    const aspectRatio = params.outputProfile === "16x9" ? "16:9" : "9:16";
    const prompt = [
      `Create a clean, reusable neutral character reference portrait for ${params.character.name.toUpperCase()}, an adult fictional character (${params.character.age} years old) in the drama series "${params.seriesTitle}".`,
      `Appearance: ${params.character.physicalDescription}.`,
      `Wardrobe ID (${params.wardrobeId ?? params.character.wardrobeIds[0] ?? "day1"}): consistent, crisp everyday or scene attire matching description.`,
      `Composition: Chest-up or three-quarter portrait, neutral calm expression, even natural studio lighting, simple uncluttered neutral slate backdrop, sharp focus on face and hair.`,
      `Strict rules: Clearly an adult character. No embedded text, no watermarks, no captions, no extra people.`,
    ].join("\n");

    const img = await geminiAdapter.generateImage({
      prompt,
      aspectRatio,
    });

    const record = await assetStore.putBase64({
      base64Data: img.base64Data,
      mimeType: img.mimeType,
      kind: "character_ref",
      label: `${params.character.name} (${params.wardrobeId ?? "master"})`,
      meta: {
        characterId: params.character.id,
        wardrobeId: params.wardrobeId ?? params.character.wardrobeIds[0] ?? "day1",
        outputProfile: params.outputProfile,
        model: img.model,
      },
    });

    return { assetId: record.assetId, model: img.model };
  },

  async generateCandidatePortraits(params: {
    mentionName: string;
    contextExcerpt: string;
    seriesTitle: string;
    cityContext: string;
    outputProfile?: OutputProfile;
  }): Promise<string[]> {
    this.enforceAdultPolicy(params.contextExcerpt);

    const archetypeVariations = [
      "Option A — Poised, understated realistic adult look with tailored contemporary wardrobe and calm guarded expression",
      "Option B — Bold, charismatic adult presence with sharp grooming, expressive eyes, and stylish urban wardrobe",
      "Option C — Grounded, warm everyday adult look with natural texture, relaxed posture, and approachable expression",
    ];

    const aspectRatio = params.outputProfile === "16x9" ? "16:9" : "9:16";
    const assetIds: string[] = [];

    for (let i = 0; i < archetypeVariations.length; i++) {
      const prompt = [
        `Create a neutral character reference portrait for a NEW adult character named "${params.mentionName}" in the serialized drama "${params.seriesTitle}" (${params.cityContext}).`,
        `Story context: ${params.contextExcerpt}`,
        `Visual direction (${archetypeVariations[i]}).`,
        `Composition: Chest-up portrait, neutral expression, even natural lighting, clean simple neutral background, photorealistic 35mm film aesthetic. Clearly an adult (25+ years old). No text, no logos, no extra people.`,
      ].join("\n");

      const img = await geminiAdapter.generateImage({
        prompt,
        aspectRatio,
      });

      const rec = await assetStore.putBase64({
        base64Data: img.base64Data,
        mimeType: img.mimeType,
        kind: "character_ref",
        label: `${params.mentionName} Candidate ${i + 1}`,
        meta: {
          candidateFor: params.mentionName,
          variantIndex: i + 1,
          model: img.model,
        },
      });
      assetIds.push(rec.assetId);
    }

    return assetIds;
  },

  registerNewCharacterFromSelection(
    project: ProjectFolder,
    params: {
      mentionName: string;
      name: string;
      age: string;
      role: string;
      city: string;
      physicalDescription: string;
      goal: string;
      secret: string;
      selectedAssetId: string;
      elevenlabsVoiceId?: string;
      edgeTtsVoice?: string;
    }
  ): ProjectFolder {
    this.enforceAdultPolicy(`${params.physicalDescription} ${params.role}`);

    const id = slugifyId(params.name);
    const existingIdx = project.characters.findIndex(
      (c) => c.id === id || c.name.toLowerCase() === params.name.toLowerCase()
    );

    const newChar: Character = {
      id,
      name: params.name.trim(),
      age: params.age.trim() || "28",
      role: params.role.trim() || `Introduced in Chapter ${project.activeEpisode.chapterNumber}`,
      city: params.city.trim() || "Chicago",
      physicalDescription:
        params.physicalDescription.trim() ||
        `Adult character matching approved reference portrait ${params.selectedAssetId}.`,
      goal: params.goal.trim() || "Navigate immediate interpersonal stakes.",
      fear: "",
      secret: params.secret.trim() || "Unrevealed motive.",
      contradiction: "",
      moralBoundary: "",
      aliases: Array.from(new Set([params.name.trim(), params.mentionName.trim()])),
      wardrobeIds: ["day1"],
      voiceProfile: {
        elevenlabsVoiceId: params.elevenlabsVoiceId || "21m00Tcm4TlvDq8ikWAM",
        edgeTtsVoice: params.edgeTtsVoice || "en-US-AriaNeural",
        deliveryStyle: "Natural, grounded drama delivery",
      },
      approvedRefAssetId: params.selectedAssetId,
      approvedRefVariants: { day1: params.selectedAssetId },
      registeredInChapter: `Chapter ${project.activeEpisode.chapterNumber}`,
      bibleVersionAdded: project.bibleVersion,
      isAdultConfirmed: true,
    };

    const nextCharacters = [...project.characters];
    if (existingIdx >= 0) {
      nextCharacters[existingIdx] = {
        ...nextCharacters[existingIdx],
        ...newChar,
        aliases: Array.from(new Set([...nextCharacters[existingIdx].aliases, ...newChar.aliases])),
      };
    } else {
      nextCharacters.push(newChar);
    }

    const updatedProject: ProjectFolder = {
      ...project,
      characters: nextCharacters,
      unresolvedCharacters: project.unresolvedCharacters.filter(
        (u) => u.mentionName.toLowerCase() !== params.mentionName.toLowerCase()
      ),
    };

    const { resolvedScenes, unresolvedCharacters } = this.resolveCharactersInScenes(
      updatedProject,
      updatedProject.activeEpisode.scenes
    );

    return {
      ...updatedProject,
      activeEpisode: {
        ...updatedProject.activeEpisode,
        scenes: resolvedScenes,
      },
      unresolvedCharacters,
    };
  },
};
