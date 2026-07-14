import fs from "node:fs";
import path from "node:path";
import { ENTITY_DIRS } from "../domain/entities.js";
import {
  PROJECT_STATE_DIRNAME,
  BACKUP_DIRNAME,
  SQLITE_DB_BASENAME,
  resolveTargetDir,
} from "../domain/paths.js";
import { removeHarnessBlock } from "../domain/upgrade.js";
import { unlinkProject } from "./registry.js";

export type RemoveOptions = {
  /** Project root directory */
  dir?: string;
  /** Skip confirmation prompt */
  force?: boolean;
  /** Keep all entity directories, including docs/reports. */
  keepEntities?: boolean;
  /** Custom harness home (for testing) */
  harnessHome?: string;
};

export type RemoveResult = {
  targetDir: string;
  unlinked: boolean;
  unlinkName?: string;
  removed: string[];
  skipped: string[];
  errors: string[];
};

function safeRemove(
  targetDir: string,
  target: string,
  removed: string[],
  errors: string[],
): void {
  const fullPath = path.join(targetDir, target);
  try {
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      removed.push(target);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`${target}: ${msg}`);
  }
}

export function removeHarness(options: RemoveOptions): RemoveResult {
  const targetDir = resolveTargetDir(options.dir);
  const removed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  // 1. Unlink from global registry
  let unlinked = false;
  let unlinkName: string | undefined;
  try {
    const result = unlinkProject(targetDir, { harnessHome: options.harnessHome });
    if (result.removed) {
      unlinked = true;
      unlinkName = result.removed.name;
      removed.push("global registry entry");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`registry: ${msg}`);
  }

  // 2. Remove .5harness/ state directory (index, local, logs, locks, etc.)
  safeRemove(targetDir, PROJECT_STATE_DIRNAME, removed, errors);

  // 3. Remove .5harness-backup/ backup directory
  safeRemove(targetDir, BACKUP_DIRNAME, removed, errors);

  // 4. Remove legacy harness.db and WAL/SHM files
  safeRemove(targetDir, SQLITE_DB_BASENAME, removed, errors);
  safeRemove(targetDir, `${SQLITE_DB_BASENAME}-wal`, removed, errors);
  safeRemove(targetDir, `${SQLITE_DB_BASENAME}-shm`, removed, errors);

  // 5. Strip HARNESS block from AGENTS.md
  const agentsPath = path.join(targetDir, "AGENTS.md");
  if (fs.existsSync(agentsPath)) {
    try {
      const content = fs.readFileSync(agentsPath, "utf8");
      const cleaned = removeHarnessBlock(content);
      if (cleaned !== content) {
        fs.writeFileSync(agentsPath, cleaned, "utf8");
        removed.push("AGENTS.md (harness block stripped)");
      } else {
        skipped.push("AGENTS.md (no harness block found)");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`AGENTS.md: ${msg}`);
    }
  }

  // 6. Optionally remove entity directories
  if (!options.keepEntities) {
    const entityDirs = [...new Set(Object.values(ENTITY_DIRS))];
    for (const entityDir of entityDirs) {
      safeRemove(targetDir, entityDir, removed, errors);
    }
    // Clean up docs/templates if it only contained harness templates
    safeRemove(targetDir, "docs/templates", removed, errors);
    // Clean up docs/product if empty after removal
    safeRemove(targetDir, "docs/product", removed, errors);
    // Clean up docs if it's now empty
    try {
      const docsDir = path.join(targetDir, "docs");
      if (fs.existsSync(docsDir)) {
        const contents = fs.readdirSync(docsDir);
        if (contents.length === 0) {
          fs.rmdirSync(docsDir);
          removed.push("docs/ (empty after removal)");
        }
      }
    } catch {
      // non-fatal
    }
  }

  return { targetDir, unlinked, unlinkName, removed, skipped, errors };
}
