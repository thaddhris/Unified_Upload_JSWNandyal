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

export function generateTimestamps(period: Periodicity, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cur = new Date(from);

  if (period === "Hourly") cur.setMinutes(0, 0, 0);
  else if (period === "Shift") cur.setHours(6, 0, 0, 0);
  else cur.setHours(0, 0, 0, 0);

  const end = new Date(to);
  end.setHours(23, 59, 59, 999);

  let safety = 0;
  while (cur <= end && safety < 10000) {
    out.push(new Date(cur));
    if (period === "Hourly") cur.setHours(cur.getHours() + 1);
    else if (period === "Shift") cur.setHours(cur.getHours() + 8);
    else if (period === "Daily") cur.setDate(cur.getDate() + 1);
    else if (period === "Weekly") cur.setDate(cur.getDate() + 7);
    safety++;
  }
  return out;
}

// Header layout matches the production manual-entry Excel:
//   DATE  |  <real param 1>  |  <real param 2>  …  |  Operator | Remarks
// A single DATE column holds the full date+time so users don't have to
// reconcile separate Date / Time / Shift columns.
export function buildHeaders(cfg: EntryConfig): string[] {
  const headers: string[] = ["DATE"];

  if (cfg.columnDefs && cfg.columnDefs.length > 0) {
    for (const c of cfg.columnDefs) headers.push(columnLabel(c));
  } else {
    // Fallback for configs that don't yet have real column defs
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
  }

  headers.push("Operator", "Remarks");
  return headers;
}

function escapeCSV(v: string) {
  if (v == null) return "";
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function generateTemplateCSV(cfg: EntryConfig, from: Date, to: Date): string {
  const headers = buildHeaders(cfg);
  const ts = generateTimestamps(cfg.periodicity, from, to);

  const versionNote =
    cfg.version === "v1"
      ? "v1 (legacy, fixed structure — columns can't be customized)"
      : "v2 (configurable)";
  const meta = [
    `# IOsense Manual Data Entry — Template`,
    `# Configuration: ${cfg.name}  (${cfg.id})`,
    `# Plant: ${cfg.plant}   Periodicity: ${cfg.periodicity}   Sub-sections: ${cfg.subSections}`,
    `# Sheet version: ${versionNote}`,
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

// Excel forbids these in sheet names; max length is 31 chars.
function sanitizeSheetName(name: string, id: string, used: Set<string>): string {
  const stripped = name.replace(/[\[\]\/\\\?\*:]/g, " ").trim();
  // Always include the cfg id at the end so the parser can recover the mapping
  const suffix = ` (${id})`;
  const maxBase = 31 - suffix.length;
  let base = stripped.length > maxBase ? stripped.slice(0, maxBase - 1) + "…" : stripped;
  let candidate = base + suffix;
  // Excel sheet names must be unique (case-insensitive)
  let n = 1;
  while (used.has(candidate.toLowerCase())) {
    n++;
    const suffix2 = ` (${id}) ${n}`;
    const maxBase2 = 31 - suffix2.length;
    base = stripped.length > maxBase2 ? stripped.slice(0, maxBase2 - 1) + "…" : stripped;
    candidate = base + suffix2;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function aoaForConfig(cfg: EntryConfig, from: Date, to: Date): string[][] {
  const headers = buildHeaders(cfg);
  const ts = generateTimestamps(cfg.periodicity, from, to);
  const versionNote =
    cfg.version === "v1"
      ? "v1 (legacy, fixed structure — columns can't be customized)"
      : "v2 (configurable)";
  const meta: string[][] = [
    [`# IOsense Manual Data Entry — Template`],
    [`# Configuration: ${cfg.name}  (${cfg.id})`],
    [`# Plant: ${cfg.plant}   Periodicity: ${cfg.periodicity}   Sub-sections: ${cfg.subSections}`],
    [`# Sheet version: ${versionNote}`],
    [`# Window: ${fmtDate(from)} → ${fmtDate(to)}   Rows: ${ts.length}`],
    [`# Do not rename or reorder the DATE column. Format: DD/MM/YYYY HH:MM:SS`],
    [],
  ];
  const rows: string[][] = [headers];
  for (const t of ts) {
    const r: string[] = [fmtDateTimeForCell(t)];
    for (let i = 1; i < headers.length; i++) r.push("");
    rows.push(r);
  }
  return [...meta, ...rows];
}

// Header style — matches the production cement-quality Excel template:
// medium blue fill (Excel's standard 4472C4), white bold text, centered, wrapped
// so the "Target X.Y" line sits below the column name within the same cell.
const HEADER_STYLE = {
  fill: { patternType: "solid", fgColor: { rgb: "4472C4" } },
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

function applySheetStyles(
  ws: XLSX.WorkSheet,
  headerRowIndex: number,
  metaRowCount: number,
  headerCount: number,
  totalRows: number,
) {
  // Style metadata rows
  for (let r = 0; r < metaRowCount; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    if (ws[addr]) (ws[addr] as XLSX.CellObject).s = META_STYLE;
  }
  // Style header row
  for (let c = 0; c < headerCount; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIndex, c });
    if (!ws[addr]) ws[addr] = { t: "s", v: "" } as XLSX.CellObject;
    (ws[addr] as XLSX.CellObject).s = HEADER_STYLE;
  }
  // Style every data cell with a light-gray border + center alignment so the
  // table looks gridded like the production file (not raw / borderless).
  for (let r = headerRowIndex + 1; r <= headerRowIndex + totalRows; r++) {
    for (let c = 0; c < headerCount; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" } as XLSX.CellObject;
      (ws[addr] as XLSX.CellObject).s = c === 0 ? DATE_CELL_STYLE : DATA_CELL_STYLE;
    }
  }
  // Freeze the header row so it stays in view while scrolling data
  ws["!freeze"] = { xSplit: 0, ySplit: headerRowIndex + 1 };
}

export function downloadWorkbook(cfgs: EntryConfig[], from: Date, to: Date) {
  if (cfgs.length === 0) return;
  const wb = XLSXStyle.utils.book_new();
  const used = new Set<string>();
  for (const cfg of cfgs) {
    const aoa = aoaForConfig(cfg, from, to);
    const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
    const headerRowIndex = 7; // 7 meta lines (incl. blank) before the header row
    const headers = aoa[headerRowIndex] ?? [];
    const totalDataRows = Math.max(0, aoa.length - (headerRowIndex + 1));

    // Reasonable default column widths — the DATE column needs ~20 chars for
    // "DD/MM/YYYY HH:MM:SS", chemistry columns need ~12 chars.
    ws["!cols"] = headers.map((h, idx) => {
      if (idx === 0) return { wch: 22 };
      // Use the longest line of the wrapped header to size the column
      const longest = String(h ?? "")
        .split("\n")
        .reduce((m, line) => Math.max(m, line.length), 0);
      return { wch: Math.min(20, Math.max(11, longest + 2)) };
    });
    ws["!rows"] = [];
    // Taller header row so the two-line "Name / Target" wrap renders cleanly
    ws["!rows"][headerRowIndex] = { hpt: 42 };

    applySheetStyles(ws, headerRowIndex, headerRowIndex, headers.length, totalDataRows);

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
