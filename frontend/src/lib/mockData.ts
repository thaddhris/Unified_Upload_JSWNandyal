export type ColumnDef = {
  name: string;
  unit?: string;
  target?: string;
  subSection?: string;
};

export type EntryConfig = {
  id: string;
  name: string;
  plant: string;
  subSections: number;
  periodicity: "Daily" | "Hourly" | "Shift" | "Weekly";
  columns: number;
  // Optional: real column definitions matching the production Excel format.
  // When present, the template uses these exact column names (and target ranges
  // are appended to the header) instead of generic Param 1..N labels.
  columnDefs?: ColumnDef[];
  lastUpdated: string;
  owner: string;
  status: "Active" | "Draft";
  // Manual Data Entry v1 sheets have hardcoded column structures (defined in
  // app code). v2 sheets are user-configurable in the configurator UI. Unified
  // Upload treats both the same end-to-end; the only divergence is template
  // generation (v1 reads a hardcoded schema map, v2 reads the live config) and
  // the save endpoint (routed by version behind a common facade).
  version: "v1" | "v2";
};

// Reusable column packs — keep production-realistic column names so the template
// matches the Excel format operators are used to filling in.
const KILN_FEED_QUALITY_COLS: ColumnDef[] = [
  { name: "SiO2", unit: "%" },
  { name: "Al2O3", unit: "%", target: "3.5–3.6" },
  { name: "Fe2O3", unit: "%", target: "3.0–3.10" },
  { name: "CaO", unit: "%" },
  { name: "MgO", unit: "%" },
  { name: "SO3", unit: "%" },
  { name: "Na2O", unit: "%" },
  { name: "K2O", unit: "%" },
  { name: "Cl", unit: "%" },
  { name: "LSF", target: "100±2" },
  { name: "SM", target: "2.3±0.1" },
  { name: "AM", target: "1.3±0.1" },
];

const RAW_MILL_COLS: ColumnDef[] = [
  { name: "Feed Rate", unit: "TPH", subSection: "Mill Input" },
  { name: "Recirculation Load", unit: "%", subSection: "Mill Input" },
  { name: "Mill Power", unit: "kW", subSection: "Mill Input" },
  { name: "Mill Outlet Temp", unit: "°C", subSection: "Operating Conditions" },
  { name: "Mill DP", unit: "mmWg", subSection: "Operating Conditions" },
  { name: "Separator RPM", unit: "rpm", subSection: "Operating Conditions" },
  { name: "Bag Filter DP", unit: "mmWg", subSection: "Operating Conditions" },
  { name: "Raw Meal Residue (90µ)", unit: "%", subSection: "Product Quality" },
  { name: "Raw Meal Residue (212µ)", unit: "%", subSection: "Product Quality" },
  { name: "Raw Meal Moisture", unit: "%", subSection: "Product Quality" },
  { name: "Specific Power", unit: "kWh/t", subSection: "Product Quality" },
];

const CLINKER_FREE_LIME_COLS: ColumnDef[] = [
  { name: "Free Lime", unit: "%", target: "≤ 2.0" },
  { name: "Litre Weight", unit: "g/l" },
  { name: "Free CaO", unit: "%" },
];

const CEMENT_MILL_ENERGY_COLS: ColumnDef[] = [
  { name: "Feed Rate", unit: "TPH", subSection: "Mill" },
  { name: "Mill Power", unit: "kW", subSection: "Mill" },
  { name: "Separator Power", unit: "kW", subSection: "Mill" },
  { name: "Specific Energy", unit: "kWh/t", subSection: "Mill" },
  { name: "Outlet Temp", unit: "°C", subSection: "Mill" },
  { name: "Cement Blaine", unit: "cm²/g", subSection: "Quality" },
  { name: "Residue (45µ)", unit: "%", subSection: "Quality" },
  { name: "Residue (90µ)", unit: "%", subSection: "Quality" },
  { name: "SO3 in Cement", unit: "%", subSection: "Quality" },
];

