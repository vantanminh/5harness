import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/domain/frontmatter.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(repoRoot, "src", "cli.ts");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runHarness(args: string[], cwd: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cliEntry, ...args],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env },
    },
  );
}

describe("markdown durable CLI e2e", () => {
  it("story add writes entity without requiring init/db", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-md-cli-"));
    tempDirs.push(dir);

    const add = runHarness(
      [
        "story",
        "add",
        "--id",
        "US-200",
        "--title",
        "No DB story",
        "--lane",
        "normal",
        "--links",
        "decisions/D-x",
        "--dir",
        dir,
      ],
      repoRoot,
    );
    expect(add.status, add.stderr + add.stdout).toBe(0);
    expect(add.stdout).toMatch(/US-200/);
    expect(add.stdout).toMatch(/docs\/stories\/US-200\.md|docs\\stories\\US-200\.md/);

    const filePath = path.join(dir, "docs", "stories", "US-200.md");
    expect(fs.existsSync(filePath)).toBe(true);
    const { data } = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
    expect(data.id).toBe("US-200");
    expect(data.type).toBe("story");
    expect(data.links).toEqual(["decisions/D-x"]);

    const upd = runHarness(
      [
        "story",
        "update",
        "--id",
        "US-200",
        "--status",
        "implemented",
        "--unit",
        "1",
        "--dir",
        dir,
      ],
      repoRoot,
    );
    expect(upd.status, upd.stderr + upd.stdout).toBe(0);
    const { data: d2 } = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
    expect(d2.status).toBe("implemented");
    expect(d2.unit).toBe(1);
  });

  it("init project then story query matrix from markdown", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-md-dual-"));
    tempDirs.push(dir);

    const init = runHarness(["init", dir], repoRoot);
    expect(init.status, init.stderr + init.stdout).toBe(0);

    const add = runHarness(
      [
        "story",
        "add",
        "--id",
        "US-201",
        "--title",
        "Dual",
        "--lane",
        "tiny",
        "--dir",
        dir,
      ],
      repoRoot,
    );
    expect(add.status, add.stderr + add.stdout).toBe(0);
    expect(fs.existsSync(path.join(dir, "docs", "stories", "US-201.md"))).toBe(
      true,
    );

    const matrix = runHarness(["query", "matrix", "--dir", dir], repoRoot);
    expect(matrix.status, matrix.stderr + matrix.stdout).toBe(0);
    expect(matrix.stdout).toContain("US-201");
  });
});
