import { buildCatalog, type CatalogEntry } from "./catalog.js";

export type ChangelogEntry = {
  version?: string;
  id: string;
  title: string;
  type: string;
  updated_at?: string;
};

export function buildChangelog(
  projectRoot: string,
  since?: string,
): ChangelogEntry[] {
  const catalog = buildCatalog(projectRoot);

  const implemented: CatalogEntry[] = [
    ...catalog.byType.story,
    ...catalog.byType.decision,
  ].filter((e) => e.status === "implemented" || e.status === "accepted");

  if (since) {
    const sinceLower = since.toLowerCase();
    // Filter by date: entity updated_at >= since
    return implemented
      .filter((e) => {
        const updated = String(e.data.updated_at ?? e.data.created_at ?? "");
        return updated >= sinceLower;
      })
      .map(toChangelogEntry)
      .sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
  }

  return implemented
    .map(toChangelogEntry)
    .sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
}

function toChangelogEntry(e: CatalogEntry): ChangelogEntry {
  return {
    id: e.id,
    title: e.title,
    type: e.type,
    updated_at: String(e.data.updated_at ?? e.data.created_at ?? ""),
  };
}

export function formatChangelog(
  entries: ChangelogEntry[],
  json: boolean,
): string {
  if (json) {
    return JSON.stringify(entries, null, 2);
  }

  if (entries.length === 0) return "No changelog entries.";

  const lines: string[] = ["# Changelog (auto-generated from harness history)", ""];

  // Group by date
  const byDate = new Map<string, ChangelogEntry[]>();
  for (const e of entries) {
    const date = (e.updated_at ?? "").slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(e);
  }

  for (const [date, items] of [...byDate.entries()].sort((a, b) =>
    b[0].localeCompare(a[0]),
  )) {
    lines.push(`## ${date}`);
    for (const item of items) {
      const prefix = item.type === "story" ? "Story" : "Decision";
      lines.push(`- [${prefix}] ${item.id}: ${item.title}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
