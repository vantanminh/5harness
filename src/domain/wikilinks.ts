/**
 * Parse Obsidian-style wikilinks and normalize link targets.
 */

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** Extract [[target]] or [[target|alias]] targets (without alias). */
export function extractWikilinks(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(WIKILINK_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1]!.split("|")[0]!.trim();
    if (raw) out.push(normalizeLinkTarget(raw));
  }
  return out;
}

/** Normalize link target to a stable key (posix, no .md). */
export function normalizeLinkTarget(raw: string): string {
  let t = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (t.endsWith(".md")) t = t.slice(0, -4);
  return t;
}

/**
 * Resolve a link target against catalog-like entries.
 * Returns matching entry id+path keys or null if unresolved.
 */
export function matchLinkTarget(
  target: string,
  entries: Array<{ id: string; path: string; type: string }>,
): { id: string; path: string; type: string } | null {
  const norm = normalizeLinkTarget(target);
  // exact path without extension
  for (const e of entries) {
    const p = e.path.replace(/\\/g, "/").replace(/\.md$/, "");
    if (p === norm || p.endsWith(`/${norm}`)) return e;
  }
  // type/id
  if (norm.includes("/")) {
    const base = norm.split("/").pop()!;
    const typeHint = norm.split("/")[0]!;
    const hit = entries.find(
      (e) =>
        e.id === base &&
        (e.type === typeHint ||
          e.path.includes(typeHint) ||
          e.path.includes(`/${base}.md`)),
    );
    if (hit) return hit;
  }
  // bare id
  const byId = entries.filter((e) => e.id === norm);
  if (byId.length === 1) return byId[0]!;
  if (byId.length > 1) {
    const story = byId.find((e) => e.type === "story");
    return story ?? byId[0]!;
  }
  return null;
}
