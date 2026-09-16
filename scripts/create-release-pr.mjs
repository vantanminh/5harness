#!/usr/bin/env node
/**
 * Commit the prepared release files to a dedicated branch and open (or reuse)
 * a pull request targeting main.
 *
 * Release automation deliberately uses a PR instead of pushing a generated
 * commit to main. This keeps repository rulesets effective when the workflow
 * token cannot bypass a protected branch.
 *
 * Usage:
 *   node scripts/create-release-pr.mjs [--tag vX.Y.Z]
 *     [--message "chore(release): X"] [--sign]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_PATHS = [
  "package.json",
  "package-lock.json",
  "Cargo.toml",
  "Cargo.lock",
  "templates/AGENTS.md",
  "AGENTS.md",
  "CHANGELOG.md",
];

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.stdio ?? "pipe",
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function must(cmd, args, label) {
  const result = run(cmd, args);
  if (result.status !== 0) {
    console.error(`${label} failed:\n${result.stdout}\n${result.stderr}`);
    process.exit(1);
  }
  return result;
}

function parseArgs(argv) {
  let tag = null;
  let message = null;
  let sign = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--tag") tag = argv[++index];
    else if (argv[index] === "--message" || argv[index] === "-m") {
      message = argv[++index];
    } else if (argv[index] === "--sign") sign = true;
  }
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    console.error("create-release-pr: --tag must match vX.Y.Z");
    process.exit(1);
  }
  return { tag, message, sign };
}

const { tag, message, sign } = parseArgs(process.argv.slice(2));
const version = tag.slice(1);
const branch = `automation/release/${tag}`;
const commitMessage = message || `chore(release): ${version}`;

// CI starts from a detached checkout. Resetting only this generated branch is
// safe and makes retries idempotent; the remote branch is protected by a
// force-with-lease check below so unrelated changes are never overwritten.
must("git", ["config", "user.name", "github-actions[bot]"], "git identity");
must(
  "git",
  ["config", "user.email", "github-actions[bot]@users.noreply.github.com"],
  "git identity",
);
must("git", ["switch", "-C", branch], "create release branch");

for (const relative of RELEASE_PATHS) {
  if (fs.existsSync(path.join(root, relative))) {
    run("git", ["add", "--", relative]);
  }
}

const staged = must("git", ["diff", "--cached", "--name-only"], "inspect release changes");
if (!staged.stdout.trim()) {
  console.error("create-release-pr: no release file changes are staged");
  process.exit(1);
}

const commitArgs = ["commit"];
if (sign) commitArgs.push("-S");
commitArgs.push("-m", commitMessage);
must("git", commitArgs, "create release commit");
console.log(`Created release branch commit: ${commitMessage}${sign ? " (GPG-signed)" : ""}`);

// Fetch the branch when it already exists so --force-with-lease protects a
// manually modified or concurrently updated release PR.
const remoteRef = `refs/remotes/origin/${branch}`;
const fetched = run("git", ["fetch", "origin", `${branch}:${remoteRef}`]);
let pushArgs = ["push", "origin", `HEAD:refs/heads/${branch}`];
if (fetched.status === 0) {
  const remoteHead = must("git", ["rev-parse", remoteRef], "resolve remote release branch").stdout.trim();
  pushArgs = [
    "push",
    `--force-with-lease=refs/heads/${branch}:${remoteHead}`,
    "origin",
    `HEAD:refs/heads/${branch}`,
  ];
}
must("git", pushArgs, "push release branch");

if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  console.error("create-release-pr: GH_TOKEN or GITHUB_TOKEN is required");
  process.exit(1);
}

const existing = must(
  "gh",
  ["pr", "list", "--base", "main", "--head", branch, "--state", "open", "--json", "number,url"],
  "find release PR",
);
let pullRequests;
try {
  pullRequests = JSON.parse(existing.stdout);
} catch (error) {
  console.error(`create-release-pr: invalid gh pr list output: ${error.message}`);
  process.exit(1);
}

if (pullRequests.length > 0) {
  console.log(`Release PR already open: ${pullRequests[0].url}`);
  process.exit(0);
}

const body = [
  `Automated release preparation for **${tag}**.`,
  "",
  "All required CI and dependency-security gates passed before this branch was created.",
  "After the PR is merged, CI will create the immutable tag and publish the exact merged commit.",
].join("\n");
const created = must(
  "gh",
  [
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    branch,
    "--title",
    commitMessage,
    "--body",
    body,
  ],
  "create release PR",
);
console.log(created.stdout.trim());
