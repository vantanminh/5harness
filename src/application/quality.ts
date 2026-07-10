import type { DatabaseSync } from "node:sqlite";
import {
  computeEntropy,
  formatAudit,
  type AuditFinding,
  type AuditResult,
} from "../domain/audit.js";
import {
  formatScoreResult,
  scoreTrace,
  type TraceScoreResult,
} from "../domain/trace-score.js";
import { formatTable } from "../infrastructure/table.js";
import { runVerifyCommand } from "../infrastructure/verify.js";

const OUTCOMES = new Set(["completed", "blocked", "partial", "failed"]);

export function parseOutcome(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!OUTCOMES.has(v)) {
    throw new Error(
      `Invalid outcome "${raw}". Use completed | blocked | partial | failed`,
    );
  }
  return v;
}

export type StoryVerifyResult = {
  id: string;
  title: string;
  pass: boolean;
  skipped: boolean;
  reason?: string;
  command?: string;
  exitCode?: number;
};

export function verifyStory(
  db: DatabaseSync,
  storyId: string,
  cwd: string,
): StoryVerifyResult {
  const row = db
    .prepare(
      `SELECT id, title, verify_command FROM story WHERE id = ?`,
    )
    .get(storyId) as
    | { id: string; title: string; verify_command: string | null }
    | undefined;

  if (!row) {
    throw new Error(`Story ${storyId} not found`);
  }
  if (!row.verify_command?.trim()) {
    return {
      id: row.id,
      title: row.title,
      pass: true,
      skipped: true,
      reason: "no verify_command configured",
    };
  }

  const run = runVerifyCommand(row.verify_command, cwd);
  const result = run.pass ? "pass" : "fail";
  db.prepare(
    `UPDATE story
     SET last_verified_at = datetime('now'),
         last_verified_result = ?
     WHERE id = ?`,
  ).run(result, storyId);

  if (run.stdout.trim()) process.stdout.write(run.stdout);
  if (run.stderr.trim()) process.stderr.write(run.stderr);

  return {
    id: row.id,
    title: row.title,
    pass: run.pass,
    skipped: false,
    command: row.verify_command,
    exitCode: run.exitCode,
  };
}

export function verifyAllStories(
  db: DatabaseSync,
  cwd: string,
): StoryVerifyResult[] {
  const rows = db
    .prepare(
      `SELECT id FROM story
       WHERE verify_command IS NOT NULL AND trim(verify_command) != ''
       ORDER BY id`,
    )
    .all() as Array<{ id: string }>;

  return rows.map((r) => verifyStory(db, r.id, cwd));
}

export type DecisionVerifyResult = {
  id: string;
  title: string;
  pass: boolean;
  skipped: boolean;
  reason?: string;
};

export function verifyDecision(
  db: DatabaseSync,
  decisionId: string,
  cwd: string,
): DecisionVerifyResult {
  const row = db
    .prepare(
      `SELECT id, title, verify_command FROM decision WHERE id = ?`,
    )
    .get(decisionId) as
    | { id: string; title: string; verify_command: string | null }
    | undefined;

  if (!row) {
    throw new Error(`Decision ${decisionId} not found`);
  }
  if (!row.verify_command?.trim()) {
    return {
      id: row.id,
      title: row.title,
      pass: true,
      skipped: true,
      reason: "no verify_command configured",
    };
  }

  const run = runVerifyCommand(row.verify_command, cwd);
  const result = run.pass ? "pass" : "fail";
  db.prepare(
    `UPDATE decision
     SET last_verified_at = datetime('now'),
         last_verified_result = ?
     WHERE id = ?`,
  ).run(result, decisionId);

  if (run.stdout.trim()) process.stdout.write(run.stdout);
  if (run.stderr.trim()) process.stderr.write(run.stderr);

  return {
    id: row.id,
    title: row.title,
    pass: run.pass,
    skipped: false,
  };
}

export type TraceInput = {
  summary: string;
  outcome?: string;
  intake?: string;
  story?: string;
  agent?: string;
  duration?: string;
  actions?: string;
  read?: string;
  changed?: string;
  decisions?: string;
  errors?: string;
  friction?: string;
  notes?: string;
};

