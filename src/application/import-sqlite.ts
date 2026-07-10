import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { entityRelativePath } from "../domain/entities.js";
import type { FrontmatterData } from "../domain/frontmatter.js";
import { openDatabase, migrateDatabase } from "../infrastructure/db.js";
import {
  ensureEntityDirs,
  readEntityById,
  writeEntityFile,
} from "../infrastructure/entities.js";

export type ImportSqliteOptions = {
  projectRoot: string;
  dbPath: string;
  migrationsDir: string;
  force?: boolean;
};

export type ImportSqliteResult = {
  stories: number;
  decisions: number;
  intakes: number;
  backlog: number;
  skipped: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function importSqliteToMarkdown(
  options: ImportSqliteOptions,
): ImportSqliteResult {
  if (!fs.existsSync(options.dbPath)) {
    throw new Error(`SQLite database not found: ${options.dbPath}`);
  }
  migrateDatabase(options.dbPath, options.migrationsDir);
  const db = openDatabase(options.dbPath);
  try {
    return importFromOpenDb(db, options.projectRoot, Boolean(options.force));
  } finally {
    db.close();
  }
}

function importFromOpenDb(
  db: DatabaseSync,
  projectRoot: string,
  force: boolean,
): ImportSqliteResult {
  ensureEntityDirs(projectRoot);
  let stories = 0;
  let decisions = 0;
  let intakes = 0;
  let backlog = 0;
  let skipped = 0;

  const storyRows = db
    .prepare(
      `SELECT id, title, status, risk_lane, unit_proof, integration_proof,
              e2e_proof, platform_proof, contract_doc, verify_command,
              evidence, notes, last_verified_at, last_verified_result
       FROM story ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;

  for (const row of storyRows) {
    const id = String(row.id);
    if (readEntityById(projectRoot, "story", id) && !force) {
      skipped += 1;
      continue;
    }
    const data: FrontmatterData = {
      id,
      type: "story",
      title: String(row.title ?? id),
      status: String(row.status ?? "planned"),
      lane: String(row.risk_lane ?? "normal"),
      unit: row.unit_proof ? 1 : 0,
      integration: row.integration_proof ? 1 : 0,
      e2e: row.e2e_proof ? 1 : 0,
      platform: row.platform_proof ? 1 : 0,
      contract: (row.contract_doc as string | null) ?? null,
      verify: (row.verify_command as string | null) ?? null,
      evidence: (row.evidence as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      last_verified_at: (row.last_verified_at as string | null) ?? null,
      last_verified_result: (row.last_verified_result as string | null) ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    writeEntityFile(
      projectRoot,
      entityRelativePath("story", id),
      data,
      `# ${data.title}\n\n`,
    );
    stories += 1;
  }

  const decisionRows = db
    .prepare(
      `SELECT id, title, status, doc_path, verify_command, notes,
              last_verified_at, last_verified_result
       FROM decision ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;

  for (const row of decisionRows) {
    const id = String(row.id);
    if (readEntityById(projectRoot, "decision", id) && !force) {
      skipped += 1;
      continue;
    }
    const rel =
      (row.doc_path as string | null)?.replace(/\\/g, "/") ||
      entityRelativePath("decision", id);
    const data: FrontmatterData = {
      id,
      type: "decision",
      title: String(row.title ?? id),
      status: String(row.status ?? "accepted"),
      doc: rel,
      verify: (row.verify_command as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      last_verified_at: (row.last_verified_at as string | null) ?? null,
      last_verified_result: (row.last_verified_result as string | null) ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    writeEntityFile(projectRoot, rel, data, `# ${data.title}\n\n`);
    decisions += 1;
  }

  const intakeRows = db
    .prepare(
      `SELECT id, input_type, summary, risk_lane, risk_flags, affected_docs,
              story_id, notes, created_at
       FROM intake ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;

  for (const row of intakeRows) {
    const num = Number(row.id);
    const id = `IN-${String(num).padStart(3, "0")}`;
    if (readEntityById(projectRoot, "intake", id) && !force) {
      skipped += 1;
      continue;
    }
    const data: FrontmatterData = {
      id,
      type: "intake",
      input_type: String(row.input_type ?? "maintenance"),
      summary: String(row.summary ?? ""),
      lane: String(row.risk_lane ?? "normal"),
      flags: (row.risk_flags as string | null) ?? null,
      docs: (row.affected_docs as string | null) ?? null,
      story: (row.story_id as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      sqlite_id: num,
      created_at: String(row.created_at ?? nowIso()),
      updated_at: nowIso(),
    };
    writeEntityFile(
      projectRoot,
      entityRelativePath("intake", id),
      data,
      `# Intake ${id}\n\n${data.summary}\n`,
    );
    intakes += 1;
  }

  const backlogRows = db
    .prepare(
      `SELECT id, title, risk, status, discovered_while, current_pain,
              suggested_improvement, predicted_impact, actual_outcome, notes
       FROM backlog ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;

  for (const row of backlogRows) {
    const num = Number(row.id);
    const id = `BL-${String(num).padStart(3, "0")}`;
    if (readEntityById(projectRoot, "backlog", id) && !force) {
      skipped += 1;
      continue;
    }
    const data: FrontmatterData = {
      id,
      type: "backlog",
      title: String(row.title ?? id),
      status: String(row.status ?? "proposed"),
      risk: (row.risk as string | null) ?? null,
      discovered_while: (row.discovered_while as string | null) ?? null,
      pain: (row.current_pain as string | null) ?? null,
      suggestion: (row.suggested_improvement as string | null) ?? null,
      predicted: (row.predicted_impact as string | null) ?? null,
      outcome: (row.actual_outcome as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      sqlite_id: num,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    writeEntityFile(
      projectRoot,
      entityRelativePath("backlog", id),
      data,
      `# ${data.title}\n\n`,
    );
    backlog += 1;
  }

  return { stories, decisions, intakes, backlog, skipped };
}

export function defaultDbPath(projectRoot: string): string {
  return path.join(projectRoot, "harness.db");
}
