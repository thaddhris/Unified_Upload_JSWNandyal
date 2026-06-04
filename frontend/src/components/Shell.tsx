"use client";

import * as React from "react";
import { clearAuth, hasAuth } from "../lib/iosenseClient";

export function Shell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [signedIn, setSignedIn] = React.useState(false);

  // Re-check sign-in state when the menu opens (covers post-bootstrap state)
  React.useEffect(() => {
    setSignedIn(hasAuth());
  }, [menuOpen]);

  const handleLogout = () => {
    clearAuth();
    // Strip any cached token from the URL too, then hard reload so the boot
    // splash → sign-in flow runs fresh.
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.location.replace(url.pathname + (url.search || "") + url.hash);
  };

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

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xs font-semibold hover:ring-2 hover:ring-amber-200 transition-shadow"
            aria-label="Account menu"
          >
            UT
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    IOsense session
                  </div>
                  <div className="text-sm text-slate-700 mt-0.5">
                    {signedIn ? "Signed in" : "Not signed in"}
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  disabled={!signedIn}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-white"
                >
                  Sign out
                </button>
                <a
                  href="https://iosense.io/profile"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100"
                  onClick={() => setMenuOpen(false)}
                >
                  Open IOsense portal ↗
                </a>
              </div>
            </>
          )}
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="h-9 border-t border-slate-200 bg-white px-6 flex items-center justify-center text-[11px] text-slate-400">
        Faclon Labs · IOsense Platform · © 2026
      </footer>
    </div>
  );
}
