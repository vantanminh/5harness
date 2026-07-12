/**
 * Keep a Changelog hygiene helpers (US-038).
 * Promote [Unreleased] into a dated version section on release.
 */

const UNRELEASED_HEADING = /^##\s+\[Unreleased\][^\n]*/m;
const VERSION_HEADING = /^##\s+\[([^\]]+)\][^\n]*/gm;

export type PromoteUnreleasedResult = {
  text: string;
  /** True when Unreleased body was moved into a new version section. */
  promoted: boolean;
  /** Body that was promoted (trimmed), or null if nothing to promote. */
  body: string | null;
  /** True when a section for `version` already existed (no change). */
  alreadyVersioned: boolean;
};

/**
 * Extract Keep-a-Changelog section bodies keyed by heading label
 * (e.g. "Unreleased", "1.2.3").
 */
export function parseChangelogSections(
  changelog: string,
): Map<string, { body: string; headingStart: number; bodyStart: number; end: number }> {
  const text = changelog.replace(/\r\n/g, "\n");
  const heads: { key: string; start: number; bodyStart: number }[] = [];
  const re = new RegExp(VERSION_HEADING.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    heads.push({
      key: m[1].trim(),
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }
  const sections = new Map<
    string,
    { body: string; headingStart: number; bodyStart: number; end: number }
  >();
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    const body = text.slice(heads[i].bodyStart, end).replace(/^\n+/, "").replace(/\n+$/, "");
    sections.set(heads[i].key, {
      body,
      headingStart: heads[i].start,
      bodyStart: heads[i].bodyStart,
      end,
    });
  }
  return sections;
}

/** True when Unreleased is missing or has no meaningful body. */
export function isUnreleasedEmpty(changelog: string): boolean {
  const sections = parseChangelogSections(changelog);
  const u = sections.get("Unreleased");
  if (!u) return true;
  return u.body.trim().length === 0;
}

/**
 * Move `## [Unreleased]` body under `## [version] - date` and leave an
 * empty Unreleased section at the top (Keep a Changelog release cut).
 *
 * No-op (returns original text) when:
 * - version section already exists
 * - Unreleased is missing or empty
 */
export function promoteUnreleased(
  changelog: string,
  version: string,
  date: string,
): PromoteUnreleasedResult {
  const text = changelog.replace(/\r\n/g, "\n");
  const sections = parseChangelogSections(text);

  if (sections.has(version)) {
    return {
      text: changelog,
      promoted: false,
      body: null,
      alreadyVersioned: true,
    };
  }

  const unreleased = sections.get("Unreleased");
  if (!unreleased || unreleased.body.trim().length === 0) {
    return {
      text: changelog,
      promoted: false,
      body: null,
      alreadyVersioned: false,
    };
  }

  const body = unreleased.body.trim();
  const emptyUnreleased = "## [Unreleased]\n\n";
  const versionHeading = `## [${version}] - ${date}\n\n`;
  const versionBlock = `${versionHeading}${body}\n\n`;

  // Replace from Unreleased heading through its body with empty Unreleased + version section.
  const before = text.slice(0, unreleased.headingStart);
  const after = text.slice(unreleased.end).replace(/^\n+/, "");
  const next = `${before}${emptyUnreleased}${versionBlock}${after}`.replace(/\n{3,}/g, "\n\n");

  return {
    text: next.endsWith("\n") ? next : `${next}\n`,
    promoted: true,
    body,
    alreadyVersioned: false,
  };
}

/**
 * Format export-changelog entries as a Keep-a-Changelog-friendly bullet list
 * (assist only — does not replace human CHANGELOG judgment).
 */
export function formatExportAssistSection(
  entries: { id: string; title: string; type: string }[],
  heading = "### From harness history (assist)",
): string {
  if (entries.length === 0) return "";
  const lines = [heading, ""];
  for (const e of entries) {
    const label = e.type === "decision" ? "Decision" : "Story";
    lines.push(`- [${label}] ${e.id}: ${e.title}`);
  }
  lines.push("");
  return lines.join("\n");
}
