import type { EntryConfig, ColumnDef } from "./mockData";

/**
 * UnifiedUploadAdapter — the single boundary between this UI module and any
 * backend (mock, IOsense v2, future systems).
 *
 * The whole Unified Upload feature only ever talks to its adapter. Swap the
 * mock impl for an IOsense impl when v2 endpoints are wired — no component
 * changes needed.
 *
 * v1 vs v2 sheets:
 *   - `listConfigs()` returns BOTH versions in the same array, each tagged
 *     with `version: "v1" | "v2"`.
 *   - `getSchema(cfg)` is the version-aware schema source:
 *       v1 → reads a hardcoded schema map (from your v1 code)
 *       v2 → reads the live config object
 *   - `saveRows(cfg, rows)` is a version-aware dispatcher that routes to the
 *     correct save endpoint based on cfg.version. Callers don't care.
 *
 * Optional:
 *   - `checkConflicts(...)` powers the "Will overwrite existing" preview count.
 *     If your backend doesn't expose this cheaply, leave it undefined — the UI
 *     degrades to "all rows shown as new" and the server still handles dedupe
 *     on save.
 */
export interface UnifiedUploadAdapter {
  /** List every manual-entry sheet visible to the current user (v1 + v2 merged). */
  listConfigs(): Promise<EntryConfig[]>;

  /** Resolve the column definitions for a config. v1 → hardcoded map, v2 → live config. */
  getSchema(cfg: EntryConfig): Promise<ColumnDef[]>;

  /** Save a batch of rows for one config. Routes by cfg.version to the correct endpoint. */
  saveRows(cfg: EntryConfig, rows: SavePayloadRow[]): Promise<SaveResult>;

  /**
   * Optional: given timestamps, return the subset that already has data stored.
   * Used to split the preview into "new" vs "overwrites existing". Skip if
   * unavailable — the UI handles it.
   */
  checkConflicts?(cfg: EntryConfig, timestamps: Date[]): Promise<Set<string>>;
}

export type SavePayloadRow = {
  timestamp: Date;
  values: Record<string, string | number | null>;
  operator?: string;
  remarks?: string;
};

export type SaveResult = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
};
