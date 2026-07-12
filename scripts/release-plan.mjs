#!/usr/bin/env node
/**
 * Decide whether / how to version for CI auto-release.
 *
 * Avoids the divergence class of bugs where:
 * - package.json is already ahead of the last git tag (no extra bump commit needed)
 * - tag for current version already exists (skip release entirely)
 *
 * Usage (CI):
 *   node scripts/release-plan.mjs [--kind patch|minor|major]
 *
 * Outputs GitHub Actions-friendly lines on stdout:
 *   skip=true|false
 *   mode=skip|tag-only|bump
 *   version=X.Y.Z
 *   kind=...
 *   reason=...
 *
 * Last line is always the version (or empty when skip).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/;

function parseSemver(v) {
  const m = String(v).trim().replace(/^v/i, "").match(SEMVER_RE);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), raw: `${m[1]}.${m[2]}.${m[3]}` };
}

function cmp(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function git(args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return { ok: false, out: (r.stdout || "") + (r.stderr || "") };
  return { ok: true, out: (r.stdout || "").trim() };
}

function tagExists(tag) {
  const r = git(["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
  return r.ok;
}

function lastVersionTag() {
  const r = git(["describe", "--tags", "--abbrev=0", "--match", "v*"]);
  if (!r.ok || !r.out) return null;
  return r.out;
}

function parseArgs(argv) {
  let kind = "patch";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--kind") kind = argv[++i] || "patch";
    else if (["patch", "minor", "major"].includes(argv[i])) kind = argv[i];
  }
  if (!["patch", "minor", "major"].includes(kind)) kind = "patch";
  return { kind };
}

function emit(plan) {
  for (const [k, v] of Object.entries(plan)) {
    console.log(`${k}=${v}`);
  }
  // GHA convenience: last line pure version for tail -n1 consumers
  console.log(plan.version || "");
}

const { kind } = parseArgs(process.argv.slice(2));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const current = parseSemver(pkg.version);
if (!current) {
  console.error(`release-plan: invalid package.json version: ${pkg.version}`);
  process.exit(1);
}

const lastTag = lastVersionTag();
const last = lastTag ? parseSemver(lastTag) : null;
const tagForCurrent = `v${current.raw}`;

if (tagExists(tagForCurrent)) {
  emit({
    skip: "true",
    mode: "skip",
    version: current.raw,
    kind,
    reason: `tag ${tagForCurrent} already exists — nothing to release`,
  });
  process.exit(0);
}

// package.json already ahead of last tag → publish current version without bumping again
// (avoids double-bump / conflicting chore(release) commits when version was advanced on main)
if (last && cmp(current, last) > 0) {
  emit({
    skip: "false",
    mode: "tag-only",
    version: current.raw,
    kind,
    reason: `package.json ${current.raw} > last tag ${lastTag} — tag and publish without bump`,
  });
  process.exit(0);
}

// No tags, or version equals last tag → need a bump for a new release
emit({
  skip: "false",
  mode: "bump",
  version: current.raw, // pre-bump; CI runs bump-version after
  kind,
  reason: last
    ? `package.json ${current.raw} equals last tag ${lastTag} — bump ${kind}`
    : `no v* tag — bump ${kind} from ${current.raw}`,
});
process.exit(0);
