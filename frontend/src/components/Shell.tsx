"use client";

import * as React from "react";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-800">
      <header className="h-14 border-b border-slate-200 bg-white flex items-center px-6 gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold text-sm">
          IO
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-slate-800">Manual Data Entry</div>
          <div className="text-[11px] text-slate-500 -mt-0.5">Unified Upload</div>
        </div>
        <div className="flex-1" />
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xs font-semibold">
          UT
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="h-9 border-t border-slate-200 bg-white px-6 flex items-center justify-center text-[11px] text-slate-400">
        Faclon Labs · IOsense Platform · © 2026
      </footer>
    </div>
  );
}
