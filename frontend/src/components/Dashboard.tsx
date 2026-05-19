"use client";

import * as React from "react";
import { ENTRY_CONFIGS } from "../lib/mockData";
import { IconSearch, IconUpload, IconEdit, IconShare, IconTrash, IconSparkle } from "./Icons";

export function Dashboard({ onOpenUnified }: { onOpenUnified: () => void }) {
  const [query, setQuery] = React.useState("");
  const filtered = ENTRY_CONFIGS.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.plant.toLowerCase().includes(query.toLowerCase()) ||
      c.owner.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      {/* Stat strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Configurations" value="102" delta="74 on v2 · 28 legacy v1" tone="slate" />
        <StatCard label="Entries Logged Today" value="1,284" delta="+12% vs yesterday" tone="emerald" />
        <StatCard label="Pending Approvals" value="7" delta="2 overdue" tone="amber" />
        <StatCard label="Validation Errors (24h)" value="3" delta="all auto-flagged" tone="rose" />
      </div>

      {/* Action bar */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="p-5 flex flex-col md:flex-row md:items-center gap-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600">
              <IconSparkle size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800 text-[15px]">Manage Data Entry Configs</h2>
              <p className="text-xs text-slate-500">102 sheets · last sync 2 min ago</p>
            </div>
          </div>

          <div className="flex-1" />

          <div className="relative">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search configurations, plants, owners…"
              className="pl-9 pr-3 h-10 w-72 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-sm"
            />
          </div>

          <button className="h-10 px-4 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors">
            Export All
          </button>

          <button
            onClick={onOpenUnified}
            className="h-10 px-4 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-semibold shadow-sm hover:shadow-md hover:from-emerald-600 hover:to-teal-700 transition-all flex items-center gap-2"
          >
            <IconUpload size={16} />
            Unified Upload
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-white/20 font-semibold tracking-wide">
              NEW
            </span>
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50/60">
                <th className="px-5 py-3 font-medium w-14">Sr.</th>
                <th className="px-5 py-3 font-medium">Configuration</th>
                <th className="px-5 py-3 font-medium">Plant / Area</th>
                <th className="px-5 py-3 font-medium">Sub-sections</th>
                <th className="px-5 py-3 font-medium">Periodicity</th>
                <th className="px-5 py-3 font-medium">Columns</th>
                <th className="px-5 py-3 font-medium">Last Updated</th>
                <th className="px-5 py-3 font-medium">Owner</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c, i) => (
                <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3 text-slate-400 font-mono text-xs">{(i + 1).toString().padStart(2, "0")}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{c.name}</span>
                      {c.version === "v1" && (
                        <span
                          title="Legacy v1 sheet — fixed (hardcoded) column structure. Behaves the same in Unified Upload."
                          className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-300 font-semibold tracking-wide"
                        >
                          LEGACY
                        </span>
                      )}
                      {c.status === "Draft" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                          DRAFT
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">{c.id}</div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.plant}</td>
                  <td className="px-5 py-3">
                    {c.subSections === 0 ? (
                      <span className="text-slate-400">No sub-sections</span>
                    ) : (
                      <span className="text-slate-700">{c.subSections} sub-section{c.subSections > 1 ? "s" : ""}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <PeriodicityChip value={c.periodicity} />
                  </td>
                  <td className="px-5 py-3 text-slate-600 font-mono text-xs">{c.columns}</td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{c.lastUpdated}</td>
                  <td className="px-5 py-3 text-slate-600">{c.owner}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <ActionBtn><IconEdit size={15} /></ActionBtn>
                      <ActionBtn><IconShare size={15} /></ActionBtn>
                      <ActionBtn danger><IconTrash size={15} /></ActionBtn>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-sm text-slate-400">
                    No configurations match “{query}”
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Showing {filtered.length} of {ENTRY_CONFIGS.length} configurations · 102 total in workspace</span>
          <div className="flex items-center gap-2">
            <span>Items per page</span>
            <select className="border border-slate-200 rounded-md px-2 py-1 text-xs">
              <option>20</option><option>50</option><option>100</option>
            </select>
          </div>
        </div>
      </div>

      {/* Promo banner */}
      <div className="mt-6 rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-5 flex items-center gap-5 shadow-sm">
        <div className="w-12 h-12 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center">
          <IconUpload size={22} />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-[15px]">Stop uploading one sheet at a time.</h3>
          <p className="text-sm text-slate-300 mt-0.5">
            Unified Upload lets you push a single Excel workbook against multiple configurations — validations and previews before anything is written.
          </p>
        </div>
        <button
          onClick={onOpenUnified}
          className="px-4 py-2.5 rounded-lg bg-white text-slate-900 font-semibold text-sm hover:bg-slate-100 transition-colors"
        >
          Try Unified Upload
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, delta, tone }: { label: string; value: string; delta: string; tone: "slate" | "emerald" | "amber" | "rose" }) {
  const tones = {
    slate: "border-slate-200",
    emerald: "border-emerald-200",
    amber: "border-amber-200",
    rose: "border-rose-200",
  };
  const deltaTones = {
    slate: "text-slate-500",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
  };
  return (
    <div className={`bg-white border ${tones[tone]} rounded-xl px-5 py-4 shadow-sm`}>
      <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 mt-2">{value}</div>
      <div className={`text-xs mt-1 ${deltaTones[tone]}`}>{delta}</div>
    </div>
  );
}

function PeriodicityChip({ value }: { value: string }) {
  const map: Record<string, string> = {
    Daily: "bg-sky-50 text-sky-700 border-sky-200",
    Hourly: "bg-violet-50 text-violet-700 border-violet-200",
    Shift: "bg-amber-50 text-amber-700 border-amber-200",
    Weekly: "bg-slate-50 text-slate-700 border-slate-200",
  };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${map[value] || map.Weekly}`}>
      {value}
    </span>
  );
}

function ActionBtn({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
        danger
          ? "text-rose-500 hover:bg-rose-50"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