export const ENTRY_CONFIGS: EntryConfig[] = [
  { id: "cfg-001", name: "Raw Mill 1 — Hourly Log", plant: "Line A", subSections: 3, periodicity: "Hourly", columns: 14, columnDefs: RAW_MILL_COLS, lastUpdated: "2026-05-14 09:12", owner: "S. Verma", status: "Active", version: "v2" },
  { id: "cfg-002", name: "Kiln Feed — Hourly Analysis", plant: "Line A", subSections: 0, periodicity: "Hourly", columns: 12, columnDefs: KILN_FEED_QUALITY_COLS, lastUpdated: "2026-05-14 06:00", owner: "S. Verma", status: "Active", version: "v2" },
  { id: "cfg-003", name: "Cement Mill 2 — Energy", plant: "Line B", subSections: 2, periodicity: "Shift", columns: 18, columnDefs: CEMENT_MILL_ENERGY_COLS, lastUpdated: "2026-05-13 22:45", owner: "R. Iyer", status: "Active", version: "v2" },
  { id: "cfg-004", name: "Coal Mill Moisture", plant: "Line B", subSections: 0, periodicity: "Daily", columns: 6, lastUpdated: "2026-05-13 18:30", owner: "K. Nair", status: "Active", version: "v1" },
  { id: "cfg-005", name: "Preheater Cyclone Temps", plant: "Line A", subSections: 4, periodicity: "Hourly", columns: 22, lastUpdated: "2026-05-14 08:55", owner: "A. Khan", status: "Active", version: "v2" },
  { id: "cfg-006", name: "Clinker Free Lime", plant: "Line C", subSections: 0, periodicity: "Daily", columns: 5, columnDefs: CLINKER_FREE_LIME_COLS, lastUpdated: "2026-05-12 11:10", owner: "R. Iyer", status: "Active", version: "v1" },
  { id: "cfg-007", name: "Cement Strength — 28 Day", plant: "QC Lab", subSections: 2, periodicity: "Daily", columns: 11, lastUpdated: "2026-05-13 14:20", owner: "P. Mehta", status: "Active", version: "v2" },
  { id: "cfg-008", name: "Bag House DP Readings", plant: "Line A", subSections: 0, periodicity: "Shift", columns: 8, lastUpdated: "2026-05-14 07:00", owner: "S. Verma", status: "Active", version: "v2" },
  { id: "cfg-009", name: "Packing Plant Throughput", plant: "Despatch", subSections: 3, periodicity: "Daily", columns: 12, lastUpdated: "2026-05-14 05:30", owner: "M. Joshi", status: "Active", version: "v2" },
  { id: "cfg-010", name: "Raw Meal Chemistry", plant: "QC Lab", subSections: 0, periodicity: "Hourly", columns: 16, lastUpdated: "2026-05-14 09:00", owner: "P. Mehta", status: "Active", version: "v2" },
  { id: "cfg-011", name: "Limestone Stacker Log", plant: "Mines", subSections: 0, periodicity: "Daily", columns: 7, lastUpdated: "2026-05-13 19:00", owner: "B. Rao", status: "Active", version: "v1" },
  { id: "cfg-012", name: "Fuel Oil Consumption", plant: "Utilities", subSections: 2, periodicity: "Daily", columns: 9, lastUpdated: "2026-05-13 20:15", owner: "K. Nair", status: "Active", version: "v2" },
  { id: "cfg-013", name: "Compressor House — KW", plant: "Utilities", subSections: 0, periodicity: "Shift", columns: 10, lastUpdated: "2026-05-14 06:30", owner: "K. Nair", status: "Active", version: "v1" },
  { id: "cfg-014", name: "Gypsum Stock Tally", plant: "Stores", subSections: 0, periodicity: "Daily", columns: 4, lastUpdated: "2026-05-13 17:00", owner: "M. Joshi", status: "Draft", version: "v2" },
  { id: "cfg-015", name: "Cooler Vent Gas Temps", plant: "Line C", subSections: 3, periodicity: "Hourly", columns: 14, lastUpdated: "2026-05-14 09:05", owner: "A. Khan", status: "Active", version: "v2" },
  { id: "cfg-016", name: "Mill Reject Weighment", plant: "Line B", subSections: 0, periodicity: "Shift", columns: 6, lastUpdated: "2026-05-14 07:10", owner: "R. Iyer", status: "Active", version: "v1" },
  { id: "cfg-017", name: "PPC Blaine & Residue", plant: "QC Lab", subSections: 2, periodicity: "Daily", columns: 8, lastUpdated: "2026-05-13 15:40", owner: "P. Mehta", status: "Active", version: "v2" },
  { id: "cfg-018", name: "DG Set Run Hours", plant: "Utilities", subSections: 0, periodicity: "Daily", columns: 5, lastUpdated: "2026-05-13 21:00", owner: "K. Nair", status: "Active", version: "v2" },
];

