import os from "node:os";
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

/**
 * Machine-local harness home (registry, caches). Override with HARNESS_HOME.
 * Default: `~/.harness` (USERPROFILE on Windows).
 */
export function resolveHarnessHome(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => os.homedir(),
): string {
  const override = env.HARNESS_HOME?.trim();
  if (override) {
    if (override.startsWith("~")) {
      const home = env.HOME || env.USERPROFILE || homedir();
      const rest = override.slice(1).replace(/^[\\/]/, "");
      return path.resolve(home, rest);
    }
    return path.resolve(override);
  }
  return path.join(homedir(), ".harness");
}

export function registryFilePath(harnessHome: string): string {
  return path.join(harnessHome, "registry.json");
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
