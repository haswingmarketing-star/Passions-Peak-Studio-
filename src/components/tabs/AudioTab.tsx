import React, { useState } from "react";
import { Captions, Music, Play, Sparkles, Volume2 } from "lucide-react";
import { ProjectFolder, Scene } from "../../contracts/schemas";
import { HealthCapabilities } from "../../stores/useStudioStores";

interface AudioTabProps {
  project: ProjectFolder;
  capabilities: HealthCapabilities;
  onUpdateProject: (updater: (prev: ProjectFolder) => ProjectFolder) => void;
  onSyncProject: (proj: ProjectFolder) => void;
  onToast: (type: "info" | "success" | "error" | "warning", msg: string, tb?: string) => void;
}

export function AudioTab({
  project,
  capabilities,
  onUpdateProject,
  onSyncProject,
  onToast,
}: AudioTabProps) {
  const ep = project.activeEpisode;
  const [preferFallback, setPreferFallback] = useState(!capabilities.elevenlabsConfigured);
  const [synthBusyId, setSynthBusyId] = useState<number | "all" | null>(null);
  const [lyriaBusyId, setLyriaBusyId] = useState<number | null>(null);
  const [useLyriaPro, setUseLyriaPro] = useState(false);
  const [srtBusy, setSrtBusy] = useState(false);

  const speakBrowserPreview = (text: string) => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.02;
      window.speechSynthesis.speak(utter);
    }
  };

  const handleSynthesizeVo = async (sceneId?: number) => {
    setSynthBusyId(sceneId ?? "all");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/audio/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId, preferFallback }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Voiceover synthesis failed");
        return;
      }
      onSyncProject(data.project);
      if (data.warnings?.length) {
        onToast("warning", data.warnings[0]);
      } else {
        onToast("success", `Synthesized ElevenLabs voiceover (${data.charsUsed} chars).`);
      }
    } finally {
      setSynthBusyId(null);
    }
  };

  const handleGenerateLyriaBgm = async (scene: Scene) => {
    setLyriaBusyId(scene.id);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/audio/bgm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: scene.id,
          prompt: scene.lyriaBgmPrompt,
          pro: useLyriaPro,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Lyria synthesis failed", data.error?.traceback);
        return;
      }
      onSyncProject(data.project);
      onToast("success", `Synthesized Lyria BGM clip for Scene ${scene.id} (${data.model}).`);
    } finally {
      setLyriaBusyId(null);
    }
  };

  const handleBuildSrt = async () => {
    setSrtBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/audio/srt`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "SRT build failed");
        return;
      }
      onSyncProject(data.project);
      onToast("success", "Compiled synchronized SRT captions.");
    } finally {
      setSrtBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Voice Engine & Mix Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold text-slate-50">
                Voice Casting (ElevenLabs + Edge-TTS Kit)
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                {capabilities.elevenlabsConfigured
                  ? "Server ELEVENLABS_API_KEY detected. Synthesizes studio MP3 clips directly."
                  : "ELEVENLABS_API_KEY not set in server environment. Cast Voice IDs for Python Creator Kit / Edge-TTS fallback and preview via Web Speech."}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={preferFallback}
                onChange={(e) => setPreferFallback(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950"
              />
              Use Free Edge-TTS / Local Preview
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-56 overflow-y-auto pr-1">
            {project.characters.slice(0, 6).map((ch) => (
              <div key={ch.id} className="bg-slate-950 border border-slate-800 rounded p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-100">{ch.name}</span>
                  <span className="font-mono text-[11px] text-slate-500">{ch.city}</span>
                </div>
                <select
                  value={ch.voiceProfile.elevenlabsVoiceId || ""}
                  onChange={(e) =>
                    onUpdateProject((prev) => ({
                      ...prev,
                      characters: prev.characters.map((c) =>
                        c.id === ch.id
                          ? {
                              ...c,
                              voiceProfile: {
                                ...c.voiceProfile,
                                elevenlabsVoiceId: e.target.value,
                              },
                            }
                          : c
                      ),
                    }))
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] font-mono text-slate-200"
                >
                  {capabilities.elevenlabsPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="flex items-center gap-4 text-xs">
              <label className="text-slate-400">
                BGM Vol{" "}
                <span className="font-mono text-slate-200">{ep.bgmConfig.volume.toFixed(2)}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={ep.bgmConfig.volume}
                  onChange={(e) =>
                    onUpdateProject((prev) => ({
                      ...prev,
                      activeEpisode: {
                        ...prev.activeEpisode,
                        bgmConfig: {
                          ...prev.activeEpisode.bgmConfig,
                          volume: Number(e.target.value),
                        },
                      },
                    }))
                  }
                  className="ml-2 align-middle"
                />
              </label>
              <label className="text-slate-400">
                Ducking <span className="font-mono text-slate-200">{ep.bgmConfig.duckingDb}dB</span>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={ep.bgmConfig.duckingDb}
                  onChange={(e) =>
                    onUpdateProject((prev) => ({
                      ...prev,
                      activeEpisode: {
                        ...prev.activeEpisode,
                        bgmConfig: {
                          ...prev.activeEpisode.bgmConfig,
                          duckingDb: Number(e.target.value),
                        },
                      },
                    }))
                  }
                  className="ml-2 align-middle"
                />
              </label>
            </div>

            <button
              type="button"
              disabled={synthBusyId !== null || ep.scenes.length === 0}
              onClick={() => handleSynthesizeVo()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs disabled:opacity-40 whitespace-nowrap"
            >
              <Volume2 className="w-3.5 h-3.5" />
              {synthBusyId === "all" ? "Synthesizing..." : "Synthesize All Voiceovers"}
            </button>
          </div>
        </section>

        {/* Right: Synchronized SRT Editor */}
        <section className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Captions className="w-4 h-4 text-amber-500" />
              SRT Subtitles
            </h2>
            <button
              type="button"
              disabled={srtBusy || ep.scenes.length === 0}
              onClick={handleBuildSrt}
              className="px-2.5 py-1 rounded border border-slate-700 hover:border-slate-500 bg-slate-950 text-xs text-slate-200 disabled:opacity-40"
            >
              {srtBusy ? "Compiling..." : "Compile SRT from Beats"}
            </button>
          </div>
          <textarea
            rows={10}
            value={ep.srtContent}
            onChange={(e) =>
              onUpdateProject((prev) => ({
                ...prev,
                activeEpisode: { ...prev.activeEpisode, srtContent: e.target.value },
              }))
            }
            placeholder="Click 'Compile SRT from Beats' after drafting your script..."
            className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-xs font-mono text-slate-200"
          />
        </section>
      </div>

      {/* Per-Scene Dialogue Audio + Lyria BGM Generation */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Scene Audio & Lyria Score Generator
            </h2>
            <p className="text-xs text-slate-400">
              Generate scene-matched BGM via Lyria (`lyria-3-clip-preview` / `lyria-3-pro-preview`) and preview individual line clips.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-300 font-mono">
            <input
              type="checkbox"
              checked={useLyriaPro}
              onChange={(e) => setUseLyriaPro(e.target.checked)}
              className="rounded border-slate-700 bg-slate-950"
            />
            Use lyria-3-pro-preview
          </label>
        </div>

        <div className="space-y-3">
          {ep.scenes.map((scene) => (
            <div
              key={scene.id}
              className="bg-slate-950 border border-slate-800 rounded p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center"
            >
              <div className="lg:col-span-5 space-y-1">
                <div className="text-xs font-mono text-slate-400">
                  <span className="text-amber-400">SCENE {scene.id}</span> · {scene.speaker} ·{" "}
                  {scene.durationSeconds}s
                </div>
                <p className="text-xs text-slate-100">"{scene.narration}"</p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleSynthesizeVo(scene.id)}
                    disabled={synthBusyId === scene.id}
                    className="px-2.5 py-1 rounded border border-slate-700 hover:border-amber-500 text-xs text-slate-200"
                  >
                    {synthBusyId === scene.id ? "Synth..." : "Synthesize VO"}
                  </button>
                  <button
                    type="button"
                    onClick={() => speakBrowserPreview(scene.narration)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-700 hover:border-slate-500 text-xs text-slate-300"
                  >
                    <Play className="w-3 h-3" /> Speech Preview
                  </button>
                </div>
                {scene.audioAssetId && (
                  <audio controls src={`/api/assets/${scene.audioAssetId}`} className="w-full h-8 mt-2" />
                )}
              </div>

              <div className="lg:col-span-7 space-y-1.5">
                <label className="block text-[11px] font-mono text-slate-400">
                  Lyria BGM Prompt
                </label>
                <div className="flex gap-2">
                  <input
                    value={scene.lyriaBgmPrompt}
                    onChange={(e) =>
                      onUpdateProject((prev) => ({
                        ...prev,
                        activeEpisode: {
                          ...prev.activeEpisode,
                          scenes: prev.activeEpisode.scenes.map((s) =>
                            s.id === scene.id ? { ...s, lyriaBgmPrompt: e.target.value } : s
                          ),
                        },
                      }))
                    }
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200"
                  />
                  <button
                    type="button"
                    disabled={lyriaBusyId === scene.id}
                    onClick={() => handleGenerateLyriaBgm(scene)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-amber-400 whitespace-nowrap"
                  >
                    <Music className="w-3.5 h-3.5" />
                    {lyriaBusyId === scene.id ? "Generating..." : "Generate Lyria BGM"}
                  </button>
                </div>
                {scene.bgmAssetId && (
                  <audio controls src={`/api/assets/${scene.bgmAssetId}`} className="w-full h-8 mt-1" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
