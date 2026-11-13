import React, { useState } from "react";
import {
  Activity,
  Download,
  Film,
  FolderPlus,
  RectangleHorizontal,
  RectangleVertical,
  X,
} from "lucide-react";
import { Job, OutputProfile, ProjectFolder } from "../contracts/schemas";

export type StudioTabId =
  | "bible"
  | "script"
  | "visuals"
  | "thumbnails"
  | "audio"
  | "export";

interface StudioShellProps {
  activeTab: StudioTabId;
  onSelectTab: (tab: StudioTabId) => void;
  projects: ProjectFolder[];
  activeProject: ProjectFolder;
  jobs: Job[];
  saving: boolean;
  onSelectProject: (id: string) => void;
  onCreateProject: (params: {
    name: string;
    genre: string;
    logline: string;
    targetRuntimeSeconds: number;
  }) => Promise<unknown>;
  onChangeOutputProfile: (profile: OutputProfile) => void;
  onToggleRenderTargets: (targets: OutputProfile[]) => void;
  onPrimaryRenderClick: () => void;
  children: React.ReactNode;
}

const NAV_TABS: Array<{ id: StudioTabId; label: string }> = [
  { id: "bible", label: "Bible & Cast" },
  { id: "script", label: "Script" },
  { id: "visuals", label: "Visuals" },
  { id: "thumbnails", label: "Thumbnails" },
  { id: "audio", label: "Audio & BGM" },
  { id: "export", label: "Export" },
];

