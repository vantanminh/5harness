import path from "node:path";

export function resolveTargetDir(
  input: string | undefined,
  cwd: string = process.cwd(),
): string {
  const raw = input?.trim() ? input.trim() : cwd;
  if (raw.startsWith("~")) {
    const home = process.env.HOME || process.env.USERPROFILE || cwd;
    const rest = raw.slice(1).replace(/^[\\/]/, "");
    return path.resolve(home, rest);
  }
  return path.resolve(cwd, raw);
}

export function resolveDbPath(
  targetDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HARNESS_DB_PATH?.trim();
  if (override) {
    return path.isAbsolute(override)
      ? override
      : path.resolve(targetDir, override);
  }
  return path.join(targetDir, "harness.db");
}

/** Paths that block init unless --force. */
export const PROTECTED_PATHS = ["AGENTS.md", "docs"] as const;

export function isProtectedRelative(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "AGENTS.md") return true;
  if (normalized === "docs" || normalized.startsWith("docs/")) return true;
  return false;
}
