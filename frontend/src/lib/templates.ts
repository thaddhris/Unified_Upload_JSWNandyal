import * as XLSX from "xlsx";
import { type EntryConfig } from "./mockData";

export type Periodicity = EntryConfig["periodicity"];

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtTime(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function shiftLabel(d: Date): string {
  const h = d.getHours();
  if (h < 14) return "A (06:00–14:00)";
  if (h < 22) return "B (14:00–22:00)";
  return "C (22:00–06:00)";
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

export function buildHeaders(cfg: EntryConfig): string[] {
  const headers: string[] = ["Date"];
  const needsTime = cfg.periodicity === "Hourly" || cfg.periodicity === "Shift";
  if (needsTime) headers.push("Time");
  if (cfg.periodicity === "Shift") headers.push("Shift");

  const reserved = headers.length; // Date, Time?, Shift?
  const dataCount = Math.max(0, cfg.columns - reserved);

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
    `# Do not rename or reorder the Date/Time/Shift columns.`,
    ``,
  ];

  const lines: string[] = [...meta, headers.map(escapeCSV).join(",")];

  for (const t of ts) {
    const row: string[] = [fmtDate(t)];
    if (cfg.periodicity === "Hourly" || cfg.periodicity === "Shift") row.push(fmtTime(t));
    if (cfg.periodicity === "Shift") row.push(shiftLabel(t));
    for (let i = row.length; i < headers.length; i++) row.push("");
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
    [`# Do not rename or reorder the Date / Time / Shift columns.`],
    [],
  ];
  const rows: string[][] = [headers];
  for (const t of ts) {
    const r: string[] = [fmtDate(t)];
    if (cfg.periodicity === "Hourly" || cfg.periodicity === "Shift") r.push(fmtTime(t));
    if (cfg.periodicity === "Shift") r.push(shiftLabel(t));
    for (let i = r.length; i < headers.length; i++) r.push("");
    rows.push(r);
  }
  return [...meta, ...rows];
}

export function downloadWorkbook(cfgs: EntryConfig[], from: Date, to: Date) {
  if (cfgs.length === 0) return;
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const cfg of cfgs) {
    const aoa = aoaForConfig(cfg, from, to);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Reasonable default column widths so headers don't get truncated on open
    const widest = aoa[6] ?? aoa[0] ?? [];
    ws["!cols"] = widest.map((h) => ({ wch: Math.min(28, Math.max(12, (h ?? "").length + 2)) }));
    const tabName = sanitizeSheetName(cfg.name, cfg.id, used);
    XLSX.utils.book_append_sheet(wb, ws, tabName);
  }
  const fname = `IOsense_Bulk_Upload__${fmtDate(from)}_to_${fmtDate(to)}.xlsx`;
  XLSX.writeFile(wb, fname, { bookType: "xlsx", compression: true });
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
