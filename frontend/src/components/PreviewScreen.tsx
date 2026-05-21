"use client";

import * as React from "react";
import { type UploadFileResult } from "../lib/mockData";
import {
  IconArrowLeft,
  IconCheck,
  IconAlert,
  IconInfo,
  IconChevronRight,
  IconChevronDown,
  IconFile,
  IconUpload,
} from "./Icons";

export function PreviewScreen({
  fileName,
  results,
  onBack,
  onConfirm,
  onReupload,
}: {
  fileName: string;
  results: UploadFileResult[];
  onBack: () => void;
  onConfirm: () => void;
  onReupload: () => void;
}) {
  const totals = results.reduce(
    (acc, r) => ({
      detected: acc.detected + r.detected,
      newRows: acc.newRows + r.newRows,
      updatedRows: acc.updatedRows + r.updatedRows,
      ignoredRows: acc.ignoredRows + r.ignoredRows,
      warnings: acc.warnings + r.warnings,
      errors: acc.errors + r.errors,
    }),
    { detected: 0, newRows: 0, updatedRows: 0, ignoredRows: 0, warnings: 0, errors: 0 },
  );

  const [expanded, setExpanded] = React.useState<string | null>(results[0]?.configId ?? null);
  const [acknowledged, setAcknowledged] = React.useState(false);

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600"
        >
          <IconArrowLeft size={18} />
        </button>
        <div>
          <div className="text-xs text-slate-500">Unified Upload · Step 3 of 4</div>
          <h1 className="text-xl font-semibold text-slate-900">Preview & Validation</h1>
        </div>
        <div className="flex-1" />
        <div className="hidden md:flex items-center gap-2 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2">
          <div className="w-7 h-7 rounded-md bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <IconFile size={14} />
          </div>
          <div className="leading-tight">
            <div className="text-slate-800 font-medium">{fileName}</div>
            <div className="text-[11px] text-slate-500">Parsed · awaiting confirmation</div>
          </div>
        </div>
      </div>

      {/* Banner */}
      {totals.errors > 0 ? (
        <Banner
          tone="rose"
          title={`${totals.errors} row${totals.errors > 1 ? "s" : ""} need${totals.errors > 1 ? "" : "s"} your attention`}
          body="These rows have values that don't look right. They won't be saved until you fix them. You can fix your file and re-upload, or continue to save the good rows and skip these."
        />
      ) : totals.warnings > 0 ? (
        <Banner
          tone="amber"
          title={`${totals.warnings} thing${totals.warnings > 1 ? "s" : ""} to double-check before saving`}
          body="Nothing will block the upload — but some rows look unusual (blank cells, duplicates, or numbers outside the normal range). Have a quick look before confirming."
        />
      ) : (
        <Banner
          tone="emerald"
          title="Everything looks good"
          body="No issues found in your file. You can safely save these entries."
        />
      )}

      {/* Totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-5">
        <TotalCard label="Sheets" value={results.length} tone="slate" />
        <TotalCard label="Rows in file" value={totals.detected} tone="slate" />
        <TotalCard label="New entries" value={totals.newRows} tone="emerald" />
        <TotalCard label="Overwrites existing" value={totals.updatedRows} tone="sky" />
        <TotalCard label="Will be skipped" value={totals.ignoredRows} tone="amber" />
        <TotalCard label="Need fixing" value={totals.errors} tone="rose" />
      </div>

      {/* Per-config breakdown */}
      <div className="mt-6 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-sm">Per-configuration breakdown</h2>
          <span className="text-xs text-slate-500">Click a row to view validation details</span>
        </div>

        <table className="io-table w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-5 py-3 font-medium w-8"></th>
              <th className="px-5 py-3 font-medium">Configuration</th>
              <th className="px-5 py-3 font-medium text-right">Rows in file</th>
              <th className="px-5 py-3 font-medium text-right">New entries</th>
              <th className="px-5 py-3 font-medium text-right">Overwrites existing</th>
              <th className="px-5 py-3 font-medium text-right">Skipped</th>
              <th className="px-5 py-3 font-medium text-right">To fix</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const open = expanded === r.configId;
              const status =
                r.errors > 0 ? "error" : r.warnings > 0 ? "warn" : "ok";
              return (
                <React.Fragment key={r.configId}>
                  <tr
                    onClick={() => setExpanded(open ? null : r.configId)}
                    className="cursor-pointer hover:bg-slate-50 border-t border-slate-100"
                  >
                    <td className="px-5 py-3 text-slate-400">
                      {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-800">{r.configName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{r.configId}</div>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-700 font-mono">{r.detected}</td>
                    <td className="px-5 py-3 text-right text-emerald-700 font-mono font-semibold">
                      +{r.newRows}
                    </td>
                    <td className="px-5 py-3 text-right text-sky-700 font-mono">{r.updatedRows}</td>
                    <td className="px-5 py-3 text-right text-amber-700 font-mono">{r.ignoredRows}</td>
                    <td className="px-5 py-3 text-right">
                      {r.errors + r.warnings === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span className="text-slate-700 text-xs">
                          {r.errors > 0 && (
                            <span className="text-rose-700 font-semibold">
                              {r.errors} to fix
                            </span>
                          )}
                          {r.errors > 0 && r.warnings > 0 && <span className="text-slate-400"> · </span>}
                          {r.warnings > 0 && (
                            <span className="text-amber-700">
                              {r.warnings} to check
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusChip status={status} />
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-50/50 border-t border-slate-100">
                      <td colSpan={8} className="px-5 py-4">
                        <ValidationList items={r.validation} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Confirm bar */}
      <div className="mt-6 bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col md:flex-row items-start md:items-center gap-4">
        <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer flex-1">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-emerald-600"
          />
          <span>
            I&apos;ve checked everything above. <strong>{totals.newRows} new entr{totals.newRows === 1 ? "y" : "ies"}</strong> will be saved
            {totals.updatedRows > 0 && (
              <>
                {" "}and <strong>{totals.updatedRows} existing entr{totals.updatedRows === 1 ? "y" : "ies"}</strong> will be overwritten with the new values
              </>
            )}{" "}
            across <strong>{results.length} sheet{results.length > 1 ? "s" : ""}</strong>.
            {totals.ignoredRows > 0 && (
              <> <strong>{totals.ignoredRows} row{totals.ignoredRows === 1 ? "" : "s"}</strong> will be skipped.</>
            )}
          </span>
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={onBack}
            className="h-10 px-4 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onReupload}
            className="h-10 px-4 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 flex items-center gap-2"
          >
            <IconUpload size={14} /> Re-upload file
          </button>
          <button
            disabled={!acknowledged}
            onClick={onConfirm}
            className={`h-10 px-5 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${
              acknowledged
                ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 shadow-sm"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            <IconCheck size={16} />
            Confirm Upload
          </button>
        </div>
      </div>
    </div>
  );
}

function TotalCard({ label, value, tone }: { label: string; value: number; tone: "slate" | "emerald" | "sky" | "amber" | "rose" }) {
  const tones = {
    slate: "bg-white border-slate-200 text-slate-900",
    emerald: "bg-emerald-50/60 border-emerald-200 text-emerald-900",
    sky: "bg-sky-50/60 border-sky-200 text-sky-900",
    amber: "bg-amber-50/60 border-amber-200 text-amber-900",
    rose: "bg-rose-50/60 border-rose-200 text-rose-900",
  };
  return (
    <div className={`border rounded-xl px-4 py-3 ${tones[tone]}`}>
      <div className="text-[11px] uppercase tracking-wider opacity-70 font-medium">{label}</div>
      <div className="text-xl font-semibold mt-1">{value.toLocaleString()}</div>
    </div>
  );
}

function StatusChip({ status }: { status: "ok" | "warn" | "error" }) {
  if (status === "ok")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
        <IconCheck size={11} /> Ready to save
      </span>
    );
  if (status === "warn")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <IconAlert size={11} /> Please check
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
      <IconAlert size={11} /> Needs fixing
    </span>
  );
}

function ValidationList({ items }: { items: { level: "error" | "warning" | "info"; message: string; row?: number; column?: string }[] }) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        const tones = {
          error: "bg-rose-50 border-rose-200 text-rose-800",
          warning: "bg-amber-50 border-amber-200 text-amber-800",
          info: "bg-sky-50 border-sky-200 text-sky-800",
        };
        const Icon = it.level === "info" ? IconInfo : IconAlert;
        return (
          <div key={i} className={`flex items-start gap-2 border rounded-lg px-3 py-2 text-xs ${tones[it.level]}`}>
            <Icon size={14} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <div>{it.message}</div>
              {(it.row || it.column) && (
                <div className="mt-1 text-[11px] opacity-75">
                  {it.row && <>Row {it.row}</>}
                  {it.row && it.column && ", "}
                  {it.column && (
                    <>
                      column <span className="font-medium">&ldquo;{it.column}&rdquo;</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Banner({ tone, title, body }: { tone: "rose" | "amber" | "emerald"; title: string; body: string }) {
  const tones = {
    rose: "bg-rose-50 border-rose-200 text-rose-900",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
  };
  const iconBg = {
    rose: "bg-rose-100 text-rose-600",
    amber: "bg-amber-100 text-amber-600",
    emerald: "bg-emerald-100 text-emerald-600",
  };
  const Icon = tone === "emerald" ? IconCheck : IconAlert;
  return (
    <div className={`border rounded-xl p-4 flex items-start gap-3 ${tones[tone]}`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconBg[tone]}`}>
        <Icon size={18} />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm opacity-80 mt-0.5">{body}</div>
      </div>
    </div>
  );
}
