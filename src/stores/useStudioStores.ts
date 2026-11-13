import { useCallback, useEffect, useRef, useState } from "react";
import {
  Episode,
  Job,
  OutputProfile,
  ProjectFolder,
} from "../contracts/schemas";

export interface HealthCapabilities {
  geminiConfigured: boolean;
  elevenlabsConfigured: boolean;
  elevenlabsPresets: Array<{ id: string; label: string }>;
}

export interface StudioToast {
  id: string;
  type: "info" | "success" | "error" | "warning";
  message: string;
  traceback?: string;
}

/**
 * Store 1: Canon Cache (seriesBible, characters, locations, WKW ledger) pinned to bibleVersion.
 * Store 2: Episode Workspace (draft scenes, active output profile, autosaved with debounce).
 * Store 3: Job Mirror (authoritative server job list hydrated via GET + SSE /api/events).
 */
export function useStudioStores() {
  const [projects, setProjects] = useState<ProjectFolder[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectFolder | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [capabilities, setCapabilities] = useState<HealthCapabilities>({
    geminiConfigured: false,
    elevenlabsConfigured: false,
    elevenlabsPresets: [],
  });
  const [toasts, setToasts] = useState<StudioToast[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const saveTimerRef = useRef<number | null>(null);

  const pushToast = useCallback(
    (type: StudioToast["type"], message: string, traceback?: string) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-4), { id, type, message, traceback }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, type === "error" ? 10000 : 5000);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const syncProjectIntoList = useCallback((proj: ProjectFolder) => {
    setActiveProject(proj);
    setProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === proj.id);
      if (idx === -1) return [...prev, proj];
      const next = [...prev];
      next[idx] = proj;
      return next;
    });
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [healthRes, projRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/projects"),
      ]);
      if (healthRes.ok) {
        const h = await healthRes.json();
        setCapabilities({
          geminiConfigured: Boolean(h.geminiConfigured),
          elevenlabsConfigured: Boolean(h.elevenlabsConfigured),
          elevenlabsPresets: Array.isArray(h.elevenlabsPresets) ? h.elevenlabsPresets : [],
        });
      }
      if (projRes.ok) {
        const pData = await projRes.json();
        const list: ProjectFolder[] = pData.projects || [];
        setProjects(list);
        const active =
          list.find((p) => p.id === pData.activeProjectId) || list[0] || null;
        setActiveProject(active);
        if (active) {
          const jobsRes = await fetch(`/api/jobs?projectId=${encodeURIComponent(active.id)}`);
          if (jobsRes.ok) {
            const jData = await jobsRes.json();
            setJobs(jData.jobs || []);
          }
        }
      }
    } catch (err) {
      pushToast("error", `Failed to load studio state: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Job Mirror SSE subscription (/api/events)
  useEffect(() => {
    const es = new EventSource("/api/events");
    const onJob = (evt: MessageEvent) => {
      try {
        const job = JSON.parse(evt.data) as Job;
        setJobs((prev) => {
          const idx = prev.findIndex((j) => j.id === job.id);
          if (idx === -1) return [job, ...prev].slice(0, 60);
          const next = [...prev];
          next[idx] = job;
          return next;
        });
      } catch {
        // Ignore malformed SSE heartbeats
      }
    };
    es.addEventListener("job", onJob);
    return () => {
      es.removeEventListener("job", onJob);
      es.close();
    };
  }, []);

  const persistProjectImmediate = useCallback(
    async (proj: ProjectFolder): Promise<ProjectFolder> => {
      setSaving(true);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(proj.id)}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(proj),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || "Failed to persist project state");
        }
        syncProjectIntoList(data.project);
        return data.project as ProjectFolder;
      } finally {
        setSaving(false);
      }
    },
    [syncProjectIntoList]
  );

  // Debounced autosave for Episode Workspace & Canon edits
  const updateProjectDraft = useCallback(
    (updater: (prev: ProjectFolder) => ProjectFolder) => {
      setActiveProject((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        setProjects((list) => list.map((p) => (p.id === next.id ? next : p)));

        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          void persistProjectImmediate(next).catch((err) => {
            pushToast("error", err instanceof Error ? err.message : String(err));
          });
        }, 550);
        return next;
      });
    },
    [persistProjectImmediate, pushToast]
  );

  const selectProject = useCallback(
    async (projectId: string) => {
      const res = await fetch("/api/projects/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        pushToast("error", data.error?.message || "Failed to switch project");
        return;
      }
      syncProjectIntoList(data.project);
      const jobsRes = await fetch(`/api/jobs?projectId=${encodeURIComponent(projectId)}`);
      if (jobsRes.ok) {
        const jData = await jobsRes.json();
        setJobs(jData.jobs || []);
      }
      pushToast("info", `Switched to "${data.project.name}".`);
    },
    [pushToast, syncProjectIntoList]
  );

  const createProject = useCallback(
    async (params: { name: string; genre: string; logline: string; targetRuntimeSeconds: number }) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        pushToast("error", data.error?.message || "Failed to create project");
        return null;
      }
      syncProjectIntoList(data.project);
      setJobs([]);
      pushToast("success", `Created story project "${data.project.name}".`);
      return data.project as ProjectFolder;
    },
    [pushToast, syncProjectIntoList]
  );

  const setActiveOutputProfile = useCallback(
    (profile: OutputProfile) => {
      updateProjectDraft((prev) => ({
        ...prev,
        activeEpisode: {
          ...prev.activeEpisode,
          activeProfile: profile,
          renderTargets: prev.activeEpisode.renderTargets.includes(profile)
            ? prev.activeEpisode.renderTargets
            : [...prev.activeEpisode.renderTargets, profile],
        },
      }));
    },
    [updateProjectDraft]
  );

  const toggleDualRenderTarget = useCallback(
    (targets: OutputProfile[]) => {
      updateProjectDraft((prev) => ({
        ...prev,
        activeEpisode: {
          ...prev.activeEpisode,
          renderTargets: targets.length > 0 ? targets : ["9x16"],
        },
      }));
    },
    [updateProjectDraft]
  );

  const updateEpisode = useCallback(
    (updater: (ep: Episode) => Episode) => {
      updateProjectDraft((prev) => ({
        ...prev,
        activeEpisode: updater(prev.activeEpisode),
      }));
    },
    [updateProjectDraft]
  );

  return {
    projects,
    activeProject,
    jobs,
    capabilities,
    toasts,
    loading,
    saving,
    pushToast,
    dismissToast,
    syncProjectIntoList,
    persistProjectImmediate,
    updateProjectDraft,
    updateEpisode,
    selectProject,
    createProject,
    setActiveOutputProfile,
    toggleDualRenderTarget,
    refreshAll,
  };
}
