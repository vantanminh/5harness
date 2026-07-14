import readline from "node:readline";
import path from "node:path";
import { removeHarness, type RemoveOptions } from "../application/remove.js";

export type RemoveCliOptions = {
  dir?: string;
  directory?: string;
  force?: boolean;
  keepEntities?: boolean;
};

function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

function formatWarning(targetDir: string, keepEntities: boolean): string {
  return [
    "",
    "⚠ WARNING: This will completely remove 5harness from the project.",
    "",
    `  Project:    ${targetDir}`,
    "",
    "  Items that will be removed:",
    "  - Global registry entry (unlink)",
    "  - .5harness/       state directory (index, local, logs, locks)",
    "  - .5harness-backup/  backup directory",
    "  - harness.db        legacy database (+ WAL/SHM files)",
    "  - AGENTS.md         harness block stripped (user content preserved)",
    keepEntities
      ? "  - Entity directories will be KEPT (--keep-entities)"
      : "  - docs/stories/     entity directory",
    keepEntities ? "" : "  - docs/decisions/    entity directory",
    keepEntities ? "" : "  - docs/intakes/      entity directory",
    keepEntities ? "" : "  - docs/backlog/      entity directory",
    keepEntities ? "" : "  - docs/reports/      entity directory",
    "",
    "  This action is IRREVERSIBLE (except via Git history).",
    "",
    "Are you sure you want to continue? (y/N) ",
  ].join("\n");
}

export async function executeRemove(options: RemoveCliOptions): Promise<void> {
  const targetDir = path.resolve(options.dir ?? options.directory ?? process.cwd());

  if (!options.force) {
    console.log(formatWarning(targetDir, options.keepEntities ?? false));
    const answer = await confirm("");
    if (!answer) {
      console.log("Remove cancelled.");
      return;
    }
    console.log("");
  }

  const removeOptions: RemoveOptions = {
    dir: targetDir,
    force: options.force,
    keepEntities: options.keepEntities,
  };

  const result = removeHarness(removeOptions);

  console.log(`Harness removed from ${result.targetDir}`);
  console.log("");

  if (result.unlinked && result.unlinkName) {
    console.log(`  ✓ unlinked "${result.unlinkName}" from global registry`);
  }

  if (result.removed.length > 0) {
    console.log("  ✓ removed:");
    for (const item of result.removed) {
      console.log(`    - ${item}`);
    }
  }

  if (result.skipped.length > 0) {
    console.log("  - skipped (not found):");
    for (const item of result.skipped) {
      console.log(`    - ${item}`);
    }
  }

  if (result.errors.length > 0) {
    console.log("  ✗ errors:");
    for (const item of result.errors) {
      console.log(`    - ${item}`);
    }
  }

  console.log("");
  console.log("To re-initialize harness in this project, run: harness init");
}

/**
 * Alias for remove. Same behavior, different command name.
 */
export const executeRm = executeRemove;
