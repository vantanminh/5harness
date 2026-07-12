#!/usr/bin/env node
/**
 * Extract GitHub Release notes from CHANGELOG.md for a given version.
 *
 * Usage:
 *   node scripts/release-notes.mjs [version] [--out path]
 *
 * Resolution order:
 *   1. ## [X.Y.Z] section (exact version)
 *   2. ## [Unreleased] section (pre-CHANGELOG-discipline releases)
 *   3. Fallback body with npm/GitHub links
 *
 * Writes markdown to stdout, or to --out when provided.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

/**
 * @param {string} changelog
 * @param {string} version
 * @returns {string | null}
 */
export function extractChangelogSection(changelog, version) {
  const text = changelog.replace(/\r\n/g, "\n");
  // Match ## [1.2.3], ## [1.2.3] - 2026-01-01, or ## [Unreleased]
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
  /** @type {Map<string, string>} */
  const sections = new Map();
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    const body = text.slice(heads[i].bodyStart, end).trim();
    sections.set(heads[i].key, body);
  }
  if (sections.has(version)) {
    const body = sections.get(version);
    if (body && body.length > 0) return body;
  }
  if (sections.has("Unreleased")) {
    const body = sections.get("Unreleased");
    if (body && body.length > 0) return body;
  }
  return null;
}

/**
 * @param {{ version: string; packageName?: string; repoUrl?: string; changelogPath?: string }} opts
 * @returns {string}
 */
export function buildReleaseNotes(opts) {
  const version = opts.version;
  const packageName = opts.packageName ?? "@vantanminh/harness";
  const repoUrl =
    opts.repoUrl ?? "https://github.com/vantanminh/harness";
  const changelogPath =
    opts.changelogPath ?? path.join(root, "CHANGELOG.md");

  let section = null;
  if (fs.existsSync(changelogPath)) {
    const raw = fs.readFileSync(changelogPath, "utf8");
    section = extractChangelogSection(raw, version);
  }

  const lines = [
    `## ${packageName} v${version}`,
    "",
  ];

  if (section) {
    lines.push(section, "");
  } else {
    lines.push(
      `Release **${version}**.`,
      "",
      "See [CHANGELOG.md](./CHANGELOG.md) for details when available.",
      "",
    );
  }

  lines.push(
    "### Install",
    "",
    "```bash",
    `npm i -g ${packageName}@${version}`,
    "```",
    "",
    "### Supply chain",
    "",
    "- Published via **npm trusted publishing** (OIDC) with **provenance** attestations when available.",
    `- Package: https://www.npmjs.com/package/${packageName}/v/${version}`,
    `- Tag: ${repoUrl}/releases/tag/v${version}`,
    "",
  );

  return lines.join("\n");
}

function parseArgs(argv) {
  let version = null;
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "-o") {
      out = argv[++i];
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
    if (!version) version = a;
  }
  if (!version) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    version = pkg.version;
  }
  return { version, out };
}

function main() {
  const { version, out } = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const notes = buildReleaseNotes({
    version,
    packageName: pkg.name,
    repoUrl: "https://github.com/vantanminh/harness",
  });
  if (out) {
    fs.writeFileSync(out, notes, "utf8");
    console.error(`Wrote release notes → ${out}`);
  } else {
    process.stdout.write(notes);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
