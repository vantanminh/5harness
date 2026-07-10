import {
  formatUpdateNotice,
  isCacheFresh,
  isNewerVersion,
  isUpdateCheckDisabled,
  parseUpdateCheckIntervalMs,
  shouldSkipUpdateCheckForArgv,
  type UpdateCheckCache,
  PACKAGE_NAME,
} from "../domain/update-check.js";
import {
  fetchLatestVersionFromNpm,
  readUpdateCheckCache,
  writeUpdateCheckCache,
  type UpdateCheckIoOptions,
} from "../infrastructure/update-check.js";

export type NotifyUpdateOptions = UpdateCheckIoOptions & {
  currentVersion: string;
  argv?: string[];
  nowMs?: number;
  /** Injected for tests. */
  fetchLatest?: () => Promise<string | null>;
  log?: (message: string) => void;
};

/**
 * Optionally print a one-line stderr notice when a newer npm version exists.
 *
 * - Fail-open (never throws to callers; network errors are silent)
 * - At most one registry fetch per interval (default 24h)
 * - Disabled when CI=true or HARNESS_NO_UPDATE_CHECK=1
 * - Skipped for bare help/version invocations
 * - Does not change process exit codes
 */
export async function maybeNotifyUpdateAvailable(
  options: NotifyUpdateOptions,
): Promise<void> {
  try {
    await runUpdateCheck(options);
  } catch {
    // Fail-open: never surface update-check failures.
  }
}

async function runUpdateCheck(options: NotifyUpdateOptions): Promise<void> {
  const env = options.env ?? process.env;
  if (isUpdateCheckDisabled(env)) return;

  const argv = options.argv ?? process.argv;
  if (shouldSkipUpdateCheckForArgv(argv)) return;

  const nowMs = options.nowMs ?? Date.now();
  const intervalMs = parseUpdateCheckIntervalMs(env);
  const io: UpdateCheckIoOptions = {
    env,
    harnessHome: options.harnessHome,
  };

  let cache = readUpdateCheckCache(io);
  let latest: string | null = cache?.latest ?? null;

  if (!isCacheFresh(cache, nowMs, intervalMs)) {
    const fetchLatest =
      options.fetchLatest ??
      (() => fetchLatestVersionFromNpm({ packageName: PACKAGE_NAME }));
    const fetched = await fetchLatest();
    // Always refresh checked_at so a failed fetch does not hammer the network.
    const next: UpdateCheckCache = {
      checked_at: new Date(nowMs).toISOString(),
      latest: fetched ?? cache?.latest ?? null,
    };
    try {
      writeUpdateCheckCache(next, io);
    } catch {
      // ignore cache write errors
    }
    cache = next;
    latest = next.latest;
  }

  if (!latest) return;
  if (!isNewerVersion(latest, options.currentVersion)) return;

  const log = options.log ?? ((msg: string) => console.error(msg));
  log(formatUpdateNotice(options.currentVersion, latest, PACKAGE_NAME));
}
