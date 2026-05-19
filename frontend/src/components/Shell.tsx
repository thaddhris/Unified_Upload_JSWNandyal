"use client";

import * as React from "react";
import {
  IconHome,
  IconGrid,
  IconLayers,
  IconChart,
  IconSettings,
  IconBell,
  IconFile,
  IconFactory,
  IconArrowLeft,
} from "./Icons";

const navItems = [
  { icon: IconHome, label: "Overview" },
  { icon: IconGrid, label: "Dashboards" },
  { icon: IconLayers, label: "Assets" },
  { icon: IconChart, label: "Analytics" },
  { icon: IconFile, label: "Manual Entry", active: true },
  { icon: IconFactory, label: "Plants" },
  { icon: IconSettings, label: "Settings" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800">
      {/* Sidebar */}
      <aside className="w-16 shrink-0 bg-slate-900 flex flex-col items-center py-4 gap-1 border-r border-slate-800">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold text-sm mb-3">
          IO
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              title={item.label}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                item.active
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              }`}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-14 border-b border-slate-200 bg-white flex items-center px-6 gap-3">
          <button className="text-slate-500 hover:text-slate-800 transition-colors">
            <IconArrowLeft size={20} />
          </button>
          <h1 className="font-semibold text-slate-800 text-[15px]">
            Manual Data Entry Tool
          </h1>
          <span className="text-slate-300">/</span>
          <span className="text-slate-500 text-sm">Unified Upload</span>
          <div className="flex-1" />
          <div className="text-xs text-slate-500 hidden md:flex items-center gap-2 px-2 py-1 rounded-md bg-slate-100">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Connected · UltraTech Cement — Jharsuguda
          </div>
          <button className="relative w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500">
            <IconBell size={18} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full" />
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xs font-semibold">
            UT
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>

        <footer className="h-9 border-t border-slate-200 bg-white px-6 flex items-center text-[11px] text-slate-400 justify-between">
          <span>Faclon Labs · IOsense Platform</span>
          <span>Terms & Conditions · Privacy Policy · © 2026</span>
        </footer>
      </div>
    </div>
  );
}
