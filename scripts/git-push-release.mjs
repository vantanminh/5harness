#!/usr/bin/env node
/**
 * Push a release commit (+ optional tag) to origin/main with rebase retries.
 *
 * Permanently reduces non-fast-forward races when auto-release commits land
 * while other work is also pushing to main:
 *   1. fetch origin
 *   2. pull --rebase origin main
 *   3. push
 *   4. retry a few times on rejection
 *
 * Usage:
 *   node scripts/git-push-release.mjs [--tag vX.Y.Z] [--message "chore(release): X"]
 *
 * Expects version files already staged or modified; creates commit if there is
 * a staged/unstaged change in the release paths. If the working tree is clean
 * for those paths, only pushes the tag (tag-only mode).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ATTEMPTS = 5;

const RELEASE_PATHS = [
  "package.json",
  "package-lock.json",
  "src/version.ts",
  "templates/AGENTS.md",
  "AGENTS.md",
  "CHANGELOG.md",
];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.stdio ?? "pipe",
    env: process.env,
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function must(cmd, args, label) {
  const r = run(cmd, args);
  if (r.status !== 0) {
    console.error(`${label} failed:\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r;
}

function parseArgs(argv) {
  let tag = null;
  let message = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tag") tag = argv[++i];
    else if (argv[i] === "--message" || argv[i] === "-m") message = argv[++i];
  }
  return { tag, message };
}

const { tag, message } = parseArgs(process.argv.slice(2));

// Ensure identity (CI sets these; local may already have them)
run("git", ["config", "user.name", "github-actions[bot]"]);
run("git", [
  "config",
  "user.email",
  "github-actions[bot]@users.noreply.github.com",
]);

// Stage release paths that exist and changed
for (const rel of RELEASE_PATHS) {
  if (fs.existsSync(path.join(root, rel))) {
    run("git", ["add", "--", rel]);
  }
}

const staged = run("git", ["diff", "--cached", "--name-only"]);
const hasCommit = staged.stdout.trim().length > 0;

if (hasCommit) {
  const msg = message || (tag ? `chore(release): ${tag.replace(/^v/, "")}` : "chore(release)");
  must("git", ["commit", "-m", msg], "git commit");
  console.log(`Created commit: ${msg}`);
} else {
  console.log("No release file changes to commit (tag-only or already committed).");
}

if (tag) {
  // Annotated tag on current HEAD (idempotent: fail if exists elsewhere)
  const exists = run("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
  if (exists.status === 0) {
    console.log(`Tag ${tag} already exists locally.`);
  } else {
    must("git", ["tag", "-a", tag, "-m", `Release ${tag}`], "git tag");
    console.log(`Created tag ${tag}`);
  }
}

let lastErr = "";
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log(`Push attempt ${attempt}/${MAX_ATTEMPTS}…`);
  must("git", ["fetch", "origin", "main"], "git fetch");

  const rebase = run("git", ["pull", "--rebase", "origin", "main"]);
  if (rebase.status !== 0) {
    console.error(`rebase failed:\n${rebase.stdout}\n${rebase.stderr}`);
    run("git", ["rebase", "--abort"]);
    lastErr = rebase.stderr || rebase.stdout;
    // conflict — cannot auto-resolve; fail hard
    console.error(
      "git-push-release: rebase conflict with origin/main. " +
        "Resolve manually; do not force-push main.",
    );
    process.exit(1);
  }

  const push = run("git", ["push", "origin", "HEAD:main"]);
  if (push.status === 0) {
    console.log("Pushed HEAD → origin/main");
    if (tag) {
      const pt = run("git", ["push", "origin", tag]);
      if (pt.status !== 0) {
        // tag may already exist on remote (another runner) — treat as ok if same
        console.error(pt.stderr);
        const remote = run("git", ["ls-remote", "--tags", "origin", tag]);
        if (remote.status === 0 && remote.stdout.includes(tag)) {
          console.log(`Tag ${tag} already on remote — continuing.`);
        } else {
          process.exit(1);
        }
      } else {
        console.log(`Pushed tag ${tag}`);
      }
    }
    process.exit(0);
  }

  lastErr = push.stderr || push.stdout;
  console.error(`push rejected (attempt ${attempt}):\n${lastErr}`);
  // next loop: fetch + rebase again
}

console.error(`git-push-release: failed after ${MAX_ATTEMPTS} attempts:\n${lastErr}`);
process.exit(1);
