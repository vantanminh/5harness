import fs from "node:fs";
import path from "node:path";
import { projectBackupRoot } from "../domain/paths.js";
import {
  extractRepoVersion,
  readTemplateBlock,
  replaceHarnessBlock,
} from "../domain/upgrade.js";
import {
  extractProjectId,
  generateProjectId,
  insertProjectIdMarker,
} from "../domain/project-id.js";
import { preserveProjectLinkMarkers } from "../domain/project-link.js";

export type ReadAgentsResult = {
  /** Absolute path to AGENTS.md in the project. */
  path: string;
  /** Raw text content. */
  text: string;
  /** Extracted harness version, or null when missing. */
  version: string | null;
};

/**
 * Read the project's AGENTS.md and extract harness metadata.
 */
export function readProjectAgents(projectRoot: string): ReadAgentsResult {
  const p = path.join(projectRoot, "AGENTS.md");
  if (!fs.existsSync(p)) {
    throw new Error(
      `AGENTS.md not found in ${projectRoot}. Run \`harness init\` first.`,
    );
  }
  const text = fs.readFileSync(p, "utf8");
  const version = extractRepoVersion(text);
  return { path: p, text, version };
}

/**
 * Read the harness template AGENTS.md from the package templates directory.
 * Returns the full template text.
 */
export function readTemplateAgents(packageRoot: string): string {
  const p = path.join(packageRoot, "templates", "AGENTS.md");
  if (!fs.existsSync(p)) {
    throw new Error(`Template AGENTS.md not found at ${p}`);
  }
  return fs.readFileSync(p, "utf8");
}

/**
 * Apply the harness block upgrade to the project's AGENTS.md.
 *
 * Only the content between `<!-- HARNESS:BEGIN -->` and `<!-- HARNESS:END -->`
 * is replaced. Everything else (user-customized agent instructions) stays.
 *
 * A timestamped backup is written to `.5harness-backup/` before modification.
 *
 * Returns true when the file was modified, false when it was already up-to-date.
 */
export function applyHarnessBlockUpgrade(
  projectRoot: string,
  templateText: string,
): { modified: boolean; backupPath?: string } {
  const targetPath = path.join(projectRoot, "AGENTS.md");
  if (!fs.existsSync(targetPath)) {
    throw new Error(
      `AGENTS.md not found in ${projectRoot}. Run \`harness init\` first.`,
    );
  }

  const targetText = fs.readFileSync(targetPath, "utf8");
  const templateBlock = readTemplateBlock(templateText);
  if (!templateBlock) {
    throw new Error(
      "Template AGENTS.md is missing the HARNESS:BEGIN/END block.",
    );
  }

  const projectId = extractProjectId(targetText) ?? generateProjectId();
  const identityBlock = insertProjectIdMarker(templateBlock, projectId);
  const newBlock = preserveProjectLinkMarkers(identityBlock, targetText);

  const updated = replaceHarnessBlock(targetText, newBlock);
  if (updated === targetText) {
    return { modified: false };
  }

  // Backup before modifying
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = projectBackupRoot(projectRoot, stamp);
  const backupPath = path.join(backupRoot, "AGENTS.md");
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(targetPath, backupPath);

  // Atomic write via temp file + rename
  const tmp = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, updated, "utf8");
  fs.renameSync(tmp, targetPath);

  return { modified: true, backupPath };
}
