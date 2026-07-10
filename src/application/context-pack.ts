import { buildCatalog, resolveCatalogEntry, proof01, type CatalogEntry } from "./catalog.js";
import { asString } from "../domain/frontmatter.js";
import { readEntityFile } from "../infrastructure/entities.js";
import { buildProjectIndex, linksFor } from "./index-store.js";

export type ContextPack = {
  id: string;
  type: string;
  title: string;
  status: string;
  body: string;
  frontmatter: Record<string, unknown>;
  outbound: Array<{ to: string; kind: string; title?: string; status?: string }>;
  backlinks: Array<{ from: string; kind: string; title?: string; status?: string }>;
  proof: Record<string, unknown>;
  verifyCommand: string | null;
  depth: number;
  maxChars: number;
  truncated: boolean;
};

export type ContextOptions = {
  depth: 0 | 1;
  maxChars: number;
};

function findEntryById(
  catalog: ReturnType<typeof buildCatalog>,
  id: string,
): CatalogEntry | undefined {
  return catalog.entries.find((e) => e.id === id);
}

export function buildContextPack(
  projectRoot: string,
  entityId: string,
  options: ContextOptions = { depth: 0, maxChars: 8000 },
): ContextPack | null {
  const catalog = buildCatalog(projectRoot);
  const entry = resolveCatalogEntry(catalog, entityId);
  if (!entry) return null;

  const file = readEntityFile(projectRoot, entry.path);
  if (!file) return null;

  let body = file.body ?? "";
  if (body.length > options.maxChars) {
    body = body.slice(0, options.maxChars) + "\n\n... (truncated)";
  }

  const fm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(file.data)) {
    fm[k] = v;
  }

  const proof: Record<string, unknown> = {};
  if (entry.type === "story") {
    proof.unit = proof01(entry.data, "unit");
    proof.integration = proof01(entry.data, "integration");
    proof.e2e = proof01(entry.data, "e2e");
    proof.platform = proof01(entry.data, "platform");
    proof.lane = asString(entry.data, "lane") ?? "normal";
    proof.contract = asString(entry.data, "contract") ?? null;
  }

  const verifyCommand = asString(entry.data, "verify") ?? null;

  let outbound: ContextPack["outbound"] = [];
  let backlinks: ContextPack["backlinks"] = [];
  let truncated = false;

  try {
    const index = buildProjectIndex(projectRoot);
    const view = linksFor(index, entry.id);

    outbound = view.outbound.map((o) => {
      const target = findEntryById(catalog, o.to);
      return {
        to: o.to,
        kind: o.kind,
        title: target?.title,
        status: target?.status,
      };
    });

    backlinks = view.backlinks.map((b) => {
      const source = findEntryById(catalog, b.from);
      return {
        from: b.from,
        kind: b.kind,
        title: source?.title,
        status: source?.status,
      };
    });

    if (options.depth >= 1) {
      let totalChars = body.length;
      for (const o of outbound) {
        if (totalChars > options.maxChars) { truncated = true; break; }
        const targetEntry = findEntryById(catalog, o.to);
        if (targetEntry) {
          const tf = readEntityFile(projectRoot, targetEntry.path);
          if (tf?.body) {
            (o as Record<string, unknown>).excerpt = tf.body.slice(0, 500);
            totalChars += tf.body.slice(0, 500).length;
          }
        }
      }
      for (const b of backlinks) {
        if (totalChars > options.maxChars) { truncated = true; break; }
        const sourceEntry = findEntryById(catalog, b.from);
        if (sourceEntry) {
          const sf = readEntityFile(projectRoot, sourceEntry.path);
          if (sf?.body) {
            (b as Record<string, unknown>).excerpt = sf.body.slice(0, 500);
            totalChars += sf.body.slice(0, 500).length;
          }
        }
      }
    }
  } catch {
    // Links unavailable; proceed without
  }

  return {
    id: entry.id,
    type: entry.type,
    title: entry.title,
    status: entry.status,
    body,
    frontmatter: fm,
    outbound,
    backlinks,
    proof,
    verifyCommand,
    depth: options.depth,
    maxChars: options.maxChars,
    truncated,
  };
}

export function formatContextPack(pack: ContextPack, json: boolean): string {
  if (json) {
    return JSON.stringify(pack, null, 2);
  }

  const lines = [
    `== ${pack.id} (${pack.type}) ==`,
    `title: ${pack.title}`,
    `status: ${pack.status}`,
    "",
    "--- Body ---",
    pack.body || "(empty)",
  ];

  if (pack.type === "story") {
    const proof = pack.proof as Record<string, unknown>;
    lines.push(
      "",
      "--- Proof ---",
      `  unit: ${proof.unit ?? "?"}`,
      `  integration: ${proof.integration ?? "?"}`,
      `  e2e: ${proof.e2e ?? "?"}`,
      `  platform: ${proof.platform ?? "?"}`,
      `  lane: ${proof.lane ?? "normal"}`,
      `  contract: ${proof.contract ?? "N/A"}`,
    );
  }

  if (pack.verifyCommand) {
    lines.push("", `verify_command: ${pack.verifyCommand}`);
  }

  lines.push("", "--- Outbound links ---");
  if (pack.outbound.length === 0) lines.push("  (none)");
  for (const o of pack.outbound) {
    const ex = o as Record<string, unknown>;
    lines.push(`  -> ${o.to}  ${ex.title ?? ""}  [${ex.status ?? ""}]  (${o.kind})`);
    if (ex.excerpt) {
      lines.push(`    ${String(ex.excerpt).slice(0, 120)}...`);
    }
  }

  lines.push("", "--- Backlinks ---");
  if (pack.backlinks.length === 0) lines.push("  (none)");
  for (const b of pack.backlinks) {
    const ex = b as Record<string, unknown>;
    lines.push(`  <- ${b.from}  ${ex.title ?? ""}  [${ex.status ?? ""}]  (${b.kind})`);
  }

  if (pack.truncated) lines.push("", "[!] Context truncated to fit budget.");
  lines.push("", `context depth=${pack.depth}  max-chars=${pack.maxChars}`);
  return lines.join("\n");
}
