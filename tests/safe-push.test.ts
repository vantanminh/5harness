import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error JavaScript helper is intentionally shared with the developer script.
import * as safePushWorklog from "../scripts/safe-push-worklog.mjs";

const { buildRebaseCommitMap, rewriteWorklogCommitRefs } = safePushWorklog;

const repoRoot = path.resolve(import.meta.dirname ?? __dirname, "..");
const safePush = path.join(repoRoot, "scripts", "safe-push.mjs");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(dir: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}${result.stdout}`);
  }
  return result.stdout.trim();
}

function configure(dir: string): void {
  git(dir, ["config", "user.name", "Harness Test"]);
  git(dir, ["config", "user.email", "harness@example.test"]);
}

function commitFile(dir: string, name: string, content: string, message: string): void {
  fs.writeFileSync(path.join(dir, name), content, "utf8");
  git(dir, ["add", name]);
  git(dir, ["commit", "-m", message]);
}

describe("safe-push worklog reconciliation", () => {
  it("maps duplicate stable patch ids in commit order", () => {
    const mapping = buildRebaseCommitMap(
      [
        { hash: "old-a", patchId: "patch" },
        { hash: "old-b", patchId: "patch" },
      ],
      [
        { hash: "new-a", patchId: "patch" },
        { hash: "new-b", patchId: "patch" },
      ],
    );
    expect([...mapping.entries()]).toEqual([
      ["old-a", "new-a"],
      ["old-b", "new-b"],
    ]);
  });

  it("rewrites unique hash prefixes atomically and preserves other lines", () => {
    const root = temp("harness-safe-push-worklog-");
    const worklog = path.join(root, "worklog.jsonl");
    const oldHash = "a".repeat(40);
    const newHash = "b".repeat(40);
    const oldFullHash = "c".repeat(40);
    const newFullHash = "d".repeat(40);
    const original = [
      JSON.stringify({ id: 1, commit: oldHash.slice(0, 9) }),
      JSON.stringify({ id: 2, commit: oldFullHash }),
      JSON.stringify({ id: 3, commit: "unmatched" }),
      "not-json",
      "",
    ].join("\n");
    fs.writeFileSync(worklog, original, "utf8");

    expect(
      rewriteWorklogCommitRefs(
        worklog,
        new Map([
          [oldHash, newHash],
          [oldFullHash, newFullHash],
        ]),
      ),
    ).toBe(2);
    const lines = fs.readFileSync(worklog, "utf8").split(/\r?\n/);
    expect(JSON.parse(lines[0]!).commit).toBe(newHash.slice(0, 9));
    expect(JSON.parse(lines[1]!).commit).toBe(newFullHash);
    expect(lines[2]).toBe(JSON.stringify({ id: 3, commit: "unmatched" }));
    expect(lines[3]).toBe("not-json");
    expect(lines[4]).toBe("");
  });

  it("refreshes a real worklog hash after pull --rebase and pushes", () => {
    const parent = temp("harness-safe-push-e2e-");
    const remote = path.join(parent, "remote.git");
    const seed = path.join(parent, "seed");
    const local = path.join(parent, "local");
    const other = path.join(parent, "other");
    fs.mkdirSync(remote);
    fs.mkdirSync(seed);
    git(remote, ["init", "--bare"]);
    git(seed, ["init", "-b", "main"]);
    configure(seed);
    commitFile(seed, "base.txt", "base\n", "base");
    git(seed, ["remote", "add", "origin", remote]);
    git(seed, ["push", "-u", "origin", "main"]);
    git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    git(parent, ["clone", remote, local]);
    git(parent, ["clone", remote, other]);
    configure(local);
    configure(other);

    commitFile(local, "local.txt", "local\n", "feat: local work");
    const oldHash = git(local, ["rev-parse", "HEAD"]);
    const worklog = path.join(local, ".5harness", "worklog.jsonl");
    fs.mkdirSync(path.dirname(worklog), { recursive: true });
    fs.writeFileSync(
      worklog,
      `${JSON.stringify({ id: 1, commit: oldHash.slice(0, 8) })}\n`,
      "utf8",
    );

    commitFile(other, "remote.txt", "remote\n", "chore: remote advance");
    git(other, ["push", "origin", "main"]);

    const pushed = spawnSync(process.execPath, [safePush, "--root", local], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    expect(pushed.status, pushed.stderr + pushed.stdout).toBe(0);
    expect(pushed.stdout).toMatch(/refreshed 1 worklog commit reference/);

    const newHash = git(local, ["rev-parse", "HEAD"]);
    expect(newHash).not.toBe(oldHash);
    const entry = JSON.parse(fs.readFileSync(worklog, "utf8").trim()) as {
      commit: string;
    };
    expect(entry.commit).toBe(newHash.slice(0, 8));
    expect(git(remote, ["rev-parse", "refs/heads/main"])).toBe(newHash);
    expect(fs.existsSync(path.join(local, ".git", "5harness-safe-push-rebase.json"))).toBe(false);
  }, 60_000);
});
