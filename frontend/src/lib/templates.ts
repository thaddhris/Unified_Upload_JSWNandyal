import * as XLSX from "xlsx";
// xlsx-js-style is a drop-in fork of SheetJS community that preserves cell
// styles (fill, font, alignment, borders) when writing XLSX files. The plain
// `xlsx` package drops styles on write.
import XLSXStyle from "xlsx-js-style";
import { type EntryConfig, type ColumnDef } from "./mockData";

export type Periodicity = EntryConfig["periodicity"];

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Production Excel uses "DD/MM/YYYY HH:MM:SS" in a single DATE column.
function fmtDateTimeForCell(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Two-line header label: name+unit on line 1, target on line 2 (matches the
// production Excel where targets sit under the column name within the same cell).
function columnLabel(col: ColumnDef): string {
  const unit = col.unit ? ` ${col.unit}` : "";
  if (col.target) return `${col.name}${unit}\nTarget ${col.target}`;
  return `${col.name}${unit}`;
}

export function generateTimestamps(
  period: Periodicity,
  from: Date,
  to: Date,
  opts: { cycleTimeHr?: number; cycleTimeMin?: number; anchorOffsetMs?: number } = {},
): Date[] {
  const out: Date[] = [];
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);

  // Hourly and Shift use local-time anchoring (top of hour / 6am+8h cadence).
  // Daily / Weekly use the section's daily anchor:
  //   - Preferred path: `anchorOffsetMs` (ms-into-the-UTC-day), derived from
  //     existing backend entries so it matches the backend's own timestamp
  //     pattern byte-for-byte regardless of timezone.
  //   - Fallback path: `cycleTimeHr` / `cycleTimeMin` in local time (mock
  //     mode and sections without data history).

  if (period === "Hourly" || period === "Shift") {
    const cur = new Date(from);
    if (period === "Hourly") cur.setMinutes(0, 0, 0);
    else cur.setHours(6, 0, 0, 0);
    let safety = 0;
    while (cur <= end && safety < 10000) {
      out.push(new Date(cur));
      if (period === "Hourly") cur.setHours(cur.getHours() + 1);
      else cur.setHours(cur.getHours() + 8);
      safety++;
    }
    return out;
  }

  if (typeof opts.anchorOffsetMs === "number") {
    // UTC-anchored Daily/Weekly: for each calendar date in [from, to],
    // emit Date.UTC(year, month, day) + anchorOffsetMs.
    const stepDays = period === "Weekly" ? 7 : 1;
    const cur = new Date(from);
    cur.setHours(0, 0, 0, 0);
    let safety = 0;
    while (cur <= end && safety < 10000) {
      const ts = Date.UTC(cur.getFullYear(), cur.getMonth(), cur.getDate()) + opts.anchorOffsetMs;
      out.push(new Date(ts));
      cur.setDate(cur.getDate() + stepDays);
      safety++;
    }
    return out;
  }

  // Fallback: local-time cycle (used by mock mode and unknown sections).
  const cycleHr = typeof opts.cycleTimeHr === "number" ? opts.cycleTimeHr : 0;
  const cycleMin = typeof opts.cycleTimeMin === "number" ? opts.cycleTimeMin : 0;
  const cur = new Date(from);
  cur.setHours(cycleHr, cycleMin, 0, 0);
  let safety = 0;
  while (cur <= end && safety < 10000) {
    out.push(new Date(cur));
    if (period === "Daily") cur.setDate(cur.getDate() + 1);
    else if (period === "Weekly") cur.setDate(cur.getDate() + 7);
    safety++;
  }
  return out;
}

// Header layout matches the production manual-entry Excel:
//   DATE  |  <real param 1>  |  <real param 2>  …  [ | Operator | Remarks ]
// A single DATE column holds the full date+time so users don't have to
// reconcile separate Date / Time / Shift columns. Operator/Remarks are only
// appended when the config has no real column schema (mock/dev mode) — for
// IOsense V2 sheets the real columns come straight from the section schema
// and there are no Operator/Remarks fields to send.
export function buildHeaders(cfg: EntryConfig): string[] {
  const headers: string[] = ["DATE"];
  const hasRealSchema = !!(cfg.columnDefs && cfg.columnDefs.length > 0);

  if (hasRealSchema) {
    for (const c of cfg.columnDefs!) headers.push(columnLabel(c));
  } else {
    // Fallback for configs that don't yet have real column defs (mock mode
    // or a config whose detail hasn't loaded). Synthesize placeholders.
    const dataCount = Math.max(0, cfg.columns - 1);
    if (cfg.subSections > 0) {
      const perSub = Math.max(1, Math.ceil(dataCount / cfg.subSections));
      let added = 0;
      for (let s = 1; s <= cfg.subSections && added < dataCount; s++) {
        for (let c = 1; c <= perSub && added < dataCount; c++) {
          headers.push(`Sub-section ${s} · Param ${c}`);
          added++;
        }
      }
    } else {
      for (let c = 1; c <= dataCount; c++) headers.push(`Param ${c}`);
    }
    headers.push("Operator", "Remarks");
  }

  return headers;
}

function escapeCSV(v: string) {
  if (v == null) return "";
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function generateTemplateCSV(cfg: EntryConfig, from: Date, to: Date): string {
  const headers = buildHeaders(cfg);
  const ts = generateTimestamps(cfg.periodicity, from, to, {
    cycleTimeHr: cfg.cycleTimeHr,
    cycleTimeMin: cfg.cycleTimeMin,
    anchorOffsetMs: cfg.anchorOffsetMs,
  });

  const meta = [
    `# IOsense Manual Data Entry — Template`,
    `# Configuration: ${cfg.name}  (${cfg.id})`,
    `# Plant: ${cfg.plant}   Periodicity: ${cfg.periodicity}   Sub-sections: ${cfg.subSections}`,
    `# Window: ${fmtDate(from)}  →  ${fmtDate(to)}   Rows: ${ts.length}`,
    `# Do not rename or reorder the DATE column.`,
    ``,
  ];

  const lines: string[] = [...meta, headers.map(escapeCSV).join(",")];

  for (const t of ts) {
    const row: string[] = [fmtDateTimeForCell(t)];
    for (let i = 1; i < headers.length; i++) row.push("");
    lines.push(row.map(escapeCSV).join(","));
  }
  return lines.join("\n");
}

function safeName(s: string) {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
}

function utf8ToBase64(str: string): string {
  if (typeof window === "undefined") return "";
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

export function triggerDownload(filename: string, content: string) {
  if (typeof window === "undefined") return;
  // application/octet-stream forces the browser to download even inside
  // sandboxed/embedded iframes where text/csv would render inline.
  const dataUri = `data:application/octet-stream;charset=utf-8;base64,${utf8ToBase64(content)}`;
  const blob = new Blob([content], { type: "application/octet-stream" });
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);

  let triggered = false;
  try {
    a.click();
    triggered = true;
  } catch {
    /* fall through */
  }

  if (!triggered) {
    // Fallback for sandboxed iframes: pop a top-level tab with the data URI
    try {
      window.open(dataUri, "_blank", "noopener,noreferrer");
    } catch {
      /* nothing more we can do */
    }
  }

  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }, 1500);
}

