#!/usr/bin/env node
import { Command } from "commander";
import { executeInit } from "./commands/init.js";
import { executeMigrate } from "./commands/migrate.js";
import { VERSION } from "./version.js";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}

function main(argv: string[] = process.argv): void {
  const program = new Command();

  program
    .name("harness")
    .description(
      "npm-native agent-ready repository harness — init operating files and durable SQLite",
    )
    .version(VERSION, "-V, --version", "print CLI version");

  program
    .command("init")
    .description(
      "Scaffold Phase A operating files and create/migrate harness.db in a target directory",
    )
    .argument("[directory]", "target project directory (default: cwd)")
    .option("-d, --dir <path>", "target project directory")
    .option("--directory <path>", "alias for --dir")
    .option("-y, --yes", "non-interactive (reserved; init is non-interactive)")
    .option("--dry-run", "print planned operations without writing")
    .option(
      "--force",
      "overwrite conflicting files after timestamped backup under .harness-backup/",
    )
    .action((directory: string | undefined, opts) => {
      try {
        executeInit(directory, opts);
      } catch (error) {
        fail(error);
      }
    });

  program
    .command("migrate")
    .description("Apply pending SQL migrations to the harness database")
    .argument("[directory]", "target project directory (default: cwd)")
    .option("-d, --dir <path>", "target project directory")
    .option("--directory <path>", "alias for --dir")
    .action((directory: string | undefined, opts) => {
      try {
        executeMigrate(directory, opts);
      } catch (error) {
        fail(error);
      }
    });

  program.parse(argv);
}

main();

