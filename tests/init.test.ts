import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "../src/infrastructure/scaffold.js";
import { migrateDatabase, schemaIsReadable } from "../src/infrastructure/db.js";
import { VERSION } from "../src/version.js";
import manifest from "../templates/manifest.json" with { type: "json" };

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-init-"));
  tempDirs.push(dir);
  return dir;
}

describe("runInit", () => {
  it("dry-run writes nothing", () => {
    const dir = tempDir();
    const result = runInit({
      directory: dir,
      dryRun: true,
      packageRoot,
      skipRegister: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.created.length).toBe(manifest.files.length);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "harness.db"))).toBe(false);
  });

  it("inits empty target with payload files, entity dirs, gitignore, registry (no SQLite SoT)", () => {
    const dir = tempDir();
    const home = tempDir();
    const result = runInit({
      directory: dir,
      packageRoot,
      env: { ...process.env, HARNESS_HOME: home },
    });

    expect(result.dryRun).toBe(false);
    expect(result.schemaVersion).toBe(0);
    expect(result.registered).toBe(true);
    for (const relative of manifest.files) {
      expect(fs.existsSync(path.join(dir, relative)), relative).toBe(true);
    }
    expect(fs.existsSync(path.join(dir, "docs", "intakes"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "docs", "backlog"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "harness.db"))).toBe(false);

    const gitignore = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain("harness.db");
    expect(gitignore).toContain(".harness/index/");
    expect(gitignore).toContain(".harness/local/");

    const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents).toMatch(/Do not[\s\S]*by hand/i);
    expect(agents).toMatch(/harness search/);
    expect(agents).toMatch(/npm i -g/);
    // decision 0017 / US-032 — hard-fail contract in harness block
    expect(agents).toMatch(/HARD STOP/i);
    expect(agents).toMatch(/harness doctor/);
    expect(agents).toMatch(/harness reindex/);
    expect(agents).toMatch(/harness link/);
    // Marker tracks package version (must not hardcode — breaks every bump).
    expect(agents).toMatch(
      new RegExp(`harness-version:\\s*${VERSION.replace(/\./g, "\\.")}`),
    );

    const harnessDoc = fs.readFileSync(path.join(dir, "docs", "HARNESS.md"), "utf8");
    expect(harnessDoc).toMatch(/markdown/i);
    expect(harnessDoc).not.toMatch(/Rust binary/i);

    const registry = fs.readFileSync(path.join(home, "registry.json"), "utf8");
    expect(registry).toMatch(/"projects"/);

    // no platform binary scaffold
    expect(fs.existsSync(path.join(dir, "scripts", "bin", "harness-cli"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(dir, "scripts", "bin", "harness-cli.exe")),
    ).toBe(false);
  });

  it("refuses protected conflicts without --force", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "mine", "utf8");
    expect(() =>
      runInit({
        directory: dir,
        packageRoot,
        skipRegister: true,
      }),
    ).toThrow(/--force/);
    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe("mine");
  });

  it("force overwrites with backup", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "mine", "utf8");
    runInit({
      directory: dir,
      force: true,
      packageRoot,
      skipRegister: true,
    });
    const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("HARNESS:BEGIN");
    expect(agents).not.toBe("mine");
    const backupRoot = path.join(dir, ".harness-backup");
    expect(fs.existsSync(backupRoot)).toBe(true);
  });

  it("optional legacy db create still migrates", () => {
    const dir = tempDir();
    runInit({
      directory: dir,
      packageRoot,
      skipRegister: true,
      createLegacyDb: true,
    });
    const dbPath = path.join(dir, "harness.db");
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(schemaIsReadable(dbPath)).toBe(true);
    const first = migrateDatabase(
      dbPath,
      path.join(packageRoot, "migrations"),
    );
    expect(first.alreadyLatest).toBe(true);
    expect(first.currentVersion).toBe(2);
  });
});

