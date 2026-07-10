import path from "node:path";
import {
  defaultDbPath,
  importSqliteToMarkdown,
} from "../application/import-sqlite.js";
import { resolveDbPath, resolveTargetDir } from "../domain/paths.js";
import { resolvePackageRoot } from "../package-root.js";

export type ImportSqliteCliOptions = {
  dir?: string;
  directory?: string;
  db?: string;
  force?: boolean;
};

export function executeImportSqlite(
  positionalDir: string | undefined,
  options: ImportSqliteCliOptions = {},
): void {
  const directory = options.dir ?? options.directory ?? positionalDir;
  const targetDir = resolveTargetDir(directory);
  const dbPath = options.db
    ? path.isAbsolute(options.db)
      ? options.db
      : path.resolve(targetDir, options.db)
    : resolveDbPath(targetDir);
  const packageRoot = resolvePackageRoot();
  const migrationsDir = path.join(packageRoot, "migrations");

  const result = importSqliteToMarkdown({
    projectRoot: targetDir,
    dbPath,
    migrationsDir,
    force: Boolean(options.force),
  });

  console.log(`Imported from ${dbPath}`);
  console.log(`  stories:   ${result.stories}`);
  console.log(`  decisions: ${result.decisions}`);
  console.log(`  intakes:   ${result.intakes}`);
  console.log(`  backlog:   ${result.backlog}`);
  if (result.skipped > 0) {
    console.log(
      `  skipped:   ${result.skipped} (already exist; use --force to overwrite)`,
    );
  }
  console.log(`Project root: ${targetDir}`);
  void defaultDbPath;
}
