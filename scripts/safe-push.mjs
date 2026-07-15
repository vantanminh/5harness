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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureRebaseCandidates,
  reconcileWorklogAfterRebase,
} from "./safe-push-worklog.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootFlag = process.argv.indexOf("--root");
const root = path.resolve(
  rootFlag >= 0 && process.argv[rootFlag + 1]
    ? process.argv[rootFlag + 1]
    : defaultRoot,
);

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
  const snapshotPathRaw = spawnSync(
    "git",
    ["rev-parse", "--git-path", "5harness-safe-push-rebase.json"],
    { cwd: root, encoding: "utf8", windowsHide: true },
  ).stdout.trim();
  const snapshotPath = path.resolve(root, snapshotPathRaw);
  let before;
  if (fs.existsSync(snapshotPath)) {
    before = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    console.log("safe-push: resume saved pre-rebase worklog mapping");
  } else {
    before = captureRebaseCandidates(root, remoteRef);
    fs.writeFileSync(snapshotPath, JSON.stringify(before), "utf8");
  }

  console.log(`safe-push: git pull --rebase ${remoteRef}`);
  if (run(["pull", "--rebase", "origin", branch]) !== 0) {
    console.error(
      "safe-push: rebase failed. Fix conflicts, then:\n" +
        "  git add … && git rebase --continue\n" +
        "  npm run push",
    );
    process.exit(1);
  }

  try {
    const after = captureRebaseCandidates(root, remoteRef);
    const reconciled = reconcileWorklogAfterRebase(root, before, after);
    if (reconciled.updated > 0) {
      console.log(
        `safe-push: refreshed ${reconciled.updated} worklog commit reference(s)`,
      );
    }
    if (reconciled.unmatched > 0) {
      console.warn(
        `safe-push: ${reconciled.unmatched} pre-rebase commit(s) had no stable patch-id match; worklog references were left unchanged`,
      );
    }
    fs.rmSync(snapshotPath, { force: true });
  } catch (error) {
    console.error(
      `safe-push: worklog reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error("safe-push: fix the issue and rerun npm run push");
    process.exit(1);
  }
}

console.log(`safe-push: git push -u origin ${branch}`);
process.exit(run(["push", "-u", "origin", branch]));