export type UploadFileResult = {
  configId: string;
  configName: string;
  detected: number;
  newRows: number;
  updatedRows: number;
  ignoredRows: number;
  warnings: number;
  errors: number;
  validation: { level: "error" | "warning" | "info"; message: string; row?: number; column?: string }[];
};

export const MOCK_UPLOAD_RESULTS: Record<string, Omit<UploadFileResult, "configId" | "configName">> = {
  default: {
    detected: 24,
    newRows: 18,
    updatedRows: 4,
    ignoredRows: 2,
    warnings: 1,
    errors: 0,
    validation: [
      { level: "warning", message: "2 cells in the Operator column were left blank. We'll use the previous shift's operator unless you fill them in.", column: "Operator" },
      { level: "info", message: "All numbers look normal for this sheet." },
    ],
  },
};

import type { ParsedSheet } from "./parseUpload";

export function makeResultFromParse(
  cfg: EntryConfig,
  sheet: ParsedSheet | undefined,
  conflicts?: Set<string>,
): UploadFileResult | null {
  if (!sheet) return null;

  // Empty template: rows exist but no reading values filled in
  if (sheet.totalRows > 0 && sheet.filledRows === 0) {
    return {
      configId: cfg.id,
      configName: cfg.name,
      detected: sheet.totalRows,
      newRows: 0,
      updatedRows: 0,
      ignoredRows: sheet.totalRows,
      warnings: 1,
      errors: 0,
      validation: [
        {
          level: "warning",
          message: `This file is the unmodified template — all ${sheet.totalRows} rows still have empty reading cells. The Date, Time and Shift columns are already pre-filled for you; please type the readings into the parameter columns and upload again.`,
        },
        {
          level: "info",
          message: "Nothing will be saved until at least one row has values.",
        },
        {
          level: "info",
          message: `Read from ${sheet.fileName}: ${sheet.totalRows} rows, 0 filled, ${sheet.headers.length} columns detected. (If you did fill data, your spreadsheet app may have moved or renamed the parameter columns — keep the original Date/Time/Shift columns intact.)`,
        },
      ],
    };
  }

  // File has data but no header rows were detected
  if (sheet.totalRows === 0) {
    return {
      configId: cfg.id,
      configName: cfg.name,
      detected: 0,
      newRows: 0,
      updatedRows: 0,
      ignoredRows: 0,
      warnings: 0,
      errors: 1,
      validation: [
        {
          level: "error",
          message:
            "We couldn't find any rows in this file. Please make sure you uploaded the template (with the Date / Time / Shift columns intact) and try again.",
        },
      ],
    };
  }

  // Partial fill — split filled rows into "new" (no prior data at that
  // timestamp) and "overwrites existing" (already have a saved row).
  const filled = sheet.filledRows;
  const empty = sheet.totalRows - filled;
  let overwrites = 0;
  if (conflicts && conflicts.size > 0) {
    for (const ts of sheet.filledTimestamps) {
      if (conflicts.has(ts)) overwrites++;
    }
  }
  const newRows = Math.max(0, filled - overwrites);

  const validation: UploadFileResult["validation"] = [];
  if (overwrites > 0) {
    validation.push({
      level: "info",
      message: `${overwrites} row${overwrites === 1 ? "" : "s"} already exist in ${cfg.name} for the same timestamps — values will be replaced with what you uploaded.`,
    });
  }
  if (empty > 0) {
    validation.push({
      level: "warning",
      message: `${empty} row${empty > 1 ? "s have" : " has"} no reading values filled in and will be skipped. Only rows with at least one filled reading are saved.`,
    });
  }
  if (newRows > 0) {
    validation.push({
      level: "info",
      message: `${newRows} row${newRows === 1 ? "" : "s"} will be added as new entr${newRows === 1 ? "y" : "ies"} to ${cfg.name}.`,
    });
  }
  validation.push({
    level: "info",
    message: `Read from ${sheet.fileName}: ${sheet.totalRows} rows, ${filled} filled, ${overwrites} match existing entries, ${sheet.headers.length} columns detected.`,
  });

  return {
    configId: cfg.id,
    configName: cfg.name,
    detected: sheet.totalRows,
    newRows,
    updatedRows: overwrites,
    ignoredRows: empty,
    warnings: empty > 0 ? 1 : 0,
    errors: 0,
    validation,
  };
}

