import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(repoRoot, "src", "cli.ts");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runHarness(args: string[], cwd?: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cliEntry, ...args],
    {
      cwd: cwd ?? repoRoot,
      encoding: "utf8",
      env: { ...process.env },
    },
  );
}

describe("CLI e2e", () => {
  it("prints version via --version, -V, and -v", () => {
    for (const flag of ["--version", "-V", "-v"] as const) {
      const result = runHarness([flag]);
      expect(result.status, `${flag}: ${result.stderr}`).toBe(0);
      expect(result.stdout.trim(), flag).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("help lists init and migrate", () => {
    const result = runHarness(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("migrate");
  });

  it("init --dry-run and init into temp dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-e2e-"));
    tempDirs.push(dir);

    const dry = runHarness(["init", dir, "--dry-run"]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/dry-run|Dry run/i);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(false);

    const init = runHarness(["init", "--dir", dir]);
    expect(init.status, init.stderr + init.stdout).toBe(0);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "docs", "stories"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "docs", "reports"))).toBe(true);
    expect(init.stdout).toContain(
      "Entity dirs: docs/stories|decisions|intakes|backlog|reports",
    );
    // US-013: no project SQLite SoT by default
    expect(fs.existsSync(path.join(dir, "harness.db"))).toBe(false);

    const migrate = runHarness(["migrate", "--dir", dir]);
    expect(migrate.status, migrate.stderr + migrate.stdout).toBe(0);
    expect(migrate.stdout).toMatch(/markdown|No harness\.db|nothing to migrate/i);
  });

  it("conflict without force exits non-zero", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-e2e-conflict-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "x", "utf8");
    const result = runHarness(["init", dir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/force/i);
  });
});
