import fs from "node:fs";
import path from "node:path";
import {
  asBoolean01,
  asString,
  asStringArray,
  type FrontmatterData,
} from "../domain/frontmatter.js";
import {
  ENTITY_TYPES,
  type EntityType,
} from "../domain/entities.js";
import {
  listEntityFiles,
  type EntityFile,
} from "../infrastructure/entities.js";

export type CatalogEntry = {
  id: string;
  type: EntityType;
  path: string;
  title: string;
  status: string;
  mtimeMs: number;
  data: FrontmatterData;
  /** Body not loaded by default (frontmatter-only scan). */
  bodyPreview?: string;
};

export type ProjectCatalog = {
  projectRoot: string;
  entries: CatalogEntry[];
  byId: Map<string, CatalogEntry[]>;
  byType: Record<EntityType, CatalogEntry[]>;
};

function entryTitle(type: EntityType, data: FrontmatterData, id: string): string {
  if (type === "intake" || type === "report") {
    return asString(data, "summary") ?? id;
  }
  return asString(data, "title") ?? id;
}

function entryStatus(type: EntityType, data: FrontmatterData): string {
  return asString(data, "status") ?? "";
}

export function fileToCatalogEntry(file: EntityFile): CatalogEntry {
  const id = asString(file.data, "id") ?? path.basename(file.relativePath, ".md");
  const type = (asString(file.data, "type") as EntityType) ?? "story";
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(file.absolutePath).mtimeMs;
  } catch {
    mtimeMs = 0;
  }
  return {
    id,
    type,
    path: file.relativePath.replace(/\\/g, "/"),
    title: entryTitle(type, file.data, id),
    status: entryStatus(type, file.data),
    mtimeMs,
    data: file.data,
  };
}

/**
 * Scan entity markdown directories (frontmatter only via listEntityFiles).
 * Shared by query (US-008) and index (US-009).
 */
export function buildCatalog(projectRoot: string): ProjectCatalog {
  const entries: CatalogEntry[] = [];
  const byType = {
    story: [] as CatalogEntry[],
    decision: [] as CatalogEntry[],
    intake: [] as CatalogEntry[],
    backlog: [] as CatalogEntry[],
    report: [] as CatalogEntry[],
  };

  for (const type of ENTITY_TYPES) {
    const files = listEntityFiles(projectRoot, type);
    for (const file of files) {
      const entry = fileToCatalogEntry(file);
      // normalize type from path when frontmatter omitted type but was filtered
      if (!ENTITY_TYPES.includes(entry.type)) {
        entry.type = type;
      }
      entries.push(entry);
      byType[type].push(entry);
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  for (const t of ENTITY_TYPES) {
    byType[t].sort((a, b) => a.id.localeCompare(b.id));
  }

  const byId = new Map<string, CatalogEntry[]>();
  for (const e of entries) {
    const list = byId.get(e.id) ?? [];
    list.push(e);
    byId.set(e.id, list);
  }

  return { projectRoot, entries, byId, byType };
}

export function resolveCatalogEntry(
  catalog: ProjectCatalog,
  idOrPath: string,
): CatalogEntry | null {
  const raw = idOrPath.trim().replace(/\\/g, "/");
  if (!raw) return null;

  // exact path match
  const byPath = catalog.entries.find(
    (e) => e.path === raw || e.path === raw.replace(/^\.\//, ""),
  );
  if (byPath) return byPath;

  // type/id path fragment
  const slash = raw.includes("/") ? raw : null;
  if (slash) {
    const base = path.posix.basename(raw, ".md");
    const hits = catalog.byId.get(base) ?? [];
    const typed = hits.find(
      (h) =>
        h.path.endsWith(`/${base}.md`) &&
        (raw.includes(h.type) || raw.includes(path.posix.dirname(h.path))),
    );
    if (typed) return typed;
    if (hits.length === 1) return hits[0]!;
  }

  const hits = catalog.byId.get(raw) ?? [];
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) {
    // prefer story for bare US-* ids
    const story = hits.find((h) => h.type === "story");
    if (story) return story;
    return hits[0]!;
  }
  return null;
}

export function proof01(data: FrontmatterData, key: string): 0 | 1 {
  return asBoolean01(data, key) ?? 0;
}

export function linksOf(data: FrontmatterData): string[] {
  return [
    ...(asStringArray(data, "links") ?? []),
    ...(asStringArray(data, "related") ?? []),
  ].filter((value, index, all) => all.indexOf(value) === index);
}
