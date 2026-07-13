import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { maybeNotifyUpdateAvailable } from "../src/application/update-check.js";
import {
  formatUpdateNotice,
  isCacheFresh,
  isNewerVersion,
  isUpdateCheckDisabled,
  isUpdateRetryBackoffActive,
  shouldSkipUpdateCheckForArgv,
} from "../src/domain/update-check.js";
import {
  fetchLatestVersionFromNpm,
  readUpdateCheckCache,
  writeUpdateCheckCache,
} from "../src/infrastructure/update-check.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-upd-"));
  tempDirs.push(dir);
  return dir;
}

describe("domain update-check", () => {
  it("compares versions", () => {
    expect(isNewerVersion("0.9.2", "0.9.1")).toBe(true);
    expect(isNewerVersion("0.9.1", "0.9.1")).toBe(false);
    expect(isNewerVersion("0.9.0", "0.9.1")).toBe(false);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });

  it("detects disable flags and CI", () => {
    expect(isUpdateCheckDisabled({})).toBe(false);
    expect(isUpdateCheckDisabled({ HARNESS_NO_UPDATE_CHECK: "1" })).toBe(true);
    expect(isUpdateCheckDisabled({ CI: "true" })).toBe(true);
  });

  it("skips help/version argv", () => {
    expect(shouldSkipUpdateCheckForArgv(["node", "cli.js", "--version"])).toBe(
      true,
    );
    expect(shouldSkipUpdateCheckForArgv(["node", "cli.js", "-v"])).toBe(true);
    expect(shouldSkipUpdateCheckForArgv(["node", "cli.js", "-V"])).toBe(true);
    expect(shouldSkipUpdateCheckForArgv(["node", "cli.js", "-h"])).toBe(true);
    expect(shouldSkipUpdateCheckForArgv(["node", "cli.js", "init"])).toBe(
      false,
    );
  });

  it("formats notice", () => {
    expect(formatUpdateNotice("0.9.1", "0.9.2")).toContain("0.9.1 → 0.9.2");
    expect(formatUpdateNotice("0.9.1", "0.9.2")).toContain("harness update");
  });

  it("cache freshness", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    expect(
      isCacheFresh(
        { checked_at: "2026-07-10T11:00:00.000Z", latest: "1.0.0" },
        now,
        24 * 60 * 60 * 1000,
      ),
    ).toBe(true);
    expect(
      isCacheFresh(
        { checked_at: "2026-07-01T12:00:00.000Z", latest: "1.0.0" },
        now,
        24 * 60 * 60 * 1000,
      ),
    ).toBe(false);
  });

  it("backs off briefly after a registry attempt", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const cache = {
      checked_at: null,
      last_attempted_at: "2026-07-10T11:58:00.000Z",
      latest: null,
    };
    expect(isUpdateRetryBackoffActive(cache, now)).toBe(true);
    expect(isUpdateRetryBackoffActive(cache, now + 5 * 60 * 1000)).toBe(false);
    expect(
      isUpdateRetryBackoffActive(
        {
          checked_at: "2026-07-10T11:58:00.000Z",
          last_attempted_at: "2026-07-10T11:58:00.000Z",
          latest: "0.9.2",
        },
        now,
      ),
    ).toBe(false);
  });

  it("requests the npm latest dist-tag without intermediary caching", async () => {
    let requestedUrl = "";
    let requestInit: RequestInit | undefined;
    const latest = await fetchLatestVersionFromNpm({
      fetchImpl: (async (url, init) => {
        requestedUrl = String(url);
        requestInit = init;
        return new Response(JSON.stringify({ version: "1.2.3" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });

    expect(requestedUrl).toBe("https://registry.npmjs.org/5harness/latest");
    expect(new Headers(requestInit?.headers).get("cache-control")).toBe(
      "no-cache",
    );
    expect(latest).toBe("1.2.3");
  });
});

describe("maybeNotifyUpdateAvailable", () => {
  it("notifies when fetch returns a newer version and writes cache", async () => {
    const home = tempHome();
    const logs: string[] = [];
    let fetches = 0;

    await maybeNotifyUpdateAvailable({
      currentVersion: "0.9.1",
      harnessHome: home,
      env: {},
      argv: ["node", "cli.js", "projects"],
      nowMs: Date.parse("2026-07-10T12:00:00.000Z"),
      fetchLatest: async () => {
        fetches += 1;
        return "0.9.2";
      },
      log: (m) => logs.push(m),
    });

    expect(fetches).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("0.9.1 → 0.9.2");

    const cache = readUpdateCheckCache({ harnessHome: home });
    expect(cache?.latest).toBe("0.9.2");

    // Second call within interval uses cache — no fetch
    logs.length = 0;
    await maybeNotifyUpdateAvailable({
      currentVersion: "0.9.1",
      harnessHome: home,
      env: {},
      argv: ["node", "cli.js", "projects"],
      nowMs: Date.parse("2026-07-10T12:30:00.000Z"),
      fetchLatest: async () => {
        fetches += 1;
        return "9.9.9";
      },
      log: (m) => logs.push(m),
    });
    expect(fetches).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("0.9.2");
  });

  it("skips when disabled or help argv", async () => {
    const home = tempHome();
    let fetches = 0;
    const logs: string[] = [];

    await maybeNotifyUpdateAvailable({
      currentVersion: "0.9.1",
      harnessHome: home,
      env: { HARNESS_NO_UPDATE_CHECK: "1" },
      argv: ["node", "cli.js", "projects"],
      fetchLatest: async () => {
        fetches += 1;
        return "9.0.0";
      },
      log: (m) => logs.push(m),
    });
    expect(fetches).toBe(0);
    expect(logs).toHaveLength(0);

    await maybeNotifyUpdateAvailable({
      currentVersion: "0.9.1",
      harnessHome: home,
      env: {},
      argv: ["node", "cli.js", "--version"],
      fetchLatest: async () => {
        fetches += 1;
        return "9.0.0";
      },
      log: (m) => logs.push(m),
    });
    expect(fetches).toBe(0);
  });

  it("fail-open when fetch fails and retries after a short backoff", async () => {
    const home = tempHome();
    const logs: string[] = [];
    let fetches = 0;
    const firstAttempt = Date.parse("2026-07-10T12:00:00.000Z");

    await maybeNotifyUpdateAvailable({
      currentVersion: "0.9.1",
      harnessHome: home,
      env: { HARNESS_UPDATE_CHECK_INTERVAL_MS: "0" },
      argv: ["node", "cli.js", "init"],
      nowMs: firstAttempt,
      fetchLatest: async () => {
        fetches += 1;
        return null;
      },
      log: (m) => logs.push(m),
    });

    expect(logs).toHaveLength(0);
    expect(fetches).toBe(1);
    expect(readUpdateCheckCache({ harnessHome: home })).toMatchObject({
      checked_at: null,
      last_attempted_at: "2026-07-10T12:00:00.000Z",
      latest: null,
    });

    await maybeNotifyUpdateAvailable({
      currentVersion: "0.9.1",
      harnessHome: home,
      env: { HARNESS_UPDATE_CHECK_INTERVAL_MS: "0" },
      argv: ["node", "cli.js", "init"],
      nowMs: firstAttempt + 4 * 60 * 1000,
      fetchLatest: async () => {
        fetches += 1;
        return "0.9.2";
      },
      log: (m) => logs.push(m),
    });
    expect(fetches).toBe(1);

    await maybeNotifyUpdateAvailable({
      currentVersion: "0.9.1",
      harnessHome: home,
      env: { HARNESS_UPDATE_CHECK_INTERVAL_MS: "0" },
      argv: ["node", "cli.js", "init"],
      nowMs: firstAttempt + 5 * 60 * 1000,
      fetchLatest: async () => {
        fetches += 1;
        return "0.9.2";
      },
      log: (m) => logs.push(m),
    });
    expect(fetches).toBe(2);
    expect(logs.at(-1)).toContain("0.9.2");
  });

  it("does not notify when latest equals current", async () => {
    const home = tempHome();
    writeUpdateCheckCache(
      {
        checked_at: "2026-07-10T11:30:00.000Z",
        latest: "0.9.1",
      },
      { harnessHome: home },
    );
    const logs: string[] = [];
    await maybeNotifyUpdateAvailable({
      currentVersion: "0.9.1",
      harnessHome: home,
      env: {},
      argv: ["node", "cli.js", "projects"],
      nowMs: Date.parse("2026-07-10T12:00:00.000Z"),
      fetchLatest: async () => "1.0.0",
      log: (m) => logs.push(m),
    });
    expect(logs).toHaveLength(0);
  });
});
