import path from "node:path";

export const ENTITY_TYPES = [
  "story",
  "decision",
  "intake",
  "backlog",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_DIRS: Record<EntityType, string> = {
  story: "docs/stories",
  decision: "docs/decisions",
  intake: "docs/intakes",
  backlog: "docs/backlog",
};

/** Safe single path segment for entity ids (Windows-friendly). */
export function sanitizeEntityId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error("Entity id must not be empty");
  }
  if (trimmed.includes("..") || /[\\/]/.test(trimmed)) {
    throw new Error(`Invalid entity id (path separators not allowed): ${id}`);
  }
  // allow letters, digits, dash, underscore, dot
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new Error(
      `Invalid entity id "${id}". Use letters, digits, ., _, - (start with alphanumeric).`,
    );
  }
  return trimmed;
}

export function entityRelativePath(
  type: EntityType,
  id: string,
  explicitPath?: string,
): string {
  if (explicitPath?.trim()) {
    const rel = explicitPath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (rel.includes("..")) {
      throw new Error(`Invalid entity path: ${explicitPath}`);
    }
    return rel;
  }
  const safe = sanitizeEntityId(id);
  return path.posix.join(ENTITY_DIRS[type], `${safe}.md`);
}

export function parseLinksCsv(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const links = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return links;
}
