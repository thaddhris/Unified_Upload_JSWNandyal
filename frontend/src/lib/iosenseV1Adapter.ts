// V1 adapter — JSWDashboard (Cement Quality) sheets on appserver.iosense.io.
//
// A V1 "sheet" is a (devID, entity) pair. The devID points at a regular
// IOsense device (e.g. JSWDQC_A1) holding sensors D0..Dn; the entity is a
// hardcoded slice key (e.g. "pb") that selects which sensor columns the
// sheet uses. The combination of (devID, entity) is what the V1 production
// app routes to as `/cement-quality-dashboard/{entity}`.
//
// Routes (from production app cURLs):
//
//   getTableRowJSW  → PUT  https://appserver.iosense.io
//                          /api/account/JSWDashboard/getTableRowJSW
//                     body: { devID, entity, page, limit, stime, eTime, sort }
//                     returns: { data: { data: Row[], allData: Row[] } }
//                     Row.data = { entity, time, date, D78?: val, D79?: val, ... }
//                     Row._id  = rowID (used by edit/save endpoints)
//
//   getRules        → PUT  https://appserver.iosense.io
//                          /api/account/JSWDashboard/getRules
//                     body: { entity: [entity] }
//                     returns conditional-formatting rules (not used for
//                     column discovery — only for value coloring).
//
//   getDeviceSpecificMetadata → GET https://connector.iosense.io
//                          /api/account/ai-sdk/metaData/device/{devID}
//                     gives sensor labels (sensorId → sensorName), used to
//                     turn D78/D79/... into human column headers.
//
// There is NO server-side list endpoint for V1 sheets (probed common names,
// all 404). The (devID, entity) inventory is hardcoded below; extend
// V1_SHEETS to surface additional V1 sheets in the unified list.
//
//   createBulk      → PUT  https://appserver.iosense.io
//                          /api/account/JSWDashboard/createBulk
//                     body: { devID, entity, data: [{devID, data:{Dn..., time}}] }
//                     Upsert semantics keyed on (devID, entity, time): if a row
//                     exists at that timestamp it's replaced with the payload,
//                     so saveRows merges user values into the existing row data
//                     first to keep cells the user didn't touch intact.
//
//   (Optional)       bulkValidate — same payload, runs validation only. Not
//                    wired here yet; the V1 UI calls it before createBulk for
//                    a pre-commit error preview.
//
//   editTableRowJSW  → PUT .../editTableRowJSW
//                     Per-row in-place edit by rowID. Not used by our adapter
//                     (createBulk handles N rows in one call), but kept here
//                     for reference: body = {devID, id, data:{Dn..., time, entity}}.

import type {
  UnifiedUploadAdapter,
  SavePayloadRow,
  SaveResult,
  ConfigWarmupPatch,
} from "./adapter";
import type { EntryConfig, ColumnDef } from "./mockData";
import { ioFetch, ioFetchApp } from "./iosenseClient";

/* ─── Hardcoded V1 sheet inventory ───────────────────────────────────────── */

type V1SheetDef = {
  devID: string;
  entity: string;
  name: string; // friendly name shown in the unified list
};

// Hardcoded inventory mirrors the V1 production app's
// /cement-quality-dashboard/<entity> route table. All 9 entities live on
// the same device (JSWDQC_A1 carries 675 sensors, partitioned by entity).
// Add new rows as the V1 catalogue grows.
const V1_SHEETS: V1SheetDef[] = [
  { devID: "JSWDQC_A1", entity: "pl", name: "PSC Loading" },
  { devID: "JSWDQC_A1", entity: "pb", name: "PSC Blending" },
  { devID: "JSWDQC_A1", entity: "opg", name: "OPC for PSC Grinding" },
  { devID: "JSWDQC_A1", entity: "omb", name: "OPC Market Blending" },
  { devID: "JSWDQC_A1", entity: "oml", name: "OPC Market Loading" },
  { devID: "JSWDQC_A1", entity: "cbm", name: "Clinker Ball Mill" },
  { devID: "JSWDQC_A1", entity: "misc", name: "Daily Avg CQ — Miscellaneous" },
  { devID: "JSWDQC_A1", entity: "cl", name: "Daily Avg CQ — CHD Loading" },
  { devID: "JSWDQC_A1", entity: "cb", name: "Daily Avg CQ — CHD Blending" },
];