export function downloadTemplate(cfg: EntryConfig, from: Date, to: Date) {
  const csv = generateTemplateCSV(cfg, from, to);
  const fname = `${safeName(cfg.name)}__${cfg.id}__${fmtDate(from)}_to_${fmtDate(to)}.csv`;
  triggerDownload(fname, csv);
}

export async function downloadTemplates(cfgs: EntryConfig[], from: Date, to: Date) {
  for (let i = 0; i < cfgs.length; i++) {
    downloadTemplate(cfgs[i], from, to);
    // Browsers block back-to-back downloads from one user gesture.
    // A longer stagger keeps the chain reading as multiple "user-allowed" files.
    await new Promise((r) => setTimeout(r, 600));
  }
}

const SHEET_NAME_MAX = 31;

// Excel forbids `[ ] / \ ? * :` in sheet names; max length is 31 chars.
//
// The config id used to be embedded in the sheet name so the parser could
// recover which sheet maps to which config. For V2, ids are MongoDB ObjectIds
// (~30 chars) which overflow the 31-char limit instantly. We now keep the
// sheet name short and let the parser recover the mapping from the embedded
// `# Configuration: <name> (<id>)` comment row inside the sheet — that field
// holds the full id regardless of what the tab is called.
function sanitizeSheetName(name: string, _id: string, used: Set<string>): string {
  const stripped = (name || "").replace(/[[\]/\\?*:]/g, " ").replace(/\s+/g, " ").trim();
  const base = stripped || "Sheet";

  const fitting = (raw: string, reserve: number) =>
    raw.length + reserve > SHEET_NAME_MAX
      ? raw.slice(0, SHEET_NAME_MAX - reserve - 1) + "…"
      : raw;

  let candidate = fitting(base, 0);
  if (!used.has(candidate.toLowerCase())) {
    used.add(candidate.toLowerCase());
    return candidate;
  }

  // Collision — append ` (n)` until unique
  let n = 2;
  while (n < 1000) {
    const suffix = ` (${n})`;
    candidate = fitting(base, suffix.length) + suffix;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
    n++;
  }
  // Last resort
  const fallback = `Sheet ${used.size + 1}`.slice(0, SHEET_NAME_MAX);
  used.add(fallback.toLowerCase());
  return fallback;
}

