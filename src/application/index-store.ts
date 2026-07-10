import fs from "node:fs";
import path from "node:path";
import { asString } from "../domain/frontmatter.js";
import {
  extractWikilinks,
  matchLinkTarget,
  normalizeLinkTarget,
} from "../domain/wikilinks.js";
import { readEntityFile } from "../infrastructure/entities.js";
import {
  buildCatalog,
  linksOf,
  resolveCatalogEntry,
  type CatalogEntry,
} from "./catalog.js";

export type IndexCatalogRow = {
  id: string;
  type: string;
  path: string;
  title: string;
  status: string;
  mtimeMs: number;
};

export type IndexEdge = {
  from: string;
  to: string;
  kind: "frontmatter" | "wikilink";
  resolved: boolean;
};

export type ProjectIndex = {
  version: 1;
  built_at: string;
  projectRoot: string;
  catalog: IndexCatalogRow[];
  edges: IndexEdge[];
  /** id -> searchable text */
  texts: Record<string, string>;
};

export function indexDir(projectRoot: string): string {
  return path.join(projectRoot, ".harness", "index");
}

export function indexJsonPath(projectRoot: string): string {
  return path.join(indexDir(projectRoot), "index.json");
}

export function hasMarkdownStore(projectRoot: string): boolean {
  const markers = [
    "docs/stories",
    "docs/decisions",
    "docs/intakes",
    "docs/backlog",
  ];
  return markers.some((rel) => fs.existsSync(path.join(projectRoot, rel)));
}

function loadBody(projectRoot: string, entry: CatalogEntry): string {
  const file = readEntityFile(projectRoot, entry.path);
  if (!file) return "";
  return file.body ?? "";
}

export function buildProjectIndex(projectRoot: string): ProjectIndex {
  const catalog = buildCatalog(projectRoot);
  const rows: IndexCatalogRow[] = catalog.entries.map((e) => ({
    id: e.id,
    type: e.type,
    path: e.path,
    title: e.title,
    status: e.status,
    mtimeMs: e.mtimeMs,
  }));

  const edges: IndexEdge[] = [];
  const texts: Record<string, string> = {};
  const entryLite = catalog.entries.map((e) => ({
    id: e.id,
    path: e.path,
    type: e.type,
  }));

  for (const e of catalog.entries) {
    const body = loadBody(projectRoot, e);
    const fmBlob = [
      e.id,
      e.type,
      e.title,
      e.status,
      asString(e.data, "notes") ?? "",
      asString(e.data, "summary") ?? "",
      asString(e.data, "evidence") ?? "",
    ].join(" ");
    texts[e.id] = `${fmBlob}\n${body}`;

    for (const link of linksOf(e.data)) {
      const target = normalizeLinkTarget(link);
      const matched = matchLinkTarget(target, entryLite);
      edges.push({
        from: e.id,
        to: matched?.id ?? target,
        kind: "frontmatter",
        resolved: Boolean(matched),
      });
    }

    for (const wl of extractWikilinks(body)) {
      const matched = matchLinkTarget(wl, entryLite);
      edges.push({
        from: e.id,
        to: matched?.id ?? wl,
        kind: "wikilink",
        resolved: Boolean(matched),
      });
    }
  }

  return {
    version: 1,
    built_at: new Date().toISOString(),
    projectRoot,
    catalog: rows,
    edges,
    texts,
  };
}

export function writeProjectIndex(
  projectRoot: string,
  index: ProjectIndex = buildProjectIndex(projectRoot),
): { path: string; entities: number; edges: number } {
  fs.mkdirSync(indexDir(projectRoot), { recursive: true });
  const outPath = indexJsonPath(projectRoot);
  fs.writeFileSync(
    outPath,
    `${JSON.stringify({ ...index, projectRoot }, null, 2)}\n`,
    "utf8",
  );
  return {
    path: outPath,
    entities: index.catalog.length,
    edges: index.edges.length,
  };
}

export function loadProjectIndex(projectRoot: string): ProjectIndex | null {
  const p = indexJsonPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ProjectIndex;
  } catch {
    return null;
  }
}

