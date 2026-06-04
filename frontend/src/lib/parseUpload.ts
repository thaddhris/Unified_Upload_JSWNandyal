import * as XLSX from "xlsx";

export type ParsedRowValues = Record<string /* columnHeader */, string /* cellValue */>;

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
  // Per-row cell values keyed by the column-header string. Parallel to
  // filledTimestamps — entry N corresponds to timestamp N. Cells that were
  // empty in the file are omitted from each row's record so saveRows skips
  // them naturally.
  filledRows_data: Array<{ timestamp: string; values: ParsedRowValues }>;
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

  // Patterns for both ID generations:
  //   v1 mock:   cfg-001
  //   v2 IOsense: mde:<24-hex Mongo ObjectId>
  const ID_PATTERNS = [
    /\((mde:[0-9a-f]{24})\)/i,
    /(mde:[0-9a-f]{24})/i,
    /\((cfg-\d+)\)/i,
    /(cfg-\d+)/i,
  ];

  const tryExtractId = (haystack: string): string | null => {
    for (const re of ID_PATTERNS) {
      const m = haystack.match(re);
      if (m) return m[1].toLowerCase();
    }
    return null;
  };

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const joined = cells.join(" ");
    if (!configId) {
      const found = tryExtractId(joined);
      if (found) configId = found;
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
    const found = tryExtractId(src);
    if (found) configId = found;
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
      filledRows_data: [],
    };
  }

  const cleanCell = (raw: unknown): string =>
    (raw ?? "").toString().replace(/^﻿/, "").replace(/^"+|"+$/g, "").trim();

  const topRow = (rows[headerIdx] ?? []).map(cleanCell);

  // Detect a two-row grouped header: the row immediately AFTER `topRow` looks
  // like a continuation header when (a) its first cell is empty (DATE was
  // vertically merged across the two rows) AND (b) at least one of its other
  // cells has text. Templates with no subsections have a single header row.
  const nextRow = (rows[headerIdx + 1] ?? []).map(cleanCell);
  const isGroupedHeader =
    nextRow.length > 0 &&
    nextRow[0] === "" &&
    nextRow.slice(1).some((c) => c !== "");

  let headers: string[];
  let dataStartIdx: number;

  if (isGroupedHeader) {
    // Combine top (group name) + bottom (leaf label) into the unique key.
    // Top-row merges leave empty cells to the right of the group name, so we
    // carry the most recent non-empty group label forward.
    headers = topRow.map((top, i) => {
      const bot = nextRow[i] ?? "";
      if (i === 0) return top; // DATE
      if (top && bot) return `${top} · ${bot}`;
      if (top && !bot) return top; // ungrouped column, vertical merge (only top is set)
      if (!top && bot) {
        // empty top = part of a left-spanning merge; carry the group name forward
        let j = i - 1;
        while (j > 0 && topRow[j] === "") j--;
        const group = topRow[j] ?? "";
        return group ? `${group} · ${bot}` : bot;
      }
      return "";
    });
    dataStartIdx = headerIdx + 2;
  } else {
    headers = topRow;
    dataStartIdx = headerIdx + 1;
  }

  const dateColIdx = headers.findIndex((h) => h.toLowerCase().startsWith("date"));
  const dataColIdxs = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => !RESERVED.has(h) && i !== dateColIdx)
    .map(({ i }) => i);

  let totalRows = 0;
  let filledRows = 0;
  const filledTimestamps: string[] = [];
  const filledRows_data: Array<{ timestamp: string; values: ParsedRowValues }> = [];

  for (let i = dataStartIdx; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (cells.every((c) => (c ?? "").toString().trim() === "")) continue;
    totalRows++;
    const hasData = dataColIdxs.some((idx) => ((cells[idx] ?? "") as string).toString().trim() !== "");
    if (hasData) {
      filledRows++;
      let iso: string | null = null;
      if (dateColIdx >= 0) {
        const raw = ((cells[dateColIdx] ?? "") as string).toString().trim();
        iso = normalizeTimestamp(raw);
        if (iso) filledTimestamps.push(iso);
      }
      if (iso) {
        // Capture every filled cell's value keyed by its column header so
        // saveRows can map it back to the right (devID, sensor) pair.
        const values: ParsedRowValues = {};
        for (const idx of dataColIdxs) {
          const raw = (cells[idx] ?? "").toString().trim();
          if (raw === "") continue;
          const header = headers[idx];
          if (!header) continue;
          values[header] = raw;
        }
        filledRows_data.push({ timestamp: iso, values });
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
    filledRows_data,
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
