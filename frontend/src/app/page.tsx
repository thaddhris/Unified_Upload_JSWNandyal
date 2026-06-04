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
import { detectAdapterMode, getAdapter, type AdapterMode } from "../lib/getAdapter";
import { bootstrapAuth, hasAuth } from "../lib/iosenseClient";
import { getLastDiscoveryStats, type AdapterDiscoveryStats } from "../lib/iosenseAdapter";
import { listGroups, type ConfigGroup } from "../lib/groups";
import type { UnifiedUploadAdapter } from "../lib/adapter";
import { IconUpload, IconFile, IconCheck, IconSparkle } from "../components/Icons";

type Stage = "landing" | "uploadModal" | "preview" | "success";

export default function Page() {
  const [stage, setStage] = React.useState<Stage>("landing");
  const [configs, setConfigs] = React.useState<EntryConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [groups, setGroups] = React.useState<ConfigGroup[]>([]);
  const [preselected, setPreselected] = React.useState<string[] | undefined>();
  const [adapterMode, setAdapterMode] = React.useState<AdapterMode>("iosense");
  const [authReady, setAuthReady] = React.useState(false);
  const [needsSignIn, setNeedsSignIn] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [discovery, setDiscovery] = React.useState<AdapterDiscoveryStats | null>(null);

  const adapterRef = React.useRef<UnifiedUploadAdapter | null>(null);
  if (!adapterRef.current) adapterRef.current = getAdapter("mock");

  const [results, setResults] = React.useState<UploadFileResult[]>([]);
  const [fileName, setFileName] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const mode = detectAdapterMode();
      setAdapterMode(mode);

      if (mode === "iosense") {
        const ok = await bootstrapAuth();
        if (!alive) return;
        if (!ok && !hasAuth()) {
          setNeedsSignIn(true);
          setAuthReady(true);
          setLoading(false);
          return;
        }
      }
      adapterRef.current = getAdapter(mode);
      setAuthReady(true);

      try {
        const c = await adapterRef.current.listConfigs();
        if (!alive) return;
        setConfigs(c);
        setGroups(listGroups());
        if (mode === "iosense") setDiscovery(getLastDiscoveryStats());
        setLoading(false);

        // Kick off background warmup so each row's placeholder periodicity +
        // column count gets replaced with real values as their details land.
        // Fire-and-forget — never blocks the UI; concurrency-limited inside.
        const adapter = adapterRef.current;
        if (adapter.warmupConfigs && c.length > 0) {
          adapter
            .warmupConfigs(
              c.map((cfg) => cfg.id),
              (configId, patch) => {
                if (!alive) return;
                setConfigs((prev) =>
                  prev.map((cfg) =>
                    cfg.id === configId
                      ? {
                          ...cfg,
                          periodicity: patch.periodicity ?? cfg.periodicity,
                          columns: patch.columns ?? cfg.columns,
                          columnDefs: patch.columnDefs ?? cfg.columnDefs,
                          cycleTimeHr: patch.cycleTimeHr ?? cfg.cycleTimeHr,
                          cycleTimeMin: patch.cycleTimeMin ?? cfg.cycleTimeMin,
                          anchorOffsetMs: patch.anchorOffsetMs ?? cfg.anchorOffsetMs,
                        }
                      : cfg,
                  ),
                );
              },
            )
            .catch((err) => console.warn("[page] warmup failed", err));
        }
      } catch (e) {
        if (!alive) return;
        const err = e as { status?: number; message?: string };
        // 401 → stale token, fall back to sign-in screen instead of a banner
        if (err.status === 401) {
          setNeedsSignIn(true);
        } else {
          setLoadError(err.message ?? "Failed to load configurations.");
        }
        setLoading(false);
      }
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

  // Force-warm a single config (synchronously waits) so download has real
  // periodicity + columnDefs before the template is built. Cache-hit if the
  // background warmup already covered it.
  const prepareConfig = React.useCallback(
    async (cfg: EntryConfig): Promise<EntryConfig> => {
      const adapter = adapterRef.current;
      if (!adapter?.warmupConfigs) return cfg;
      let enriched = cfg;
      await adapter.warmupConfigs([cfg.id], (id, patch) => {
        if (id !== cfg.id) return;
        enriched = {
          ...enriched,
          periodicity: patch.periodicity ?? enriched.periodicity,
          columns: patch.columns ?? enriched.columns,
          columnDefs: patch.columnDefs ?? enriched.columnDefs,
          cycleTimeHr: patch.cycleTimeHr ?? enriched.cycleTimeHr,
          cycleTimeMin: patch.cycleTimeMin ?? enriched.cycleTimeMin,
          anchorOffsetMs: patch.anchorOffsetMs ?? enriched.anchorOffsetMs,
        };
        // Also push the patch into the global configs state so other places
        // pick up the enriched values too.
        setConfigs((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  periodicity: patch.periodicity ?? c.periodicity,
                  columns: patch.columns ?? c.columns,
                  columnDefs: patch.columnDefs ?? c.columnDefs,
                }
              : c,
          ),
        );
      });
      return enriched;
    },
    [],
  );

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
        const adapter = adapterRef.current!;
        if (adapter.checkConflicts && matched.filledTimestamps.length > 0) {
          const dates = matched.filledTimestamps.map((iso) => new Date(iso));
          conflicts = await adapter.checkConflicts(c, dates);
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
    // For each result, send the actual parsed rows (timestamps + cell values)
    // to the adapter. The values come from the parser's filledRows_data field,
    // keyed by the workbook's column header text. The adapter translates each
    // (header → cell value) into a (devID, sensor, value, time) deviceData
    // entry by matching headers to its cached schema.
    for (const r of results) {
      const cfg = configs.find((c) => c.id === r.configId);
      if (!cfg || r.newRows + r.updatedRows === 0) continue;

      const sheet = currentSheetsRef.current.get(cfg.id);
      const rows = (sheet?.filledRows_data ?? []).map((rv) => ({
        timestamp: new Date(rv.timestamp),
        values: rv.values,
      }));
      if (rows.length === 0) continue;

      await adapterRef.current!.saveRows(cfg, rows);
    }
    setStage("success");
  };

  // Cache the parsed sheets so handleConfirm can replay the real timestamps to the adapter
  const currentSheetsRef = React.useRef<Map<string, ParsedSheet>>(new Map());

  return (
    <Shell>
      {!authReady && <BootSplash />}

      {authReady && needsSignIn && stage === "landing" && <SignInRequired />}

      {authReady && !needsSignIn && (stage === "landing" || stage === "uploadModal") && (
        <Landing
          loading={loading}
          configs={configs}
          groups={groups}
          adapterMode={adapterMode}
          authReady={authReady}
          loadError={loadError}
          discovery={discovery}
          onUpload={() => launchUpload()}
          onUploadGroup={(g) => launchUpload(g.configIds)}
        />
      )}

      {authReady && !needsSignIn && stage === "uploadModal" && !loading && (
        <UnifiedUploadModal
          configs={configs}
          preselectedIds={preselected}
          onClose={() => {
            setStage("landing");
            refreshGroups();
          }}
          onProceed={handleProceed}
          onPrepareConfig={prepareConfig}
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

/* ─── Boot splash (shown until SSO bootstrap + adapter resolve) ─────────── */

function BootSplash() {
  return (
    <div className="px-6 py-14 max-w-xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 flex items-center justify-center mb-4">
          <div className="w-5 h-5 rounded-full border-2 border-slate-300 border-t-emerald-500 animate-spin" />
        </div>
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    </div>
  );
}

/* ─── Sign-in required (when no SSO token can be found) ─────────────────── */

function SignInRequired() {
  return (
    <div className="px-6 py-14 max-w-xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center mb-4">
          <IconUpload size={22} />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
          Sign in to continue
        </h1>
        <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
          Unified Upload is part of the IOsense platform. Open it from your
          IOsense dashboard so a session can be exchanged, or paste an SSO token
          below.
        </p>

        <a
          href="https://iosense.io/profile"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center justify-center w-full h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-semibold shadow-md shadow-emerald-500/20 hover:from-emerald-600 hover:to-teal-700 transition-all"
        >
          Open IOsense portal
        </a>

        <div className="flex items-center gap-3 my-5 text-[11px] uppercase tracking-wider text-slate-400">
          <div className="flex-1 h-px bg-slate-200" />
          <span>or paste an SSO token</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const token = String(f.get("token") ?? "").trim();
            if (!token) return;
            const url = new URL(window.location.href);
            url.searchParams.set("token", token);
            window.location.replace(url.toString());
          }}
          className="flex gap-2"
        >
          <input
            name="token"
            placeholder="Paste SSO token from IOsense → Profile"
            className="flex-1 h-10 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
          />
          <button
            type="submit"
            className="h-10 px-4 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
          >
            Continue
          </button>
        </form>

        <p className="text-[11px] text-slate-400 mt-5">
          In IOsense, go to <span className="font-medium text-slate-600">Profile → Generate SSO token</span>.
          Tokens are one-time use and expire after 60 seconds.
        </p>
      </div>
    </div>
  );
}

/* ─── Landing page (minimal, upload-focused) ─────────────────────────────── */

function Landing({
  loading,
  configs,
  groups,
  adapterMode,
  authReady,
  loadError,
  discovery,
  onUpload,
  onUploadGroup,
}: {
  loading: boolean;
  configs: EntryConfig[];
  groups: ConfigGroup[];
  adapterMode: AdapterMode;
  authReady: boolean;
  loadError: string | null;
  discovery: AdapterDiscoveryStats | null;
  onUpload: () => void;
  onUploadGroup: (g: ConfigGroup) => void;
}) {

  // Resolve each group's saved configIds against the current adapter's configs.
  // A group is "stale" if none of its saved sheets exist anymore (e.g. user
  // saved a group in mock mode and is now on the live IOsense backend).
  const resolvedGroups = React.useMemo(() => {
    const knownIds = new Set(configs.map((c) => c.id));
    return groups
      .map((g) => {
        const validIds = g.configIds.filter((id) => knownIds.has(id));
        const validNames = validIds
          .map((id) => configs.find((c) => c.id === id)?.name)
          .filter((n): n is string => !!n);
        return { group: g, validIds, validNames, total: g.configIds.length };
      })
      .filter((r) => r.validIds.length > 0);
  }, [groups, configs]);

  const GROUPS_PER_PAGE = 6;
  const [expanded, setExpanded] = React.useState(false);
  const visibleGroups = expanded ? resolvedGroups : resolvedGroups.slice(0, GROUPS_PER_PAGE);
  const hiddenCount = Math.max(0, resolvedGroups.length - GROUPS_PER_PAGE);

  return (
    <div className="px-6 py-10 md:py-14 max-w-3xl mx-auto">
      {loadError && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <strong>Couldn&apos;t load your sheets.</strong>{" "}
          <span className="opacity-80">{loadError}</span>
        </div>
      )}
      {authReady && adapterMode === "mock" && (
        <div className="mb-4 inline-block px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-semibold">
          DEV MODE · mock data
        </div>
      )}
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
              {resolvedGroups.length === 0
                ? "Save groups from inside the upload screen"
                : `${resolvedGroups.length} group${resolvedGroups.length === 1 ? "" : "s"}`}
            </span>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        ) : resolvedGroups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            No saved groups yet. Inside the upload screen, pick the sheets you use together and
            click <span className="font-medium text-slate-700">&ldquo;Save selection as group&rdquo;</span> — they&apos;ll
            land here for one-click access next time.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleGroups.map(({ group: g, validIds, validNames, total }) => {
                const isPartial = validIds.length < total;
                return (
                  <button
                    key={g.id}
                    onClick={() => onUploadGroup({ ...g, configIds: validIds })}
                    className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-emerald-400 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-slate-800 group-hover:text-emerald-700">
                        {g.name}
                      </h3>
                      <span className="text-[11px] font-mono text-slate-400">
                        {isPartial
                          ? `${validIds.length} of ${total}`
                          : `${validIds.length} sheet${validIds.length === 1 ? "" : "s"}`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 truncate">
                      {validNames.slice(0, 3).join(" · ")}
                      {validNames.length > 3 && ` · +${validNames.length - 3} more`}
                    </p>
                  </button>
                );
              })}
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
      {!loading && configs.length > 0 && (
        <p className="mt-8 text-xs text-slate-400 text-center">
          {configs.length} manual-entry sheet{configs.length === 1 ? "" : "s"} connected
        </p>
      )}
      {!loading && configs.length === 0 && !loadError && adapterMode === "iosense" && (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>No manual-entry sheets found on this IOsense account.</strong>
          {discovery && (
            <div className="mt-2 text-xs font-mono bg-white/60 border border-amber-200/70 rounded-md px-2 py-1.5 text-amber-900">
              Sections returned: {discovery.sectionsReturned}
            </div>
          )}
          <div className="mt-2 text-amber-800/90">
            If you expect sheets here, the account may not have any MDE sections configured,
            or the signed-in user might not have read permission. Use the avatar menu to sign out
            and try a different account.
          </div>
        </div>
      )}
    </div>
  );
}
