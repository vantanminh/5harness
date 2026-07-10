import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/domain/frontmatter.js";

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

describe("quality CLI e2e (MD store)", () => {
  it("verify, trace, score-trace, audit, query traces, propose without db", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-q-cli-"));
    tempDirs.push(dir);

    const add = runHarness([
      "story",
      "add",
      "--dir",
      dir,
      "--id",
      "US-Q1",
      "--title",
      "Quality",
      "--lane",
      "tiny",
      "--verify",
      'node -e "process.exit(0)"',
    ]);
    expect(add.status, add.stderr + add.stdout).toBe(0);

    const verify = runHarness(["story", "verify", "US-Q1", "--dir", dir]);
    expect(verify.status, verify.stderr + verify.stdout).toBe(0);
    expect(verify.stdout).toMatch(/pass/i);

    const fm = parseFrontmatter(
      fs.readFileSync(path.join(dir, "docs", "stories", "US-Q1.md"), "utf8"),
    );
    expect(fm.data.last_verified_result).toBe("pass");

    const trace = runHarness([
      "trace",
      "--dir",
      dir,
      "--summary",
      "quality work",
      "--outcome",
      "completed",
      "--changed",
      "src/a.ts",
      "--story",
      "US-Q1",
      "--agent",
      "test",
      "--actions",
      "implement",
      "--read",
      "README.md",
      "--friction",
      "none",
    ]);
    expect(trace.status, trace.stderr + trace.stdout).toBe(0);
    expect(trace.stdout).toMatch(/Trace #1/);
    expect(trace.stdout).toMatch(/Tier achieved/);
    expect(
      fs.existsSync(path.join(dir, ".harness", "local", "traces.jsonl")),
    ).toBe(true);
    expect(fs.existsSync(path.join(dir, "harness.db"))).toBe(false);

    const score = runHarness(["score-trace", "--dir", dir]);
    expect(score.status, score.stderr + score.stdout).toBe(0);

    const traces = runHarness(["query", "traces", "--dir", dir]);
    expect(traces.status, traces.stderr + traces.stdout).toBe(0);
    expect(traces.stdout).toContain("quality work");

    const audit = runHarness(["audit", "--dir", dir]);
    expect(audit.status, audit.stderr + audit.stdout).toBe(0);
    expect(audit.stdout).toMatch(/Entropy score/);

    const propose = runHarness(["propose", "--commit", "--dir", dir]);
    expect(propose.status, propose.stderr + propose.stdout).toBe(0);
  });
});