/* ─── API response types ─────────────────────────────────────────────────── */

type DeviceMetaResponse = {
  success?: boolean;
  data?: {
    devID?: string;
    devName?: string;
    sensors?: Array<{ sensorId: string; sensorName?: string }>;
    unitSelected?: Record<string, string>;
  };
};

type TableRow = {
  _id: string;
  devID: string;
  data: Record<string, unknown> & {
    entity?: string;
    time?: number;
    date?: string;
  };
};

type GetTableRowResponse = {
  success?: boolean;
  data?: {
    data?: TableRow[];
    allData?: TableRow[];
  };
};

/* ─── Internal types ─────────────────────────────────────────────────────── */

type V1Column = {
  sensorId: string; // D78, D79, ...
  sensorName: string; // human label, falls back to sensorId
  unit?: string;
};

type V1SheetMeta = {
  devID: string;
  entity: string;
  name: string;
  columns: V1Column[];
  existingByCell: Map<string, Record<string, string>>;
  // ^ sensorId → { nsTime (string) → value } for prefill into the workbook
  // Time-of-day offset (ms into UTC day) used by the template generator to
  // anchor every row at the same wall-clock time the V1 rows are stored at.
  // V1 daily rows land at 18:30 UTC (= midnight IST) → 66_600_000 ms. Derived
  // empirically from the first observed row's `time` field so it's
  // timezone-independent rather than hardcoded.
  anchorOffsetMs?: number;
};

const v1MetaCache = new Map<string, V1SheetMeta>();

/* ─── Config id encoding (jsw:<devID>:<entity>) ──────────────────────────── */

function encodeV1Id(devID: string, entity: string): string {
  return `jsw:${devID}:${entity}`;
}

function decodeV1Id(id: string): { devID: string; entity: string } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== "jsw") return null;
  if (!parts[1] || !parts[2]) return null;
  return { devID: parts[1], entity: parts[2] };
}

/* ─── Build V1 column list ───────────────────────────────────────────────── */

