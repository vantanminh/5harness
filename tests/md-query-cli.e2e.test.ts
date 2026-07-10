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

function runHarness(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cliEntry, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env },
    },
  );
}

describe("markdown query CLI e2e (US-008)", () => {
  it("write via CLI then query matrix/stats without harness.db", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-md-q-cli-"));
    tempDirs.push(dir);

    expect(fs.existsSync(path.join(dir, "harness.db"))).toBe(false);

    const add = runHarness([
      "story",
      "add",
      "--id",
      "US-808",
      "--title",
      "MD query",
      "--lane",
      "normal",
      "--dir",
      dir,
    ]);
    expect(add.status, add.stderr + add.stdout).toBe(0);

    const upd = runHarness([
      "story",
      "update",
      "--id",
      "US-808",
      "--status",
      "in_progress",
      "--unit",
      "1",
      "--dir",
      dir,
    ]);
    expect(upd.status, upd.stderr + upd.stdout).toBe(0);

    expect(fs.existsSync(path.join(dir, "harness.db"))).toBe(false);

    const matrix = runHarness(["query", "matrix", "--numeric", "--dir", dir]);
    expect(matrix.status, matrix.stderr + matrix.stdout).toBe(0);
    expect(matrix.stdout).toMatch(/US-808/);
    expect(matrix.stdout).toMatch(/in_progress/);
    expect(matrix.stdout).toMatch(/MD query/);

    const stats = runHarness(["query", "stats", "--dir", dir]);
    expect(stats.status, stats.stderr + stats.stdout).toBe(0);
    expect(stats.stdout).toMatch(/stories/);
    expect(stats.stdout).toContain("1");

    const intake = runHarness([
      "intake",
      "--type",
      "spec_slice",
      "--summary",
      "from cli",
      "--lane",
      "tiny",
      "--dir",
      dir,
    ]);
    expect(intake.status, intake.stderr + intake.stdout).toBe(0);

    const intakes = runHarness(["query", "intakes", "--dir", dir]);
    expect(intakes.status, intakes.stderr + intakes.stdout).toBe(0);
    expect(intakes.stdout).toMatch(/IN-001|from cli/);
  });
});
