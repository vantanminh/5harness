import fs from "node:fs";
import path from "node:path";
import { isProtectedRelative } from "./paths.js";

export type PlannedWrite =
  | { kind: "create"; relative: string }
  | { kind: "overwrite"; relative: string }
  | { kind: "skip"; relative: string; reason: string }
  | { kind: "gitignore"; action: "create" | "append" | "skip" }
  | { kind: "db"; action: "create" | "migrate"; path: string };

export function classifyFilePlan(
  targetDir: string,
  relative: string,
  force: boolean,
): Extract<PlannedWrite, { kind: "create" | "overwrite" | "skip" }> {
  const abs = path.join(targetDir, relative);
  const exists = fs.existsSync(abs);
  if (!exists) {
    return { kind: "create", relative };
  }
  if (force) {
    return { kind: "overwrite", relative };
  }
  if (isProtectedRelative(relative)) {
    return {
      kind: "skip",
      relative,
      reason: "protected path exists (use --force to overwrite with backup)",
    };
  }
  return {
    kind: "skip",
    relative,
    reason: "already exists",
  };
}

export function hasBlockingConflicts(
  plans: PlannedWrite[],
  force: boolean,
): string[] {
  if (force) return [];
  return plans
    .filter(
      (p): p is Extract<PlannedWrite, { kind: "skip" }> =>
        p.kind === "skip" && p.reason.includes("protected"),
    )
    .map((p) => p.relative);
}