type MergeRange = { s: { r: number; c: number }; e: { r: number; c: number } };

type HeaderStructure = {
  headerRows: string[][]; // 1 row for flat, 2 rows for grouped
  merges: MergeRange[]; // ranges expressed RELATIVE to header start
};

// Build header rows + merges based on the config's columnDefs.
// - When no subsection info is present → single flat row of leaves.
// - When subsections exist → two rows: top has group names with merges for
//   contiguous columns sharing the same subsection, bottom has the leaf labels.
function buildHeaderStructure(cfg: EntryConfig): HeaderStructure {
  if (!cfg.columnDefs || cfg.columnDefs.length === 0) {
    return { headerRows: [buildHeaders(cfg)], merges: [] };
  }

  const anyGrouped = cfg.columnDefs.some((c) => (c.subSection ?? "").trim());
  if (!anyGrouped) {
    const single = ["DATE", ...cfg.columnDefs.map(columnLabel)];
    return { headerRows: [single], merges: [] };
  }

  const topRow: string[] = ["DATE"];
  const bottomRow: string[] = [""]; // DATE will be vertically merged
  const merges: MergeRange[] = [];

  // Vertical merge for the DATE column across both header rows
  merges.push({ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } });

  let i = 0;
  while (i < cfg.columnDefs.length) {
    const c = cfg.columnDefs[i];
    const sub = (c.subSection ?? "").trim();
    const startCol = topRow.length;

    if (!sub) {
      // Ungrouped column — leaf only, merge top→bottom vertically so the
      // leaf label sits in a single tall cell (matches the prod look)
      topRow.push(columnLabel(c));
      bottomRow.push("");
      merges.push({ s: { r: 0, c: startCol }, e: { r: 1, c: startCol } });
      i++;
      continue;
    }

    // Find extent of contiguous columns sharing this subsection
    topRow.push(sub);
    bottomRow.push(columnLabel(c));
    let j = i + 1;
    while (j < cfg.columnDefs.length && (cfg.columnDefs[j].subSection ?? "").trim() === sub) {
      topRow.push("");
      bottomRow.push(columnLabel(cfg.columnDefs[j]));
      j++;
    }
    const endCol = topRow.length - 1;
    if (endCol > startCol) {
      merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: endCol } });
    }
    i = j;
  }

  return { headerRows: [topRow, bottomRow], merges };
}

type SheetBuild = {
  aoa: string[][];
  headerRowStart: number; // first header row's index in aoa
  headerRowCount: number; // 1 or 2
  dataRowCount: number;
  headerCount: number; // number of columns
  merges: MergeRange[]; // RELATIVE to header start — caller offsets by headerRowStart
  // Per-data-row, per-column flag: true means the cell was pre-populated from
  // existing backend data. Used to style prefilled cells subtly different
  // (lighter font color) so the user can tell what's new vs what was there.
  prefilled: boolean[][];
};