export function ensureIndex(projectRoot: string): ProjectIndex {
  const existing = loadProjectIndex(projectRoot);
  if (existing) return existing;
  const built = buildProjectIndex(projectRoot);
  writeProjectIndex(projectRoot, built);
  return built;
}

export type SearchHit = {
  id: string;
  path: string;
  type: string;
  title: string;
  score: number;
  snippet: string;
};

function snippetAround(text: string, query: string, radius = 60): string {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) {
    const line = text.split(/\r?\n/).find((l) => l.trim()) ?? text;
    return line.slice(0, radius * 2).trim();
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  let snip = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snip = `…${snip}`;
  if (end < text.length) snip = `${snip}…`;
  return snip;
}

export function searchIndex(
  index: ProjectIndex,
  query: string,
  limit = 20,
): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];

  for (const row of index.catalog) {
    const text = index.texts[row.id] ?? `${row.id} ${row.title} ${row.status}`;
    const lower = text.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (row.id.toLowerCase() === t) score += 10;
      else if (row.id.toLowerCase().includes(t)) score += 5;
      if (row.title.toLowerCase().includes(t)) score += 4;
      if (lower.includes(t)) score += 1;
    }
    if (score <= 0) continue;
    hits.push({
      id: row.id,
      path: row.path,
      type: row.type,
      title: row.title,
      score,
      snippet: snippetAround(text, tokens[0]!),
    });
  }

  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}

export type LinksView = {
  id: string;
  outbound: Array<{
    to: string;
    kind: string;
    resolved: boolean;
    title?: string;
  }>;
  backlinks: Array<{
    from: string;
    kind: string;
    resolved: boolean;
    title?: string;
  }>;
  broken: string[];
};

export function linksFor(index: ProjectIndex, id: string): LinksView {
  const titleOf = (eid: string) =>
    index.catalog.find((c) => c.id === eid)?.title;
  const outbound = index.edges
    .filter((e) => e.from === id)
    .map((e) => ({
      to: e.to,
      kind: e.kind,
      resolved: e.resolved,
      title: titleOf(e.to),
    }));
  const backlinks = index.edges
    .filter((e) => e.to === id)
    .map((e) => ({
      from: e.from,
      kind: e.kind,
      resolved: e.resolved,
      title: titleOf(e.from),
    }));
  const broken = outbound.filter((o) => !o.resolved).map((o) => o.to);
  return { id, outbound, backlinks, broken };
}

export function getEntityText(
  projectRoot: string,
  idOrPath: string,
  summaryOnly: boolean,
): {
  entry: CatalogEntry;
  frontmatter: string;
  body: string;
} | null {
  const catalog = buildCatalog(projectRoot);
  const entry = resolveCatalogEntry(catalog, idOrPath);
  if (!entry) return null;
  const file = readEntityFile(projectRoot, entry.path);
  if (!file) return null;
  const fmLines = Object.entries(file.data).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: ${JSON.stringify(v)}`;
    return `${k}: ${v}`;
  });
  return {
    entry,
    frontmatter: fmLines.join("\n"),
    body: summaryOnly ? "" : file.body,
  };
}

export function formatSearchHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "No matches.";
  return hits
    .map(
      (h) =>
        `[${h.score}] ${h.id} (${h.type}) ${h.path}\n  ${h.title}\n  ${h.snippet}`,
    )
    .join("\n\n");
}

export function formatLinksView(view: LinksView): string {
  const lines = [`Links for ${view.id}`, "", "Outbound:"];
  if (view.outbound.length === 0) lines.push("  (none)");
  for (const o of view.outbound) {
    const mark = o.resolved ? "" : " [broken]";
    lines.push(
      `  → ${o.to}${o.title ? ` — ${o.title}` : ""}${mark} (${o.kind})`,
    );
  }
  lines.push("", "Backlinks:");
  if (view.backlinks.length === 0) lines.push("  (none)");
  for (const b of view.backlinks) {
    lines.push(
      `  ← ${b.from}${b.title ? ` — ${b.title}` : ""} (${b.kind})`,
    );
  }
  if (view.broken.length > 0) {
    lines.push("", `Broken targets: ${view.broken.join(", ")}`);
  }
  return lines.join("\n");
}
