import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
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

describe("durable CLI e2e", () => {
  it("init then intake story decision backlog query", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dur-cli-"));
    tempDirs.push(dir);

    const init = runHarness(["init", dir]);
    expect(init.status, init.stderr + init.stdout).toBe(0);

    const intake = runHarness([
      "intake",
      "--dir",
      dir,
      "--type",
      "spec-slice",
      "--summary",
      "phase b",
      "--lane",
      "normal",
      "--story",
      "US-100",
    ]);
    expect(intake.status, intake.stderr + intake.stdout).toBe(0);
    expect(intake.stdout).toMatch(/Intake IN-001/);

    const storyAdd = runHarness([
      "story",
      "add",
      "--dir",
      dir,
      "--id",
      "US-100",
      "--title",
      "Phase B story",
      "--lane",
      "normal",
    ]);
    expect(storyAdd.status, storyAdd.stderr + storyAdd.stdout).toBe(0);

    const storyUpdate = runHarness([
      "story",
      "update",
      "--dir",
      dir,
      "--id",
      "US-100",
      "--status",
      "implemented",
      "--unit",
      "1",
      "--integration",
      "1",
      "--e2e",
      "0",
      "--platform",
      "0",
    ]);
    expect(storyUpdate.status, storyUpdate.stderr + storyUpdate.stdout).toBe(0);

    const decision = runHarness([
      "decision",
      "add",
      "--dir",
      dir,
      "--id",
      "0100-test",
      "--title",
      "Test decision",
    ]);
    expect(decision.status, decision.stderr + decision.stdout).toBe(0);

    const backlog = runHarness([
      "backlog",
      "add",
      "--dir",
      dir,
      "--title",
      "Polish help text",
      "--risk",
      "tiny",
    ]);
    expect(backlog.status, backlog.stderr + backlog.stdout).toBe(0);

    const matrix = runHarness(["query", "matrix", "--dir", dir]);
    expect(matrix.status, matrix.stderr + matrix.stdout).toBe(0);
    expect(matrix.stdout).toContain("US-100");

    const stats = runHarness(["query", "stats", "--dir", dir]);
    expect(stats.status, stats.stderr + stats.stdout).toBe(0);
    expect(stats.stdout).toContain("Harness Stats");

    // empty project: query works without harness.db
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "harness-empty-q-"));
    tempDirs.push(empty);
    const emptyMatrix = runHarness(["query", "matrix", "--dir", empty]);
    expect(emptyMatrix.status, emptyMatrix.stderr + emptyMatrix.stdout).toBe(0);
  });
});
