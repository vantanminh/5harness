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

describe("propose + tools CLI", () => {
  it("lists tools without a database", () => {
    const result = runHarness(["query", "tools", "--capability", "verification"]);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("story verify");
    expect(result.stdout).toContain("verification");
  });

  it("propose and propose --commit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-p-cli-"));
    tempDirs.push(dir);
    expect(runHarness(["init", dir]).status).toBe(0);
    expect(
      runHarness([
        "story",
        "add",
        "--dir",
        dir,
        "--id",
        "US-P1",
        "--title",
        "Orphan",
        "--lane",
        "normal",
        "--verify",
        'node -e "process.exit(0)"',
      ]).status,
    ).toBe(0);

    const propose = runHarness(["propose", "--dir", dir]);
    expect(propose.status, propose.stderr + propose.stdout).toBe(0);
    expect(propose.stdout).toMatch(/Proposal|Improvement/i);

    const commit = runHarness(["propose", "--dir", dir, "--commit"]);
    expect(commit.status, commit.stderr + commit.stdout).toBe(0);
    expect(commit.stdout).toMatch(/Commit: added/);

    const backlog = runHarness(["query", "backlog", "--dir", dir, "--open"]);
    expect(backlog.status).toBe(0);
    expect(backlog.stdout).toContain("US-P1");
  });
});
