import fs from "node:fs";
import path from "node:path";
import { resolvePackageRoot } from "../package-root.js";
import { formatTable } from "../infrastructure/table.js";

export type DocsCliOptions = {
  /** Override package root (testing hook). */
  packageRoot?: string;
};

function resolveDocsDir(options: DocsCliOptions): string {
  const root = options.packageRoot ?? resolvePackageRoot();
  const docsDir = path.join(root, "docs");
  if (!fs.existsSync(docsDir)) {
    throw new Error(`Docs directory not found: ${docsDir}`);
  }
  return docsDir;
}

/** Collect all .md files under the harness docs/ directory. */
function collectDocsFiles(docsDir: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(full);
      }
    }
  };
  walk(docsDir);
  return files.sort();
}

/** Extract the first markdown heading from file content. */
function firstHeading(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "(no heading)";
}

/** Compute a relative path from docsDir for display. */
function relativeDocsPath(docsDir: string, absPath: string): string {
  return path.relative(docsDir, absPath).replace(/\\/g, "/");
}

/**
 * Read a harness doc file and return its full content.
 * The `docPath` is relative to docs/ (e.g. "HARNESS.md").
 */
function readDocsFile(
  docsDir: string,
  docPath: string,
): { rel: string; content: string } {
  const safe = path.normalize(docPath).replace(/\\/g, "/");
  if (safe.startsWith("..") || path.isAbsolute(docPath)) {
    throw new Error(
      `Invalid doc path: ${docPath}. Use a relative path within docs/.`,
    );
  }
  const abs = path.join(docsDir, safe);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `Doc not found: ${docPath}. Use "harness docs list" to see available docs.`,
    );
  }
  if (!abs.startsWith(docsDir)) {
    throw new Error(`Invalid doc path: ${docPath} (resolves outside docs/).`);
  }
  return { rel: safe, content: fs.readFileSync(abs, "utf-8") };
}

/** Search one file and return snippets around each match (up to 3 per file). */
function searchInFile(
  content: string,
  queryLower: string,
): { heading: string; snippets: string[] } {
  const heading = firstHeading(content);
  if (!content.toLowerCase().includes(queryLower)) {
    return { heading, snippets: [] };
  }
  const lines = content.split("\n");
  const snippets: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(queryLower)) {
      const start = Math.max(0, i - 2);
      const end = Math.min(lines.length, i + 3);
      let snippet = lines.slice(start, end).join("\n").trim();
      if (snippet.length > 300) snippet = snippet.slice(0, 297) + "...";
      snippets.push(snippet);
      if (snippets.length >= 3) break;
    }
  }
  return { heading, snippets };
}

// ── Formatting ────────────────────────────────────────────────────

function formatDocsSearchResults(
  results: { rel: string; heading: string; snippets: string[] }[],
): string {
  if (results.length === 0) return "No matching docs found.";
  const lines: string[] = [];
  lines.push(`# Docs Search Results (${results.length} files)`);
  lines.push("");
  for (const r of results) {
    lines.push(`## ${r.rel}`);
    lines.push(`> ${r.heading}`);
    lines.push("");
    for (const snippet of r.snippets) {
      lines.push("```");
      lines.push(snippet);
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ── Public command executors ──────────────────────────────────────

/** harness docs search <query> */
export function executeDocsSearch(
  query: string,
  options: DocsCliOptions = {},
): void {
  if (!query?.trim()) throw new Error("docs search requires a query string");
  const docsDir = resolveDocsDir(options);
  const allFiles = collectDocsFiles(docsDir);
  const queryLower = query.trim().toLowerCase();
  const results: {
    rel: string;
    heading: string;
    snippets: string[];
  }[] = [];
  for (const absPath of allFiles) {
    const content = fs.readFileSync(absPath, "utf-8");
    const { heading, snippets } = searchInFile(content, queryLower);
    if (snippets.length > 0) {
      results.push({
        rel: relativeDocsPath(docsDir, absPath),
        heading,
        snippets,
      });
    }
  }
  console.log(formatDocsSearchResults(results));
}

/** harness docs list */
export function executeDocsList(options: DocsCliOptions = {}): void {
  const docsDir = resolveDocsDir(options);
  const allFiles = collectDocsFiles(docsDir);
  const rows = allFiles.map((absPath) => {
    const content = fs.readFileSync(absPath, "utf-8");
    return {
      path: relativeDocsPath(docsDir, absPath),
      title: firstHeading(content),
    };
  });
  if (rows.length === 0) {
    console.log("No docs found.");
    return;
  }
  console.log(formatTable(rows, ["path", "title"]));
}

/** harness docs read <path> */
export function executeDocsRead(
  docPath: string,
  options: DocsCliOptions = {},
): void {
  if (!docPath?.trim())
    throw new Error("docs read requires a path (e.g. HARNESS.md)");
  const docsDir = resolveDocsDir(options);
  const { rel, content } = readDocsFile(docsDir, docPath.trim());
  console.log(`# ${rel}`);
  console.log("");
  console.log(content);
}


