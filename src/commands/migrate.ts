import path from "node:path";
import { resolvePackageRoot } from "../package-root.js";
import { resolveDbPath, resolveTargetDir } from "../domain/paths.js";
import { migrateDatabase } from "../infrastructure/db.js";

export type MigrateCliOptions = {
  dir?: string;
  directory?: string;
};

export function executeMigrate(
  positionalDir: string | undefined,
  options: MigrateCliOptions,
): void {
  const directory = options.dir ?? options.directory ?? positionalDir;
  const targetDir = resolveTargetDir(directory);
  const dbPath = resolveDbPath(targetDir);
  const packageRoot = resolvePackageRoot();
  const migrationsDir = path.join(packageRoot, "migrations");

  const result = migrateDatabase(dbPath, migrationsDir);
  if (result.applied.length === 0) {
    console.log(
      `Already up to date at schema v${result.currentVersion} (${result.dbPath})`,
    );
    return;
  }
  for (const m of result.applied) {
    console.log(`Applied v${m.version} ${m.name}`);
  }
  console.log(
    `Migrated ${result.dbPath} to schema v${result.currentVersion}`,
  );
}
