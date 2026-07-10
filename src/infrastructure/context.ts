import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveDbPath, resolveTargetDir } from "../domain/paths.js";
import { resolvePackageRoot } from "../package-root.js";
import { migrateDatabase, openDatabase } from "./db.js";

export type TargetOptions = {
  directory?: string;
  dir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  packageRoot?: string;
};

export function resolveTargetFromOptions(options: TargetOptions): {
  targetDir: string;
  dbPath: string;
  packageRoot: string;
} {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const directory = options.dir ?? options.directory;
  const targetDir = resolveTargetDir(directory, cwd);
  const dbPath = resolveDbPath(targetDir, env);
  const packageRoot = options.packageRoot ?? resolvePackageRoot();
  return { targetDir, dbPath, packageRoot };
}

/**
 * Open an existing harness DB. Auto-migrates pending SQL.
 * Throws if the database file does not exist.
 */
export function openExistingHarnessDb(options: TargetOptions): {
  db: DatabaseSync;
  dbPath: string;
  targetDir: string;
} {
  const { targetDir, dbPath, packageRoot } = resolveTargetFromOptions(options);
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `Harness database not found at ${dbPath}. Run \`harness init\` first (or \`harness migrate\` after creating the file).`,
    );
  }
  const migrationsDir = path.join(packageRoot, "migrations");
  migrateDatabase(dbPath, migrationsDir);
  const db = openDatabase(dbPath);
  return { db, dbPath, targetDir };
}

export function withHarnessDb<T>(
  options: TargetOptions,
  fn: (db: DatabaseSync, meta: { dbPath: string; targetDir: string }) => T,
): T {
  const { db, dbPath, targetDir } = openExistingHarnessDb(options);
  try {
    return fn(db, { dbPath, targetDir });
  } finally {
    db.close();
  }
}

/**
 * Open DB if present (for dual-write transition). Never throws for missing DB.
 */
export function withOptionalHarnessDb<T>(
  options: TargetOptions,
  fn: (
    db: DatabaseSync | null,
    meta: { dbPath: string; targetDir: string },
  ) => T,
): T {
  const { targetDir, dbPath, packageRoot } = resolveTargetFromOptions(options);
  if (!fs.existsSync(dbPath)) {
    return fn(null, { dbPath, targetDir });
  }
  const migrationsDir = path.join(packageRoot, "migrations");
  migrateDatabase(dbPath, migrationsDir);
  const db = openDatabase(dbPath);
  try {
    return fn(db, { dbPath, targetDir });
  } finally {
    db.close();
  }
}
