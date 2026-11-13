import type {
  AuditIssue,
  CarryForwardDiff,
  CompletedChapter,
  Episode,
  ProjectFolder,
  WKWEntry,
} from "../../src/contracts/schemas.ts";
import { geminiAdapter } from "../adapters/geminiAdapter.ts";

export const canonService = {
  async auditEpisodeAgainstCanon(
    project: ProjectFolder,
    episode: Episode
  ): Promise<{ issues: AuditIssue[]; tokensUsed: number }> {
    const issues: AuditIssue[] = [];
    let tokensUsed = 0;

    // 1. Deterministic version check
    if (episode.bibleVersion < project.bibleVersion) {
      issues.push({
        severity: "warning",
        category: "Canon Version Drift",
        message: `Episode was drafted against Bible v${episode.bibleVersion}, while current canon is v${project.bibleVersion}.`,
        suggestedFix: "Re-audit or update affected scenes to align with newer chapter facts.",
      });
    }

    // 2. Deterministic unregistered / unapproved character check
    if (project.unresolvedCharacters.length > 0) {
      for (const unreg of project.unresolvedCharacters) {
        issues.push({
          severity: "error",
          sceneId: unreg.sceneIds[0],
          category: "Unregistered Character",
          message: `"${unreg.mentionName}" appears in scene(s) ${unreg.sceneIds.join(", ")} but is not registered in the Reference Bible.`,
          suggestedFix: "Open Continuity & Visuals to generate candidate portraits and approve them into the cast.",
        });
      }
    }

    // 3. Deterministic WKW secret check
    const secretMap = project.wkwLedger.filter((w) => !w.knows);
    for (const scene of episode.scenes) {
      for (const secret of secretMap) {
        if (scene.charactersPresent.includes(secret.characterId)) {
          const keywords = secret.factSummary
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 5);
          const textLower = `${scene.narration} ${scene.visualDirection}`.toLowerCase();
          const hit = keywords.find((kw) => textLower.includes(kw));
          if (hit && (hit.includes("drug") || hit.includes("secret") || hit.includes("trade"))) {
            issues.push({
              severity: "warning",
              sceneId: scene.id,
              category: "Who Knows What (WKW) Risk",
              message: `Character "${secret.characterId}" is marked unaware of "${secret.factSummary}" in the WKW ledger, yet Scene ${scene.id} references "${hit}".`,
              suggestedFix: "Confirm this scene shows discovery or remove premature knowledge from dialogue.",
            });
          }
        }
      }
    }

    // 4. Gemini structural & canon audit if configured and scenes exist
    if (geminiAdapter.isConfigured() && episode.scenes.length > 0) {
      try {
        const sys = `You are a Continuity Supervisor auditing a micro-drama script against an approved Series Bible and append-only Who-Knows-What (WKW) ledger.
Return JSON strictly matching:
{
  "issues": [
    {
      "severity": "error" | "warning" | "info",
      "sceneId": number | null,
      "category": string,
      "message": string,
      "suggestedFix": string
    }
  ]
}
Check: timeline consistency, WKW secret leaks, character motive/moral boundary alignment, wardrobe/prop continuity, and whether the ending genuinely advances the situation rather than repeating conflict.`;

        const prompt = JSON.stringify({
          bibleVersion: project.bibleVersion,
          seriesBible: project.seriesBible,
          characters: project.characters.map((c) => ({
            id: c.id,
            name: c.name,
            goal: c.goal,
            secret: c.secret,
            moralBoundary: c.moralBoundary,
          })),
          wkwLedger: project.wkwLedger,
          completedChapters: project.completedChapters.map((ch) => ({
            chapterNumber: ch.chapterNumber,
            summary: ch.summary,
            newCanonFacts: ch.newCanonFacts,
          })),
          episodeScenes: episode.scenes.map((s) => ({
            id: s.id,
            beat: s.beat,
            speaker: s.speaker,
            charactersPresent: s.charactersPresent,
            narration: s.narration,
            visualDirection: s.visualDirection,
          })),
        });

        const res = await geminiAdapter.generateJson<{ issues: AuditIssue[] }>({
          systemInstruction: sys,
          prompt,
        });
        tokensUsed = res.totalTokens;
        if (Array.isArray(res.data?.issues)) {
          for (const item of res.data.issues) {
            issues.push({
              severity: item.severity ?? "info",
              sceneId: item.sceneId ?? undefined,
              category: item.category ?? "Continuity",
              message: item.message,
              suggestedFix: item.suggestedFix ?? "Review scene beat.",
            });
          }
        }
      } catch (err) {
        issues.push({
          severity: "info",
          category: "LLM Audit Skipped",
          message: `Deterministic continuity checks completed; AI audit could not run (${err instanceof Error ? err.message : String(err)}).`,
          suggestedFix: "Verify GEMINI_API_KEY if you want deep semantic auditing.",
        });
      }
    }

    return { issues, tokensUsed };
  },

  async proposeCarryForwardDiff(
    project: ProjectFolder,
    episode: Episode
  ): Promise<{ diff: CarryForwardDiff; tokensUsed: number }> {
    if (!geminiAdapter.isConfigured() || episode.scenes.length === 0) {
      return {
        diff: {
          chapterNumber: episode.chapterNumber,
          chapterTitle: episode.title || `Episode ${episode.chapterNumber}`,
          summary:
            episode.scenes.map((s) => s.narration).slice(0, 3).join(" / ") ||
            "Completed chapter.",
          proposedFacts: [
            `Chapter ${episode.chapterNumber} (${episode.title || episode.episodeCode}) concluded with cliffhanger: ${
              episode.scenes[episode.scenes.length - 1]?.cliffhangerLine || "Open thread"
            }`,
          ],
          proposedWkwEntries: [],
        },
        tokensUsed: 0,
      };
    }

    const sys = `You are a Showrunner Continuity Supervisor preparing a reviewable Carry-Forward Diff after completing an episode/chapter.
Extract ONLY concrete, verified new canon facts and Who-Knows-What (WKW) state changes introduced by this episode.
Return strict JSON:
{
  "chapterNumber": number,
  "chapterTitle": string,
  "summary": string,
  "proposedFacts": string[],
  "proposedWkwEntries": [
    {
      "characterId": string,
      "factId": string,
      "factSummary": string,
      "knows": boolean,
      "revealedAt": string
    }
  ]
}`;

    const prompt = JSON.stringify({
      chapterNumber: episode.chapterNumber,
      episodeTitle: episode.title || episode.episodeCode,
      existingCanonFacts: project.seriesBible.canonFacts,
      characterIds: project.characters.map((c) => ({ id: c.id, name: c.name })),
      scenes: episode.scenes.map((s) => ({
        id: s.id,
        beat: s.beat,
        speaker: s.speaker,
        charactersPresent: s.charactersPresent,
        narration: s.narration,
        visualDirection: s.visualDirection,
        cliffhangerLine: s.cliffhangerLine,
      })),
    });

    const res = await geminiAdapter.generateJson<CarryForwardDiff>({
      systemInstruction: sys,
      prompt,
    });

    return {
      diff: {
        chapterNumber: episode.chapterNumber,
        chapterTitle: res.data.chapterTitle || episode.title || `Chapter ${episode.chapterNumber}`,
        summary: res.data.summary || "Completed chapter.",
        proposedFacts: res.data.proposedFacts ?? [],
        proposedWkwEntries: res.data.proposedWkwEntries ?? [],
      },
      tokensUsed: res.totalTokens,
    };
  },

  commitCarryForwardDiff(project: ProjectFolder, episode: Episode, diff: CarryForwardDiff): ProjectFolder {
    const now = new Date().toISOString();
    const prevVersion = project.bibleVersion;
    const nextVersion = prevVersion + 1;

    const newWkw: WKWEntry[] = diff.proposedWkwEntries.map((entry, idx) => ({
      id: `wkw_ch${diff.chapterNumber}_${Date.now()}_${idx}`,
      chapterId: episode.id,
      characterId: entry.characterId,
      factId: entry.factId,
      factSummary: entry.factSummary,
      knows: entry.knows,
      revealedAt: entry.revealedAt || `Chapter ${diff.chapterNumber}`,
      createdAt: now,
    }));

    const completedRecord: CompletedChapter = {
      id: episode.id,
      chapterNumber: diff.chapterNumber,
      title: diff.chapterTitle,
      bibleVersionBefore: prevVersion,
      bibleVersionAfter: nextVersion,
      summary: diff.summary,
      newCanonFacts: diff.proposedFacts,
      wkwAdded: newWkw,
      completedAt: now,
    };

    const nextEpisodeNum = diff.chapterNumber + 1;
    const completedEpisode: Episode = {
      ...episode,
      status: "completed",
      updatedAt: now,
    };

    const freshNextEpisode: Episode = {
      ...episode,
      id: `ep_${project.slug}_${nextEpisodeNum}_${Date.now()}`,
      chapterNumber: nextEpisodeNum,
      title: "",
      episodeCode: `EP ${String(nextEpisodeNum).padStart(2, "0")}`,
      bibleVersion: nextVersion,
      hook: "",
      status: "draft",
      sourceChapterText: "",
      scenes: [],
      srtAssetId: undefined,
      srtContent: "",
      thumbnailRenders: { "9x16": [], "16x9": [] },
      telemetry: { textTokens: 0, imagesGenerated: 0, lyriaClips: 0, elevenlabsChars: 0 },
      updatedAt: now,
    };

    return {
      ...project,
      bibleVersion: nextVersion,
      seriesBible: {
        ...project.seriesBible,
        canonFacts: Array.from(new Set([...project.seriesBible.canonFacts, ...diff.proposedFacts])),
      },
      canonVersions: [
        ...project.canonVersions,
        {
          version: nextVersion,
          createdAt: now,
          sourceChapterId: episode.id,
          summary: `Completed Chapter ${diff.chapterNumber}: ${diff.chapterTitle}`,
          diff: {
            addedFacts: diff.proposedFacts,
            addedCharacters: project.characters
              .filter((c) => c.bibleVersionAdded === prevVersion)
              .map((c) => c.name),
            wkwEntriesCount: newWkw.length,
          },
        },
      ],
      wkwLedger: [...project.wkwLedger, ...newWkw],
      completedChapters: [...project.completedChapters, completedRecord],
      episodeArchive: [...project.episodeArchive, completedEpisode],
      activeEpisode: freshNextEpisode,
      unresolvedCharacters: [],
      updatedAt: now,
    };
  },
};
