// Groups let users save a reusable bundle of configs (e.g. "Line A daily shift bundle",
// "QC Lab — morning batch") and one-click select them next time. Stored in localStorage
// for the prototype; in the real v2 integration this swaps to an IOsense user-preferences API.
export type ConfigGroup = {
  id: string;
  name: string;
  configIds: string[];
  createdAt: number;
};

const STORAGE_KEY = "iosense.unifiedUpload.groups.v1";

function safeRead(): ConfigGroup[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return seed();
    return parsed.filter(
      (g): g is ConfigGroup =>
        g && typeof g.id === "string" && typeof g.name === "string" && Array.isArray(g.configIds),
    );
  } catch {
    return seed();
  }
}

function safeWrite(groups: ConfigGroup[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    /* quota or privacy mode — ignore in prototype */
  }
}

// Ship a couple of starter groups so the feature is discoverable on first open.
function seed(): ConfigGroup[] {
  const seeded: ConfigGroup[] = [
    {
      id: "grp-line-a-daily",
      name: "Line A — Daily Bundle",
      configIds: ["cfg-001", "cfg-002", "cfg-005", "cfg-008"],
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 14,
    },
    {
      id: "grp-qc-lab",
      name: "QC Lab — Morning Batch",
      configIds: ["cfg-002", "cfg-007", "cfg-010", "cfg-017"],
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
    },
  ];
  safeWrite(seeded);
  return seeded;
}

export function listGroups(): ConfigGroup[] {
  return safeRead().sort((a, b) => b.createdAt - a.createdAt);
}

export function saveGroup(name: string, configIds: string[]): ConfigGroup {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) throw new Error("Group name is required");
  if (configIds.length === 0) throw new Error("Pick at least one configuration before saving a group");
  const groups = safeRead();
  const existing = groups.find((g) => g.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    existing.configIds = Array.from(new Set(configIds));
    existing.createdAt = Date.now();
    safeWrite(groups);
    return existing;
  }
  const created: ConfigGroup = {
    id: `grp-${Date.now().toString(36)}`,
    name: trimmed,
    configIds: Array.from(new Set(configIds)),
    createdAt: Date.now(),
  };
  groups.push(created);
  safeWrite(groups);
  return created;
}

export function deleteGroup(id: string) {
  safeWrite(safeRead().filter((g) => g.id !== id));
}
