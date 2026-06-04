// Real IOsense MDE V2 adapter — talks to appserver.iosense.io.
//
// Routes (confirmed from production app cURLs):
//
//   listConfigs()      → PUT  /api/account/manualDataEntry/section/{page}/{limit}
//                        body: { configType, searchValue: [] }
//
//   loadSectionDetail()→ PUT  /api/account/manualDataEntry/getData/{sectionID}/1/30
//                        body: { startTime, endTime, periodicity, configType }   (ms)
//                        returns: { data: { totalCount, section?, data: { [subsection]: ColumnDef[] } } }
//
//   saveRows()         → POST /api/account/manualDataEntry/upload/{sectionID}
//                        body: { configType, periodicity, deviceData[] }
//                        deviceData[i].time is NANOSECONDS (ms × 1_000_000)
//
//   checkConflicts()   → PUT  /api/account/manualDataEntry/getData/{sectionID}/1/500
//                        same body as loadSectionDetail; existing timestamps live
//                        in each column's `data` map keyed by ns-string.

import type {
  UnifiedUploadAdapter,
  SavePayloadRow,
  SaveResult,
  ConfigWarmupPatch,
} from "./adapter";
import type { EntryConfig, ColumnDef } from "./mockData";
import { ioFetchApp } from "./iosenseClient";

/* ─── Section list response ──────────────────────────────────────────────── */

type SectionListResponse = {
  success: boolean;
  data: {
    count: number;
    data: Array<{
      sectionData: { _id: string; title: string };
      subsections: Array<{ _id: string; title: string; parent?: { id: string } }>;
    }>;
  };
};

/* ─── getData response (used for schema + conflict-check) ────────────────── */

type RawColumn = {
  label?: string;
  devType?: string;
  devID?: string;
  sensorId?: { sensorId?: string; sensorName?: string; globalName?: string };
  periodicity?: string;
  section?: string; // = subsection name
  precision?: number;
  sensorName?: string;
  sensor?: string;
  devName?: string;
  cID?: string;
  data?: Record<string /* nsTime */, string /* value or "-" */>;
};

type SectionTimeConfig = {
  timezone?: string;
  cycleTimeHr?: number;
  cycleTimeMin?: number;
};

type GetDataResponse = {
  success: boolean;
  data?: {
    totalCount?: number;
    section?: {
      _id: string;
      title: string;
      configType: string;
      config?: {
        time?: SectionTimeConfig;
      };
    };
    data?: Record<string /* subsectionName */, RawColumn[]>;
  };
};

/* ─── Section meta (cached per section after loadSectionDetail) ──────────── */

type SectionColumn = {
  subsection: string;   // e.g. "Feed(TPH)"
  label: string;        // e.g. "Min"
  devID: string;        // e.g. "JSWCEM_KPIT"
  sensor: string;       // e.g. "D0"
  sensorName: string;   // e.g. "Feed(TPH) Min"
  precision: number;
  // Existing recorded values from the backend, keyed by nanosecond-string
  // timestamp. Used to pre-fill the template so users see the current state
  // and only need to edit cells they want to change.
  data?: Record<string /* nsTime */, string /* value or "-" */>;
};

type SectionMeta = {
  id: string;
  title: string;
  configType: string;
  periodicity: string;       // lowercase, e.g. "monthly"
  columns: SectionColumn[];
  // From section.config.time when present.
  cycleTimeHr: number;
  cycleTimeMin: number;
  timezone: string;          // e.g. "Asia/Calcutta"
  // The section's daily anchor expressed as ms-into-the-UTC-day, derived
  // from any existing data point's timestamp (ts_ms % 86_400_000). This is
  // what the V2 backend actually keys entries on. We use this in preference
  // to cycleTimeHr/Min because the cycle config isn't returned for every
  // section, but data-derived anchor is always available once the section
  // has at least one entry.
  anchorOffsetMs: number | undefined;
};

/* ─── Caches (rebuilt on every listConfigs) ──────────────────────────────── */

let sectionTitleCache = new Map<string, string>();
let sectionMetaCache = new Map<string, SectionMeta>();
let parentByChild = new Map<string, string>();

export type AdapterDiscoveryStats = { sectionsReturned: number };
let lastDiscovery: AdapterDiscoveryStats = { sectionsReturned: 0 };
export function getLastDiscoveryStats(): AdapterDiscoveryStats {
  return lastDiscovery;
}

/* ─── Config id encoding (mde:<sectionId>) ───────────────────────────────── */

