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

function runHarness(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cliEntry, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...env },
    },
  );
}

describe("index tools CLI e2e (US-009)", () => {
  it("reindex → search → get → links; link triggers reindex", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-idx-cli-"));
    tempDirs.push(dir);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-home-"));
    tempDirs.push(home);

    const add = runHarness([
      "story",
      "add",
      "--id",
      "US-900",
      "--title",
      "Searchable pineapple topic",
      "--lane",
      "normal",
      "--links",
      "decisions/D-900",
      "--dir",
      dir,
    ]);
    expect(add.status, add.stderr + add.stdout).toBe(0);

    runHarness([
      "decision",
      "add",
      "--id",
      "D-900",
      "--title",
      "Pine decision",
      "--dir",
      dir,
    ]);

    const reindex = runHarness(["reindex", "--dir", dir]);
    expect(reindex.status, reindex.stderr + reindex.stdout).toBe(0);
    expect(reindex.stdout).toMatch(/entities/);
    expect(fs.existsSync(path.join(dir, ".harness", "index", "index.json"))).toBe(
      true,
    );

    const search = runHarness(["search", "pineapple", "--dir", dir]);
    expect(search.status, search.stderr + search.stdout).toBe(0);
    expect(search.stdout).toMatch(/US-900/);
    expect(search.stdout).toMatch(/docs\/stories\/US-900\.md/);
    // snippet present, not a vault dump of unrelated files only
    expect(search.stdout.length).toBeLessThan(2000);

    const get = runHarness(["get", "US-900", "--summary", "--dir", dir]);
    expect(get.status, get.stderr + get.stdout).toBe(0);
    expect(get.stdout).toMatch(/US-900/);
    expect(get.stdout).toMatch(/story/);

    const links = runHarness(["links", "US-900", "--dir", dir]);
    expect(links.status, links.stderr + links.stdout).toBe(0);
    expect(links.stdout).toMatch(/Outbound/);
    expect(links.stdout).toMatch(/D-900/);

    // broken links command does not crash
    const missing = runHarness(["links", "DOES-NOT-EXIST", "--dir", dir]);
    expect(missing.status, missing.stderr + missing.stdout).toBe(0);

    const link = runHarness(["link", dir], {
      ...process.env,
      HARNESS_HOME: home,
    });
    expect(link.status, link.stderr + link.stdout).toBe(0);
    expect(link.stdout).toMatch(/reindex/i);
  });
});