// Each V1 sheet only uses a subset of the device's sensors. Discover that
// subset from the keys that actually appear in row data; map each to its
// sensorName via the device metadata.
function inferActiveSensorIds(rows: TableRow[]): string[] {
  const ids = new Set<string>();
  const RESERVED = new Set(["entity", "time", "date"]);
  for (const r of rows) {
    for (const k of Object.keys(r.data ?? {})) {
      if (RESERVED.has(k)) continue;
      if (/^D\d+$/.test(k)) ids.add(k);
    }
  }
  // Stable order: numeric sensor index ascending.
  return [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

async function loadDeviceSensorNames(
  devID: string,
): Promise<Map<string, { sensorName: string; unit?: string }>> {
  try {
    const resp = await ioFetch<DeviceMetaResponse>(
      `/api/account/ai-sdk/metaData/device/${encodeURIComponent(devID)}`,
      { method: "GET" },
    );
    const out = new Map<string, { sensorName: string; unit?: string }>();
    const sensors = resp?.data?.sensors ?? [];
    const units = resp?.data?.unitSelected ?? {};
    for (const s of sensors) {
      if (!s.sensorId) continue;
      out.set(s.sensorId, {
        sensorName: (s.sensorName ?? "").trim() || s.sensorId,
        unit: units[s.sensorId],
      });
    }
    return out;
  } catch (e) {
    console.warn(`[v1] device metadata load failed for ${devID}`, e);
    return new Map();
  }
}

async function loadRowsForSheet(
  devID: string,
  entity: string,
  limit: number,
): Promise<TableRow[]> {
  // Wide window — backend will return whatever exists within. The sheet UI
  // doesn't strictly need a date filter to discover columns; the limit caps
  // network cost.
  const endMs = Date.now();
  const startMs = endMs - 365 * 86_400_000;
  try {
    const resp = await ioFetchApp<GetTableRowResponse>(
      `/api/account/JSWDashboard/getTableRowJSW`,
      {
        method: "PUT",
        body: {
          devID,
          entity,
          page: 1,
          limit,
          stime: new Date(startMs).toISOString(),
          eTime: new Date(endMs).toISOString(),
          sort: "desc",
        },
      },
    );
    return resp?.data?.data ?? [];
  } catch (e) {
    console.warn(`[v1] getTableRowJSW failed for ${devID}/${entity}`, e);
    return [];
  }
}

async function buildSheetMeta(def: V1SheetDef): Promise<V1SheetMeta | null> {
  const cacheKey = `${def.devID}:${def.entity}`;
  const cached = v1MetaCache.get(cacheKey);
  if (cached) return cached;

  const [sensorMap, rows] = await Promise.all([
    loadDeviceSensorNames(def.devID),
    loadRowsForSheet(def.devID, def.entity, 60),
  ]);
  const activeIds = inferActiveSensorIds(rows);
  // Surface the sheet even when the entity has no rows yet — empty schema
  // is still useful in the list (shows what's available). Don't gate on
  // sensorMap either: if metadata failed but rows came back, the row keys
  // become the column ids.

  const columns: V1Column[] = activeIds.map((sid) => {
    const meta = sensorMap.get(sid);
    return {
      sensorId: sid,
      sensorName: meta?.sensorName ?? sid,
      unit: meta?.unit,
    };
  });

  // Build per-column existingData keyed by ns-timestamp (template builder
  // expects ns-string keys; multiply ms by 1_000_000). Derive the daily
  // anchor offset from the first row's `time` while iterating — that's what
  // the template uses to place each row at the right time-of-day.
  const existingByCell = new Map<string, Record<string, string>>();
  for (const sid of activeIds) existingByCell.set(sid, {});
  let anchorOffsetMs: number | undefined;
  for (const r of rows) {
    const tMs = typeof r.data?.time === "number" ? r.data.time : NaN;
    if (!isFinite(tMs)) continue;
    if (anchorOffsetMs === undefined && tMs > 0) {
      anchorOffsetMs = ((tMs % 86_400_000) + 86_400_000) % 86_400_000;
    }
    const nsKey = (tMs * 1_000_000).toString();
    for (const sid of activeIds) {
      const v = r.data?.[sid];
      if (v === undefined || v === null || v === "") continue;
      existingByCell.get(sid)![nsKey] = String(v);
    }
  }

  const meta: V1SheetMeta = {
    devID: def.devID,
    entity: def.entity,
    name: def.name,
    columns,
    existingByCell,
    anchorOffsetMs,
  };
  v1MetaCache.set(cacheKey, meta);
  return meta;
}

/* ─── Adapter implementation ─────────────────────────────────────────────── */

export const iosenseV1Adapter: UnifiedUploadAdapter = {
  async listConfigs(): Promise<EntryConfig[]> {
    v1MetaCache.clear();
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    return V1_SHEETS.map((def) => ({
      id: encodeV1Id(def.devID, def.entity),
      name: def.name,
      plant: "V1 Sheet",
      subSections: 0,
      periodicity: "Daily",
      // Placeholder column count until warmup populates the real one.
      columns: 1,
      lastUpdated: now,
      owner: "IOsense",
      status: "Active",
      version: "v1",
    }));
  },

  async getSchema(cfg: EntryConfig): Promise<ColumnDef[]> {
    const decoded = decodeV1Id(cfg.id);
    if (!decoded) return [];
    const def = V1_SHEETS.find(
      (d) => d.devID === decoded.devID && d.entity === decoded.entity,
    );
    if (!def) return [];
    const meta = await buildSheetMeta(def);
    if (!meta) return [];
    return meta.columns.map((c) => ({
      name: c.sensorName,
      unit: c.unit,
      existingData: meta.existingByCell.get(c.sensorId),
    }));
  },

  async saveRows(cfg: EntryConfig, rows: SavePayloadRow[]): Promise<SaveResult> {
    const decoded = decodeV1Id(cfg.id);
    if (!decoded) {
      return {
        inserted: 0,
        updated: 0,
        skipped: rows.length,
        errors: [{ row: 0, message: "Invalid V1 config id" }],
      };
    }
    const def = V1_SHEETS.find(
      (d) => d.devID === decoded.devID && d.entity === decoded.entity,
    );
    if (!def) {
      return {
        inserted: 0,
        updated: 0,
        skipped: rows.length,
        errors: [{ row: 0, message: "Unknown V1 sheet" }],
      };
    }
    if (rows.length === 0) {
      return { inserted: 0, updated: 0, skipped: 0, errors: [] };
    }

    const meta = await buildSheetMeta(def);
    if (!meta || meta.columns.length === 0) {
      return {
        inserted: 0,
        updated: 0,
        skipped: rows.length,
        errors: [{ row: 0, message: "Couldn't load V1 sheet schema" }],
      };
    }
    const nameToId = new Map<string, string>();
    for (const c of meta.columns) nameToId.set(c.sensorName, c.sensorId);

    // Fetch existing rows covering the upload range so we can merge each
    // incoming row's user-supplied cells with the server-side row. createBulk
    // has replace-on-(devID,entity,time) semantics — without the merge we'd
    // blank out cells the user didn't touch.
    const tsMs = rows.map((r) => r.timestamp.getTime()).sort((a, b) => a - b);
    const PAD = 86_400_000; // 1 day each side
    const existingResp = await ioFetchApp<GetTableRowResponse>(
      `/api/account/JSWDashboard/getTableRowJSW`,
      {
        method: "PUT",
        body: {
          devID: def.devID,
          entity: def.entity,
          page: 1,
          limit: 1000,
          stime: new Date(tsMs[0] - PAD).toISOString(),
          eTime: new Date(tsMs[tsMs.length - 1] + PAD).toISOString(),
          sort: "desc",
        },
      },
    ).catch((e) => {
      console.warn(`[v1] saveRows existing-rows fetch failed`, e);
      return null;
    });

    const existingRows = existingResp?.data?.data ?? [];
    const byTimestamp = new Map<number, TableRow>();
    for (const r of existingRows) {
      if (typeof r.data?.time === "number") byTimestamp.set(r.data.time, r);
    }

    // Build the bulk payload — one entry per upload row.
    const bulkData = rows.map((row) => {
      const tMs = row.timestamp.getTime();
      const existing = byTimestamp.get(tMs);

      // Start from the existing row's data (preserves untouched cells). When
      // there's no existing row, seed with empty strings for every active
      // column — matches the V1 UI's upload payload shape.
      const cells: Record<string, unknown> = existing?.data
        ? { ...existing.data }
        : Object.fromEntries(meta.columns.map((c) => [c.sensorId, ""]));

      for (const [colName, rawVal] of Object.entries(row.values)) {
        const sid = nameToId.get(colName);
        if (!sid) continue;
        if (rawVal === undefined || rawVal === null) continue;
        if (rawVal === "") {
          cells[sid] = "";
          continue;
        }
        const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
        cells[sid] = Number.isFinite(num) ? num : String(rawVal);
      }

      cells.time = row.timestamp.toISOString();
      cells.entity = def.entity;
      return { devID: def.devID, data: cells };
    });

    try {
      await ioFetchApp(`/api/account/JSWDashboard/createBulk`, {
        method: "PUT",
        body: {
          devID: def.devID,
          entity: def.entity,
          data: bulkData,
        },
      });
      return {
        inserted: rows.length,
        updated: 0,
        skipped: 0,
        errors: [],
      };
    } catch (e) {
      const err = e as { message?: string };
      return {
        inserted: 0,
        updated: 0,
        skipped: rows.length,
        errors: [
          { row: 0, message: err.message ?? "V1 bulk upload failed" },
        ],
      };
    }
  },

  async warmupConfigs(
    configIds: string[],
    onProgress: (configId: string, patch: ConfigWarmupPatch) => void,
  ): Promise<void> {
    const ours = configIds.filter((id) => decodeV1Id(id) !== null);
    if (ours.length === 0) return;

    const CONCURRENCY = 4;
    const queue = [...ours];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const cfgId = queue.shift();
        if (!cfgId) break;
        const decoded = decodeV1Id(cfgId);
        if (!decoded) continue;
        const def = V1_SHEETS.find(
          (d) => d.devID === decoded.devID && d.entity === decoded.entity,
        );
        if (!def) continue;
        try {
          const meta = await buildSheetMeta(def);
          if (!meta) continue;
          onProgress(cfgId, {
            periodicity: "Daily",
            columns: meta.columns.length + 1, // +1 for DATE column
            columnDefs: meta.columns.map((c) => ({
              name: c.sensorName,
              unit: c.unit,
              existingData: meta.existingByCell.get(c.sensorId),
            })),
            anchorOffsetMs: meta.anchorOffsetMs,
          });
        } catch (e) {
          console.warn(`[v1] warmup failed for ${cfgId}`, e);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, ours.length) }, () => worker()),
    );
  },
};
