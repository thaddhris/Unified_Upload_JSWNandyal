"use client";

import * as React from "react";
import { Shell } from "../components/Shell";
import { UnifiedUploadModal } from "../components/UnifiedUploadModal";
import { PreviewScreen } from "../components/PreviewScreen";
import { SuccessScreen } from "../components/SuccessScreen";
import {
  type EntryConfig,
  type UploadFileResult,
  makeResultFromParse,
  makeResultNoData,
} from "../lib/mockData";
import { type ParsedSheet } from "../lib/parseUpload";
import { mockAdapter } from "../lib/mockAdapter";
import { listGroups, type ConfigGroup } from "../lib/groups";
import { IconUpload, IconFile, IconCheck, IconSparkle } from "../components/Icons";

type Stage = "landing" | "uploadModal" | "preview" | "success";

export default function Page() {
  const [stage, setStage] = React.useState<Stage>("landing");
  const [configs, setConfigs] = React.useState<EntryConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [groups, setGroups] = React.useState<ConfigGroup[]>([]);
  const [preselected, setPreselected] = React.useState<string[] | undefined>();

  const [results, setResults] = React.useState<UploadFileResult[]>([]);
  const [fileName, setFileName] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const c = await mockAdapter.listConfigs();
      if (!alive) return;
      setConfigs(c);
      setGroups(listGroups());
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refreshGroups = () => setGroups(listGroups());

  const launchUpload = (ids?: string[]) => {
    setPreselected(ids);
    setStage("uploadModal");
  };

  const handleProceed = async (chosen: EntryConfig[], fname: string, parsedSheets: ParsedSheet[]) => {
    setFileName(fname);
    const byId = new Map<string, ParsedSheet>();
    for (const s of parsedSheets) {
      if (s.configId) byId.set(s.configId, s);
    }
    const providedIds = parsedSheets.map((s) => s.configId).filter((id): id is string => !!id);

    const next: UploadFileResult[] = await Promise.all(
      chosen.map(async (c) => {
        const matched = byId.get(c.id);
        if (!matched) return makeResultNoData(c, providedIds);

        // Ask the adapter which of the filled timestamps already have data —
        // split new vs overwrites honestly instead of treating everything as new.
        let conflicts: Set<string> | undefined;
        if (mockAdapter.checkConflicts && matched.filledTimestamps.length > 0) {
          const dates = matched.filledTimestamps.map((iso) => new Date(iso));
          conflicts = await mockAdapter.checkConflicts(c, dates);
        }
        return makeResultFromParse(c, matched, conflicts) ?? makeResultNoData(c, providedIds);
      }),
    );

    // Remember the parsed sheets so the Confirm step can replay actual timestamps
    currentSheetsRef.current = byId;

    setResults(next);
    setStage("preview");
  };

  const handleConfirm = async () => {
    // Persist the filled timestamps in the mock so re-uploads correctly show
    // as overwrites next time. Real adapter does the actual save here.
    for (const r of results) {
      const cfg = configs.find((c) => c.id === r.configId);
      if (!cfg || r.newRows + r.updatedRows === 0) continue;
      // Reconstruct the row payload from what we tracked in the preview
      const rows = Array.from({ length: r.newRows + r.updatedRows }, (_, i) => ({
        timestamp: new Date(Date.now() + i),
        values: {},
      }));
      // Use actual parsed timestamps if available
      const sheet = currentSheetsRef.current.get(cfg.id);
      if (sheet) {
        rows.length = 0;
        for (const iso of sheet.filledTimestamps) {
          rows.push({ timestamp: new Date(iso), values: {} });
        }
      }
      await mockAdapter.saveRows(cfg, rows);
    }
    setStage("success");
  };

  // Cache the parsed sheets so handleConfirm can replay the real timestamps to the adapter
  const currentSheetsRef = React.useRef<Map<string, ParsedSheet>>(new Map());

  return (
    <Shell>
      {(stage === "landing" || stage === "uploadModal") && (
        <Landing
          loading={loading}
          configs={configs}
          groups={groups}
          onUpload={() => launchUpload()}
          onUploadGroup={(g) => launchUpload(g.configIds)}
        />
      )}

      {stage === "uploadModal" && !loading && (
        <UnifiedUploadModal
          configs={configs}
          preselectedIds={preselected}
          onClose={() => {
            setStage("landing");
            refreshGroups();
          }}
          onProceed={handleProceed}
        />
      )}

      {stage === "preview" && (
        <PreviewScreen
          fileName={fileName}
          results={results}
          onBack={() => setStage("landing")}
          onReupload={() => setStage("uploadModal")}
          onConfirm={handleConfirm}
        />
      )}

      {stage === "success" && (
        <SuccessScreen
          fileName={fileName}
          results={results}
          onDone={() => {
            setStage("landing");
            setResults([]);
            setFileName("");
            refreshGroups();
          }}
          onAnother={() => setStage("uploadModal")}
        />
      )}
    </Shell>
  );
}

