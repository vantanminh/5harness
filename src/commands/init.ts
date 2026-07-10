import { resolvePackageRoot } from "../package-root.js";
import { runInit } from "../infrastructure/scaffold.js";
import { maybeReindex } from "./_reindex-helper.js";

export type InitCliOptions = {
  dir?: string;
  directory?: string;
  force?: boolean;
  dryRun?: boolean;
  yes?: boolean;
};

export function executeInit(
  positionalDir: string | undefined,
  options: InitCliOptions,
): void {
  const directory = options.dir ?? options.directory ?? positionalDir;
  const result = runInit({
    directory,
    force: options.force,
    dryRun: options.dryRun,
    yes: options.yes,
    packageRoot: resolvePackageRoot(),
    log: (message) => console.log(message),
  });

  console.log("");
  if (result.dryRun) {
    console.log(`Dry run complete for ${result.targetDir}`);
  } else {
    console.log(`Harness initialized in ${result.targetDir}`);
    if (result.schemaVersion > 0) {
      console.log(
        `Database: ${result.dbPath} (schema v${result.schemaVersion}, legacy/transition)`,
      );
    }
    console.log(
      `Files created: ${result.created.length}, overwritten: ${result.overwritten.length}, skipped: ${result.skipped.length}`,
    );
    if (result.registered) {
      console.log(`Registered in global registry: ${result.registryPath}`);
    }
    console.log("Entity dirs: docs/stories|decisions|intakes|backlog");

    // Decision 0012: init auto-reindexes after scaffolding so queries work immediately
    maybeReindex(result.targetDir);
  }
}
