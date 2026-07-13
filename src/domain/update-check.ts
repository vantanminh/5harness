/** npm package name used for update checks (decision 0016 / US-040). */
export const PACKAGE_NAME = "5harness";

/** Default minimum interval between successful registry checks. */
export const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Retry transient registry failures sooner than the normal freshness window. */
export const DEFAULT_UPDATE_CHECK_RETRY_MS = 5 * 60 * 1000;

export type UpdateCheckCache = {
  /** Last successful registry lookup. Null when no lookup has succeeded yet. */
  checked_at: string | null;
  /** Last attempted lookup, successful or not. */
  last_attempted_at?: string;
  latest: string | null;
};

export function isUpdateCheckDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (truthy(env.HARNESS_NO_UPDATE_CHECK)) return true;
  // Common CI indicators — never slow pipelines or agent loops.
  if (truthy(env.CI) || truthy(env.CONTINUOUS_INTEGRATION)) return true;
  return false;
}

function truthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * True when argv is only help/version (keep those instant; no network).
 * argv is process.argv-style (node, script, ...userArgs) or just userArgs.
 */
export function shouldSkipUpdateCheckForArgv(argv: string[]): boolean {
  // Drop node + script when present
  let args = argv;
  if (args[0]?.includes("node") || args[0]?.endsWith("node.exe")) {
    args = args.slice(2);
  } else if (args[0]?.endsWith("cli.js") || args[0]?.endsWith("cli.ts")) {
    args = args.slice(1);
  }

  if (args.length === 0) return true;

  const first = args[0]!;
  if (
    first === "-v" ||
    first === "-V" ||
    first === "--version" ||
    first === "-h" ||
    first === "--help" ||
    first === "help"
  ) {
    return true;
  }

  // `harness <cmd> --help` still runs the command tree; preAction may fire.
  // Allow check — cached most of the time.
  return false;
}

/**
 * Compare dotted numeric semver-ish versions (e.g. 0.9.1, 1.0.0).
 * Returns true when `latest` is strictly greater than `current`.
 * Pre-release tags are not supported (treated as plain prefix before `-`).
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

function parseVersion(raw: string): number[] | null {
  const core = raw.trim().replace(/^v/i, "").split("-")[0] ?? "";
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split(".").map((p) => Number(p));
}

export function formatUpdateNotice(
  current: string,
  latest: string,
  packageName: string = PACKAGE_NAME,
): string {
  return (
    `Notice: ${packageName} ${current} → ${latest} available. ` +
    "Run: harness update"
  );
}

export function parseUpdateCheckIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.HARNESS_UPDATE_CHECK_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_UPDATE_CHECK_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_UPDATE_CHECK_INTERVAL_MS;
  return n;
}

export function isCacheFresh(
  cache: UpdateCheckCache | null,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (!cache?.checked_at) return false;
  const t = Date.parse(cache.checked_at);
  if (!Number.isFinite(t)) return false;
  return nowMs - t < intervalMs;
}

export function isUpdateRetryBackoffActive(
  cache: UpdateCheckCache | null,
  nowMs: number,
  retryMs: number = DEFAULT_UPDATE_CHECK_RETRY_MS,
): boolean {
  if (!cache?.last_attempted_at) return false;
  const attemptedAt = Date.parse(cache.last_attempted_at);
  if (!Number.isFinite(attemptedAt)) return false;
  const checkedAt = cache.checked_at ? Date.parse(cache.checked_at) : NaN;
  // A successful attempt is governed by the normal freshness interval. The
  // retry backoff is only for attempts newer than the last successful check.
  if (Number.isFinite(checkedAt) && attemptedAt <= checkedAt) return false;
  return nowMs - attemptedAt < retryMs;
}