function aoaForConfig(cfg: EntryConfig, from: Date, to: Date): SheetBuild {
  const structure = buildHeaderStructure(cfg);
  const ts = generateTimestamps(cfg.periodicity, from, to, {
    cycleTimeHr: cfg.cycleTimeHr,
    cycleTimeMin: cfg.cycleTimeMin,
    anchorOffsetMs: cfg.anchorOffsetMs,
  });
  const meta: string[][] = [
    [`# IOsense Manual Data Entry — Template`],
    [`# Configuration: ${cfg.name}  (${cfg.id})`],
    [`# Plant: ${cfg.plant}   Periodicity: ${cfg.periodicity}   Sub-sections: ${cfg.subSections}`],
    [`# Window: ${fmtDate(from)} → ${fmtDate(to)}   Rows: ${ts.length}`],
    [`# Do not rename or reorder the DATE column. Format: DD/MM/YYYY HH:MM:SS`],
    [],
  ];

  const headerCount = structure.headerRows[0].length;
  const rows: string[][] = [...structure.headerRows];

  // Build a per-column lookup of existing values by ns-timestamp string so
  // cell prefill is O(1) per cell. Position 0 is DATE (no data); positions
  // 1..N correspond 1:1 with cfg.columnDefs entries.
  const existingByCol: Array<Record<string, string> | undefined> = [undefined];
  if (cfg.columnDefs && cfg.columnDefs.length > 0) {
    for (const c of cfg.columnDefs) existingByCol.push(c.existingData);
  }

  // Track which cells were prefilled vs blank so the workbook builder can
  // style them subtly different (slightly different font color so the user
  // can spot what was already recorded vs what's new).
  const prefilled: Array<Array<boolean>> = [];

  for (const t of ts) {
    const r: string[] = [fmtDateTimeForCell(t)];
    const tsNs = (t.getTime() * 1_000_000).toString();
    const rowPrefilled: boolean[] = [false]; // DATE is never "prefill"
    for (let i = 1; i < headerCount; i++) {
      const existing = existingByCol[i]?.[tsNs];
      // Backend uses "-" as the empty-slot marker; treat as no value.
      if (existing && existing !== "-") {
        r.push(existing);
        rowPrefilled.push(true);
      } else {
        r.push("");
        rowPrefilled.push(false);
      }
    }
    rows.push(r);
    prefilled.push(rowPrefilled);
  }

  return {
    aoa: [...meta, ...rows],
    headerRowStart: meta.length,
    headerRowCount: structure.headerRows.length,
    dataRowCount: ts.length,
    headerCount,
    merges: structure.merges,
    prefilled,
  };
}