/* ─── Landing page (minimal, upload-focused) ─────────────────────────────── */

function Landing({
  loading,
  configs,
  groups,
  onUpload,
  onUploadGroup,
}: {
  loading: boolean;
  configs: EntryConfig[];
  groups: ConfigGroup[];
  onUpload: () => void;
  onUploadGroup: (g: ConfigGroup) => void;
}) {
  const v1Count = configs.filter((c) => c.version === "v1").length;
  const v2Count = configs.filter((c) => c.version === "v2").length;

  const GROUPS_PER_PAGE = 6;
  const [expanded, setExpanded] = React.useState(false);
  const visibleGroups = expanded ? groups : groups.slice(0, GROUPS_PER_PAGE);
  const hiddenCount = Math.max(0, groups.length - GROUPS_PER_PAGE);

  return (
    <div className="px-6 py-10 md:py-14 max-w-3xl mx-auto">
      {/* Hero */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 md:p-10">
        <div className="flex items-start gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-sm shadow-emerald-500/20">
            <IconUpload size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
              Unified Upload
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-md">
              Push one workbook against multiple manual-entry sheets. Templates auto-fill the dates;
              you fill the readings; nothing is saved until you review.
            </p>
          </div>
        </div>

        <button
          onClick={onUpload}
          className="w-full h-14 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-base font-semibold shadow-md shadow-emerald-500/20 hover:from-emerald-600 hover:to-teal-700 transition-all flex items-center justify-center gap-2"
        >
          <IconUpload size={20} /> Start Unified Upload
        </button>

        <div className="mt-4 flex items-center justify-center gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <IconCheck size={12} className="text-emerald-600" /> Pre-filled date/time
          </span>
          <span className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-1.5">
            <IconFile size={12} className="text-emerald-600" /> .xlsx download/upload
          </span>
          <span className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-1.5">
            <IconSparkle size={12} className="text-emerald-600" /> Preview before save
          </span>
        </div>
      </div>

      {/* Quick start with saved groups */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider">
            Quick start with a saved group
          </h2>
          {!loading && (
            <span className="text-xs text-slate-500">
              {groups.length === 0 ? "Save groups from inside the upload screen" : `${groups.length} group${groups.length === 1 ? "" : "s"}`}
            </span>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No saved groups yet. Inside the upload screen, pick the sheets you use together and
            click <span className="font-medium text-slate-700">&ldquo;Save selection as group&rdquo;</span> — they&apos;ll
            land here for one-click access next time.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleGroups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => onUploadGroup(g)}
                  className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-emerald-400 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-slate-800 group-hover:text-emerald-700">
                      {g.name}
                    </h3>
                    <span className="text-[11px] font-mono text-slate-400">
                      {g.configIds.length} sheets
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">
                    {g.configIds
                      .map((id) => configs.find((c) => c.id === id)?.name)
                      .filter(Boolean)
                      .slice(0, 3)
                      .join(" · ")}
                    {g.configIds.length > 3 && ` · +${g.configIds.length - 3} more`}
                  </p>
                </button>
              ))}
            </div>

            {hiddenCount > 0 && (
              <div className="mt-3 flex justify-center">
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-sm font-medium text-emerald-700 hover:text-emerald-800 px-4 py-2 rounded-lg hover:bg-emerald-50 transition-colors inline-flex items-center gap-1"
                >
                  {expanded ? (
                    <>Show fewer groups</>
                  ) : (
                    <>Show {hiddenCount} more group{hiddenCount === 1 ? "" : "s"}</>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer note: source-of-truth count */}
      {!loading && (
        <p className="mt-8 text-xs text-slate-400 text-center">
          {configs.length} manual-entry sheets connected · {v2Count} on v2 ·{" "}
          {v1Count} legacy v1 (treated the same in upload)
        </p>
      )}
    </div>
  );
}
