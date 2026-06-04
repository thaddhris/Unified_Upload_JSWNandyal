// Picks which UnifiedUploadAdapter the app uses at runtime.
//
//   Default:                       composite IOsense adapter (V2 + V1)
//   ?adapter=mock in URL OR
//   NEXT_PUBLIC_ADAPTER=mock env:  mockAdapter (in-memory demo data — dev only)
//
// The composite delegates per-config by cfg.version so V1 sheets (CUSTOM_TABLE03
// devices on connector.iosense.io) and V2 sheets (appserver MDE V2 sections)
// land in the same unified list without either adapter knowing about the other.

import type { UnifiedUploadAdapter, ConfigWarmupPatch } from "./adapter";
import type { EntryConfig } from "./mockData";
import { mockAdapter } from "./mockAdapter";
import { iosenseAdapter } from "./iosenseAdapter";
import { iosenseV1Adapter } from "./iosenseV1Adapter";

export type AdapterMode = "mock" | "iosense";

export function detectAdapterMode(): AdapterMode {
  if (typeof window !== "undefined") {
    const urlMode = new URLSearchParams(window.location.search).get("adapter");
    if (urlMode === "mock") return "mock";
    if (urlMode === "iosense") return "iosense";
  }
  const envMode = process.env.NEXT_PUBLIC_ADAPTER;
  if (envMode === "mock") return "mock";
  return "iosense";
}

function pick(cfg: EntryConfig): UnifiedUploadAdapter {
  return cfg.version === "v1" ? iosenseV1Adapter : iosenseAdapter;
}

// Composite — V2 results first (existing UX ordering), V1 appended.
// Per-adapter failures don't take down the other side: a V1 outage shouldn't
// hide V2 sheets and vice-versa.
const iosenseComposite: UnifiedUploadAdapter = {
  async listConfigs(): Promise<EntryConfig[]> {
    const [v2, v1] = await Promise.all([
      iosenseAdapter.listConfigs().catch((e) => {
        console.warn("[composite] V2 listConfigs failed", e);
        return [] as EntryConfig[];
      }),
      iosenseV1Adapter.listConfigs().catch((e) => {
        console.warn("[composite] V1 listConfigs failed", e);
        return [] as EntryConfig[];
      }),
    ]);
    return [...v2, ...v1];
  },

  getSchema(cfg) {
    return pick(cfg).getSchema(cfg);
  },

  saveRows(cfg, rows) {
    return pick(cfg).saveRows(cfg, rows);
  },

  async warmupConfigs(
    configIds: string[],
    onProgress: (configId: string, patch: ConfigWarmupPatch) => void,
  ) {
    // Each adapter filters out ids it doesn't own internally.
    await Promise.all([
      iosenseAdapter.warmupConfigs?.(configIds, onProgress),
      iosenseV1Adapter.warmupConfigs?.(configIds, onProgress),
    ]);
  },

  async checkConflicts(cfg, timestamps) {
    const a = pick(cfg);
    if (a.checkConflicts) return a.checkConflicts(cfg, timestamps);
    return new Set<string>();
  },
};

export function getAdapter(mode: AdapterMode): UnifiedUploadAdapter {
  return mode === "iosense" ? iosenseComposite : mockAdapter;
}
