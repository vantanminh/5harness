/**
 * GitHub Release notes from CHANGELOG.md (US-036 / US-038).
 * Used by scripts/release-notes.mjs in CI after npm publish.
 */

import {
  formatExportAssistSection,
  parseChangelogSections,
} from "./changelog-hygiene.js";

/**
 * Extract a Keep-a-Changelog section body for `version`, else Unreleased.
 */
export function extractChangelogSection(
  changelog: string,
  version: string,
): string | null {
  const sections = parseChangelogSections(changelog);
  const exact = sections.get(version)?.body?.trim();
  if (exact && exact.length > 0) return exact;
  const unreleased = sections.get("Unreleased")?.body?.trim();
  if (unreleased && unreleased.length > 0) return unreleased;
  return null;
}

export interface ExportAssistEntry {
  id: string;
  title: string;
  type: string;
}

export interface BuildReleaseNotesOptions {
  version: string;
  packageName?: string;
  repoUrl?: string;
  /** Pre-loaded CHANGELOG text; if omitted, section is skipped. */
  changelogText?: string | null;
  /**
   * Optional durable-history assist from `harness export changelog`
   * (US-028 / US-038). Appended after the human CHANGELOG section.
   */
  exportEntries?: ExportAssistEntry[] | null;
}

export function buildReleaseNotes(opts: BuildReleaseNotesOptions): string {
  const version = opts.version;
  const packageName = opts.packageName ?? "5harness";
  const repoUrl = opts.repoUrl ?? "https://github.com/vantanminh/harness";

  let section: string | null = null;
  if (opts.changelogText) {
    section = extractChangelogSection(opts.changelogText, version);
  }

  const lines: string[] = [`## ${packageName} v${version}`, ""];

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

  if (opts.exportEntries && opts.exportEntries.length > 0) {
    lines.push(
      formatExportAssistSection(opts.exportEntries).trimEnd(),
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