function encodeConfigId(sectionId: string): string {
  return `mde:${sectionId}`;
}
function decodeConfigId(id: string): { sectionId: string } | null {
  const [prefix, sectionId] = id.split(":");
  if (prefix !== "mde" || !sectionId) return null;
  return { sectionId };
}

function normalizePeriodicity(p: string | undefined): string {
  return (p ?? "").toString().trim().toLowerCase();
}

function mapPeriodicityToApp(p: string): EntryConfig["periodicity"] {
  const key = normalizePeriodicity(p);
  if (key === "hourly") return "Hourly";
  if (key === "daily") return "Daily";
  if (key === "shiftwise") return "Shift";
  if (key === "monthly") return "Weekly";
  return "Daily";
}

/* ─── loadSectionDetail: fetches columns + periodicity for a section ──── */

async function loadSectionDetail(sectionId: string): Promise<SectionMeta | null> {
  const cached = sectionMetaCache.get(sectionId);
  if (cached) return cached;

  // Periodicity isn't known up-front and varies per section. Try common values;
  // each section accepts whichever it was configured with. Cache on success.
  const now = Date.now();
  const yearMs = 365 * 86_400_000;
  const probeBody = (periodicity: string) => ({
    startTime: now - yearMs,
    endTime: now,
    periodicity,
    configType: "manualDataEntryToolV2",
  });
  const candidates = ["monthly", "daily", "hourly", "shiftwise", "weekly", "custom"];

  for (const probe of candidates) {
    try {
      const resp = await ioFetchApp<GetDataResponse>(
        `/api/account/manualDataEntry/getData/${encodeURIComponent(sectionId)}/1/30`,
        { method: "PUT", body: probeBody(probe) },
      );
      const dataMap = resp?.data?.data;
      if (!dataMap || Object.keys(dataMap).length === 0) continue;

      const columns: SectionColumn[] = [];
      let foundPeriodicity = probe;
      let anchorOffsetMs: number | undefined;
      for (const [dataMapKey, cols] of Object.entries(dataMap)) {
        for (const c of cols ?? []) {
          // Derive the section's daily anchor from any existing data point.
          // Every entry in a given section uses the same time-of-day in UTC,
          // so the first timestamp we see tells us the offset.
          if (anchorOffsetMs === undefined && c.data) {
            for (const tsNs of Object.keys(c.data)) {
              const tsMs = Number(tsNs) / 1_000_000;
              if (isFinite(tsMs) && tsMs > 0) {
                anchorOffsetMs = ((tsMs % 86_400_000) + 86_400_000) % 86_400_000;
                break;
              }
            }
          }
          const devID = c.devID || "";
          const sensor = c.sensor || c.sensorId?.sensorId || "";
          if (!devID || !sensor) continue;
          // The map key is the subsection title only when the section actually
          // has subsections. For flat sections the backend returns `section:
          // "none"` and the key is the column's cID (devID_sensor) — not a
          // human-readable group. Honour the column's own `section` field;
          // treat "none"/missing as "no subsection".
          const rawSection = (c.section ?? dataMapKey ?? "").toString().trim();
          const isFlat =
            !rawSection ||
            rawSection.toLowerCase() === "none" ||
            rawSection === `${devID}_${sensor}`;
          columns.push({
            subsection: isFlat ? "" : rawSection,
            label: c.label || "",
            devID,
            sensor,
            sensorName: c.sensorName || c.sensorId?.sensorName || sensor,
            precision: typeof c.precision === "number" ? c.precision : 2,
            data: c.data,
          });
          if (c.periodicity) foundPeriodicity = normalizePeriodicity(c.periodicity);
        }
      }
      if (columns.length === 0) continue;

      const timeCfg = resp?.data?.section?.config?.time;
      const meta: SectionMeta = {
        id: sectionId,
        title: resp?.data?.section?.title || sectionTitleCache.get(sectionId) || sectionId,
        configType: resp?.data?.section?.configType || "manualDataEntryToolV2",
        periodicity: foundPeriodicity,
        columns,
        cycleTimeHr: typeof timeCfg?.cycleTimeHr === "number" ? timeCfg.cycleTimeHr : 0,
        cycleTimeMin: typeof timeCfg?.cycleTimeMin === "number" ? timeCfg.cycleTimeMin : 0,
        timezone: timeCfg?.timezone || "Asia/Calcutta",
        anchorOffsetMs,
      };
      sectionMetaCache.set(sectionId, meta);
      return meta;
    } catch (e) {
      // try next candidate
      console.warn(`[adapter] loadSectionDetail probe failed for ${sectionId} (${probe})`, e);
    }
  }
  return null;
}

