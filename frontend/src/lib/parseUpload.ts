import * as XLSX from "xlsx";

export type ParsedSheet = {
  fileName: string;
  sheetName?: string;
  configId: string | null;
  configName: string | null;
  totalRows: number;
  filledRows: number;
  headers: string[];
  // ISO strings for every row that had at least one filled value. Used by the
  // adapter's checkConflicts() to split new vs overwrites in the preview.
  filledTimestamps: string[];
};

const RESERVED = new Set(["Date", "Time", "Shift", "Operator", "Remarks"]);

function stripBOM(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function looksLikeHeaderRow(cells: string[]): boolean {
  const first = (cells[0] ?? "").replace(/^﻿/, "").replace(/^"+|"+$/g, "").trim().toLowerCase();
  return first === "date";
}

function analyzeRows(
  rows: string[][],
  fileName: string,
  sheetName: string | undefined,
  configIdHint: string | null,
  configNameHint: string | null,
): ParsedSheet {
  let configId = configIdHint;
  let configName = configNameHint;
  let headerIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const joined = cells.join(" ");
    if (!configId) {
      const m = joined.match(/\((cfg-\d+)\)/i) || joined.match(/(cfg-\d+)/i);
      if (m) configId = m[1].toLowerCase();
    }
    if (!configName) {
      const m = joined.match(/Configuration:\s*(.+?)\s*\(/i);
      if (m) configName = m[1].trim();
    }
    if (looksLikeHeaderRow(cells)) {
      headerIdx = i;
      break;
    }
  }

  if (!configId) {
    const src = sheetName ?? fileName;
    const m = src.match(/(cfg-\d+)/i);
    if (m) configId = m[1].toLowerCase();
  }

  if (headerIdx === -1) {
    return {
      fileName,
      sheetName,
      configId,
      configName,
      totalRows: 0,
      filledRows: 0,
      headers: [],
      filledTimestamps: [],
    };
  }

  const headers = (rows[headerIdx] ?? []).map((h) =>
    (h ?? "").toString().replace(/^﻿/, "").replace(/^"+|"+$/g, "").trim(),
  );
  const dateColIdx = headers.findIndex((h) => h.toLowerCase().startsWith("date"));
  const dataColIdxs = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => !RESERVED.has(h) && i !== dateColIdx)
    .map(({ i }) => i);

  let totalRows = 0;
  let filledRows = 0;
  const filledTimestamps: string[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (cells.every((c) => (c ?? "").toString().trim() === "")) continue;
    totalRows++;
    const hasData = dataColIdxs.some((idx) => ((cells[idx] ?? "") as string).toString().trim() !== "");
    if (hasData) {
      filledRows++;
      if (dateColIdx >= 0) {
        const raw = ((cells[dateColIdx] ?? "") as string).toString().trim();
        const iso = normalizeTimestamp(raw);
        if (iso) filledTimestamps.push(iso);
      }
    }
  }

  return {
    fileName,
    sheetName,
    configId,
    configName,
    totalRows,
    filledRows,
    headers,
    filledTimestamps,
  };
}

// Accepts "DD/MM/YYYY HH:MM:SS", "DD/MM/YYYY HH:MM", "YYYY-MM-DD HH:MM:SS",
// "YYYY-MM-DD", and ISO timestamps. Returns an ISO string or null.
function normalizeTimestamp(s: string): string | null {
  if (!s) return null;
  // DD/MM/YYYY [HH:MM[:SS]]
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (slash) {
    const [, d, m, y, h = "0", mi = "0", se = "0"] = slash;
    const dt = new Date(+y, +m - 1, +d, +h, +mi, +se);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  // YYYY-MM-DD [HH:MM[:SS]]
  const dash = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dash) {
    const [, y, m, d, h = "0", mi = "0", se = "0"] = dash;
    const dt = new Date(+y, +m - 1, +d, +h, +mi, +se);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  const native = new Date(s);
  return isNaN(native.getTime()) ? null : native.toISOString();
}

async function parseCSV(file: File): Promise<ParsedSheet[]> {
  const text = stripBOM(await file.text());
  const lines = text.split(/\r?\n/);
  const rows = lines.map(splitCSVLine);
  return [analyzeRows(rows, file.name, undefined, null, null)];
}

async function parseXLSX(file: File): Promise<ParsedSheet[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const out: ParsedSheet[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    }) as string[][];
    out.push(analyzeRows(rows, file.name, sheetName, null, null));
  }
  return out;
}

export async function parseTemplate(file: File): Promise<ParsedSheet[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
    try {
      return await parseXLSX(file);
    } catch (e) {
      console.warn("XLSX parse failed, falling back to CSV", e);
      return parseCSV(file);
    }
  }
  return parseCSV(file);
}

export async function parseTemplates(files: File[]): Promise<ParsedSheet[]> {
  const nested = await Promise.all(files.map(parseTemplate));
  return nested.flat();
}
