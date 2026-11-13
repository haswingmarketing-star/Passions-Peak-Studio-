import React, { useState } from "react";
import { Download, ImagePlus, Sparkles } from "lucide-react";
import { OutputProfile, ProjectFolder } from "../../contracts/schemas";

interface ThumbnailsTabProps {
  project: ProjectFolder;
  outputProfile: OutputProfile;
  onSyncProject: (proj: ProjectFolder) => void;
  onToast: (type: "info" | "success" | "error" | "warning", msg: string, tb?: string) => void;
}

export function ThumbnailsTab({
  project,
  outputProfile,
  onSyncProject,
  onToast,
}: ThumbnailsTabProps) {
  const ep = project.activeEpisode;
  const [targetProfile, setTargetProfile] = useState<OutputProfile>(outputProfile);
  const [conceptTitle, setConceptTitle] = useState("Betrayal Behind Closed Doors");
  const [headlineText, setHeadlineText] = useState("WHO LIED FIRST?");
  const [emotion, setEmotion] = useState("Tense Suspicion / Quiet Shock");
  const [focusCharId, setFocusCharId] = useState(project.characters[0]?.id || "");
  const [visualBrief, setVisualBrief] = useState(ep.hook || project.seriesBible.logline);
  const [generating, setGenerating] = useState(false);

  const items = ep.thumbnailRenders[targetProfile] || [];

  const handleGenerateThumbnail = async () => {
    setGenerating(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/thumbnails/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputProfile: targetProfile,
            conceptTitle,
            headlineText,
            emotion,
            focusCharacterId: focusCharId || undefined,
            visualBrief,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Thumbnail generation failed", data.error?.traceback);
        return;
      }
      onSyncProject(data.project);
      onToast("success", `Generated ${targetProfile} thumbnail.`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <section className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold text-slate-50">Episode Thumbnail Studio</h1>
          <div className="inline-flex rounded border border-slate-700 bg-slate-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTargetProfile("9x16")}
              className={`px-2 py-1 rounded ${
                targetProfile === "9x16" ? "bg-slate-800 text-amber-400" : "text-slate-400"
              }`}
            >
              9:16 Cover
            </button>
            <button
              type="button"
              onClick={() => setTargetProfile("16x9")}
              className={`px-2 py-1 rounded ${
                targetProfile === "16x9" ? "bg-slate-800 text-amber-400" : "text-slate-400"
              }`}
            >
              16:9 YouTube
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Lead Character Focus</label>
          <select
            value={focusCharId}
            onChange={(e) => setFocusCharId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
          >
            {project.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.approvedRefAssetId ? "Ref Locked" : "Text Only"})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Concept Title</label>
          <input
            value={conceptTitle}
            onChange={(e) => setConceptTitle(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">
            Studio Headline Overlay (Rendered Cleanly in Preview)
          </label>
          <input
            value={headlineText}
            onChange={(e) => setHeadlineText(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-semibold text-amber-300"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Dominant Emotion</label>
          <input
            value={emotion}
            onChange={(e) => setEmotion(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Visual Composition Brief</label>
          <textarea
            rows={3}
            value={visualBrief}
            onChange={(e) => setVisualBrief(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
          />
        </div>

        <button
          type="button"
          disabled={generating}
          onClick={handleGenerateThumbnail}
          className="w-full py-2 px-4 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {generating
            ? "Generating Thumbnail..."
            : `Generate ${targetProfile === "9x16" ? "9:16 Cover" : "16:9 YouTube CTR"}`}
        </button>
      </section>

      <section className="lg:col-span-8 space-y-4">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">
            Generated {targetProfile === "9x16" ? "9:16 Cover" : "16:9 YouTube"} Variants ({items.length})
          </h2>
          <span className="text-xs font-mono text-slate-400">gemini-3.1-flash-lite-image</span>
        </div>

        {items.length === 0 ? (
          <div className="bg-slate-900 border border-dashed border-slate-800 rounded-lg p-12 text-center space-y-2">
            <ImagePlus className="w-7 h-7 text-slate-600 mx-auto" />
            <p className="text-sm text-slate-300">
              No {targetProfile} thumbnails generated for {ep.episodeCode} yet.
            </p>
            <p className="text-xs text-slate-500">
              Thumbnails keep text-free generated plates so headline typography stays sharp in every aspect ratio.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map((thumb) => (
              <div
                key={thumb.id}
                className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col"
              >
                <div
                  className={`relative bg-slate-950 overflow-hidden ${
                    thumb.outputProfile === "9x16" ? "aspect-[9/16] max-h-96" : "aspect-video"
                  }`}
                >
                  <img
                    src={`/api/assets/${thumb.assetId}`}
                    alt={thumb.conceptTitle}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent p-4">
                    <p className="text-base font-bold tracking-tight text-amber-400 drop-shadow">
                      {thumb.headlineText}
                    </p>
                    <p className="text-[11px] text-slate-200">{thumb.conceptTitle}</p>
                  </div>
                </div>
                <div className="p-3 flex items-center justify-between text-xs border-t border-slate-800">
                  <span className="text-slate-400 truncate pr-2">{thumb.emotion}</span>
                  <a
                    href={`/api/assets/${thumb.assetId}`}
                    download={`${project.slug}_${ep.episodeCode}_${thumb.outputProfile}_thumb.png`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-700 hover:border-slate-500 text-slate-200 shrink-0"
                  >
                    <Download className="w-3 h-3" /> PNG
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