/* ─── Column name helpers ────────────────────────────────────────────────── */

// Push the "Target …" portion of a label onto a second line so it renders
// the same way the production MDE V2 sheets do — `name` on top, target range
// underneath in one cell. Idempotent: a newline already present is left alone.
function wrapTargetSuffix(name: string): string {
  if (name.includes("\n")) return name;
  const m = name.match(/^(.*?)(\s+Target\b.*)$/i);
  if (!m) return name;
  return `${m[1]}\n${m[2].trimStart()}`;
}

// Leaf label for a column — what goes in the BOTTOM row of the two-row header.
// Always just the column's own label/sensor; no subsection prefix (the
// template builder handles grouping via the `subSection` field).
function columnLeafLabel(c: SectionColumn): string {
  const lbl = (c.label ?? "").trim();
  if (lbl) return wrapTargetSuffix(lbl);
  if (c.sensorName) return c.sensorName;
  return `${c.devID} — ${c.sensor}`;
}

// Display name used for unique cell-keying (template header text the parser
// sees on upload). Includes subsection prefix when present so two distinct
// subsections can both have a "Min" leaf without collision.
function columnDisplayName(c: SectionColumn): string {
  const sub = (c.subsection ?? "").trim();
  const leaf = columnLeafLabel(c);
  if (!sub) return leaf;
  return `${sub} · ${leaf.replace(/\n/g, " ")}`;
}

/* ─── Adapter implementation ─────────────────────────────────────────────── */

