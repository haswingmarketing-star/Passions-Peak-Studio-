import React, { useState } from "react";
import {
  AlertOctagon,
  ArrowUpDown,
  Check,
  Image as ImageIcon,
  Layers,
  ShieldAlert,
  Sparkles,
  Upload,
} from "lucide-react";
import { OutputProfile, ProjectFolder, Scene, UnresolvedCharacter } from "../../contracts/schemas";

interface VisualsTabProps {
  project: ProjectFolder;
  outputProfile: OutputProfile;
  onUpdateProject: (updater: (prev: ProjectFolder) => ProjectFolder) => void;
  onSyncProject: (proj: ProjectFolder) => void;
  onToast: (type: "info" | "success" | "error" | "warning", msg: string, tb?: string) => void;
}

export function VisualsTab({
  project,
  outputProfile,
  onUpdateProject,
  onSyncProject,
  onToast,
}: VisualsTabProps) {
  const ep = project.activeEpisode;
  const [busySceneId, setBusySceneId] = useState<number | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [busyCandidateMention, setBusyCandidateMention] = useState<string | null>(null);
  const [dragSceneIdx, setDragSceneIdx] = useState<number | null>(null);
  const [regForms, setRegForms] = useState<
    Record<string, { name: string; age: string; role: string; desc: string; selectedAssetId: string }>
  >({});

  // Compute missing character reference sheets required by active scenes
  const missingRefChars = Array.from(
    new Map(
      ep.scenes
        .flatMap((s) => s.charactersPresent)
        .map((cid) => project.characters.find((c) => c.id === cid))
        .filter((c): c is NonNullable<typeof c> => Boolean(c && !c.approvedRefAssetId))
        .map((c) => [c.id, c])
    ).values()
  );

  const gateBlocked = project.unresolvedCharacters.length > 0 || missingRefChars.length > 0;

  const handleGenerateCandidates = async (unreg: UnresolvedCharacter) => {
    setBusyCandidateMention(unreg.mentionName);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/characters/candidates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mentionName: unreg.mentionName,
            contextExcerpt: unreg.contextExcerpt,
            outputProfile,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Failed to generate candidate portraits", data.error?.traceback);
        return;
      }
      onSyncProject(data.project);
      onToast("success", `Generated 3 adult candidate looks for "${unreg.mentionName}".`);
    } finally {
      setBusyCandidateMention(null);
    }
  };

  const handleRegisterCandidate = async (unreg: UnresolvedCharacter) => {
    const form = regForms[unreg.mentionName] || {
      name: unreg.mentionName,
      age: "29",
      role: `Introduced in Chapter ${ep.chapterNumber}`,
      desc: unreg.contextExcerpt,
      selectedAssetId: unreg.candidateAssetIds[0] || "",
    };
    if (!form.selectedAssetId) {
      onToast("warning", "Generate and click one of the 3 candidate portraits first.");
      return;
    }

    const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/characters/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mentionName: unreg.mentionName,
        name: form.name,
        age: form.age,
        role: form.role,
        city: "Chicago",
        physicalDescription: form.desc,
        goal: "Navigate chapter stakes",
        secret: "Unrevealed",
        selectedAssetId: form.selectedAssetId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      onToast("error", data.error?.message || "Character registration failed");
      return;
    }
    onSyncProject(data.project);
    onToast("success", `Registered "${form.name}" into Reference Bible!`);
  };

  const handleQuickApproveExistingRef = async (charId: string) => {
    const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/characters/ref`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: charId, outputProfile }),
    });
    const data = await res.json();
    if (!res.ok) {
      onToast("error", data.error?.message || "Ref generation failed");
      return;
    }
    onSyncProject(data.project);
    onToast("success", "Reference sheet locked.");
  };

  const handleGenerateSceneFrame = async (scene: Scene) => {
    setBusySceneId(scene.id);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/visuals/scene/${scene.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outputProfile }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Scene frame failed", data.error?.traceback);
        return;
      }
      onSyncProject(data.project);
      onToast("success", `Generated ${outputProfile} frame for Scene ${scene.id}.`);
    } finally {
      setBusySceneId(null);
    }
  };

  const handleGenerateAllFrames = async () => {
    setGeneratingAll(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/visuals/generate-all`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outputProfile }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Batch visual generation failed");
        return;
      }
      onSyncProject(data.project);
      onToast("success", `Generated ${data.outputAssetIds?.length || 0} scene frames.`);
    } finally {
      setGeneratingAll(false);
    }
  };

  const handleUploadAsset = async (
    file: File,
    role: "scene_frame" | "overlay" | "watermark" | "bgm",
    sceneId?: number
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", role);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      onToast("error", data.error?.message || "Upload failed");
      return;
    }
    const assetId = data.asset.assetId as string;

    onUpdateProject((prev) => {
      if (role === "watermark") {
        return {
          ...prev,
          activeEpisode: {
            ...prev.activeEpisode,
            watermarkConfig: { ...prev.activeEpisode.watermarkConfig, assetId, enabled: true },
          },
        };
      }
      if (role === "bgm") {
        return {
          ...prev,
          activeEpisode: {
            ...prev.activeEpisode,
            bgmConfig: { ...prev.activeEpisode.bgmConfig, masterBgmAssetId: assetId },
          },
        };
      }
      if (sceneId !== undefined) {
        return {
          ...prev,
          activeEpisode: {
            ...prev.activeEpisode,
            scenes: prev.activeEpisode.scenes.map((s) => {
              if (s.id !== sceneId) return s;
              if (role === "overlay") return { ...s, overlayAssetId: assetId };
              return {
                ...s,
                renders: {
                  ...s.renders,
                  [outputProfile]: {
                    ...(s.renders[outputProfile] ?? { thumbnailAssetIds: [] }),
                    frameAssetId: assetId,
                  },
                },
              };
            }),
          },
        };
      }
      return prev;
    });
    onToast("success", "Uploaded asset.");
  };

  const handleSceneDropReorder = (targetIdx: number) => {
    if (dragSceneIdx === null || dragSceneIdx === targetIdx) return;
    onUpdateProject((prev) => {
      const copy = [...prev.activeEpisode.scenes];
      const [moved] = copy.splice(dragSceneIdx, 1);
      copy.splice(targetIdx, 0, moved);
      return {
        ...prev,
        activeEpisode: { ...prev.activeEpisode, scenes: copy },
      };
    });
    setDragSceneIdx(null);
  };

  return (
    <div className="space-y-6">
      {/* Header Action Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-slate-50">
            Continuity Gate & Reference-Guided Visuals ({outputProfile})
          </h1>
          <p className="text-xs text-slate-400">
            Scene images inherit locked character sheets + location plates + deterministic Provenance hashes.
          </p>
        </div>

        <button
          type="button"
          disabled={generatingAll || gateBlocked || ep.scenes.length === 0}
          onClick={handleGenerateAllFrames}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs disabled:opacity-40 whitespace-nowrap"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {generatingAll ? "Generating All Scenes..." : `Generate All ${outputProfile} Frames`}
        </button>
      </div>

      {/* Continuity Gate Panel */}
      {gateBlocked && (
        <div className="bg-slate-900 border border-amber-500/60 rounded-lg p-5 space-y-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-amber-200">
                Continuity Gate Active — Reference Approval Required
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Every character appearing in active scenes must have an approved Reference Sheet before generating scene frames.
              </p>
            </div>
          </div>

          {/* Missing Refs on Registered Characters */}
          {missingRefChars.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-slate-400">
                REGISTERED CAST MISSING REFERENCE SHEETS ({missingRefChars.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {missingRefChars.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => handleQuickApproveExistingRef(ch.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-950 border border-slate-700 hover:border-amber-500 text-xs text-slate-100"
                  >
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    Generate Sheet: {ch.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Unregistered Characters -> 3 Candidate Portrait Picker */}
          {project.unresolvedCharacters.map((unreg) => {
            const form = regForms[unreg.mentionName] || {
              name: unreg.mentionName,
              age: "29",
              role: `Introduced in Chapter ${ep.chapterNumber}`,
              desc: unreg.contextExcerpt,
              selectedAssetId: unreg.candidateAssetIds[0] || "",
            };

            return (
              <div
                key={unreg.mentionName}
                className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                      <AlertOctagon className="w-4 h-4 text-amber-400" />
                      Unregistered Character: "{unreg.mentionName}"
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Scenes {unreg.sceneIds.join(", ")} · {unreg.contextExcerpt.slice(0, 140)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyCandidateMention === unreg.mentionName}
                    onClick={() => handleGenerateCandidates(unreg)}
                    className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs whitespace-nowrap"
                  >
                    {busyCandidateMention === unreg.mentionName
                      ? "Generating 3 Looks..."
                      : "Generate 3 Candidate Portraits"}
                  </button>
                </div>

                {unreg.candidateAssetIds.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                    <div className="md:col-span-6 grid grid-cols-3 gap-2">
                      {unreg.candidateAssetIds.map((cid, idx) => {
                        const selected = form.selectedAssetId === cid;
                        return (
                          <button
                            key={cid}
                            type="button"
                            onClick={() =>
                              setRegForms((prev) => ({
                                ...prev,
                                [unreg.mentionName]: { ...form, selectedAssetId: cid },
                              }))
                            }
                            className={`rounded overflow-hidden border-2 transition-all text-left ${
                              selected ? "border-amber-500" : "border-slate-800 hover:border-slate-600"
                            }`}
                          >
                            <div className="aspect-[9/16] bg-slate-900">
                              <img
                                src={`/api/assets/${cid}`}
                                alt={`Candidate ${idx + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="p-1.5 bg-slate-900 text-[11px] font-mono flex items-center justify-between">
                              <span>Option {idx + 1}</span>
                              {selected && <Check className="w-3 h-3 text-amber-400" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="md:col-span-6 space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={form.name}
                          onChange={(e) =>
                            setRegForms((prev) => ({
                              ...prev,
                              [unreg.mentionName]: { ...form, name: e.target.value },
                            }))
                          }
                          placeholder="Canonical Name"
                          className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                        />
                        <input
                          value={form.age}
                          onChange={(e) =>
                            setRegForms((prev) => ({
                              ...prev,
                              [unreg.mentionName]: { ...form, age: e.target.value },
                            }))
                          }
                          placeholder="Adult Age (e.g. 29)"
                          className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                        />
                      </div>
                      <input
                        value={form.role}
                        onChange={(e) =>
                          setRegForms((prev) => ({
                            ...prev,
                            [unreg.mentionName]: { ...form, role: e.target.value },
                          }))
                        }
                        placeholder="Role in Series"
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                      />
                      <textarea
                        rows={2}
                        value={form.desc}
                        onChange={(e) =>
                          setRegForms((prev) => ({
                            ...prev,
                            [unreg.mentionName]: { ...form, desc: e.target.value },
                          }))
                        }
                        placeholder="Physical spec"
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => handleRegisterCandidate(unreg)}
                        className="w-full py-2 px-3 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold text-xs"
                      >
                        Approve Selected Portrait & Register in Bible
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Episode Watermark & Master BGM Dropzones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void handleUploadAsset(f, "watermark");
          }}
          className="bg-slate-900 border border-dashed border-slate-700 rounded-lg p-4 flex items-center justify-between gap-3"
        >
          <div>
            <p className="text-xs font-semibold text-slate-100">Custom Watermark PNG (RGBA)</p>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              {ep.watermarkConfig.assetId
                ? `Asset: ${ep.watermarkConfig.assetId}`
                : `Text Fallback: "${ep.watermarkConfig.labelText}"`}
            </p>
          </div>
          <label className="px-3 py-1.5 rounded border border-slate-700 bg-slate-950 text-xs text-slate-200 cursor-pointer shrink-0">
            Upload PNG
            <input
              type="file"
              accept="image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadAsset(f, "watermark");
              }}
            />
          </label>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void handleUploadAsset(f, "bgm");
          }}
          className="bg-slate-900 border border-dashed border-slate-700 rounded-lg p-4 flex items-center justify-between gap-3"
        >
          <div>
            <p className="text-xs font-semibold text-slate-100">Master BGM Audio Track</p>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              {ep.bgmConfig.masterBgmAssetId
                ? `Asset: ${ep.bgmConfig.masterBgmAssetId}`
                : "Drop .mp3 / .wav here or synthesize via Lyria in Audio tab"}
            </p>
          </div>
          <label className="px-3 py-1.5 rounded border border-slate-700 bg-slate-950 text-xs text-slate-200 cursor-pointer shrink-0">
            Upload Audio
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadAsset(f, "bgm");
              }}
            />
          </label>
        </div>
      </div>

      {/* Scene Frame Cards (Drag-to-reorder & Drop-to-replace) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ep.scenes.map((scene, idx) => {
          const variant = scene.renders[outputProfile];
          const frameId = variant?.frameAssetId;

          return (
            <div
              key={scene.id}
              draggable
              onDragStart={() => setDragSceneIdx(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length > 0) {
                  void handleUploadAsset(e.dataTransfer.files[0], "scene_frame", scene.id);
                } else {
                  handleSceneDropReorder(idx);
                }
              }}
              className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col"
            >
              <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
                <span className="text-amber-400 font-semibold flex items-center gap-1.5">
                  <ArrowUpDown className="w-3 h-3 text-slate-500 cursor-grab" />
                  SCENE {scene.id} · {scene.beat.toUpperCase()}
                </span>
                <span className="text-slate-400">{scene.durationSeconds}s</span>
              </div>

              <div
                className={`${
                  outputProfile === "9x16" ? "aspect-[9/16] max-h-72" : "aspect-video"
                } bg-slate-950 border-b border-slate-800 flex items-center justify-center overflow-hidden relative`}
              >
                {frameId ? (
                  <img
                    src={`/api/assets/${frameId}`}
                    alt={`Scene ${scene.id}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center p-4 space-y-1">
                    <ImageIcon className="w-6 h-6 text-slate-600 mx-auto" />
                    <p className="text-[11px] text-slate-500">Drop PNG/JPG or Generate</p>
                  </div>
                )}
              </div>

              <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
                <p className="text-xs text-slate-300 line-clamp-2">{scene.visualDirection}</p>

                {variant?.provenance && (
                  <div className="bg-slate-950 border border-slate-800 rounded p-2 text-[11px] font-mono text-slate-400 space-y-0.5">
                    <div className="truncate">Model: {variant.provenance.model}</div>
                    <div className="truncate">
                      Pack: {variant.provenance.continuityPackHash} · Refs:{" "}
                      {variant.provenance.refAssetIds.length}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busySceneId === scene.id || gateBlocked}
                    onClick={() => handleGenerateSceneFrame(scene)}
                    className="flex-1 py-1.5 px-2.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs disabled:opacity-40 whitespace-nowrap"
                  >
                    {busySceneId === scene.id ? "Rendering..." : frameId ? "Regenerate" : "Generate Frame"}
                  </button>
                  <label className="p-1.5 rounded border border-slate-700 hover:border-slate-500 bg-slate-950 text-slate-300 cursor-pointer" title="Upload custom frame">
                    <Upload className="w-3.5 h-3.5" />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUploadAsset(f, "scene_frame", scene.id);
                      }}
                    />
                  </label>
                  <label className="p-1.5 rounded border border-slate-700 hover:border-slate-500 bg-slate-950 text-slate-300 cursor-pointer" title="Attach overlay PNG">
                    <Layers className="w-3.5 h-3.5" />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUploadAsset(f, "overlay", scene.id);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
