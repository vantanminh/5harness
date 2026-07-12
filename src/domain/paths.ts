import os from "node:os";
import path from "node:path";

/** Machine-local global home directory name (registry, caches, logs). */
export const GLOBAL_HOME_DIRNAME = ".5harness";

/** Project-local derived state directory name (index, traces, locks, logs). */
export const PROJECT_STATE_DIRNAME = ".5harness";

/** Timestamped init/upgrade backup root under the project. */
export const BACKUP_DIRNAME = ".5harness-backup";

/** Default log file basename under global or project log dirs. */
export const LOG_BASENAME = "5harness.log";

/**
 * Optional SQLite path for `import-sqlite` only (not operational SoT).
 * Filename kept for historical import tooling.
 */
export const SQLITE_DB_BASENAME = "harness.db";

/** @deprecated Use SQLITE_DB_BASENAME */
export const LEGACY_DB_BASENAME = SQLITE_DB_BASENAME;

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

function expandHomePath(
  raw: string,
  env: NodeJS.ProcessEnv,
  homedir: () => string,
): string {
  if (raw.startsWith("~")) {
    const home = env.HOME || env.USERPROFILE || homedir();
    const rest = raw.slice(1).replace(/^[\\/]/, "");
    return path.resolve(home, rest);
  }
  return path.resolve(raw);
}

/**
 * Machine-local 5harness home (registry, caches). Override with HARNESS_HOME.
 * Default: `~/.5harness` (USERPROFILE on Windows).
 */
export function resolveHarnessHome(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => os.homedir(),
): string {
  const override = env.HARNESS_HOME?.trim();
  if (override) {
    return expandHomePath(override, env, homedir);
  }
  return path.join(homedir(), GLOBAL_HOME_DIRNAME);
}

export function registryFilePath(harnessHome: string): string {
  return path.join(harnessHome, "registry.json");
}

/** Project-local state root: always `<project>/.5harness`. */
export function resolveProjectStateRoot(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_STATE_DIRNAME);
}

export function projectIndexDir(projectRoot: string): string {
  return path.join(resolveProjectStateRoot(projectRoot), "index");
}

export function projectLocalDir(projectRoot: string): string {
  return path.join(resolveProjectStateRoot(projectRoot), "local");
}

export function projectLogsDir(projectRoot: string): string {
  return path.join(resolveProjectStateRoot(projectRoot), "logs");
}

export function projectMutationLockPath(projectRoot: string): string {
  return path.join(resolveProjectStateRoot(projectRoot), "mutation.lock");
}

export function projectToolRegistryPath(projectRoot: string): string {
  return path.join(resolveProjectStateRoot(projectRoot), "tool-registry.json");
}

export function projectWorklogPath(projectRoot: string): string {
  return path.join(resolveProjectStateRoot(projectRoot), "worklog.jsonl");
}

export function projectMcpCallsPath(projectRoot: string): string {
  return path.join(projectLocalDir(projectRoot), "mcp-calls.jsonl");
}

export function projectBackupRoot(projectRoot: string, stamp: string): string {
  return path.join(projectRoot, BACKUP_DIRNAME, stamp);
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
  return path.join(targetDir, SQLITE_DB_BASENAME);
}

/** Paths that block init unless --force. */
export const PROTECTED_PATHS = ["AGENTS.md", "docs"] as const;

export function isProtectedRelative(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "AGENTS.md") return true;
  if (normalized === "docs" || normalized.startsWith("docs/")) return true;
  return false;
}

/**
 * True when a bind host is loopback-only (default safe surface for dashboard/MCP).
 * US-037: non-loopback binds have no multi-tenant auth — warn operators.
 */
export function isLoopbackBindHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === "127.0.0.1" ||
    h === "localhost" ||
    h === "::1" ||
    h === "[::1]"
  );
}
