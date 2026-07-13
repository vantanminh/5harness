import fs from "node:fs";
import path from "node:path";
import {
  type UpdateCheckCache,
  PACKAGE_NAME,
} from "../domain/update-check.js";
import { resolveHarnessHome } from "../domain/paths.js";

export const DEFAULT_FETCH_TIMEOUT_MS = 1_500;

export type UpdateCheckIoOptions = {
  env?: NodeJS.ProcessEnv;
  harnessHome?: string;
};

export function updateCheckCachePath(options: UpdateCheckIoOptions = {}): string {
  const home =
    options.harnessHome ??
    resolveHarnessHome(options.env ?? process.env);
  return path.join(home, "update-check.json");
}

export function readUpdateCheckCache(
  options: UpdateCheckIoOptions = {},
): UpdateCheckCache | null {
  const file = updateCheckCachePath(options);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return null;
    const data = JSON.parse(raw) as UpdateCheckCache;
    if (data.checked_at !== null && typeof data.checked_at !== "string") {
      return null;
    }
    if (
      data.last_attempted_at !== undefined &&
      typeof data.last_attempted_at !== "string"
    ) {
      return null;
    }
    if (data.latest !== null && typeof data.latest !== "string") return null;
    return {
      checked_at: data.checked_at ?? null,
      last_attempted_at: data.last_attempted_at,
      latest: data.latest ?? null,
    };
  } catch {
    return null;
  }
}

export function writeUpdateCheckCache(
  cache: UpdateCheckCache,
  options: UpdateCheckIoOptions = {},
): void {
  const file = updateCheckCachePath(options);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Fetch latest version from the npm registry. Fail-open: returns null on any error.
 */
export async function fetchLatestVersionFromNpm(options?: {
  packageName?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const packageName = options?.packageName ?? PACKAGE_NAME;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return null;

  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": `${packageName}-update-check`,
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== "string" || !body.version.trim()) return null;
    return body.version.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
