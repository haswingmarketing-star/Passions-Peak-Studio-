import React, { useEffect, useRef, useState } from "react";
import {
  Archive,
  Download,
  FileCode2,
  Film,
  Layers,
  Pause,
  Play,
  Terminal,
} from "lucide-react";
import { Job, OutputProfile, ProjectFolder } from "../../contracts/schemas";
import {
  PreviewLayerToggles,
  renderManifestFrameToCanvas,
} from "../../utils/canvasPreviewRenderer";

interface RenderExportTabProps {
  project: ProjectFolder;
  outputProfile: OutputProfile;
  jobs: Job[];
  onUpdateProject: (updater: (prev: ProjectFolder) => ProjectFolder) => void;
  onToast: (type: "info" | "success" | "error" | "warning", msg: string, tb?: string) => void;
}

export function RenderExportTab({
  project,
  outputProfile,
  jobs,
  onUpdateProject,
  onToast,
}: RenderExportTabProps) {
  const ep = project.activeEpisode;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [layers, setLayers] = useState<PreviewLayerToggles>({
    showBackground: true,
    showOverlay: true,
    showCaptions: true,
    showWatermark: true,
  });
  const [batchJsonText, setBatchJsonText] = useState(
    JSON.stringify(
      [
        {
          episodeCode: "EP 01",
          chapterNumber: 1,
          tone: "Urgent tense drama",
          duration: 30,
          outputProfile: "9x16",
        },
        {
          episodeCode: "EP 02",
          chapterNumber: 2,
          tone: "Quiet betrayal",
          duration: 30,
          outputProfile: "9x16",
        },
      ],
      null,
      2
    )
  );
  const [activeRenderJobId, setActiveRenderJobId] = useState<string | null>(null);
  const [activeBatchJobId, setActiveBatchJobId] = useState<string | null>(null);

  const totalDuration = Math.max(
    1,
    ep.scenes.reduce((acc, s) => acc + s.durationSeconds, 0)
  );

  // Playback timer
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayheadSec((prev) => {
        const next = prev + dt;
        return next >= totalDuration ? 0 : next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, totalDuration]);

  // Draw preview frame whenever playhead, layers, or episode edits change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void renderManifestFrameToCanvas({
      canvas,
      project,
      episode: ep,
      profile: outputProfile,
      playheadSec,
      layers,
    });
  }, [project, ep, outputProfile, playheadSec, layers]);

  const handleStartServerRender = async (previewOnly: boolean) => {
    const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targets: previewOnly ? [outputProfile] : ep.renderTargets,
        outputProfile,
        previewOnly,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      onToast("error", data.error?.message || "Failed to start MP4 render");
      return;
    }
    setActiveRenderJobId(data.job.id);
    onToast("info", previewOnly ? "Started 3-sec MP4 preview render." : "Started full MP4 master render.");
  };

  const handleStartBatch = async () => {
    try {
      const items = JSON.parse(batchJsonText);
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Failed to enqueue batch");
        return;
      }
      setActiveBatchJobId(data.batchJob.id);
      onToast("info", `Enqueued batch manifest (${items.length} episodes).`);
    } catch (err) {
      onToast("error", `Invalid batch JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const currentRenderJob =
    jobs.find((j) => j.id === activeRenderJobId) ||
    jobs.find((j) => j.type === "video_render");
  const currentBatchJob =
    jobs.find((j) => j.id === activeBatchJobId) ||
    jobs.find((j) => j.type === "batch_render");

  const renderedVideoAssetId =
    currentRenderJob?.status === "succeeded" ? currentRenderJob.outputAssetIds[0] : undefined;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Live RenderManifest Canvas Previewer */}
        <section className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-semibold text-slate-50">
              Live RenderManifest Preview ({outputProfile})
            </h1>
            <span className="text-xs font-mono tabular-nums text-amber-400">
              {playheadSec.toFixed(1)}s / {totalDuration.toFixed(1)}s
            </span>
          </div>

          <div className="flex justify-center bg-slate-950 border border-slate-800 rounded p-3">
            <canvas
              ref={canvasRef}
              width={outputProfile === "16x9" ? 640 : 360}
              height={outputProfile === "16x9" ? 360 : 640}
              className="max-h-[430px] w-auto rounded border border-slate-800"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="p-2 rounded bg-amber-600 hover:bg-amber-500 text-slate-950"
              aria-label={playing ? "Pause preview" : "Play preview"}
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={totalDuration}
              step={0.1}
              value={playheadSec}
              onChange={(e) => setPlayheadSec(Number(e.target.value))}
              className="flex-1"
            />
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-slate-300 pt-1">
            {[
              { key: "showBackground", label: "Frames" },
              { key: "showOverlay", label: "Overlays" },
              { key: "showCaptions", label: "Captions" },
              { key: "showWatermark", label: "Watermark" },
            ].map((item) => (
              <label key={item.key} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={layers[item.key as keyof PreviewLayerToggles]}
                  onChange={(e) =>
                    setLayers((prev) => ({ ...prev, [item.key]: e.target.checked }))
                  }
                  className="rounded border-slate-700 bg-slate-950"
                />
                {item.label}
              </label>
            ))}
          </div>
        </section>

        {/* Right: Composition Tuning, MP4 Render & Export Packages */}
        <section className="lg:col-span-7 space-y-5">
          {/* Render Controls */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Film className="w-4 h-4 text-amber-500" />
                MP4 Master Render (ffmpeg H.264 / AAC)
              </h2>
              <span className="text-xs font-mono text-slate-400">
                Targets: {ep.renderTargets.join(" + ")} · CRF {ep.renderConfig.crf} · {ep.renderConfig.fps}fps
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Caption Y% ({ep.captionStyle.positionY}%)
                </label>
                <input
                  type="range"
                  min={55}
                  max={92}
                  value={ep.captionStyle.positionY}
                  onChange={(e) =>
                    onUpdateProject((prev) => ({
                      ...prev,
                      activeEpisode: {
                        ...prev.activeEpisode,
                        captionStyle: {
                          ...prev.activeEpisode.captionStyle,
                          positionY: Number(e.target.value),
                        },
                      },
                    }))
                  }
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Font Size ({ep.captionStyle.fontSize}px)
                </label>
                <input
                  type="range"
                  min={24}
                  max={72}
                  value={ep.captionStyle.fontSize}
                  onChange={(e) =>
                    onUpdateProject((prev) => ({
                      ...prev,
                      activeEpisode: {
                        ...prev.activeEpisode,
                        captionStyle: {
                          ...prev.activeEpisode.captionStyle,
                          fontSize: Number(e.target.value),
                        },
                      },
                    }))
                  }
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Watermark Opacity ({ep.watermarkConfig.opacity})
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ep.watermarkConfig.opacity}
                  onChange={(e) =>
                    onUpdateProject((prev) => ({
                      ...prev,
                      activeEpisode: {
                        ...prev.activeEpisode,
                        watermarkConfig: {
                          ...prev.activeEpisode.watermarkConfig,
                          opacity: Number(e.target.value),
                        },
                      },
                    }))
                  }
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Watermark Corner</label>
                <select
                  value={ep.watermarkConfig.position}
                  onChange={(e) =>
                    onUpdateProject((prev) => ({
                      ...prev,
                      activeEpisode: {
                        ...prev.activeEpisode,
                        watermarkConfig: {
                          ...prev.activeEpisode.watermarkConfig,
                          position: e.target.value as typeof ep.watermarkConfig.position,
                        },
                      },
                    }))
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
                >
                  <option value="top_right">Top Right</option>
                  <option value="top_left">Top Left</option>
                  <option value="bottom_right">Bottom Right</option>
                  <option value="bottom_left">Bottom Left</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={ep.scenes.length === 0}
                onClick={() => handleStartServerRender(false)}
                className="flex-1 py-2 px-4 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs disabled:opacity-40 whitespace-nowrap"
              >
                Render Full MP4 ({ep.renderTargets.join(" + ")})
              </button>
              <button
                type="button"
                disabled={ep.scenes.length === 0}
                onClick={() => handleStartServerRender(true)}
                className="py-2 px-4 rounded border border-slate-700 hover:border-slate-500 bg-slate-950 text-xs text-slate-100 disabled:opacity-40 whitespace-nowrap"
              >
                Render 3-Sec Test Clip
              </button>
            </div>

            {currentRenderJob && (
              <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-200">{currentRenderJob.message}</span>
                  <span className="text-amber-400">{currentRenderJob.progress}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all"
                    style={{ width: `${currentRenderJob.progress}%` }}
                  />
                </div>
                {renderedVideoAssetId && (
                  <div className="pt-2 space-y-2">
                    <video
                      controls
                      src={`/api/assets/${renderedVideoAssetId}`}
                      className="w-full max-h-64 rounded border border-slate-800 bg-black"
                    />
                    <a
                      href={`/api/assets/${renderedVideoAssetId}`}
                      download={`${project.slug}_${ep.episodeCode}_${outputProfile}.mp4`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold text-xs"
                    >
                      <Download className="w-3.5 h-3.5" /> Download Rendered MP4
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Export Deliverables */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Archive className="w-4 h-4 text-amber-500" />
              Export Deliverables & Standalone Python Pipeline
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <a
                href={`/api/projects/${encodeURIComponent(project.id)}/export/motion-prompts?profile=${outputProfile}`}
                download
                className="p-3 rounded border border-slate-700 hover:border-amber-500/70 bg-slate-950 space-y-1 transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-100">
                  <FileCode2 className="w-3.5 h-3.5 text-amber-400" />
                  Motion Prompts (.txt)
                </div>
                <p className="text-[11px] text-slate-400">
                  Omni 1.2 Flash motion specs + full dialogue/VO script & timestamps.
                </p>
              </a>

              <a
                href={`/api/projects/${encodeURIComponent(project.id)}/export/bundle?profile=${outputProfile}`}
                download
                className="p-3 rounded border border-slate-700 hover:border-amber-500/70 bg-slate-950 space-y-1 transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-100">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Project Bundle (.zip)
                </div>
                <p className="text-[11px] text-slate-400">
                  RenderManifest v1 JSON + schema + assets + Bible snapshot.
                </p>
              </a>

              <a
                href="/api/kit/download"
                download
                className="p-3 rounded border border-slate-700 hover:border-amber-500/70 bg-slate-950 space-y-1 transition-colors"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-100">
                  <Terminal className="w-3.5 h-3.5 text-amber-400" />
                  Python Creator Kit (.zip)
                </div>
                <p className="text-[11px] text-slate-400">
                  Secret-scrubbed Flask + MoviePy + Whisper + Edge-TTS + pytest suite.
                </p>
              </a>
            </div>
          </div>

          {/* Batch Queue */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Batch Episode Queue</h2>
              <button
                type="button"
                onClick={handleStartBatch}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-amber-400"
              >
                Run Batch Manifest
              </button>
            </div>
            <textarea
              rows={5}
              value={batchJsonText}
              onChange={(e) => setBatchJsonText(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-xs font-mono text-slate-200"
            />
            {currentBatchJob && (
              <div className="bg-slate-950 border border-slate-800 rounded p-3 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300">
                  {currentBatchJob.message} ({currentBatchJob.progress}%)
                </span>
                {currentBatchJob.status === "succeeded" && currentBatchJob.outputAssetIds[0] && (
                  <a
                    href={`/api/assets/${currentBatchJob.outputAssetIds[0]}`}
                    download={`${project.slug}_batch.zip`}
                    className="px-2.5 py-1 rounded bg-emerald-600 text-slate-950 font-sans font-semibold"
                  >
                    Download Batch ZIP
                  </a>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
