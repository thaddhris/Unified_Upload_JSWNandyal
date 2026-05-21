"use client";

import * as React from "react";
import { type UploadFileResult } from "../lib/mockData";
import { triggerDownload } from "../lib/templates";
import { IconCheck, IconDownload, IconHome, IconUpload } from "./Icons";

export function SuccessScreen({
  fileName,
  results,
  onDone,
  onAnother,
}: {
  fileName: string;
  results: UploadFileResult[];
  onDone: () => void;
  onAnother: () => void;
}) {
  const totals = results.reduce(
    (acc, r) => ({
      newRows: acc.newRows + r.newRows,
      updatedRows: acc.updatedRows + r.updatedRows,
      ignoredRows: acc.ignoredRows + r.ignoredRows,
      errors: acc.errors + r.errors,
    }),
    { newRows: 0, updatedRows: 0, ignoredRows: 0, errors: 0 },
  );

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Hero */}
        <div className="px-8 py-10 text-center bg-gradient-to-b from-emerald-50 to-white border-b border-slate-100">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <IconCheck size={32} />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 mt-5">Upload completed</h1>
          <p className="text-sm text-slate-500 mt-1">
            <span className="font-medium text-slate-700">{fileName}</span> was processed across{" "}
            <span className="font-medium text-slate-700">{results.length}</span> configuration
            {results.length > 1 ? "s" : ""}.
          </p>
          <div className="text-[11px] text-slate-400 mt-2 font-mono">
            Job ID: UU-2026-{Math.floor(Math.random() * 9000) + 1000} · {new Date().toLocaleTimeString()}
          </div>
        </div>

        {/* Summary grid */}
        <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Sheets touched" value={results.length} tone="slate" />
          <SummaryCard label="New entries saved" value={totals.newRows} tone="emerald" />
          <SummaryCard label="Existing entries overwritten" value={totals.updatedRows} tone="sky" />
          <SummaryCard label="Rows skipped" value={totals.ignoredRows} tone="amber" />
        </div>

        {/* Per-config compact list */}
        <div className="px-6 pb-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Configurations affected
          </div>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {results.map((r) => (
              <div key={r.configId} className="flex items-center px-4 py-2.5 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 truncate">{r.configName}</div>
                  <div className="text-[11px] text-slate-400 font-mono">{r.configId}</div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-emerald-700 font-semibold font-mono">+{r.newRows}</span>
                  <span className="text-sky-700 font-mono">~{r.updatedRows}</span>
                  {r.ignoredRows > 0 && (
                    <span className="text-amber-700 font-mono">!{r.ignoredRows}</span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <IconCheck size={11} /> Done
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/40 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {totals.errors > 0 || totals.ignoredRows > 0 ? (
            <button
              onClick={() => downloadErrorReport(fileName, results)}
              className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 flex items-center justify-center gap-2"
            >
              <IconDownload size={15} /> Download Error Report
            </button>
          ) : (
            <div className="text-xs text-slate-500 px-1">
              No errors — full audit log available in History.
            </div>
          )}
          <div className="flex-1" />
          <button
            onClick={onAnother}
            className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 flex items-center justify-center gap-2"
          >
            <IconUpload size={15} /> Upload another batch
          </button>
          <button
            onClick={onDone}
            className="h-10 px-5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 flex items-center justify-center gap-2"
          >
            <IconHome size={15} /> Back to Dashboard
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-400 text-center mt-4">
        A copy of this run has been logged to <span className="font-mono">Audit › Unified Uploads</span>.
        You can revert this batch within 24 hours.
      </p>
    </div>
  );
}

// Generates a CSV listing every error / warning / skipped row across all
// configs in this upload. Operators can hand this to QA or use it as a
// punch-list when re-uploading the corrected file.
function downloadErrorReport(fileName: string, results: UploadFileResult[]) {
  const ts = new Date();
  const stamp = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(
    ts.getDate(),
  ).padStart(2, "0")}_${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}`;

  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines: string[] = [];
  lines.push(`# IOsense Unified Upload — Error & Skipped Rows Report`);
  lines.push(`# Source file: ${fileName}`);
  lines.push(`# Generated: ${ts.toISOString()}`);
  lines.push(`# Sheets affected: ${results.length}`);
  lines.push("");
  lines.push(
    [
      "Configuration",
      "Config ID",
      "Severity",
      "Row in file",
      "Column",
      "Issue",
    ]
      .map(esc)
      .join(","),
  );

  let count = 0;
  for (const r of results) {
    for (const v of r.validation) {
      if (v.level === "info") continue; // info lines are confirmations, not issues
      lines.push(
        [
          r.configName,
          r.configId,
          v.level,
          v.row ?? "",
          v.column ?? "",
          v.message,
        ]
          .map(esc)
          .join(","),
      );
      count++;
    }
    // Also list skipped-row count per config so the report is a complete punch-list
    if (r.ignoredRows > 0) {
      lines.push(
        [
          r.configName,
          r.configId,
          "skipped",
          "",
          "",
          `${r.ignoredRows} row${r.ignoredRows === 1 ? "" : "s"} skipped (empty values or duplicate timestamps).`,
        ]
          .map(esc)
          .join(","),
      );
      count++;
    }
  }

  if (count === 0) {
    lines.push("(no issues to report)");
  }

  const out = lines.join("\n");
  triggerDownload(`IOsense_Upload_Error_Report__${stamp}.csv`, out);
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "slate" | "emerald" | "sky" | "amber" }) {
  const tones = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50/60",
    sky: "border-sky-200 bg-sky-50/60",
    amber: "border-amber-200 bg-amber-50/60",
  };
  const valTones = {
    slate: "text-slate-900",
    emerald: "text-emerald-700",
    sky: "text-sky-700",
    amber: "text-amber-700",
  };
  return (
    <div className={`border rounded-xl px-4 py-3 ${tones[tone]}`}>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${valTones[tone]}`}>{value.toLocaleString()}</div>
    </div>
  );
}
