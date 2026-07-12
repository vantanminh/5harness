import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isLoopbackBindHost,
  isProtectedRelative,
  registryFilePath,
  resolveDbPath,
  resolveHarnessHome,
  resolveTargetDir,
} from "../src/domain/paths.js";

describe("resolveTargetDir", () => {
  it("defaults to cwd", () => {
    const cwd = path.resolve("/tmp/project");
    expect(resolveTargetDir(undefined, cwd)).toBe(cwd);
  });

  it("resolves relative paths against cwd", () => {
    const cwd = path.resolve("/tmp/project");
    expect(resolveTargetDir("./child", cwd)).toBe(path.join(cwd, "child"));
  });
});

describe("resolveDbPath", () => {
  it("uses harness.db under target by default", () => {
    const target = path.resolve("/tmp/app");
    expect(resolveDbPath(target, {})).toBe(path.join(target, "harness.db"));
  });

  it("honors HARNESS_DB_PATH absolute override", () => {
    const target = path.resolve("/tmp/app");
    const db = path.resolve("/tmp/custom.db");
    expect(resolveDbPath(target, { HARNESS_DB_PATH: db })).toBe(db);
  });
});

describe("resolveHarnessHome", () => {
  it("joins .harness under home when HARNESS_HOME unset", () => {
    expect(resolveHarnessHome({}, () => "/Users/me")).toBe(
      path.join("/Users/me", ".harness"),
    );
  });

  it("registry file lives under home", () => {
    expect(registryFilePath("/tmp/h")).toBe(path.join("/tmp/h", "registry.json"));
  });
});

describe("isProtectedRelative", () => {

  it("protects AGENTS.md and docs tree", () => {
    expect(isProtectedRelative("AGENTS.md")).toBe(true);
    expect(isProtectedRelative("docs/HARNESS.md")).toBe(true);
    expect(isProtectedRelative("docs")).toBe(true);
    expect(isProtectedRelative(".gitignore")).toBe(false);
    expect(isProtectedRelative("README.md")).toBe(false);
  });
});

describe("isLoopbackBindHost (US-037)", () => {
  it("accepts loopback forms", () => {
    expect(isLoopbackBindHost("127.0.0.1")).toBe(true);
    expect(isLoopbackBindHost("localhost")).toBe(true);
    expect(isLoopbackBindHost("LOCALHOST")).toBe(true);
    expect(isLoopbackBindHost("::1")).toBe(true);
    expect(isLoopbackBindHost("[::1]")).toBe(true);
  });

  it("rejects non-loopback binds", () => {
    expect(isLoopbackBindHost("0.0.0.0")).toBe(false);
    expect(isLoopbackBindHost("192.168.1.10")).toBe(false);
  });
});
