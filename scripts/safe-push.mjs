#!/usr/bin/env node
/**
 * Developer helper: pull --rebase origin/main then push.
 * Prevents the usual non-fast-forward rejection when CI auto-release
 * (or another clone) advanced main while you were working locally.
 *
 *   node scripts/safe-push.mjs
 *   npm run push
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(args, inherit = true) {
  const r = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
  return r.status ?? 1;
}

const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim();

if (!branch || branch === "HEAD") {
  console.error("safe-push: detached HEAD — refuse to push");
  process.exit(1);
}

console.log(`safe-push: branch ${branch}`);
if (run(["fetch", "origin"]) !== 0) process.exit(1);

const remoteRef = `origin/${branch}`;
const hasRemote =
  spawnSync("git", ["rev-parse", "--verify", remoteRef], {
    cwd: root,
    stdio: "ignore",
  }).status === 0;

if (hasRemote) {
  console.log(`safe-push: git pull --rebase ${remoteRef}`);
  if (run(["pull", "--rebase", "origin", branch]) !== 0) {
    console.error(
      "safe-push: rebase failed. Fix conflicts, then:\n" +
        "  git add … && git rebase --continue\n" +
        "  npm run push",
    );
    process.exit(1);
  }
}

console.log(`safe-push: git push -u origin ${branch}`);
process.exit(run(["push", "-u", "origin", branch]));
