import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLogger,
  redactSecrets,
  resolveDefaultLogFile,
  resolveGlobalLogDir,
  isDebugEnabled,
  resetDefaultLogger,
} from "../src/infrastructure/logger.js";

const tempDirs: string[] = [];

afterEach(() => {
  resetDefaultLogger();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-log-"));
  tempDirs.push(dir);
  return dir;
}

describe("logger redaction (US-033)", () => {
  it("redacts api keys, tokens, and common secret shapes", () => {
    expect(redactSecrets("api_key=sk-abc123secretvaluehere")).toMatch(/\*\*\*/);
    expect(redactSecrets("Authorization: Bearer tok_abc")).toMatch(/\*\*\*/);
    expect(redactSecrets("password: hunter2long")).toMatch(/\*\*\*/);
    expect(redactSecrets("token=ghp_abcdefghijklmnopqrstuv")).toMatch(/\*\*\*/);
    expect(redactSecrets("safe message")).toBe("safe message");
  });
});

describe("logger paths and debug (US-033)", () => {
  it("resolves global log dir under HARNESS_HOME", () => {
    const home = tempDir();
    expect(resolveGlobalLogDir({ HARNESS_HOME: home })).toBe(
      path.join(home, "logs"),
    );
  });

  it("prefers project log file when projectRoot set", () => {
    const project = tempDir();
    const file = resolveDefaultLogFile({}, project);
    expect(file).toBe(path.join(project, ".harness", "logs", "harness.log"));
  });

  it("honors HARNESS_LOG_FILE override", () => {
    const custom = path.join(tempDir(), "custom.log");
    expect(resolveDefaultLogFile({ HARNESS_LOG_FILE: custom })).toBe(
      path.resolve(custom),
    );
  });

  it("isDebugEnabled reads HARNESS_DEBUG", () => {
    expect(isDebugEnabled({})).toBe(false);
    expect(isDebugEnabled({ HARNESS_DEBUG: "1" })).toBe(true);
  });

  it("writes error lines to log file and redacts secrets", () => {
    const home = tempDir();
    const logFile = path.join(home, "logs", "harness.log");
    const logger = createLogger({
      env: { HARNESS_HOME: home },
      logFile,
      now: () => new Date("2026-07-12T00:00:00.000Z"),
    });
    logger.error("failed with api_key=supersecretvalue12345");
    expect(fs.existsSync(logFile)).toBe(true);
    const body = fs.readFileSync(logFile, "utf8");
    expect(body).toContain("[error]");
    expect(body).toContain("***");
    expect(body).not.toContain("supersecretvalue12345");
  });

  it("debug lines only when HARNESS_DEBUG set", () => {
    const home = tempDir();
    const logFile = path.join(home, "logs", "harness.log");
    const quiet = createLogger({
      env: { HARNESS_HOME: home },
      logFile,
    });
    quiet.debug("should not appear");
    expect(fs.existsSync(logFile)).toBe(false);

    const noisy = createLogger({
      env: { HARNESS_HOME: home, HARNESS_DEBUG: "1" },
      logFile,
    });
    noisy.debug("debug me");
    expect(fs.readFileSync(logFile, "utf8")).toContain("debug me");
  });
});
