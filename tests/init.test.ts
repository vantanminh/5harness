import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "../src/infrastructure/scaffold.js";
import { migrateDatabase, schemaIsReadable } from "../src/infrastructure/db.js";
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
    });
    expect(result.dryRun).toBe(true);
    expect(result.created.length).toBe(manifest.files.length);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "harness.db"))).toBe(false);
  });

  it("inits empty target with payload files and readable db", () => {
    const dir = tempDir();
    const result = runInit({
      directory: dir,
      packageRoot,
    });

    expect(result.dryRun).toBe(false);
    expect(result.schemaVersion).toBe(1);
    for (const relative of manifest.files) {
      expect(fs.existsSync(path.join(dir, relative)), relative).toBe(true);
    }
    expect(fs.existsSync(path.join(dir, "harness.db"))).toBe(true);
    expect(schemaIsReadable(path.join(dir, "harness.db"))).toBe(true);

    const gitignore = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    expect(gitignore).toContain("harness.db");

    // no upstream binary scaffold
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
    });
    const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("HARNESS:BEGIN");
    expect(agents).not.toBe("mine");
    const backupRoot = path.join(dir, ".harness-backup");
    expect(fs.existsSync(backupRoot)).toBe(true);
  });

  it("migrate is idempotent after init", () => {
    const dir = tempDir();
    runInit({ directory: dir, packageRoot });
    const dbPath = path.join(dir, "harness.db");
    const first = migrateDatabase(
      dbPath,
      path.join(packageRoot, "migrations"),
    );
    expect(first.alreadyLatest).toBe(true);
    const second = migrateDatabase(
      dbPath,
      path.join(packageRoot, "migrations"),
    );
    expect(second.alreadyLatest).toBe(true);
    expect(second.currentVersion).toBe(1);
  });
});