export const iosenseAdapter: UnifiedUploadAdapter = {
  async listConfigs(): Promise<EntryConfig[]> {
    sectionTitleCache = new Map();
    sectionMetaCache = new Map();
    parentByChild = new Map();
    lastDiscovery = { sectionsReturned: 0 };

    const resp = await ioFetchApp<SectionListResponse>(
      "/api/account/manualDataEntry/section/1/500",
      {
        method: "PUT",
        body: {
          configType: "manualDataEntryToolV2",
          searchValue: [],
        },
      },
    );
    if (!resp?.success) throw new Error("Failed to load sections");

    type ParentRow = {
      id: string;
      title: string;
      subsections: Array<{ id: string; title: string }>;
    };
    const parents: ParentRow[] = [];
    for (const item of resp.data?.data ?? []) {
      const sd = item?.sectionData;
      if (!sd?._id) continue;
      const title = (sd.title ?? "").trim() || sd._id;
      sectionTitleCache.set(sd._id, title);

      const subs: Array<{ id: string; title: string }> = [];
      for (const sub of item.subsections ?? []) {
        if (!sub?._id) continue;
        const subTitle = (sub.title ?? "").trim() || sub._id;
        sectionTitleCache.set(sub._id, subTitle);
        parentByChild.set(sub._id, sd._id);
        subs.push({ id: sub._id, title: subTitle });
      }
      parents.push({ id: sd._id, title, subsections: subs });
    }

    lastDiscovery.sectionsReturned = parents.length;

    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    return parents.map(({ id, title, subsections }) => ({
      id: encodeConfigId(id),
      name: title,
      plant: "Section",
      subSections: subsections.length,
      periodicity: "Daily", // placeholder until loadSectionDetail runs
      columns: 1, // placeholder
      lastUpdated: now,
      owner: "IOsense",
      status: "Active",
      version: "v2",
    }));
  },

  async getSchema(cfg: EntryConfig): Promise<ColumnDef[]> {
    const decoded = decodeConfigId(cfg.id);
    if (!decoded) return [];
    const meta = await loadSectionDetail(decoded.sectionId);
    if (!meta) return [];

    // `name` = the leaf label (bottom row of two-row template header).
    // `subSection` = the group/subsection name (top row).
    // The template builder combines them with a vertical merge for the
    // grouped layout. The parser reconstructs the unique key from both rows.
    return meta.columns.map((c) => ({
      name: columnLeafLabel(c),
      subSection: c.subsection,
    }));
  },

  async saveRows(cfg: EntryConfig, rows: SavePayloadRow[]): Promise<SaveResult> {
    const decoded = decodeConfigId(cfg.id);
    if (!decoded) {
      return { inserted: 0, updated: 0, skipped: 0, errors: [{ row: 0, message: "Invalid config id" }] };
    }
    const meta = await loadSectionDetail(decoded.sectionId);
    if (!meta) {
      return { inserted: 0, updated: 0, skipped: 0, errors: [{ row: 0, message: "Couldn't load section config" }] };
    }

    // Map each filled cell back to its column's (devID, sensor). The parser
    // reconstructs row.values keys by combining the two header rows with " · "
    // when a subsection is present, e.g. "Feed(TPH) · Min", or just the leaf
    // label when the section has no subsections.
    const deviceData: { devID: string; sensor: string; value: string; time: number }[] = [];
    for (const row of rows) {
      const tNs = row.timestamp.getTime() * 1_000_000;
      for (const col of meta.columns) {
        const sub = (col.subsection ?? "").trim();
        const leaf = (col.label || col.sensorName || `${col.devID} — ${col.sensor}`).trim();
        const key = sub ? `${sub} · ${leaf}` : leaf;
        const raw = row.values[key];
        if (raw === undefined || raw === null || raw === "") continue;
        deviceData.push({
          devID: col.devID,
          sensor: col.sensor,
          value: String(raw),
          time: tNs,
        });
      }
    }

    try {
      await ioFetchApp<{ success: boolean; data: string }>(
        `/api/account/manualDataEntry/upload/${encodeURIComponent(meta.id)}`,
        {
          method: "POST",
          body: {
            configType: meta.configType,
            periodicity: meta.periodicity,
            deviceData,
          },
        },
      );
      return { inserted: rows.length, updated: 0, skipped: 0, errors: [] };
    } catch (e) {
      const err = e as { message?: string };
      return { inserted: 0, updated: 0, skipped: 0, errors: [{ row: 0, message: err.message ?? "Upload failed" }] };
    }
  },

  async warmupConfigs(
    configIds: string[],
    onProgress: (configId: string, patch: ConfigWarmupPatch) => void,
  ): Promise<void> {
    // Concurrency-limited prefetch. The browser already caps at ~6 connections
    // per origin; matching that here means no burst and no head-of-line stall.
    const CONCURRENCY = 6;
    const queue = [...configIds];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const cfgId = queue.shift();
        if (!cfgId) break;
        const decoded = decodeConfigId(cfgId);
        if (!decoded) continue;
        try {
          const meta = await loadSectionDetail(decoded.sectionId);
          if (!meta) continue;
          onProgress(cfgId, {
            periodicity: mapPeriodicityToApp(meta.periodicity),
            columns: meta.columns.length + 1, // +1 for the DATE column in templates
            columnDefs: meta.columns.map((c) => ({
              name: columnLeafLabel(c),
              subSection: c.subsection,
              existingData: c.data,
            })),
            cycleTimeHr: meta.cycleTimeHr,
            cycleTimeMin: meta.cycleTimeMin,
            anchorOffsetMs: meta.anchorOffsetMs,
          });
        } catch (e) {
          // Per-section failures shouldn't kill the warmup of others
          console.warn(`[adapter] warmup failed for ${cfgId}`, e);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, configIds.length) }, () => worker()),
    );
  },

  async checkConflicts(cfg: EntryConfig, timestamps: Date[]): Promise<Set<string>> {
    if (timestamps.length === 0) return new Set();
    const decoded = decodeConfigId(cfg.id);
    if (!decoded) return new Set();
    const meta = await loadSectionDetail(decoded.sectionId);
    if (!meta) return new Set();

    const sortedMs = timestamps.map((d) => d.getTime()).sort((a, b) => a - b);
    const startTime = sortedMs[0] - 60_000;
    const endTime = sortedMs[sortedMs.length - 1] + 60_000;

    try {
      const resp = await ioFetchApp<GetDataResponse>(
        `/api/account/manualDataEntry/getData/${encodeURIComponent(meta.id)}/1/500`,
        {
          method: "PUT",
          body: {
            startTime,
            endTime,
            periodicity: meta.periodicity,
            configType: meta.configType,
          },
        },
      );

      // Existing values live in each column's `data` map keyed by ns-string.
      // Any non-"-" value counts as "already saved at that timestamp".
      const existing = new Set<string>();
      for (const cols of Object.values(resp?.data?.data ?? {})) {
        for (const c of cols ?? []) {
          for (const [tsNs, val] of Object.entries(c.data ?? {})) {
            if (val === "-" || val === "") continue;
            const tsMs = Number(tsNs) / 1_000_000;
            if (!isFinite(tsMs)) continue;
            existing.add(new Date(tsMs).toISOString());
          }
        }
      }
      return existing;
    } catch (e) {
      console.warn("checkConflicts failed, degrading to all-new", e);
      return new Set();
    }
  },
};

// Re-export for the mock-mode UI to import without errors.
export { mapPeriodicityToApp };
