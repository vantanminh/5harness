import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname ?? __dirname, "..");
const script = path.join(root, "scripts", "release-plan.mjs");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runPlan(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("node", ["--no-warnings", script, "--root", dir, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: dir, XDG_CONFIG_HOME: dir },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function git(dir: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@test.com", ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: dir, XDG_CONFIG_HOME: dir },
  });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function setupRepo(): { dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-relplan-"));
  tempDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "test"]);
  git(dir, ["config", "user.email", "test@test.com"]);
  return { dir };
}

function writePkg(dir: string, version: string) {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test", version }, null, 2), "utf8");
}

function commitAndTag(dir: string, message: string, tag?: string) {
  fs.writeFileSync(path.join(dir, "readme.md"), message, "utf8");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", message]);
  if (tag) git(dir, ["tag", "-a", tag, "-m", tag]);
}

describe("release-plan.mjs", () => {
  it("returns skip when tag exists and no new commits", () => {
    const { dir } = setupRepo();
    writePkg(dir, "0.1.0");
    commitAndTag(dir, "initial", "v0.1.0");
    const res = runPlan(dir, ["--kind", "patch"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/skip=true/);
    expect(res.stdout).toMatch(/mode=skip/);
    expect(res.stdout).toMatch(/no new commits/);
  });

  it("returns bump when tag exists but new commits are present", () => {
    const { dir } = setupRepo();
    writePkg(dir, "0.1.0");
    commitAndTag(dir, "initial", "v0.1.0");
    commitAndTag(dir, "feat: something new");
    const res = runPlan(dir, ["--kind", "minor"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/skip=false/);
    expect(res.stdout).toMatch(/mode=bump/);
    expect(res.stdout).toMatch(/new commit/);
    expect(res.stdout).toContain("version=0.1.0");
  });

  it("returns bump when no tags exist", () => {
    const { dir } = setupRepo();
    writePkg(dir, "0.2.0");
    commitAndTag(dir, "initial");
    const res = runPlan(dir, ["major"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/skip=false/);
    expect(res.stdout).toMatch(/mode=bump/);
    expect(res.stdout).toMatch(/no v\* tag/);
    expect(res.stdout).toContain("kind=major");
  });

  it("returns tag-only when package.json is ahead of last tag", () => {
    const { dir } = setupRepo();
    writePkg(dir, "0.3.0");
    commitAndTag(dir, "initial", "v0.2.0");
    const res = runPlan(dir, ["--kind", "patch"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/skip=false/);
    expect(res.stdout).toMatch(/mode=tag-only/);
    expect(res.stdout).toMatch(/> last tag/);
    expect(res.stdout).toContain("version=0.3.0");
  });

  it("returns tag-only when version was bumped locally ahead of last tag", () => {
    const { dir } = setupRepo();
    writePkg(dir, "0.1.0");
    commitAndTag(dir, "initial", "v0.1.0");
    writePkg(dir, "0.1.1");
    commitAndTag(dir, "chore: prep");
    const res = runPlan(dir, ["patch"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/tag-only/);
  });

  it("defaults kind to patch when not specified", () => {
    const { dir } = setupRepo();
    writePkg(dir, "0.1.0");
    commitAndTag(dir, "initial");
    const res = runPlan(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("kind=patch");
  });

  it("counts multiple new commits", () => {
    const { dir } = setupRepo();
    writePkg(dir, "1.0.0");
    commitAndTag(dir, "release", "v1.0.0");
    commitAndTag(dir, "fix: bug");
    commitAndTag(dir, "feat: feature");
    commitAndTag(dir, "docs: readme");
    const res = runPlan(dir, ["--kind", "minor"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/mode=bump/);
    expect(res.stdout).toMatch(/3 new commit/);
  });
});