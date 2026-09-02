import {
  ensureIndex,
  formatLinksView,
  formatSearchHits,
  getEntityText,
  linksFor,
  searchIndex,
  writeProjectIndex,
} from "../application/index-store.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";

export function executeReindex(options: TargetOptions = {}): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const result = writeProjectIndex(targetDir);
  console.log(`Reindexed ${result.entities} entities, ${result.edges} edges`);
  console.log(`Index: ${result.path}`);
}

export type GetCliOptions = TargetOptions & {
  summary?: boolean;
  json?: boolean;
};

export function executeGet(
  idOrPath: string,
  options: GetCliOptions = {},
): void {
  if (!idOrPath?.trim()) {
    throw new Error("get requires an entity id or path");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const result = getEntityText(
    targetDir,
    idOrPath,
    Boolean(options.summary),
  );
  if (!result) {
    throw new Error(`Entity not found: ${idOrPath}`);
  }
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          id: result.entry.id,
          type: result.entry.type,
          path: result.entry.path,
          title: result.entry.title,
          status: result.entry.status,
          frontmatter: result.frontmatter,
          body: options.summary ? undefined : result.body,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`# ${result.entry.id} (${result.entry.type})`);
  console.log(`path: ${result.entry.path}`);
  console.log("---");
  console.log(result.frontmatter);
  if (!options.summary && result.body.trim()) {
    console.log("---");
    console.log(result.body.trimEnd());
  }
}

export type SearchCliOptions = TargetOptions & {
  limit?: string;
  json?: boolean;
  type?: string;
};

export function executeSearch(
  query: string,
  options: SearchCliOptions = {},
): void {
  if (!query?.trim()) {
    throw new Error(
      "search requires a query string (e.g. harness search matrix)",
    );
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const index = ensureIndex(targetDir);
  const limit = options.limit ? Number(options.limit) : 20;
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`Invalid --limit "${options.limit}"`);
  }
  const hits = searchIndex(index, query, limit, { type: options.type });
  if (options.json) {
    console.log(JSON.stringify(hits, null, 2));
    return;
  }
  console.log(formatSearchHits(hits));
}

export function executeLinks(
  id: string,
  options: TargetOptions & { json?: boolean; broken?: boolean } = {},
): void {
  if (!id?.trim()) {
    throw new Error("links requires an entity id");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const index = ensureIndex(targetDir);
  // resolve bare id even if only in catalog
  const row = index.catalog.find((c) => c.id === id);
  if (!row) {
    const empty = { id, outbound: [], backlinks: [], broken: [] };
    if (options.json) {
      console.log(JSON.stringify({ ...empty, note: "not in index" }, null, 2));
      return;
    }
    console.log(formatLinksView(empty));
    console.log("");
    console.log(`note: ${id} not in index (run harness reindex)`);
    return;
  }
  const full = linksFor(index, id);
  const view = options.broken
    ? { ...full, outbound: full.outbound.filter((o) => !o.resolved) }
    : full;
  if (options.broken && !options.json) {
    const broken = view.broken;
    if (broken.length === 0) {
      console.log(`No broken links from ${id}.`);
      return;
    }
    console.log(`Broken links from ${id}:`);
    for (const target of broken) console.log(`  → ${target}`);
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  console.log(formatLinksView(view));
}
