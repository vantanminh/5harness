import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type MigrationFile = {
  version: number;
  name: string;
  fileName: string;
  sql: string;
};

export function listMigrations(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory missing: ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{3,}-.+\.sql$/i.test(f))
    .sort();

  return files.map((fileName) => {
    const match = fileName.match(/^(\d+)-(.+)\.sql$/i);
    if (!match) {
      throw new Error(`Invalid migration file name: ${fileName}`);
    }
    const version = Number(match[1]);
    const name = match[2];
    const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
    return { version, name, fileName, sql };
  });
}

function ensureMigrationsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function getAppliedVersions(db: DatabaseSync): Set<number> {
  ensureMigrationsTable(db);
  const rows = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number }>;
  return new Set(rows.map((r) => r.version));
}

export type MigrateResult = {
  dbPath: string;
  applied: Array<{ version: number; name: string }>;
  currentVersion: number;
  alreadyLatest: boolean;
};

export function openDatabase(dbPath: string): DatabaseSync {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function migrateDatabase(
  dbPath: string,
  migrationsDir: string,
): MigrateResult {
  const migrations = listMigrations(migrationsDir);
  const db = openDatabase(dbPath);
  try {
    ensureMigrationsTable(db);
    const applied = getAppliedVersions(db);
    const newly: Array<{ version: number; name: string }> = [];

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      db.exec("BEGIN");
      try {
        db.exec(migration.sql);
        db.prepare(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
        ).run(migration.version, migration.name);
        db.exec("COMMIT");
        newly.push({ version: migration.version, name: migration.name });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }

    const versions = getAppliedVersions(db);
    const currentVersion =
      versions.size === 0 ? 0 : Math.max(...Array.from(versions));

    return {
      dbPath,
      applied: newly,
      currentVersion,
      alreadyLatest: newly.length === 0,
    };
  } finally {
    db.close();
  }
}

export function schemaIsReadable(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) return false;
  const db = openDatabase(dbPath);
  try {
    ensureMigrationsTable(db);
    db.prepare("SELECT version FROM schema_migrations LIMIT 1").get();
    return true;
  } finally {
    db.close();
  }
}
