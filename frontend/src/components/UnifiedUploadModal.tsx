"use client";

import * as React from "react";
import { type EntryConfig } from "../lib/mockData";
import { listGroups, saveGroup, deleteGroup, type ConfigGroup } from "../lib/groups";
import { parseTemplates, type ParsedSheet } from "../lib/parseUpload";
import {
  downloadWorkbook,
  estimateRows,
  parseISO,
  todayISO,
} from "../lib/templates";
import {
  IconX,
  IconSearch,
  IconCheck,
  IconCloud,
  IconFile,
  IconChevronRight,
  IconUpload,
  IconDownload,
} from "./Icons";

type Step = "select" | "uploading";

export function UnifiedUploadModal({
  configs,
  onClose,
  onProceed,
  preselectedIds,
  onPrepareConfig,
}: {
  configs: EntryConfig[];
  onClose: () => void;
  onProceed: (selected: EntryConfig[], fileName: string, parsedSheets: ParsedSheet[]) => void;
  preselectedIds?: string[];
  // Returns the cfg with real periodicity + columnDefs filled in (after
  // a forced warmup if needed). Used right before download so the template
  // reflects the real schema, never the placeholder.
  onPrepareConfig?: (cfg: EntryConfig) => Promise<EntryConfig>;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState("");
  const [plantFilter, setPlantFilter] = React.useState<string>("All");
  const [files, setFiles] = React.useState<File[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [step, setStep] = React.useState<Step>("select");
  const [progress, setProgress] = React.useState(0);
  const [fromDate, setFromDate] = React.useState<string>(todayISO(-6));
  const [toDate, setToDate] = React.useState<string>(todayISO(0));
  const [toast, setToast] = React.useState<string | null>(null);
  const [groups, setGroups] = React.useState<ConfigGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = React.useState<string | null>(null);
  const [saveGroupOpen, setSaveGroupOpen] = React.useState(false);
  const [newGroupName, setNewGroupName] = React.useState("");
  const [groupsExpanded, setGroupsExpanded] = React.useState(false);
  const GROUPS_VISIBLE = 6;
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setGroups(listGroups());
  }, []);

  // Seed the selection from preselectedIds (used when launched from a saved group on the landing)
  React.useEffect(() => {
    if (!preselectedIds || preselectedIds.length === 0) return;
    const next = new Set<string>();
    for (const id of preselectedIds) {
      if (configs.some((c) => c.id === id)) next.add(id);
    }
    setSelected(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedIds, configs]);

  const applyGroup = (g: ConfigGroup) => {
    const next = new Set<string>();
    for (const id of g.configIds) {
      if (configs.some((c) => c.id === id)) next.add(id);
    }
    setSelected(next);
    setActiveGroupId(g.id);
  };

  const handleSaveGroup = () => {
    if (!newGroupName.trim()) return;
    try {
      const created = saveGroup(newGroupName, Array.from(selected));
      setGroups(listGroups());
      setActiveGroupId(created.id);
      setNewGroupName("");
      setSaveGroupOpen(false);
      showToast(`Group "${created.name}" saved · ${created.configIds.length} configs`);
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const handleDeleteGroup = (g: ConfigGroup) => {
    deleteGroup(g.id);
    setGroups(listGroups());
    if (activeGroupId === g.id) setActiveGroupId(null);
    showToast(`Group "${g.name}" deleted`);
  };

  // If user manually changes selection after applying a group, clear the "active" highlight
  const onSelectionChanged = () => {
    if (activeGroupId) setActiveGroupId(null);
  };

  const showToast = React.useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2800);
  }, []);

  const prepare = React.useCallback(
    async (cfg: EntryConfig): Promise<EntryConfig> => {
      if (!onPrepareConfig) return cfg;
      try {
        return await onPrepareConfig(cfg);
      } catch (e) {
        console.warn("[modal] prepareConfig failed, downloading with placeholders", e);
        return cfg;
      }
    },
    [onPrepareConfig],
  );

  // Tracks which download is in flight so re-clicks don't trigger duplicate
  // downloads while the async prepare() is still resolving. The first click
  // can take longer (cold warmup) than the second (cache hit), so without a
  // guard both eventually call downloadWorkbook and the browser saves two
  // copies. `downloadInFlight` is a ref (not state) so the guard sees the
  // latest value within the same synchronous handler call — state updates
  // wouldn't be committed in time.
  const downloadInFlightRef = React.useRef<Set<string>>(new Set());
  const [downloadingKey, setDownloadingKey] = React.useState<string | null>(null);

  const beginDownload = (key: string): boolean => {
    if (downloadInFlightRef.current.has(key)) return false;
    downloadInFlightRef.current.add(key);
    setDownloadingKey(key);
    return true;
  };
  const endDownload = (key: string) => {
    downloadInFlightRef.current.delete(key);
    setDownloadingKey((cur) => (cur === key ? null : cur));
  };

  const handleDownloadOne = async (cfg: EntryConfig) => {
    const key = `one:${cfg.id}`;
    if (!beginDownload(key)) return;
    try {
      showToast(`Preparing template for "${cfg.name}"…`);
      const ready = await prepare(cfg);
      downloadWorkbook([ready], from, to);
      showToast(`Template for "${cfg.name}" downloaded`);
    } finally {
      endDownload(key);
    }
  };

  const handleDownloadAll = async () => {
    const key = "all";
    if (!beginDownload(key)) return;
    try {
      const count = selected.size;
      showToast(`Preparing workbook with ${count} sheet${count > 1 ? "s" : ""}…`);
      const ready = await Promise.all(selectedConfigs.map(prepare));
      downloadWorkbook(ready, from, to);
      showToast(`Workbook with ${count} sheet${count > 1 ? "s" : ""} downloaded`);
    } finally {
      endDownload(key);
    }
  };

  const selectedConfigs = React.useMemo(
    () => configs.filter((c) => selected.has(c.id)),
    [selected],
  );

  const from = parseISO(fromDate);
  const to = parseISO(toDate);
  const validRange = from.getTime() <= to.getTime();
  const totalEstRows = validRange
    ? selectedConfigs.reduce((n, c) => n + estimateRows(c.periodicity, from, to), 0)
    : 0;

  const plants = React.useMemo(
    () => ["All", ...Array.from(new Set(configs.map((c) => c.plant)))],
    [],
  );

  const visible = configs.filter(
    (c) =>
      (plantFilter === "All" || c.plant === plantFilter) &&
      (c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.plant.toLowerCase().includes(query.toLowerCase())),
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    onSelectionChanged();
  };

  const toggleAll = () => {
    if (visible.every((c) => selected.has(c.id))) {
      const next = new Set(selected);
      visible.forEach((c) => next.delete(c.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      visible.forEach((c) => next.add(c.id));
      setSelected(next);
    }
    onSelectionChanged();
  };

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  const handleFiles = (fl: FileList | null) => {
    if (!fl || fl.length === 0) return;
    const added = Array.from(fl);
    setFiles((prev) => {
      const byName = new Map(prev.map((f) => [f.name, f]));
      for (const f of added) byName.set(f.name, f);
      return Array.from(byName.values());
    });
  };

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const canProceed = selected.size > 0 && files.length > 0;

  const startUpload = async () => {
    setStep("uploading");
    setProgress(0);
    const parsedPromise = parseTemplates(files);

    let cur = 0;
    const tick = () => {
      cur = Math.min(96, cur + (8 + Math.random() * 14));
      setProgress(cur);
      if (cur < 96) setTimeout(tick, 180);
    };
    setTimeout(tick, 200);

    const parsed = await parsedPromise;
    setProgress(100);
    setTimeout(() => {
      const chosen = configs.filter((c) => selected.has(c.id));
      const fname =
        files.length === 1 ? files[0].name : `${files.length} files (${files.map((f) => f.name).join(", ")})`;
      onProceed(chosen, fname, parsed);
    }, 350);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_.15s_ease-out]">
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-[fadeIn_.15s_ease-out]">
          <IconCheck size={14} /> {toast}
        </div>
      )}
      <div className="bg-white w-full max-w-6xl max-h-[92vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center">
            <IconUpload size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-semibold text-slate-900">Unified Upload</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Push a single workbook against multiple configurations. Nothing is written until you review and confirm.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-3 bg-slate-50/60 border-b border-slate-100 flex items-center gap-2 text-xs">
          <StepDot n={1} active label="Select Configs" done />
          <span className="text-slate-300">›</span>
          <StepDot n={2} active label="Upload File" done={step === "uploading"} />
          <span className="text-slate-300">›</span>
          <StepDot n={3} label="Preview" />
          <span className="text-slate-300">›</span>
          <StepDot n={4} label="Confirm" />
        </div>

        {step === "uploading" ? (
          <UploadingScreen
            progress={progress}
            fileName={files.length === 1 ? files[0].name : `${files.length} files`}
            configCount={selected.size}
          />
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* Left: config picker */}
            <div className="flex-1 min-w-0 flex flex-col border-r border-slate-100">
              {/* Groups bar */}
              <div className="px-5 py-2 border-b border-slate-100 bg-slate-50/60">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 shrink-0">
                    Groups
                  </span>
                  {groups.length === 0 && (
                    <span className="text-xs text-slate-400 italic">
                      Saved bundles will appear here — select configs then save as a group.
                    </span>
                  )}
                  {(groupsExpanded ? groups : groups.slice(0, GROUPS_VISIBLE)).map((g) => {
                    const active = activeGroupId === g.id;
                    return (
                      <span
                        key={g.id}
                        className={`group inline-flex items-center gap-1 text-xs rounded-full pl-2.5 pr-1 py-0.5 border transition-colors ${
                          active
                            ? "bg-emerald-500 text-white border-emerald-500"
                            : "bg-white text-slate-700 border-slate-200 hover:border-emerald-400 hover:text-emerald-700"
                        }`}
                      >
                        <button onClick={() => applyGroup(g)} className="font-medium" title={`Select ${g.configIds.length} configs`}>
                          {g.name}
                        </button>
                        <span className={`text-[10px] font-mono ${active ? "text-white/80" : "text-slate-400"}`}>
                          {g.configIds.length}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Delete group "${g.name}"?`)) handleDeleteGroup(g);
                          }}
                          className={`w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${
                            active ? "hover:bg-white/20" : "hover:bg-slate-100 text-slate-500"
                          }`}
                          title="Delete group"
                        >
                          <IconX size={10} />
                        </button>
                      </span>
                    );
                  })}
                  {groups.length > GROUPS_VISIBLE && (
                    <button
                      onClick={() => setGroupsExpanded((v) => !v)}
                      className="text-xs font-medium px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-600 hover:bg-white hover:border-emerald-400 hover:text-emerald-700 transition-colors"
                    >
                      {groupsExpanded
                        ? "Show fewer"
                        : `+${groups.length - GROUPS_VISIBLE} more`}
                    </button>
                  )}
                  <div className="flex-1" />
                  {selected.size > 0 && !activeGroupId && (
                    <button
                      onClick={() => {
                        setNewGroupName("");
                        setSaveGroupOpen(true);
                      }}
                      className="text-xs px-2.5 py-1 rounded-full border border-dashed border-slate-300 text-slate-600 hover:bg-white hover:border-emerald-400 hover:text-emerald-700 transition-colors"
                    >
                      + Save selection as group
                    </button>
                  )}
                </div>
                {saveGroupOpen && (
                  <div className="mt-2 flex items-center gap-2 bg-white border border-emerald-200 rounded-lg p-2">
                    <input
                      autoFocus
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveGroup();
                        if (e.key === "Escape") setSaveGroupOpen(false);
                      }}
                      placeholder="e.g. Line B nightshift bundle"
                      className="flex-1 h-8 px-2 text-sm rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    />
                    <button
                      onClick={handleSaveGroup}
                      disabled={!newGroupName.trim()}
                      className="h-8 px-3 text-xs font-semibold rounded-md bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400"
                    >
                      Save · {selected.size}
                    </button>
                    <button
                      onClick={() => setSaveGroupOpen(false)}
                      className="h-8 w-8 rounded-md text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                <div className="relative flex-1">
                  <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${configs.length} configuration${configs.length === 1 ? "" : "s"}…`}
                    className="pl-9 pr-3 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-sm"
                  />
                </div>
                <select
                  value={plantFilter}
                  onChange={(e) => setPlantFilter(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 bg-white text-sm px-2"
                >
                  {plants.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div className="px-5 py-2 border-b border-slate-100 flex items-center gap-3 text-xs">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <Checkbox checked={allVisibleSelected} onChange={toggleAll} />
                  <span className="font-medium text-slate-700">Select all visible</span>
                </label>
                <span className="text-slate-300">·</span>
                <span className="text-slate-500">
                  <span className="font-semibold text-emerald-600">{selected.size}</span> selected
                </span>
                {selected.size > 0 && (
                  <button
                    onClick={() => setSelected(new Set())}
                    className="ml-auto text-slate-500 hover:text-slate-800 underline"
                  >
                    Clear selection
                  </button>
                )}
              </div>

              <div className="overflow-y-auto flex-1">
                {visible.map((c) => {
                  const checked = selected.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 px-5 py-3 cursor-pointer border-b border-slate-50 hover:bg-emerald-50/30 transition-colors ${
                        checked ? "bg-emerald-50/40" : ""
                      }`}
                    >
                      <Checkbox checked={checked} onChange={() => toggle(c.id)} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">
                          {c.name}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {c.plant} · {c.periodicity} · {c.columns} columns
                          {c.subSections > 0 && ` · ${c.subSections} sub-section${c.subSections > 1 ? "s" : ""}`}
                        </div>
                      </div>
                      {checked && validRange && (() => {
                        const oneKey = `one:${c.id}`;
                        const busy = downloadingKey === oneKey;
                        return (
                          <button
                            disabled={busy}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (busy) return;
                              handleDownloadOne(c);
                            }}
                            title={busy ? "Preparing…" : `Download template for ${c.name}`}
                            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                              busy
                                ? "text-slate-300 cursor-wait"
                                : "text-slate-500 hover:bg-emerald-100 hover:text-emerald-700"
                            }`}
                          >
                            {busy ? (
                              <div className="w-3 h-3 rounded-full border-2 border-slate-300 border-t-emerald-500 animate-spin" />
                            ) : (
                              <IconDownload size={14} />
                            )}
                          </button>
                        );
                      })()}
                      <span className="text-[10px] font-mono text-slate-400">{c.id}</span>
                    </label>
                  );
                })}
                {visible.length === 0 && (
                  <div className="text-center py-12 text-slate-400 text-sm">No configurations match your filter</div>
                )}
              </div>
            </div>

            {/* Right: file upload + summary */}
            <div className="w-[380px] shrink-0 flex flex-col min-h-0 overflow-y-auto">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-800">Bulk window & template</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pick the duration you&apos;re uploading for — we&apos;ll pre-fill date/time rows per config.
                </p>
              </div>

              <div className="px-5 py-4 border-b border-slate-100">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">From</span>
                    <input
                      type="date"
                      value={fromDate}
                      max={toDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="mt-1 w-full h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">To</span>
                    <input
                      type="date"
                      value={toDate}
                      min={fromDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="mt-1 w-full h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    />
                  </label>
                </div>

                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  {[
                    { label: "Today", from: 0, to: 0 },
                    { label: "Last 24h", from: 0, to: 0 },
                    { label: "Last 7d", from: -6, to: 0 },
                    { label: "MTD", from: -new Date().getDate() + 1, to: 0 },
                  ].map((p) => (
                    <button
                      key={p.label}
                      onClick={() => {
                        setFromDate(todayISO(p.from));
                        setToDate(todayISO(p.to));
                      }}
                      className="px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {(() => {
                  const allBusy = downloadingKey === "all";
                  const disabled = selected.size === 0 || !validRange || allBusy;
                  return (
                    <button
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return;
                        handleDownloadAll();
                      }}
                      className={`mt-4 w-full h-10 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                        allBusy
                          ? "bg-emerald-50 border border-emerald-200 text-emerald-700 cursor-wait"
                          : selected.size > 0 && validRange
                          ? "bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          : "bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed"
                      }`}
                    >
                      {allBusy ? (
                        <>
                          <div className="w-4 h-4 rounded-full border-2 border-emerald-200 border-t-emerald-600 animate-spin" />
                          Preparing workbook…
                        </>
                      ) : (
                        <>
                          <IconDownload size={15} />
                          {selected.size === 0
                            ? "Select configs to download workbook"
                            : `Download workbook (.xlsx · ${selected.size} sheet${selected.size > 1 ? "s" : ""})`}
                        </>
                      )}
                    </button>
                  );
                })()}

                {selected.size > 0 && validRange && (
                  <div className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                    One Excel file with{" "}
                    <span className="font-semibold text-slate-700">{selected.size}</span> tab
                    {selected.size > 1 ? "s" : ""} (one per config), pre-filled with{" "}
                    <span className="font-semibold text-slate-700">{totalEstRows.toLocaleString()}</span>{" "}
                    date/time row{totalEstRows !== 1 ? "s" : ""}. Fill the readings in Excel, then drop the same file back below.
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-800">Upload filled workbook</h3>
                <p className="text-xs text-slate-500 mt-0.5">One workbook can carry data for all selected configs.</p>
              </div>

              <div className="p-5">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFiles(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                    dragOver
                      ? "border-emerald-500 bg-emerald-50/60"
                      : "border-slate-200 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-3">
                    <IconCloud size={24} />
                  </div>
                  <p className="text-sm font-medium text-slate-800">
                    {dragOver ? "Drop your file(s) here" : "Drag & drop your filled templates"}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    or <span className="text-emerald-600 font-medium">browse from device</span>
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    multiple
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Supported: .xlsx, .xls, .csv</span>
                  <span>One file per config, or upload all at once</span>
                </div>

                {files.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {files.map((f) => (
                      <div
                        key={f.name}
                        className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 flex items-center gap-3"
                      >
                        <div className="w-9 h-9 rounded-md bg-white border border-emerald-200 text-emerald-600 flex items-center justify-center">
                          <IconFile size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">{f.name}</div>
                          <div className="text-[11px] text-slate-500">{formatBytes(f.size)} · ready to validate</div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(f.name);
                          }}
                          className="text-slate-400 hover:text-rose-500"
                          title="Remove"
                        >
                          <IconX size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-5 rounded-lg bg-slate-50 border border-slate-200 p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                    Selection summary
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Configurations</span>
                    <span className="font-semibold text-slate-900">{selected.size}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-slate-600">Plants covered</span>
                    <span className="font-semibold text-slate-900">
                      {new Set(
                        configs.filter((c) => selected.has(c.id)).map((c) => c.plant),
                      ).size}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-slate-600">Files attached</span>
                    <span className={`font-semibold ${files.length > 0 ? "text-emerald-600" : "text-slate-400"}`}>
                      {files.length}
                    </span>
                  </div>
                </div>

                <div className="mt-5 text-[11px] text-slate-500 leading-relaxed bg-sky-50/60 border border-sky-100 rounded-lg p-3">
                  <strong className="text-sky-700">Tip:</strong> Drop back the workbook you downloaded above — each tab maps to its
                  config by name. For a one-off fix, you can also use the download icon next to a single config to grab just that
                  sheet as a CSV.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {step === "select" && (
          <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/40">
            <div className="text-xs text-slate-500">
              {selected.size === 0
                ? "Select at least one configuration to continue"
                : `${selected.size} configuration${selected.size > 1 ? "s" : ""} ready · ${
                    files.length > 0
                      ? `${files.length} file${files.length > 1 ? "s" : ""} attached`
                      : "no file yet"
                  }`}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="h-9 px-4 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-white"
              >
                Cancel
              </button>
              <button
                disabled={!canProceed}
                onClick={startUpload}
                className={`h-9 px-4 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${
                  canProceed
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 shadow-sm"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                Validate & Preview
                <IconChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadingScreen({ progress, fileName, configCount }: { progress: number; fileName: string; configCount: number }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-10 py-20">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center mb-5 shadow-lg">
        <IconCloud size={28} />
      </div>
      <h3 className="text-lg font-semibold text-slate-900">Validating your workbook</h3>
      <p className="text-sm text-slate-500 mt-1 text-center max-w-md">
        Parsing <span className="font-medium text-slate-700">{fileName}</span> against{" "}
        <span className="font-medium text-slate-700">{configCount}</span> configuration
        {configCount > 1 ? "s" : ""}. No data is written yet.
      </p>
      <div className="w-full max-w-md mt-8">
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
          <span>{progress < 30 ? "Reading sheets…" : progress < 70 ? "Matching columns to tags…" : "Running validations…"}</span>
          <span className="font-mono">{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  );
}

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange();
      }}
      className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center transition-colors ${
        checked
          ? "bg-emerald-500 border-emerald-500 text-white"
          : "bg-white border-slate-300 hover:border-slate-400"
      }`}
    >
      {checked && <IconCheck size={12} />}
    </button>
  );
}

function StepDot({ n, label, active, done }: { n: number; label: string; active?: boolean; done?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
          done
            ? "bg-emerald-500 text-white"
            : active
            ? "bg-slate-900 text-white"
            : "bg-slate-200 text-slate-500"
        }`}
      >
        {done ? <IconCheck size={11} /> : n}
      </div>
      <span className={`${active || done ? "text-slate-800 font-medium" : "text-slate-400"}`}>{label}</span>
    </div>
  );
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