// Header style — matches the production MDE V2 web UI's lighter blue
// (sampled from screenshots: `#5B9BD5`, Excel's standard "Blue Accent 1
// Lighter 25%"). White bold text, centered, wrapText so "Target X.Y" sits
// on a second line in the same cell.
//
// Note on per-sheet colors: the V2 section config we currently receive doesn't
// expose a per-section header color. If/when the backend surfaces that (e.g.
// `section.config.style.headerColor`), wire it through to override the default.
const HEADER_STYLE = {
  fill: { patternType: "solid", fgColor: { rgb: "5B9BD5" } },
  font: { name: "Calibri", sz: 11, bold: true, color: { rgb: "FFFFFF" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: {
    top: { style: "thin", color: { rgb: "BFBFBF" } },
    bottom: { style: "thin", color: { rgb: "BFBFBF" } },
    left: { style: "thin", color: { rgb: "BFBFBF" } },
    right: { style: "thin", color: { rgb: "BFBFBF" } },
  },
};

const META_STYLE = {
  font: { name: "Calibri", sz: 9, italic: true, color: { rgb: "6B7280" } },
};

const DATE_CELL_STYLE = {
  font: { name: "Calibri", sz: 11 },
  alignment: { horizontal: "center", vertical: "center" },
  border: {
    top: { style: "thin", color: { rgb: "D9D9D9" } },
    bottom: { style: "thin", color: { rgb: "D9D9D9" } },
    left: { style: "thin", color: { rgb: "D9D9D9" } },
    right: { style: "thin", color: { rgb: "D9D9D9" } },
  },
};

const DATA_CELL_STYLE = {
  font: { name: "Calibri", sz: 11 },
  alignment: { horizontal: "center", vertical: "center" },
  border: {
    top: { style: "thin", color: { rgb: "D9D9D9" } },
    bottom: { style: "thin", color: { rgb: "D9D9D9" } },
    left: { style: "thin", color: { rgb: "D9D9D9" } },
    right: { style: "thin", color: { rgb: "D9D9D9" } },
  },
};

// Style for cells that were pre-populated from existing backend data.
// Same gridline + alignment as a regular data cell, just a lighter font
// color so the user can tell at a glance which values were already there
// vs which they typed new.
const PREFILLED_CELL_STYLE = {
  font: { name: "Calibri", sz: 11, color: { rgb: "6B7280" }, italic: true },
  fill: { patternType: "solid", fgColor: { rgb: "F3F4F6" } },
  alignment: { horizontal: "center", vertical: "center" },
  border: {
    top: { style: "thin", color: { rgb: "D9D9D9" } },
    bottom: { style: "thin", color: { rgb: "D9D9D9" } },
    left: { style: "thin", color: { rgb: "D9D9D9" } },
    right: { style: "thin", color: { rgb: "D9D9D9" } },
  },
};

function applySheetStyles(
  ws: XLSX.WorkSheet,
  headerRowStart: number,
  headerRowCount: number,
  headerCount: number,
  totalRows: number,
  prefilled: boolean[][] = [],
) {
  // Style metadata rows (everything before the first header row)
  for (let r = 0; r < headerRowStart; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    if (ws[addr]) (ws[addr] as XLSX.CellObject).s = META_STYLE;
  }
  // Style every header row (1 row for flat, 2 rows for grouped)
  for (let hr = 0; hr < headerRowCount; hr++) {
    const rowIdx = headerRowStart + hr;
    for (let c = 0; c < headerCount; c++) {
      const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" } as XLSX.CellObject;
      (ws[addr] as XLSX.CellObject).s = HEADER_STYLE;
    }
  }
  // Style every data cell — gridded look matching the production file.
  const firstDataRow = headerRowStart + headerRowCount;
  for (let r = firstDataRow; r < firstDataRow + totalRows; r++) {
    const rowPre = prefilled[r - firstDataRow];
    for (let c = 0; c < headerCount; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" } as XLSX.CellObject;
      const isPrefilled = c > 0 && rowPre && rowPre[c];
      (ws[addr] as XLSX.CellObject).s = c === 0
        ? DATE_CELL_STYLE
        : isPrefilled
        ? PREFILLED_CELL_STYLE
        : DATA_CELL_STYLE;
    }
  }
  // Freeze the header rows so they stay in view while scrolling data
  ws["!freeze"] = { xSplit: 0, ySplit: firstDataRow };
}

export function downloadWorkbook(cfgs: EntryConfig[], from: Date, to: Date) {
  if (cfgs.length === 0) return;
  const wb = XLSXStyle.utils.book_new();
  const used = new Set<string>();
  for (const cfg of cfgs) {
    const build = aoaForConfig(cfg, from, to);
    const ws = XLSXStyle.utils.aoa_to_sheet(build.aoa);

    // Per-column width based on the longest line of either header row.
    // Use both `wch` (character count) AND `wpx` (pixels) so whichever the
    // host app honours gives a reasonable result.
    const widestLine: number[] = new Array(build.headerCount).fill(0);
    for (const hr of build.aoa.slice(
      build.headerRowStart,
      build.headerRowStart + build.headerRowCount,
    )) {
      for (let c = 0; c < build.headerCount; c++) {
        const cell = String(hr[c] ?? "");
        const longest = cell.split("\n").reduce((m, line) => Math.max(m, line.length), 0);
        if (longest > widestLine[c]) widestLine[c] = longest;
      }
    }
    ws["!cols"] = widestLine.map((longest, idx) => {
      if (idx === 0) return { wch: 22, wpx: 170 }; // DATE column
      const charWidth = Math.min(36, Math.max(13, longest + 9));
      const pxWidth = Math.min(260, Math.max(95, longest * 11 + 26));
      return { wch: charWidth, wpx: pxWidth };
    });

    // Taller header rows so wrapped two-line labels render cleanly.
    ws["!rows"] = [];
    for (let i = 0; i < build.headerRowCount; i++) {
      ws["!rows"][build.headerRowStart + i] = { hpt: 38 };
    }

    // Merges (subsection grouping spans + DATE vertical merge), shifted from
    // header-relative coordinates to absolute sheet coordinates.
    if (build.merges.length > 0) {
      ws["!merges"] = build.merges.map((m) => ({
        s: { r: m.s.r + build.headerRowStart, c: m.s.c },
        e: { r: m.e.r + build.headerRowStart, c: m.e.c },
      }));
    }

    applySheetStyles(
      ws,
      build.headerRowStart,
      build.headerRowCount,
      build.headerCount,
      build.dataRowCount,
      build.prefilled,
    );

    const tabName = sanitizeSheetName(cfg.name, cfg.id, used);
    XLSXStyle.utils.book_append_sheet(wb, ws, tabName);
  }
  const fname =
    cfgs.length === 1
      ? `${safeName(cfgs[0].name)}__${cfgs[0].id}__${fmtDate(from)}_to_${fmtDate(to)}.xlsx`
      : `IOsense_Bulk_Upload__${fmtDate(from)}_to_${fmtDate(to)}.xlsx`;
  XLSXStyle.writeFile(wb, fname, { bookType: "xlsx", compression: true });
}


export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return fmtDate(d);
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function estimateRows(period: Periodicity, from: Date, to: Date): number {
  return generateTimestamps(period, from, to).length;
}
