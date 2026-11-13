function showToast(message, isError = false, tracebackText = "") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `p-3 rounded border text-xs shadow-lg ${
    isError ? "bg-red-950/95 border-red-700 text-red-100" : "bg-slate-900/95 border-slate-700 text-slate-100"
  }`;
  const msgNode = document.createElement("p");
  msgNode.textContent = message;
  el.appendChild(msgNode);
  if (tracebackText) {
    const det = document.createElement("details");
    det.className = "mt-1 text-[11px] font-mono opacity-80";
    const sum = document.createElement("summary");
    sum.textContent = "Traceback";
    const pre = document.createElement("pre");
    pre.className = "whitespace-pre-wrap mt-1 max-h-32 overflow-y-auto";
    pre.textContent = tracebackText;
    det.appendChild(sum);
    det.appendChild(pre);
    el.appendChild(det);
  }
  container.appendChild(el);
  setTimeout(() => el.remove(), isError ? 9000 : 4500);
}

window.studioApp = function studioApp() {
  return {
    activeTab: "script",
    outputProfile: "9x16",
    tabs: [
      { id: "script", label: "Script" },
      { id: "assets", label: "Assets & Visuals" },
      { id: "audio", label: "Audio & Captions" },
      { id: "preview", label: "Preview" },
      { id: "render", label: "Render" },
      { id: "batch", label: "Batch" },
    ],
    script: null,
    bgmPath: "",
    watermarkPath: "",
    voiceoverUrl: "",
    srtContent: "",
    lastRenderUrl: "",
    batchSummary: null,
    busy: { script: false, images: false, tts: false, captions: false, render: false },
    scriptForm: {
      genre: "urban drama",
      tone: "tense",
      duration: 30,
      characters: "Kena, Roberto, Desmond",
      extra: "",
    },
    audioForm: {
      tts_engine: "edge_tts",
      edge_voice: "en-US-AriaNeural",
      elevenlabs_voice_id: "21m00Tcm4TlvDq8ikWAM",
      bgm_volume: 0.32,
      ducking_db: 12,
    },
    renderForm: {
      caption_position_y: 84,
      caption_font_size: 44,
      watermark_opacity: 0.3,
      watermark_position: "top_right",
    },
    renderProgress: { jobId: "", progress: 0, message: "" },

    async init() {
      const res = await fetch("/api/state");
      if (res.ok) {
        const st = await res.json();
        this.outputProfile = st.output_profile || "9x16";
        this.script = st.script || null;
        this.bgmPath = st.bgm_path || "";
        this.watermarkPath = st.watermark_path || "";
        this.voiceoverUrl = st.voiceover_url || "";
        this.srtContent = st.srt_content || "";
        this.lastRenderUrl = st.last_render_url || "";
      }
    },

    async generateScript() {
      this.busy.script = true;
      try {
        const res = await fetch("/api/generate-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.scriptForm),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast(data.error?.message || "Script generation failed", true, data.error?.traceback);
          return;
        }
        this.script = data.script;
        showToast("Script generated.");
      } finally {
        this.busy.script = false;
      }
    },

    async generateImages() {
      this.busy.images = true;
      try {
        const res = await fetch("/api/generate-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ script: this.script, output_profile: this.outputProfile }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast(data.error?.message || "Image generation failed", true);
          return;
        }
        this.script = data.script;
        showToast(`Prepared ${data.images.length} scene frames.`);
      } finally {
        this.busy.images = false;
      }
    },

    async handleDrop(evt, role, sceneId = null) {
      const file = evt.dataTransfer?.files?.[0];
      if (file) await this.uploadAsset(file, role, sceneId);
    },

    async uploadAsset(file, role, sceneId = null) {
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("role", role);
      if (sceneId !== null) fd.append("scene_id", String(sceneId));
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.error?.message || "Upload failed", true);
        return;
      }
      if (role === "bgm") this.bgmPath = data.path;
      if (role === "watermark") this.watermarkPath = data.path;
      if (role === "scene" && sceneId !== null && this.script) {
        const target = this.script.scenes.find((s) => s.id === sceneId);
        if (target) target.image_path = data.path;
      }
      showToast("Asset uploaded.");
    },

    async importBundle(evt) {
      const file = evt.target.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import-bundle", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.error?.message || "Bundle import failed", true);
        return;
      }
      await this.init();
      showToast(`Imported bundle: ${data.manifest_title}`);
    },

    async synthesizeTts() {
      this.busy.tts = true;
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...this.audioForm, script: this.script }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast(data.error?.message || "TTS failed", true, data.error?.traceback);
          return;
        }
        this.voiceoverUrl = `${data.audio_url}?t=${Date.now()}`;
        showToast(data.warnings?.length ? data.warnings[0] : "Voiceover synthesized.");
      } finally {
        this.busy.tts = false;
      }
    },

    async generateCaptions() {
      this.busy.captions = true;
      try {
        const res = await fetch("/api/captions", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showToast(data.error?.message || "Caption transcription failed", true, data.error?.traceback);
          return;
        }
        this.srtContent = data.srt;
        showToast(`Generated ${data.cue_count} SRT cues.`);
      } finally {
        this.busy.captions = false;
      }
    },

    async startRender(previewOnly = false) {
      this.busy.render = true;
      const endpoint = previewOnly ? "/api/preview" : "/api/render";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: this.script,
          output_profile: this.outputProfile,
          ...this.scriptForm,
          ...this.audioForm,
          ...this.renderForm,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        this.busy.render = false;
        showToast(data.error?.message || "Failed to enqueue render", true);
        return;
      }
      this.renderProgress = { jobId: data.job_id, progress: 5, message: "Started render..." };
      window.subscribeJobProgress(data.job_id, (evt) => {
        this.renderProgress = {
          jobId: evt.job_id,
          progress: evt.progress ?? this.renderProgress.progress,
          message: evt.message ?? "",
        };
        if (evt.status === "completed") {
          this.busy.render = false;
          this.lastRenderUrl = `${evt.video_url}?t=${Date.now()}`;
          showToast("MP4 render complete.");
        } else if (evt.status === "failed") {
          this.busy.render = false;
          showToast(evt.message || "Render failed", true, evt.error?.traceback);
        }
      });
    },

    async runBatch(file) {
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/batch", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.error?.message || "Batch failed", true);
        return;
      }
      this.batchSummary = data;
      showToast(`Batch finished (${data.succeeded}/${data.total}).`);
    },
  };
};
