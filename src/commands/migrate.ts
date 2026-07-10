import fs from "node:fs";
import path from "node:path";
import { resolvePackageRoot } from "../package-root.js";
import { resolveDbPath, resolveTargetDir } from "../domain/paths.js";
import { migrateDatabase } from "../infrastructure/db.js";

export type MigrateCliOptions = {
  dir?: string;
  directory?: string;
};

/**
 * Legacy: project harness.db is no longer the durable SoT (US-013).
 * Still migrates an existing file for import-sqlite compatibility.
 */
export function executeMigrate(
  positionalDir: string | undefined,
  options: MigrateCliOptions,
): void {
  const directory = options.dir ?? options.directory ?? positionalDir;
  const targetDir = resolveTargetDir(directory);
  const dbPath = resolveDbPath(targetDir);

  console.log(
    "note: project SQLite is no longer the durable source of truth (markdown is).",
  );
  console.log(
    "      Prefer entity files under docs/; use `harness import-sqlite` to convert a legacy DB.",
  );

  if (!fs.existsSync(dbPath)) {
    console.log(`No harness.db at ${dbPath} — nothing to migrate.`);
    return;
  }

  const packageRoot = resolvePackageRoot();
  const migrationsDir = path.join(packageRoot, "migrations");
  const result = migrateDatabase(dbPath, migrationsDir);
  if (result.applied.length === 0) {
    console.log(
      `Legacy DB already at schema v${result.currentVersion} (${result.dbPath})`,
    );
    return;
  }
  for (const m of result.applied) {
    console.log(`Applied v${m.version} ${m.name}`);
  }
  console.log(
    `Migrated legacy ${result.dbPath} to schema v${result.currentVersion}`,
  );
}
