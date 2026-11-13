import React, { useState } from "react";
import { Check, MapPin, Plus, Sparkles, Upload, UserCheck } from "lucide-react";
import { Character, LocationPlate, OutputProfile, ProjectFolder } from "../../contracts/schemas";
import { HealthCapabilities } from "../../stores/useStudioStores";

interface BibleCastTabProps {
  project: ProjectFolder;
  capabilities: HealthCapabilities;
  outputProfile: OutputProfile;
  onUpdateProject: (updater: (prev: ProjectFolder) => ProjectFolder) => void;
  onSyncProject: (proj: ProjectFolder) => void;
  onToast: (type: "info" | "success" | "error" | "warning", msg: string, tb?: string) => void;
}

export function BibleCastTab({
  project,
  capabilities,
  outputProfile,
  onUpdateProject,
  onSyncProject,
  onToast,
}: BibleCastTabProps) {
  const [subView, setSubView] = useState<"cast" | "locations" | "bible" | "wkw">("cast");
  const [busyCharId, setBusyCharId] = useState<string | null>(null);
  const [busyLocId, setBusyLocId] = useState<string | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string>(project.characters[0]?.id || "");

  const selectedChar =
    project.characters.find((c) => c.id === selectedCharId) || project.characters[0] || null;

  const handleGenerateCharRef = async (char: Character) => {
    setBusyCharId(char.id);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/characters/ref`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: char.id,
          wardrobeId: char.wardrobeIds[0] || "day1",
          outputProfile,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Reference sheet generation failed", data.error?.traceback);
        return;
      }
      onSyncProject(data.project);
      onToast("success", `Generated neutral reference sheet for ${char.name}.`);
    } finally {
      setBusyCharId(null);
    }
  };

  const handleUploadCharRef = async (char: Character, file?: File) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "character_ref");
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      onToast("error", data.error?.message || "Upload failed");
      return;
    }
    const assetId = data.asset.assetId as string;
    const wKey = char.wardrobeIds[0] || "day1";
    onUpdateProject((prev) => ({
      ...prev,
      characters: prev.characters.map((c) =>
        c.id === char.id
          ? {
              ...c,
              approvedRefAssetId: assetId,
              approvedRefVariants: { ...c.approvedRefVariants, [wKey]: assetId },
            }
          : c
      ),
    }));
    onToast("success", `Uploaded custom reference sheet for ${char.name}.`);
  };

  const handleGenerateLocationPlate = async (loc: LocationPlate) => {
    setBusyLocId(loc.id);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/locations/plate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: loc.id, outputProfile }),
      });
      const data = await res.json();
      if (!res.ok) {
        onToast("error", data.error?.message || "Location plate failed", data.error?.traceback);
        return;
      }
      onSyncProject(data.project);
      onToast("success", `Approved plate saved for ${loc.name}.`);
    } finally {
      setBusyLocId(null);
    }
  };

  const handleAddCharacter = () => {
    const idx = project.characters.length + 1;
    const newId = `char_${Date.now()}`;
    const nextChar: Character = {
      id: newId,
      name: `New Character ${idx}`,
      age: "29",
      role: "Supporting Lead",
      city: "Chicago",
      physicalDescription: "Adult fictional character, natural expression, contemporary realistic wardrobe.",
      goal: "Protect their leverage.",
      fear: "",
      secret: "",
      contradiction: "",
      moralBoundary: "",
      aliases: [`New Character ${idx}`],
      wardrobeIds: ["day1"],
      voiceProfile: {
        elevenlabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
        edgeTtsVoice: "en-US-AriaNeural",
        deliveryStyle: "Grounded and natural",
      },
      approvedRefVariants: {},
      bibleVersionAdded: project.bibleVersion,
      isAdultConfirmed: true,
    };
    onUpdateProject((prev) => ({
      ...prev,
      characters: [...prev.characters, nextChar],
    }));
    setSelectedCharId(newId);
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation & Summary Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-50 tracking-tight">
            {project.seriesBible.title} · Series Bible & Cast
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
            Canon v{project.bibleVersion} · {project.characters.length} cast profiles ·{" "}
            {project.characters.filter((c) => c.approvedRefAssetId).length} approved sheets ·{" "}
            {project.locations.length} locations · {project.completedChapters.length} chapters archived
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {[
            { id: "cast", label: "Cast Roster" },
            { id: "locations", label: "Locations" },
            { id: "bible", label: "Series Bible" },
            { id: "wkw", label: `WKW Ledger (${project.wkwLedger.length})` },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubView(item.id as typeof subView)}
              className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap ${
                subView === item.id
                  ? "bg-slate-800 text-amber-400 border border-slate-700"
                  : "text-slate-400 hover:text-slate-100 border border-transparent"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* View 1: Cast Roster */}
      {subView === "cast" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <aside className="lg:col-span-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Character Roster
              </span>
              <button
                type="button"
                onClick={handleAddCharacter}
                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                <Plus className="w-3.5 h-3.5" /> Add Cast
              </button>
            </div>
            <div className="space-y-2 max-h-[680px] overflow-y-auto pr-1">
              {project.characters.map((char) => {
                const isSelected = selectedChar?.id === char.id;
                const hasRef = Boolean(char.approvedRefAssetId);
                return (
                  <button
                    key={char.id}
                    type="button"
                    onClick={() => setSelectedCharId(char.id)}
                    className={`w-full text-left p-3 rounded border transition-colors flex items-center gap-3 ${
                      isSelected
                        ? "bg-slate-900 border-amber-500/70"
                        : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="w-11 h-14 rounded bg-slate-950 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                      {char.approvedRefAssetId ? (
                        <img
                          src={`/api/assets/${char.approvedRefAssetId}`}
                          alt={char.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xs font-mono text-slate-500">
                          {char.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-100 truncate">
                          {char.name}
                        </span>
                        {hasRef ? (
                          <span className="text-[11px] font-mono text-emerald-400 shrink-0">
                            Locked
                          </span>
                        ) : (
                          <span className="text-[11px] font-mono text-slate-500 shrink-0">
                            No Ref
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 truncate">
                        {char.role} · {char.city}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="lg:col-span-8">
            {selectedChar ? (
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-slate-50">
                      {selectedChar.name}
                    </h2>
                    <p className="text-xs font-mono text-slate-400">
                      Age {selectedChar.age} · {selectedChar.city} · Added Canon v
                      {selectedChar.bibleVersionAdded}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busyCharId === selectedChar.id}
                      onClick={() => handleGenerateCharRef(selectedChar)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold text-xs whitespace-nowrap disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {busyCharId === selectedChar.id
                        ? "Generating Sheet..."
                        : selectedChar.approvedRefAssetId
                        ? "Regenerate Ref Sheet"
                        : "Generate Neutral Ref Sheet"}
                    </button>
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500 bg-slate-950 text-xs text-slate-200 cursor-pointer whitespace-nowrap">
                      <Upload className="w-3.5 h-3.5 text-slate-400" />
                      Upload Ref PNG
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleUploadCharRef(selectedChar, e.target.files?.[0])}
                      />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                  {/* Reference Portrait Preview */}
                  <div className="md:col-span-4 space-y-2">
                    <div className="aspect-[9/16] bg-slate-950 border border-slate-800 rounded overflow-hidden flex items-center justify-center">
                      {selectedChar.approvedRefAssetId ? (
                        <img
                          src={`/api/assets/${selectedChar.approvedRefAssetId}`}
                          alt={selectedChar.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center p-4 space-y-1">
                          <UserCheck className="w-6 h-6 text-slate-600 mx-auto" />
                          <p className="text-xs text-slate-500">
                            Generate or upload a neutral reference portrait before rendering scenes.
                          </p>
                        </div>
                      )}
                    </div>
                    {selectedChar.approvedRefAssetId && (
                      <p className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Approved Ref Locked
                      </p>
                    )}
                  </div>

                  {/* Character Canon & Voice Casting Fields */}
                  <div className="md:col-span-8 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Name</label>
                        <input
                          value={selectedChar.name}
                          onChange={(e) =>
                            onUpdateProject((prev) => ({
                              ...prev,
                              characters: prev.characters.map((c) =>
                                c.id === selectedChar.id ? { ...c, name: e.target.value } : c
                              ),
                            }))
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Age & City</label>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={selectedChar.age}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                characters: prev.characters.map((c) =>
                                  c.id === selectedChar.id ? { ...c, age: e.target.value } : c
                                ),
                              }))
                            }
                            className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                          />
                          <input
                            value={selectedChar.city}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                characters: prev.characters.map((c) =>
                                  c.id === selectedChar.id ? { ...c, city: e.target.value } : c
                                ),
                              }))
                            }
                            className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Physical & Wardrobe Spec (Canon Anchor)
                      </label>
                      <textarea
                        rows={3}
                        value={selectedChar.physicalDescription}
                        onChange={(e) =>
                          onUpdateProject((prev) => ({
                            ...prev,
                            characters: prev.characters.map((c) =>
                              c.id === selectedChar.id
                                ? { ...c, physicalDescription: e.target.value }
                                : c
                            ),
                          }))
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Core Goal</label>
                        <input
                          value={selectedChar.goal}
                          onChange={(e) =>
                            onUpdateProject((prev) => ({
                              ...prev,
                              characters: prev.characters.map((c) =>
                                c.id === selectedChar.id ? { ...c, goal: e.target.value } : c
                              ),
                            }))
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Secret</label>
                        <input
                          value={selectedChar.secret}
                          onChange={(e) =>
                            onUpdateProject((prev) => ({
                              ...prev,
                              characters: prev.characters.map((c) =>
                                c.id === selectedChar.id ? { ...c, secret: e.target.value } : c
                              ),
                            }))
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Aliases (comma-separated)
                        </label>
                        <input
                          value={selectedChar.aliases.join(", ")}
                          onChange={(e) =>
                            onUpdateProject((prev) => ({
                              ...prev,
                              characters: prev.characters.map((c) =>
                                c.id === selectedChar.id
                                  ? {
                                      ...c,
                                      aliases: e.target.value
                                        .split(",")
                                        .map((x) => x.trim())
                                        .filter(Boolean),
                                    }
                                  : c
                              ),
                            }))
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          ElevenLabs Voice ID
                        </label>
                        <div className="flex gap-1.5">
                          <select
                            value={selectedChar.voiceProfile.elevenlabsVoiceId || ""}
                            onChange={(e) =>
                              onUpdateProject((prev) => ({
                                ...prev,
                                characters: prev.characters.map((c) =>
                                  c.id === selectedChar.id
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
                            className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-100"
                          >
                            {capabilities.elevenlabsPresets.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Add a character to start building your cast.</p>
            )}
          </section>
        </div>
      )}

      {/* View 2: Locations */}
      {subView === "locations" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {project.locations.map((loc) => (
            <div key={loc.id} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col">
              <div className="aspect-video bg-slate-950 border-b border-slate-800 flex items-center justify-center overflow-hidden">
                {loc.approvedPlateAssetId ? (
                  <img
                    src={`/api/assets/${loc.approvedPlateAssetId}`}
                    alt={loc.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <MapPin className="w-6 h-6 text-slate-600" />
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-slate-100">{loc.name}</h3>
                    <span className="text-[11px] font-mono text-amber-400">{loc.city}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{loc.description}</p>
                </div>
                <button
                  type="button"
                  disabled={busyLocId === loc.id}
                  onClick={() => handleGenerateLocationPlate(loc)}
                  className="w-full py-1.5 px-3 rounded border border-slate-700 hover:border-amber-500/70 bg-slate-950 text-xs text-slate-100 font-medium"
                >
                  {busyLocId === loc.id
                    ? "Generating Plate..."
                    : loc.approvedPlateAssetId
                    ? "Regenerate Location Plate"
                    : "Generate Empty Plate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View 3: Series Bible */}
      {subView === "bible" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-100">Core Story Engine</h2>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Logline</label>
              <textarea
                rows={3}
                value={project.seriesBible.logline}
                onChange={(e) =>
                  onUpdateProject((prev) => ({
                    ...prev,
                    seriesBible: { ...prev.seriesBible, logline: e.target.value },
                  }))
                }
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Story Engine Formula</label>
              <textarea
                rows={2}
                value={project.seriesBible.storyEngineFormula}
                onChange={(e) =>
                  onUpdateProject((prev) => ({
                    ...prev,
                    seriesBible: { ...prev.seriesBible, storyEngineFormula: e.target.value },
                  }))
                }
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Central Question</label>
              <input
                value={project.seriesBible.centralQuestion}
                onChange={(e) =>
                  onUpdateProject((prev) => ({
                    ...prev,
                    seriesBible: { ...prev.seriesBible, centralQuestion: e.target.value },
                  }))
                }
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-slate-100"
              />
            </div>
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-100">Locked Canon Facts (v{project.bibleVersion})</h2>
            <ul className="space-y-2 text-xs text-slate-300">
              {project.seriesBible.canonFacts.map((fact, idx) => (
                <li key={idx} className="bg-slate-950 border border-slate-800 rounded px-3 py-2">
                  {fact}
                </li>
              ))}
            </ul>
            <h3 className="text-xs font-medium text-slate-400 pt-2">City Color Grades</h3>
            <div className="space-y-2">
              {Object.entries(project.seriesBible.cityColorGrades).map(([city, grade]) => (
                <div key={city} className="bg-slate-950 border border-slate-800 rounded p-2.5 text-xs">
                  <span className="font-mono text-amber-400 uppercase">{city}:</span>{" "}
                  <span className="text-slate-300">{grade}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* View 4: Who Knows What (WKW) Ledger */}
      {subView === "wkw" && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono">
              <tr>
                <th className="px-4 py-3">Character</th>
                <th className="px-4 py-3">Fact / Secret</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Window</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {project.wkwLedger.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-3 font-medium text-slate-100">{entry.characterId}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.factSummary}</td>
                  <td className="px-4 py-3 font-mono">
                    {entry.knows ? (
                      <span className="text-emerald-400">KNOWS</span>
                    ) : (
                      <span className="text-amber-400">UNAWARE</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{entry.revealedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
