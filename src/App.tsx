import { useState } from "react";
import { StudioShell, StudioTabId } from "./components/StudioShell";
import { ToastStack } from "./components/ToastStack";
import { AudioTab } from "./components/tabs/AudioTab";
import { BibleCastTab } from "./components/tabs/BibleCastTab";
import { RenderExportTab } from "./components/tabs/RenderExportTab";
import { ScriptTab } from "./components/tabs/ScriptTab";
import { ThumbnailsTab } from "./components/tabs/ThumbnailsTab";
import { VisualsTab } from "./components/tabs/VisualsTab";
import { useStudioStores } from "./stores/useStudioStores";

export default function App() {
  const [activeTab, setActiveTab] = useState<StudioTabId>("bible");
  const {
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
    updateProjectDraft,
    selectProject,
    createProject,
    setActiveOutputProfile,
    toggleDualRenderTarget,
  } = useStudioStores();

  if (loading || !activeProject) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center text-sm font-mono">
        Loading Passions Peak Studio...
      </div>
    );
  }

  const outputProfile = activeProject.activeEpisode.activeProfile;

  return (
    <>
      <StudioShell
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        projects={projects}
        activeProject={activeProject}
        jobs={jobs}
        saving={saving}
        onSelectProject={selectProject}
        onCreateProject={createProject}
        onChangeOutputProfile={setActiveOutputProfile}
        onToggleRenderTargets={toggleDualRenderTarget}
        onPrimaryRenderClick={() => setActiveTab("export")}
      >
        {activeTab === "bible" && (
          <BibleCastTab
            project={activeProject}
            capabilities={capabilities}
            outputProfile={outputProfile}
            onUpdateProject={updateProjectDraft}
            onSyncProject={syncProjectIntoList}
            onToast={pushToast}
          />
        )}
        {activeTab === "script" && (
          <ScriptTab
            project={activeProject}
            outputProfile={outputProfile}
            onUpdateProject={updateProjectDraft}
            onSyncProject={syncProjectIntoList}
            onJumpToVisuals={() => setActiveTab("visuals")}
            onToast={pushToast}
          />
        )}
        {activeTab === "visuals" && (
          <VisualsTab
            project={activeProject}
            outputProfile={outputProfile}
            onUpdateProject={updateProjectDraft}
            onSyncProject={syncProjectIntoList}
            onToast={pushToast}
          />
        )}
        {activeTab === "thumbnails" && (
          <ThumbnailsTab
            project={activeProject}
            outputProfile={outputProfile}
            onSyncProject={syncProjectIntoList}
            onToast={pushToast}
          />
        )}
        {activeTab === "audio" && (
          <AudioTab
            project={activeProject}
            capabilities={capabilities}
            onUpdateProject={updateProjectDraft}
            onSyncProject={syncProjectIntoList}
            onToast={pushToast}
          />
        )}
        {activeTab === "export" && (
          <RenderExportTab
            project={activeProject}
            outputProfile={outputProfile}
            jobs={jobs}
            onUpdateProject={updateProjectDraft}
            onToast={pushToast}
          />
        )}
      </StudioShell>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
