/**
 * Harness version tracking and upgrade domain logic.
 *
 * Version is stored as an HTML comment inside the `<!-- HARNESS:BEGIN -->` /
 * `<!-- HARNESS:END -->` block in AGENTS.md:
 *
 *   <!-- harness-version: 0.9.7 -->
 *
 * This way the version is Git-tracked, human-readable, and the harness can
 * detect when a repo was created with an older CLI version and offer to
 * upgrade only the managed block content.
 */

/** Regex to extract harness version from AGENTS.md content. */
const VERSION_RE = /<!--\s*harness-version:\s*([^\s-]+)\s*-->/;

/** Delimiter markers for the harness-managed section in AGENTS.md. */
export const HARNESS_BEGIN = "<!-- HARNESS:BEGIN -->";
export const HARNESS_END = "<!-- HARNESS:END -->";

/**
 * Extract the harness version from AGENTS.md text.
 * Returns null when the version marker is missing or unparseable.
 */
export function extractRepoVersion(agentsText: string): string | null {
  const m = VERSION_RE.exec(agentsText);
  if (!m?.[1]) return null;
  return m[1].trim();
}

/**
 * Compare two dotted semver-ish version strings.
 * Returns:
 *   - positive when a > b
 *   - negative when a < b
 *   - zero when equal
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function parseVersion(raw: string): number[] | null {
  const core = raw.trim().replace(/^v/i, "").split("-")[0] ?? "";
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split(".").map((p) => Number(p));
}

/**
 * Extract the harness-managed block from AGENTS.md text.
 * Returns `{ before, block, after }` — everything outside the block plus
 * the block content (between but not including the markers).
 * Returns null when markers are missing.
 */
export function extractHarnessBlock(agentsText: string): {
  before: string;
  block: string;
  after: string;
} | null {
  const beginIdx = agentsText.indexOf(HARNESS_BEGIN);
  // Use lastIndexOf so Upgrade prose that *mentions* the END marker cannot
  // truncate the managed block (US-032 regression).
  const endIdx = agentsText.lastIndexOf(HARNESS_END);
  if (beginIdx === -1 || endIdx === -1) return null;
  if (endIdx <= beginIdx) return null;

  const before = agentsText.slice(0, beginIdx);
  // Include the marker in the block for easier replacement
  const blockStart = beginIdx;
  const blockEnd = endIdx + HARNESS_END.length;
  const block = agentsText.slice(blockStart, blockEnd);
  const after = agentsText.slice(blockEnd);

  return { before, block, after };
}

/**
 * Read the harness block template from the package's templates/AGENTS.md.
 * Returns the block content (including markers) that should be inserted.
 */
export function readTemplateBlock(templateText: string): string | null {
  // The template AGENTS.md has its own HARNESS:BEGIN/END block.
  // Extract the block so we can replace it in target repos.
  const extracted = extractHarnessBlock(templateText);
  if (!extracted) return null;
  return extracted.block;
}

/**
 * Replace the harness block in target AGENTS.md content with the new block.
 * If no existing block is found, append the new block before EOF.
 */
export function replaceHarnessBlock(
  targetText: string,
  newBlock: string,
): string {
  const extracted = extractHarnessBlock(targetText);
  if (extracted) {
    return extracted.before + newBlock + extracted.after;
  }
  // No existing block — append at end
  const trimmed = targetText.trimEnd();
  return trimmed + "\n\n" + newBlock + "\n";
}

/**
 * Check if the repo needs a harness upgrade.
 * Returns the repo version when an upgrade is available, null otherwise.
 */
export function needsUpgrade(
  repoVersion: string | null,
  cliVersion: string,
): string | null {
  if (!repoVersion) return null;
  if (compareVersions(cliVersion, repoVersion) <= 0) return null;
  return repoVersion;
}
