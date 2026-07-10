import fs from "node:fs";
import path from "node:path";
import { extractRepoVersion, needsUpgrade } from "../domain/upgrade.js";

/**
 * Optionally print a one-line stderr notice when the project's AGENTS.md
 * harness version is older than the current CLI version.
 *
 * - Fail-open (never throws)
 * - Skipped when HARNESS_NO_UPGRADE_NOTICE=1 or CI=true
 * - Skipped when AGENTS.md doesn't exist or has no version marker
 * - Cached: only prints once per project per CLI session (via env)
 */
export function maybeNotifyRepoUpgrade(
  projectRoot: string,
  cliVersion: string,
): void {
  try {
    if (isDisabled()) return;
    if (alreadyNotified(projectRoot)) return;

    const agentsPath = path.join(projectRoot, "AGENTS.md");
    if (!fs.existsSync(agentsPath)) return;

    const text = fs.readFileSync(agentsPath, "utf8");
    const repoVersion = extractRepoVersion(text);
    if (!repoVersion) return;
    if (!needsUpgrade(repoVersion, cliVersion)) return;

    markNotified(projectRoot);
    console.error(
      `Notice: harness ${cliVersion} available (repo at ${repoVersion}). ` +
        `Run \`harness upgrade\` to update AGENTS.md.`,
    );
    console.error(
      `  (only the HARNESS:BEGIN/END section is modified — all other content is preserved)`,
    );
  } catch {
    // fail-open
  }
}

const NOTICE_KEY = "HARNESS_UPGRADE_NOTIFIED_";

function isDisabled(): boolean {
  if (
    process.env.HARNESS_NO_UPGRADE_NOTICE === "1" ||
    process.env.HARNESS_NO_UPGRADE_NOTICE === "true"
  ) {
    return true;
  }
  if (process.env.CI === "true" || process.env.CI === "1") return true;
  return false;
}

function alreadyNotified(projectRoot: string): boolean {
  const key = NOTICE_KEY + safeKey(projectRoot);
  return process.env[key] === "1";
}

function markNotified(projectRoot: string): void {
  const key = NOTICE_KEY + safeKey(projectRoot);
  process.env[key] = "1";
}

function safeKey(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, "_").slice(-80);
}