export function addTrace(
  db: DatabaseSync,
  input: TraceInput,
): { id: number } {
  if (!input.summary?.trim()) {
    throw new Error("trace requires --summary");
  }
  const outcome = input.outcome ? parseOutcome(input.outcome) : null;
  let intakeId: number | null = null;
  if (input.intake) {
    intakeId = Number(input.intake);
    if (!Number.isFinite(intakeId)) {
      throw new Error(`Invalid --intake "${input.intake}"`);
    }
  }
  let durationMs: number | null = null;
  if (input.duration) {
    durationMs = Number(input.duration);
    if (!Number.isFinite(durationMs)) {
      throw new Error(`Invalid --duration "${input.duration}"`);
    }
  }

  const result = db
    .prepare(
      `INSERT INTO trace (
         task_summary, intake_id, story_id, agent, actions_taken,
         files_read, files_changed, decisions_made, errors, outcome,
         duration_ms, notes, harness_friction
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.summary,
      intakeId,
      input.story ?? null,
      input.agent ?? null,
      input.actions ?? null,
      input.read ?? null,
      input.changed ?? null,
      input.decisions ?? null,
      input.errors ?? null,
      outcome,
      durationMs,
      input.notes ?? null,
      input.friction ?? null,
    );

  return { id: Number(result.lastInsertRowid) };
}

function loadTraceScoreSource(
  db: DatabaseSync,
  id: number,
): Parameters<typeof scoreTrace>[0] {
  const row = db
    .prepare(
      `SELECT t.id, t.task_summary, t.agent, t.actions_taken, t.files_read,
              t.files_changed, t.decisions_made, t.errors, t.outcome,
              t.duration_ms, t.harness_friction, t.notes, t.story_id,
              s.risk_lane
       FROM trace t
       LEFT JOIN story s ON s.id = t.story_id
       WHERE t.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        task_summary: string;
        agent: string | null;
        actions_taken: string | null;
        files_read: string | null;
        files_changed: string | null;
        decisions_made: string | null;
        errors: string | null;
        outcome: string | null;
        duration_ms: number | null;
        harness_friction: string | null;
        notes: string | null;
        risk_lane: string | null;
      }
    | undefined;

  if (!row) {
    throw new Error(`Trace #${id} not found`);
  }

  return {
    id: row.id,
    task_summary: row.task_summary,
    agent: row.agent,
    actions_taken: row.actions_taken,
    files_read: row.files_read,
    files_changed: row.files_changed,
    decisions_made: row.decisions_made,
    errors: row.errors,
    outcome: row.outcome,
    duration_ms: row.duration_ms,
    harness_friction: row.harness_friction,
    notes: row.notes,
    risk_lane: row.risk_lane,
  };
}

export function scoreTraceById(
  db: DatabaseSync,
  id?: number,
): TraceScoreResult {
  let traceId = id;
  if (traceId === undefined) {
    const latest = db
      .prepare(`SELECT id FROM trace ORDER BY id DESC LIMIT 1`)
      .get() as { id: number } | undefined;
    if (!latest) {
      throw new Error("No traces recorded yet");
    }
    traceId = latest.id;
  }
  return scoreTrace(loadTraceScoreSource(db, traceId));
}

export function formatTraceScore(result: TraceScoreResult): string {
  return formatScoreResult(result);
}

export function queryTraces(db: DatabaseSync): string {
  const rows = db
    .prepare(
      `SELECT id, created_at, outcome, task_summary, harness_friction, story_id
       FROM trace ORDER BY id DESC LIMIT 50`,
    )
    .all() as Array<{
    id: number;
    created_at: string;
    outcome: string | null;
    task_summary: string;
    harness_friction: string | null;
    story_id: string | null;
  }>;

  return formatTable(
    rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      outcome: r.outcome ?? "",
      story: r.story_id ?? "",
      summary: r.task_summary,
      friction: r.harness_friction ?? "",
    })),
    ["id", "created_at", "outcome", "story", "summary", "friction"],
  );
}

export function runAudit(db: DatabaseSync): AuditResult {
  const orphanedStories = db
    .prepare(
      `SELECT s.id, s.title
       FROM story s
       WHERE s.status IN ('planned', 'in_progress')
         AND NOT EXISTS (SELECT 1 FROM trace t WHERE t.story_id = s.id)
       ORDER BY s.id`,
    )
    .all() as Array<{ id: string; title: string }>;

  const unverifiedStories = db
    .prepare(
      `SELECT id, title FROM story
       WHERE verify_command IS NOT NULL AND trim(verify_command) != ''
         AND (last_verified_result IS NULL OR last_verified_result != 'pass')
       ORDER BY id`,
    )
    .all() as Array<{ id: string; title: string }>;

  const unverifiedDecisions = db
    .prepare(
      `SELECT id, title FROM decision
       WHERE verify_command IS NOT NULL AND trim(verify_command) != ''
         AND (last_verified_result IS NULL OR last_verified_result != 'pass')
       ORDER BY id`,
    )
    .all() as Array<{ id: string; title: string }>;

  const backlogWithoutOutcomes = db
    .prepare(
      `SELECT id, title FROM backlog
       WHERE status IN ('proposed', 'accepted')
         AND (actual_outcome IS NULL OR trim(actual_outcome) = '')
       ORDER BY id`,
    )
    .all() as Array<{ id: number; title: string }>;

  const base = {
    orphanedStories: orphanedStories.map(
      (r): AuditFinding => ({ id: r.id, title: r.title }),
    ),
    unverifiedStories: unverifiedStories.map(
      (r): AuditFinding => ({ id: r.id, title: r.title }),
    ),
    unverifiedDecisions: unverifiedDecisions.map(
      (r): AuditFinding => ({ id: r.id, title: r.title }),
    ),
    backlogWithoutOutcomes: backlogWithoutOutcomes.map(
      (r): AuditFinding => ({ id: String(r.id), title: r.title }),
    ),
  };

  return {
    ...base,
    entropyScore: computeEntropy(base),
  };
}

export function formatAuditResult(result: AuditResult): string {
  return formatAudit(result);
}
