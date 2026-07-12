import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildReleaseNotes,
  extractChangelogSection,
} from "../src/application/release-notes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("extractChangelogSection", () => {
  const sample = `# Changelog

## [Unreleased]

### Added

- New thing

## [1.2.0] - 2026-01-01

### Fixed

- Bug fix

## [1.1.0] - 2025-12-01

### Changed

- Older stuff
`;

  it("extracts exact version section", () => {
    const body = extractChangelogSection(sample, "1.2.0");
    expect(body).toContain("### Fixed");
    expect(body).toContain("Bug fix");
    expect(body).not.toContain("Older stuff");
    expect(body).not.toContain("New thing");
  });

  it("falls back to Unreleased when version missing", () => {
    const body = extractChangelogSection(sample, "9.9.9");
    expect(body).toContain("### Added");
    expect(body).toContain("New thing");
  });

  it("returns null when no usable sections", () => {
    expect(extractChangelogSection("# Changelog\n\nNo sections.\n", "1.0.0")).toBeNull();
  });

  it("handles CRLF line endings", () => {
    const crlf = sample.replace(/\n/g, "\r\n");
    const body = extractChangelogSection(crlf, "1.2.0");
    expect(body).toContain("Bug fix");
  });
});

describe("buildReleaseNotes", () => {
  it("includes package header, install, and supply-chain links", () => {
    const notes = buildReleaseNotes({
      version: "0.12.1",
      packageName: "@vantanminh/harness",
      repoUrl: "https://github.com/vantanminh/harness",
      changelogText: `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Feature X\n`,
    });
    expect(notes).toContain("@vantanminh/harness v0.12.1");
    expect(notes).toContain("Feature X");
    expect(notes).toContain("npm i -g @vantanminh/harness@0.12.1");
    expect(notes).toContain("trusted publishing");
    expect(notes).toContain("provenance");
    expect(notes).toContain(
      "https://www.npmjs.com/package/@vantanminh/harness/v/0.12.1",
    );
  });

  it("uses fallback when changelog missing", () => {
    const notes = buildReleaseNotes({
      version: "1.0.0",
      changelogText: null,
    });
    expect(notes).toContain("Release **1.0.0**");
    expect(notes).toContain("CHANGELOG.md");
  });
});

describe("scripts/release-notes.mjs CLI", () => {
  it("writes notes for package version", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rn-cli-"));
    tempDirs.push(dir);
    const out = path.join(dir, "notes.md");
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts", "release-notes.mjs"), "0.12.1", "--out", out],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    const notes = fs.readFileSync(out, "utf8");
    expect(notes).toContain("@vantanminh/harness v0.12.1");
    expect(notes).toContain("npm i -g");
  });
});