export function StudioShell({
  activeTab,
  onSelectTab,
  projects,
  activeProject,
  jobs,
  saving,
  onSelectProject,
  onCreateProject,
  onChangeOutputProfile,
  onToggleRenderTargets,
  onPrimaryRenderClick,
  children,
}: StudioShellProps) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [showJobDrawer, setShowJobDrawer] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGenre, setNewGenre] = useState("Serialized Urban Drama");
  const [newLogline, setNewLogline] = useState("");
  const [newRuntime, setNewRuntime] = useState(75);
  const [creating, setCreating] = useState(false);

  const activeProfile = activeProject.activeEpisode.activeProfile;
  const targets = activeProject.activeEpisode.renderTargets;
  const isBoth = targets.includes("9x16") && targets.includes("16x9");
  const runningJobs = jobs.filter((j) => j.status === "running" || j.status === "queued");

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreateProject({
        name: newName.trim(),
        genre: newGenre.trim(),
        logline: newLogline.trim() || "High-stakes vertical micro-drama.",
        targetRuntimeSeconds: newRuntime,
      });
      setNewName("");
      setNewLogline("");
      setShowNewModal(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/95 backdrop-blur sticky top-0 z-30 px-4 lg:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 shrink-0">
          <Film className="w-4 h-4 text-amber-500" />
          <span className="font-semibold tracking-tight text-sm text-slate-50 whitespace-nowrap">
            PASSIONS PEAK STUDIO
          </span>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {NAV_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isActive
                    ? "bg-slate-800 text-amber-400 border border-slate-700"
                    : "text-slate-400 hover:text-slate-100 border border-transparent"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={onPrimaryRenderClick}
            className="px-3.5 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs whitespace-nowrap shrink-0 transition-colors"
          >
            Render Episode
          </button>
        </div>
      </header>

      {/* Workspace Control Bar (Project Folders, Output Profile, Job Tray, Creator Kit Download) */}
      <div className="border-b border-slate-800 bg-slate-900/50 px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Story Folder
          </label>
          <select
            value={activeProject.id}
            onChange={(e) => onSelectProject(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (Canon v{p.bibleVersion})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-700 hover:border-slate-500 bg-slate-900 text-xs text-slate-200 whitespace-nowrap shrink-0"
          >
            <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
            New Story
          </button>

          <span className="text-slate-600 hidden sm:inline">·</span>
          <span className="text-xs font-mono tabular-nums text-slate-400">
            {activeProject.activeEpisode.episodeCode} · {activeProject.activeEpisode.scenes.length} scenes
            {saving ? " · saving" : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Output Format Switcher (9:16 primary, 16:9 toggle, Both) */}
          <div className="inline-flex items-center rounded border border-slate-700 bg-slate-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                onChangeOutputProfile("9x16");
                onToggleRenderTargets(["9x16"]);
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded whitespace-nowrap ${
                !isBoth && activeProfile === "9x16"
                  ? "bg-slate-800 text-amber-400 font-medium"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <RectangleVertical className="w-3 h-3" />
              9:16
            </button>
            <button
              type="button"
              onClick={() => {
                onChangeOutputProfile("16x9");
                onToggleRenderTargets(["16x9"]);
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded whitespace-nowrap ${
                !isBoth && activeProfile === "16x9"
                  ? "bg-slate-800 text-amber-400 font-medium"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <RectangleHorizontal className="w-3 h-3" />
              16:9
            </button>
            <button
              type="button"
              onClick={() => onToggleRenderTargets(["9x16", "16x9"])}
              className={`px-2.5 py-1 rounded whitespace-nowrap ${
                isBoth ? "bg-slate-800 text-amber-400 font-medium" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Both
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowJobDrawer(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-700 bg-slate-900 hover:border-slate-500 text-xs text-slate-200 whitespace-nowrap shrink-0 font-mono tabular-nums"
          >
            <Activity className={`w-3.5 h-3.5 ${runningJobs.length > 0 ? "text-amber-400" : "text-slate-400"}`} />
            Jobs ({runningJobs.length > 0 ? `${runningJobs.length} active` : jobs.length})
          </button>

          <a
            href="/api/kit/download"
            download
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-700 bg-slate-900 hover:border-amber-500/70 text-xs text-slate-200 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-amber-500" />
            Creator Kit (.zip)
          </a>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-6 py-6">{children}</main>

      {/* New Story Project Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSubmit}
            className="bg-slate-900 border border-slate-700 rounded-lg max-w-md w-full p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-50">Create New Story Project</h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Series / Story Title</label>
              <input
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Harbor Line, Glass Harbor..."
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Genre</label>
                <input
                  value={newGenre}
                  onChange={(e) => setNewGenre(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Target Runtime (s)</label>
                <input
                  type="number"
                  min={15}
                  max={1800}
                  value={newRuntime}
                  onChange={(e) => setNewRuntime(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm font-mono text-slate-100"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Logline & Premise</label>
              <textarea
                rows={3}
                value={newLogline}
                onChange={(e) => setNewLogline(e.target.value)}
                placeholder="Core tension, setting, and emotional stakes..."
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-3 py-1.5 rounded border border-slate-700 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs"
              >
                {creating ? "Creating..." : "Create Project Folder"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Job Tray Drawer */}
      {showJobDrawer && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex justify-end">
          <div className="w-full max-w-md bg-slate-900 border-l border-slate-700 h-full flex flex-col">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Studio Background Jobs</h2>
              <button
                type="button"
                onClick={() => setShowJobDrawer(false)}
                className="text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {jobs.length === 0 && (
                <p className="text-xs text-slate-400">No background jobs recorded for this project yet.</p>
              )}
              {jobs.map((job) => (
                <div key={job.id} className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-200">{job.phase}</span>
                    <span
                      className={
                        job.status === "succeeded"
                          ? "text-emerald-400"
                          : job.status === "failed"
                          ? "text-red-400"
                          : "text-amber-400"
                      }
                    >
                      {job.status} · {job.progress}%
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{job.message}</p>
                  <div className="w-full h-1 bg-slate-800 rounded overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        job.status === "failed"
                          ? "bg-red-500"
                          : job.status === "succeeded"
                          ? "bg-emerald-500"
                          : "bg-amber-500"
                      }`}
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