export function makeResultNoData(cfg: EntryConfig, providedConfigIds: string[]): UploadFileResult {
  const others = providedConfigIds.length
    ? `Your upload only contained data for ${providedConfigIds.join(", ")}.`
    : "";
  return {
    configId: cfg.id,
    configName: cfg.name,
    detected: 0,
    newRows: 0,
    updatedRows: 0,
    ignoredRows: 0,
    warnings: 1,
    errors: 0,
    validation: [
      {
        level: "warning",
        message: `No data was found for "${cfg.name}" in your upload. ${others} Download this sheet's template, fill it in, and upload it together with the others.`.trim(),
      },
    ],
  };
}

export function makeMockResult(cfg: EntryConfig, seed: number): UploadFileResult {
  const detected = 12 + ((seed * 7 + cfg.columns) % 48);
  const ignoredRows = seed % 3 === 0 ? (seed % 4) + 1 : 0;
  const updatedRows = Math.max(0, Math.floor(detected * 0.18) - (seed % 2));
  const newRows = Math.max(0, detected - updatedRows - ignoredRows);
  const errors = seed % 5 === 0 ? 1 : 0;
  const warnings = (seed % 2) + (errors ? 1 : 0);
  const validation: UploadFileResult["validation"] = [];
  if (errors)
    validation.push({
      level: "error",
      row: 14 + seed,
      column: "Free Lime %",
      message:
        "This Free Lime % reading is 12.4 — that's higher than the maximum allowed value of 4.0. Please check the entry. This row will be skipped until it's fixed.",
    });
  if (warnings)
    validation.push({
      level: "warning",
      row: 7 + seed,
      column: "Operator",
      message:
        "Operator name is missing for this row. We'll automatically use the previous shift's operator unless you fill it in.",
    });
  if (ignoredRows)
    validation.push({
      level: "warning",
      message: `Found ${ignoredRows} row${ignoredRows > 1 ? "s" : ""} with the same date & time as an existing entry. ${
        ignoredRows > 1 ? "These will be skipped" : "This will be skipped"
      } so the original data isn't overwritten by mistake.`,
    });
  validation.push({
    level: "info",
    message: `Row frequency in your file matches this sheet's setting (${cfg.periodicity.toLowerCase()}).`,
  });
  return {
    configId: cfg.id,
    configName: cfg.name,
    detected,
    newRows,
    updatedRows,
    ignoredRows,
    warnings,
    errors,
    validation,
  };
}
