/**
 * GitHub Release notes from CHANGELOG.md (US-036).
 * Used by scripts/release-notes.mjs in CI after npm publish.
 */

/**
 * Extract a Keep-a-Changelog section body for `version`, else Unreleased.
 */
export function extractChangelogSection(
  changelog: string,
  version: string,
): string | null {
  const text = changelog.replace(/\r\n/g, "\n");
  const headingRe = /^##\s+\[([^\]]+)\][^\n]*/gm;
  const heads: { key: string; start: number; bodyStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text)) !== null) {
    heads.push({
      key: m[1].trim(),
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }
  const sections = new Map<string, string>();
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    const body = text.slice(heads[i].bodyStart, end).trim();
    sections.set(heads[i].key, body);
  }
  const exact = sections.get(version);
  if (exact && exact.length > 0) return exact;
  const unreleased = sections.get("Unreleased");
  if (unreleased && unreleased.length > 0) return unreleased;
  return null;
}

export interface BuildReleaseNotesOptions {
  version: string;
  packageName?: string;
  repoUrl?: string;
  /** Pre-loaded CHANGELOG text; if omitted, section is skipped. */
  changelogText?: string | null;
}

export function buildReleaseNotes(opts: BuildReleaseNotesOptions): string {
  const version = opts.version;
  const packageName = opts.packageName ?? "@vantanminh/harness";
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
