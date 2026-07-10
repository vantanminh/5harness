import { needsUpgrade } from "../domain/upgrade.js";
import {
  applyHarnessBlockUpgrade,
  readProjectAgents,
  readTemplateAgents,
} from "../infrastructure/upgrade.js";
import { VERSION } from "../version.js";

export type UpgradeCheckResult = {
  /** Current harness CLI version. */
  cliVersion: string;
  /** Version found in the repo's AGENTS.md, or null. */
  repoVersion: string | null;
  /** True when an upgrade is available (repo version < cli version). */
  available: boolean;
};

/**
 * Check whether the project at projectRoot has an older harness version
 * and could be upgraded.
 */
export function checkUpgradeAvailable(
  projectRoot: string,
  packageRoot: string,
): UpgradeCheckResult {
  const agents = readProjectAgents(projectRoot);
  const repoVersion = agents.version;
  const available = needsUpgrade(repoVersion, VERSION) !== null;
  return {
    cliVersion: VERSION,
    repoVersion,
    available,
  };
}

export type ApplyUpgradeResult = {
  modified: boolean;
  repoVersion: string | null;
  cliVersion: string;
  backupPath?: string;
};

/**
 * Apply a harness block upgrade to the project's AGENTS.md.
 *
 * Reads the template from packageRoot, compares with the project's AGENTS.md,
 * and replaces only the harness-managed block.
 */
export function applyUpgrade(
  projectRoot: string,
  packageRoot: string,
): ApplyUpgradeResult {
  const agents = readProjectAgents(projectRoot);
  const templateText = readTemplateAgents(packageRoot);
  const result = applyHarnessBlockUpgrade(projectRoot, templateText);
  return {
    modified: result.modified,
    repoVersion: agents.version,
    cliVersion: VERSION,
    backupPath: result.backupPath,
  };
}
