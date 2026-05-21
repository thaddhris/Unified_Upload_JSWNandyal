import type { UnifiedUploadAdapter, SavePayloadRow, SaveResult } from "./adapter";
import type { EntryConfig, ColumnDef } from "./mockData";
import { ENTRY_CONFIGS } from "./mockData";

/**
 * Mock implementation of UnifiedUploadAdapter. Backs the demo and is the
 * reference for the eventual IOsense adapter. Swap this out — no UI changes.
 *
 * Implementation hints for the real iosenseAdapter:
 *
 *   listConfigs():
 *     - Hit your "list manual-entry configs" endpoint (returns v2 sheets).
 *     - Merge with the hardcoded v1 list (kept in code alongside v1 schemas).
 *     - Tag each with `version: "v1" | "v2"`.
 *
 *   getSchema(cfg):
 *     - if cfg.version === "v1" → return V1_SCHEMAS[cfg.id] (hardcoded map)
 *     - else → fetch from the v2 config endpoint
 *
 *   saveRows(cfg, rows):
 *     - if cfg.version === "v1" → POST to /v1/manualEntry/{id}/rows
 *     - else → POST to /v2/manualEntry/{id}/rows
 *     Same return shape either way.
 */
export const mockAdapter: UnifiedUploadAdapter = {
  async listConfigs(): Promise<EntryConfig[]> {
    // Simulate network so the UI exercises its loading states
    await sleep(120);
    return ENTRY_CONFIGS;
  },

  async getSchema(cfg: EntryConfig): Promise<ColumnDef[]> {
    await sleep(40);
    if (cfg.columnDefs && cfg.columnDefs.length > 0) return cfg.columnDefs;
    // Fallback: synthesize generic columns for configs without a hand-defined schema
    const out: ColumnDef[] = [];
    const reserved = 1; // DATE column
    const dataCount = Math.max(0, cfg.columns - reserved);
    if (cfg.subSections > 0) {
      const perSub = Math.max(1, Math.ceil(dataCount / cfg.subSections));
      let added = 0;
      for (let s = 1; s <= cfg.subSections && added < dataCount; s++) {
        for (let c = 1; c <= perSub && added < dataCount; c++) {
          out.push({ name: `Param ${c}`, subSection: `Sub-section ${s}` });
          added++;
        }
      }
    } else {
      for (let c = 1; c <= dataCount; c++) out.push({ name: `Param ${c}` });
    }
    return out;
  },

  async saveRows(cfg: EntryConfig, rows: SavePayloadRow[]): Promise<SaveResult> {
    await sleep(180 + rows.length * 4);
    const existing = loadSavedSet(cfg.id);
    let inserted = 0;
    let updated = 0;
    for (const r of rows) {
      const key = r.timestamp.toISOString();
      if (existing.has(key)) updated++;
      else {
        inserted++;
        existing.add(key);
      }
    }
    persistSavedSet(cfg.id, existing);
    return { inserted, updated, skipped: 0, errors: [] };
  },

  // Returns the subset of timestamps that already have data stored. In the real
  // iosenseAdapter this hits an endpoint like POST /manualEntry/{cfgId}/checkExisting
  // with the timestamps and reads which ones come back as "found".
  async checkConflicts(cfg: EntryConfig, timestamps: Date[]): Promise<Set<string>> {
    await sleep(60);
    const stored = loadSavedSet(cfg.id);
    const conflicts = new Set<string>();
    for (const t of timestamps) {
      const key = t.toISOString();
      if (stored.has(key)) conflicts.add(key);
    }
    return conflicts;
  },
};

// ─── Persistence layer: in-browser memory of "what's been saved" so the demo
//     correctly classifies repeat uploads as overwrites instead of new rows. ───
const SAVED_KEY_PREFIX = "iosense.unifiedUpload.savedTimestamps.";

function loadSavedSet(configId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SAVED_KEY_PREFIX + configId);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistSavedSet(configId: string, set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_KEY_PREFIX + configId, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore quota errors in prototype */
  }
}

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}
