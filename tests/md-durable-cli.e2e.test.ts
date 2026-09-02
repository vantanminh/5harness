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

  it("story start accepts positional id and --id alias", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-story-start-"));
    tempDirs.push(dir);

    const add = runHarness(
      [
        "story",
        "add",
        "--id",
        "US-210",
        "--title",
        "Start alias",
        "--lane",
        "tiny",
        "--dir",
        dir,
      ],
      repoRoot,
    );
    expect(add.status, add.stderr + add.stdout).toBe(0);

    const viaFlag = runHarness(
      ["story", "start", "--id", "US-210", "--dir", dir],
      repoRoot,
    );
    expect(viaFlag.status, viaFlag.stderr + viaFlag.stdout).toBe(0);
    expect(viaFlag.stdout).toMatch(/US-210/);
    const { data } = parseFrontmatter(
      fs.readFileSync(path.join(dir, "docs", "stories", "US-210.md"), "utf8"),
    );
    expect(data.status).toBe("in_progress");

    const add2 = runHarness(
      [
        "story",
        "add",
        "--id",
        "US-211",
        "--title",
        "Start positional",
        "--lane",
        "tiny",
        "--dir",
        dir,
      ],
      repoRoot,
    );
    expect(add2.status, add2.stderr + add2.stdout).toBe(0);
    const viaPos = runHarness(
      ["story", "start", "US-211", "--dir", dir],
      repoRoot,
    );
    expect(viaPos.status, viaPos.stderr + viaPos.stdout).toBe(0);
    const { data: d3 } = parseFrontmatter(
      fs.readFileSync(path.join(dir, "docs", "stories", "US-211.md"), "utf8"),
    );
    expect(d3.status).toBe("in_progress");
  });

  it("intake close accepts --id alias", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-intake-id-"));
    tempDirs.push(dir);
    const add = runHarness(
      [
        "intake",
        "--type",
        "change_request",
        "--summary",
        "Close via --id",
        "--lane",
        "tiny",
        "--dir",
        dir,
      ],
      repoRoot,
    );
    expect(add.status, add.stderr + add.stdout).toBe(0);
    const close = runHarness(
      ["intake", "close", "--id", "IN-001", "--dir", dir],
      repoRoot,
    );
    expect(close.status, close.stderr + close.stdout).toBe(0);
    const { data } = parseFrontmatter(
      fs.readFileSync(path.join(dir, "docs", "intakes", "IN-001.md"), "utf8"),
    );
    expect(data.status).toBe("completed");
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

  it("updates and closes an intake", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-intake-cli-"));
    tempDirs.push(dir);

    const add = runHarness(
      [
        "intake",
        "--type",
        "change_request",
        "--summary",
        "Lifecycle",
        "--lane",
        "normal",
        "--dir",
        dir,
      ],
      repoRoot,
    );
    expect(add.status, add.stderr + add.stdout).toBe(0);

    const update = runHarness(
      [
        "intake",
        "update",
        "--id",
        "IN-001",
        "--stories",
        "US-1,US-2",
        "--dir",
        dir,
      ],
      repoRoot,
    );
    expect(update.status, update.stderr + update.stdout).toBe(0);

    const close = runHarness(
      ["intake", "close", "IN-001", "--notes", "done", "--dir", dir],
      repoRoot,
    );
    expect(close.status, close.stderr + close.stdout).toBe(0);
    const { data } = parseFrontmatter(
      fs.readFileSync(path.join(dir, "docs", "intakes", "IN-001.md"), "utf8"),
    );
    expect(data.status).toBe("completed");
    expect(data.stories).toEqual(["US-1", "US-2"]);
    expect(data.notes).toBe("done");
  });
});
