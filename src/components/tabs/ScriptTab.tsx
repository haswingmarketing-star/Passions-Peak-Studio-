import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  GitCommit,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  AuditIssue,
  CarryForwardDiff,
  OutputProfile,
  ProjectFolder,
} from "../../contracts/schemas";

interface ScriptTabProps {
  project: ProjectFolder;
  outputProfile: OutputProfile;
  onUpdateProject: (updater: (prev: ProjectFolder) => ProjectFolder) => void;
  onSyncProject: (proj: ProjectFolder) => void;
  onJumpToVisuals: () => void;
  onToast: (type: "info" | "success" | "error" | "warning", msg: string, tb?: string) => void;
}

export function ScriptTab({
  project,
  outputProfile,
  onUpdateProject,
  onSyncProject,
  onJumpToVisuals,
  onToast,
}: ScriptTabProps) {
  const ep = project.activeEpisode;
  const [chapterText, setChapterText] = useState(ep.sourceChapterText || "");
  const [episodeCode, setEpisodeCode] = useState(ep.episodeCode || "EP 01");
  const [chapterNumber, setChapterNumber] = useState(ep.chapterNumber || 1);
  const [tone, setTone] = useState("Urgent, intimate, high-stakes dramatic tension");
  const [targetDuration, setTargetDuration] = useState(
    project.seriesBible.targetRuntimeSeconds || 75
  );
  const [focusArc, setFocusArc] = useState(project.seriesBible.seasonScope);
  const [extraInstructions, setExtraInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [regenSceneId, setRegenSceneId] = useState<number | null>(null);
  const [auditIssues, setAuditIssues] = useState<AuditIssue[]>([]);
  const [carryDiff, setCarryDiff] = useState<CarryForwardDiff | null>(null);
  const [proposingDiff, setProposingDiff] = useState(false);

  const handleFileUpload = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    setChapterText(text);
    onUpdateProject((prev) => ({
      ...prev,
      activeEpisode: { ...prev.activeEpisode, sourceChapterText: text },
    }));
    onToast("info", `Loaded ${file.name} (${text.length.toLocaleString()} chars).`);
  };

  const handleGenerateScript = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/script/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterNumber,
          episodeCode,
          chapterText,
          genre: project.seriesBible.genre,
          tone,
          targetDurationSeconds: targetDuration,
          focusArc,
          extraInstructions,
          outputProfile,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Script generation failed", data.error?.traceback);
        return;
      }
      onSyncProject(data.project);
      const unregCount = (data.project as ProjectFolder).unresolvedCharacters.length;
      onToast(
        unregCount > 0 ? "warning" : "success",
        unregCount > 0
          ? `Script generated (${data.project.activeEpisode.scenes.length} scenes). ${unregCount} unregistered character(s) detected.`
          : `Script generated (${data.project.activeEpisode.scenes.length} scenes).`
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenScene = async (sceneId: number) => {
    setRegenSceneId(sceneId);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/script/scene/${sceneId}/regen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction: "Deepen subtext and emotional tension." }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Scene regeneration failed", data.error?.traceback);
        return;
      }
      onSyncProject(data.project);
      onToast("success", `Regenerated Scene ${sceneId}.`);
    } finally {
      setRegenSceneId(null);
    }
  };

  const handleAudit = async () => {
    setAuditing(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/canon/audit`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Canon audit failed");
        return;
      }
      setAuditIssues(data.issues || []);
      onToast(
        data.issues?.length ? "warning" : "success",
        data.issues?.length
          ? `Canon audit flagged ${data.issues.length} item(s).`
          : "Canon audit passed with zero conflicts."
      );
    } finally {
      setAuditing(false);
    }
  };

  const handleProposeCarryForward = async () => {
    setProposingDiff(true);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/canon/carry-forward/propose`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Failed to generate carry-forward diff");
        return;
      }
      setCarryDiff(data.diff);
    } finally {
      setProposingDiff(false);
    }
  };

  const handleCommitCarryForward = async () => {
    if (!carryDiff) return;
    const res = await fetch(
      `/api/projects/${encodeURIComponent(project.id)}/canon/carry-forward/commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diff: carryDiff }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      onToast("error", data.error?.message || "Failed to commit canon version");
      return;
    }
    onSyncProject(data.project);
    setCarryDiff(null);
    setChapterText("");
    setChapterNumber((data.project as ProjectFolder).activeEpisode.chapterNumber);
    setEpisodeCode((data.project as ProjectFolder).activeEpisode.episodeCode);
    onToast(
      "success",
      `Chapter committed! Canon advanced to v${(data.project as ProjectFolder).bibleVersion}.`
    );
  };

  const totalSceneDuration = ep.scenes.reduce((acc, s) => acc + s.durationSeconds, 0);

  return (
    <div className="space-y-6">
      {/* Script-Time Unregistered Character Detection Banner */}
      {project.unresolvedCharacters.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-600/50 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-100">
                Unregistered Character(s) Detected in Script:{" "}
                {project.unresolvedCharacters.map((u) => u.mentionName).join(", ")}
              </p>
              <p className="text-xs text-amber-200/80 mt-0.5">
                Before generating scene images, approve 1 of 3 candidate reference portraits in Visuals to add them to the Series Bible.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onJumpToVisuals}
            className="px-3.5 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs whitespace-nowrap"
          >
            Resolve in Visuals
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Chapter Upload & Script Controls */}
        <section className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Chapter Source & Brief</h2>
            <span className="text-xs font-mono text-slate-400">Canon v{project.bibleVersion}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Chapter #</label>
              <input
                type="number"
                min={1}
                value={chapterNumber}
                onChange={(e) => setChapterNumber(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Episode Code</label>
              <input
                value={episodeCode}
                onChange={(e) => setEpisodeCode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-slate-400">
                Upload or Paste Chapter Text (.txt / .md)
              </label>
              <label className="text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer">
                Choose File
                <input
                  type="file"
                  accept=".txt,.md"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                />
              </label>
            </div>
            <textarea
              rows={7}
              value={chapterText}
              onChange={(e) => setChapterText(e.target.value)}
              placeholder="Paste Chapter prose here (optional if generating from prompt & Bible)..."
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Target Runtime (s)</label>
              <input
                type="number"
                min={15}
                max={900}
                value={targetDuration}
                onChange={(e) => setTargetDuration(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Arc Focus</label>
              <input
                value={focusArc}
                onChange={(e) => setFocusArc(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Tone & Direction</label>
            <input
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Extra Instructions</label>
            <textarea
              rows={2}
              value={extraInstructions}
              onChange={(e) => setExtraInstructions(e.target.value)}
              placeholder="Specific scene beat emphasis or cliffhanger focus..."
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
            />
          </div>

          <button
            type="button"
            disabled={generating}
            onClick={handleGenerateScript}
            className="w-full py-2 px-4 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {generating ? "Generating Script..." : "Generate Episode Script (Gemini 3.1 Flash Lite)"}
          </button>
        </section>

        {/* Right: Structured Scene Beats & Canon Audit */}
        <section className="lg:col-span-8 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {ep.title || "No Episode Script Drafted Yet"}
              </h2>
              <p className="text-xs font-mono tabular-nums text-slate-400">
                {ep.scenes.length} scenes · {totalSceneDuration.toFixed(1)}s runtime · Drafted on Canon v
                {ep.bibleVersion}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={auditing || ep.scenes.length === 0}
                onClick={handleAudit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500 bg-slate-950 text-xs text-slate-100 disabled:opacity-50"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
                {auditing ? "Auditing..." : "Audit Canon"}
              </button>
              <button
                type="button"
                disabled={proposingDiff || ep.scenes.length === 0}
                onClick={handleProposeCarryForward}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-600/60 hover:border-emerald-500 bg-emerald-950/40 text-xs text-emerald-200 disabled:opacity-50"
              >
                <GitCommit className="w-3.5 h-3.5" />
                {proposingDiff ? "Preparing Diff..." : "Complete Chapter & Carry Forward"}
              </button>
            </div>
          </div>

          {/* Audit Output */}
          {auditIssues.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-2">
              <h3 className="text-xs font-semibold text-slate-200">Canon Continuity Audit</h3>
              {auditIssues.map((issue, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950 border border-slate-800 rounded p-2.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between font-mono">
                    <span
                      className={
                        issue.severity === "error"
                          ? "text-red-400"
                          : issue.severity === "warning"
                          ? "text-amber-400"
                          : "text-slate-400"
                      }
                    >
                      {issue.severity.toUpperCase()} · {issue.category}
                    </span>
                    {issue.sceneId && <span className="text-slate-500">Scene {issue.sceneId}</span>}
                  </div>
                  <p className="text-slate-200">{issue.message}</p>
                  <p className="text-slate-400">Fix: {issue.suggestedFix}</p>
                </div>
              ))}
            </div>
          )}

          {/* Scene Cards */}
          {ep.scenes.length === 0 ? (
            <div className="bg-slate-900 border border-dashed border-slate-800 rounded-lg p-12 text-center space-y-2">
              <FileText className="w-7 h-7 text-slate-600 mx-auto" />
              <p className="text-sm text-slate-300">
                Ready for Chapter 1. Upload or paste prose on the left, or click Generate Episode Script.
              </p>
              <p className="text-xs text-slate-500">
                Passions Peak begins clean with your Series Bible & 10 cast profiles locked—zero pre-baked scenes.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {ep.scenes.map((scene) => (
                <div
                  key={scene.id}
                  className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-mono text-slate-400 tabular-nums">
                      <span className="text-amber-400 font-semibold">SCENE {scene.id}</span> ·{" "}
                      {scene.beat.toUpperCase()} · {scene.speaker} · {scene.durationSeconds}s ·{" "}
                      {scene.camera}
                    </div>
                    <button
                      type="button"
                      disabled={regenSceneId === scene.id}
                      onClick={() => handleRegenScene(scene.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-700 hover:border-slate-500 text-xs text-slate-300"
                    >
                      <RefreshCw className={`w-3 h-3 ${regenSceneId === scene.id ? "animate-spin" : ""}`} />
                      Regenerate Scene
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Voiceover / Dialogue Line
                      </label>
                      <textarea
                        rows={2}
                        value={scene.narration}
                        onChange={(e) =>
                          onUpdateProject((prev) => ({
                            ...prev,
                            activeEpisode: {
                              ...prev.activeEpisode,
                              scenes: prev.activeEpisode.scenes.map((s) =>
                                s.id === scene.id
                                  ? { ...s, narration: e.target.value, srtCueText: e.target.value }
                                  : s
                              ),
                            },
                          }))
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Visual Direction Prompt
                      </label>
                      <textarea
                        rows={2}
                        value={scene.visualDirection}
                        onChange={(e) =>
                          onUpdateProject((prev) => ({
                            ...prev,
                            activeEpisode: {
                              ...prev.activeEpisode,
                              scenes: prev.activeEpisode.scenes.map((s) =>
                                s.id === scene.id ? { ...s, visualDirection: e.target.value } : s
                              ),
                            },
                          }))
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Carry-Forward Diff Review Modal */}
      {carryDiff && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-xl w-full p-5 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
              <h2 className="text-sm font-semibold text-slate-50">
                Review Carry-Forward Canon Diff (v{project.bibleVersion} → v{project.bibleVersion + 1})
              </h2>
            </div>
            <p className="text-xs text-slate-300">{carryDiff.summary}</p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              <p className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                New Canon Facts ({carryDiff.proposedFacts.length})
              </p>
              {carryDiff.proposedFacts.map((fact, idx) => (
                <div key={idx} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-200">
                  {fact}
                </div>
              ))}
              {carryDiff.proposedWkwEntries.length > 0 && (
                <>
                  <p className="text-[11px] uppercase tracking-wider text-slate-400 font-medium pt-2">
                    WKW State Updates ({carryDiff.proposedWkwEntries.length})
                  </p>
                  {carryDiff.proposedWkwEntries.map((w, idx) => (
                    <div key={idx} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-300">
                      <span className="font-mono text-amber-400">{w.characterId}</span> ·{" "}
                      {w.knows ? "KNOWS" : "UNAWARE"} · {w.factSummary}
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCarryDiff(null)}
                className="px-3 py-1.5 rounded border border-slate-700 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommitCarryForward}
                className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold text-xs"
              >
                Approve & Advance to Chapter {carryDiff.chapterNumber + 1}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
