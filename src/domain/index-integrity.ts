import { createHash } from "node:crypto";

/** Current on-disk index schema version (US-034). */
export const INDEX_SCHEMA_VERSION = 1 as const;

/**
 * Stable checksum over index payload (excluding checksum itself).
 * Uses sorted JSON so key order does not matter.
 */
export function computeIndexChecksum(payload: {
  version: number;
  built_at: string;
  projectRoot: string;
  catalog: unknown;
  edges: unknown;
  texts: unknown;
}): string {
  const body = stableStringify({
    version: payload.version,
    built_at: payload.built_at,
    projectRoot: payload.projectRoot,
    catalog: payload.catalog,
    edges: payload.edges,
    texts: payload.texts,
  });
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export type IndexIntegrityIssue = {
  code:
    | "parse_error"
    | "schema_mismatch"
    | "checksum_mismatch"
    | "missing_checksum"
    | "missing_entity_file"
    | "broken_link";
  severity: "fail" | "warn";
  message: string;
};

/**
 * Validate a parsed index object shape and optional checksum.
 * Does not touch the filesystem (entity path existence is separate).
 */
export function validateIndexShape(raw: unknown): {
  ok: boolean;
  issues: IndexIntegrityIssue[];
  version?: number;
  checksum?: string;
  expectedChecksum?: string;
} {
  const issues: IndexIntegrityIssue[] = [];
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      issues: [
        {
          code: "parse_error",
          severity: "fail",
          message: "Index is not a JSON object",
        },
      ],
    };
  }
  const idx = raw as Record<string, unknown>;
  const version = Number(idx.version);
  if (!Number.isFinite(version) || version !== INDEX_SCHEMA_VERSION) {
    issues.push({
      code: "schema_mismatch",
      severity: "fail",
      message: `Index schema version ${String(idx.version)} unsupported (expected ${INDEX_SCHEMA_VERSION})`,
    });
  }
  if (!Array.isArray(idx.catalog) || !Array.isArray(idx.edges)) {
    issues.push({
      code: "parse_error",
      severity: "fail",
      message: "Index missing catalog/edges arrays",
    });
  }
  if (!idx.texts || typeof idx.texts !== "object") {
    issues.push({
      code: "parse_error",
      severity: "fail",
      message: "Index missing texts map",
    });
  }

  if (issues.some((i) => i.severity === "fail")) {
    return { ok: false, issues, version };
  }

  const expectedChecksum = computeIndexChecksum({
    version: version as number,
    built_at: String(idx.built_at ?? ""),
    projectRoot: String(idx.projectRoot ?? ""),
    catalog: idx.catalog,
    edges: idx.edges,
    texts: idx.texts,
  });

  const stored = typeof idx.checksum === "string" ? idx.checksum : undefined;
  if (!stored) {
    issues.push({
      code: "missing_checksum",
      severity: "warn",
      message: "Index has no checksum (pre-US-034); run `harness reindex`",
    });
  } else if (stored !== expectedChecksum) {
    issues.push({
      code: "checksum_mismatch",
      severity: "fail",
      message:
        "Index checksum mismatch (corrupt or partial write) — run `harness reindex`",
    });
  }

  return {
    ok: !issues.some((i) => i.severity === "fail"),
    issues,
    version,
    checksum: stored,
    expectedChecksum,
  };
}
