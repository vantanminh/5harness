#!/usr/bin/env node
/**
 * Bump package version and keep release-critical files in sync.
 *
 * Usage:
 *   node scripts/bump-version.mjs              # default: patch
 *   node scripts/bump-version.mjs patch|minor|major
 *   node scripts/bump-version.mjs 1.2.3        # set exact version
 *
 * Updates:
 *   - package.json
 *   - package-lock.json (root + packages[""])
 *   - src/version.ts
 *   - templates/AGENTS.md  <!-- harness-version: X.Y.Z -->
 *   - AGENTS.md            (same marker, when present)
 *
 * Prints the new version to stdout (last line is just the version for CI).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

function fail(message) {
  console.error(`bump-version: ${message}`);
  process.exit(1);
}

function parseSemver(v) {
  const m = String(v).trim().match(SEMVER_RE);
  if (!m) fail(`invalid semver: ${v}`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
    build: m[5] ?? null,
  };
}

function formatSemver({ major, minor, patch, prerelease, build }) {
  let out = `${major}.${minor}.${patch}`;
  if (prerelease) out += `-${prerelease}`;
  if (build) out += `+${build}`;
  return out;
}

function bump(current, kind) {
  const p = parseSemver(current);
  if (kind === "major") {
    return formatSemver({ major: p.major + 1, minor: 0, patch: 0 });
  }
  if (kind === "minor") {
    return formatSemver({ major: p.major, minor: p.minor + 1, patch: 0 });
  }
  if (kind === "patch") {
    return formatSemver({ major: p.major, minor: p.minor, patch: p.patch + 1 });
  }
  // exact version
  parseSemver(kind); // validate
  return kind;
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function writeJson(rel, data) {
  fs.writeFileSync(path.join(root, rel), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function replaceInFile(rel, replacer) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return false;
  const before = fs.readFileSync(full, "utf8");
  const after = replacer(before);
  if (after === before) return false;
  fs.writeFileSync(full, after, "utf8");
  return true;
}

const arg = (process.argv[2] ?? "patch").trim();
const kind = ["patch", "minor", "major"].includes(arg) ? arg : arg;

const pkg = readJson("package.json");
const oldVersion = pkg.version;
const newVersion = bump(oldVersion, kind);

if (newVersion === oldVersion) {
  fail(`version unchanged: ${oldVersion}`);
}

// package.json
pkg.version = newVersion;
writeJson("package.json", pkg);

// package-lock.json (root fields only — keep deps intact)
const lockPath = path.join(root, "package-lock.json");
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.version = newVersion;
  if (lock.packages && lock.packages[""]) {
    lock.packages[""].version = newVersion;
    // keep lock name aligned with package.json when present
    if (pkg.name) {
      lock.name = pkg.name;
      lock.packages[""].name = pkg.name;
    }
  }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

// src/version.ts
replaceInFile("src/version.ts", (text) => {
  if (!/VERSION\s*=\s*"[^"]+"/.test(text)) {
    fail("src/version.ts: VERSION constant not found");
  }
  return text.replace(/VERSION\s*=\s*"[^"]+"/, `VERSION = "${newVersion}"`);
});

// harness-version markers
const markerRe = /(<!--\s*harness-version:\s*)([^\s-]+)(\s*-->)/;
for (const rel of ["templates/AGENTS.md", "AGENTS.md"]) {
  replaceInFile(rel, (text) => {
    if (!markerRe.test(text)) {
      console.warn(`bump-version: no harness-version marker in ${rel} (skipped)`);
      return text;
    }
    return text.replace(markerRe, `$1${newVersion}$3`);
  });
}

// Keep a Changelog: promote [Unreleased] → [newVersion] - date (US-038)
// Pure inline helper (keep in sync with src/application/changelog-hygiene.ts).
function promoteUnreleased(changelog, version, date) {
  const text = changelog.replace(/\r\n/g, "\n");
  const headingRe = /^##\s+\[([^\]]+)\][^\n]*/gm;
  /** @type {{ key: string; start: number; bodyStart: number }[]} */
  const heads = [];
  let m;
  while ((m = headingRe.exec(text)) !== null) {
    heads.push({
      key: m[1].trim(),
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }
  /** @type {Map<string, { body: string; headingStart: number; end: number }>} */
  const sections = new Map();
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    const body = text
      .slice(heads[i].bodyStart, end)
      .replace(/^\n+/, "")
      .replace(/\n+$/, "");
    sections.set(heads[i].key, {
      body,
      headingStart: heads[i].start,
      end,
    });
  }
  if (sections.has(version)) {
    return { text: changelog, promoted: false, reason: "already-versioned" };
  }
  const unreleased = sections.get("Unreleased");
  if (!unreleased || unreleased.body.trim().length === 0) {
    return { text: changelog, promoted: false, reason: "empty-unreleased" };
  }
  const body = unreleased.body.trim();
  const emptyUnreleased = "## [Unreleased]\n\n";
  const versionBlock = `## [${version}] - ${date}\n\n${body}\n\n`;
  const before = text.slice(0, unreleased.headingStart);
  const after = text.slice(unreleased.end).replace(/^\n+/, "");
  const next = `${before}${emptyUnreleased}${versionBlock}${after}`.replace(
    /\n{3,}/g,
    "\n\n",
  );
  return {
    text: next.endsWith("\n") ? next : `${next}\n`,
    promoted: true,
    reason: "ok",
  };
}

const changelogRel = "CHANGELOG.md";
const changelogFull = path.join(root, changelogRel);
if (fs.existsSync(changelogFull)) {
  const today = new Date().toISOString().slice(0, 10);
  const beforeCl = fs.readFileSync(changelogFull, "utf8");
  const cut = promoteUnreleased(beforeCl, newVersion, today);
  if (cut.promoted) {
    fs.writeFileSync(changelogFull, cut.text, "utf8");
    console.log(
      `bump-version: promoted CHANGELOG [Unreleased] → [${newVersion}] - ${today}`,
    );
  } else {
    console.log(
      `bump-version: CHANGELOG Unreleased not promoted (${cut.reason})`,
    );
  }
} else {
  console.warn("bump-version: CHANGELOG.md missing (skipped promote)");
}

console.log(`bumped ${oldVersion} → ${newVersion} (${["patch", "minor", "major"].includes(arg) ? arg : "exact"})`);
// CI-friendly last line
console.log(newVersion);
