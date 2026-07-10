import type { DatabaseSync } from "node:sqlite";
import {
  laneDisplay,
  parseBacklogStatus,
  parseDecisionStatus,
  parseInputType,
  parseProofFlag,
  parseRiskLane,
  parseStoryStatus,
  proofDisplay,
  type BacklogStatus,
  type DecisionStatus,
  type InputType,
  type RiskLane,
  type StoryStatus,
} from "../domain/enums.js";
import { formatTable } from "../infrastructure/table.js";

export type IntakeInput = {
  type: string;
  summary: string;
  lane: string;
  flags?: string;
  docs?: string;
  story?: string;
  notes?: string;
};

export function addIntake(
  db: DatabaseSync,
  input: IntakeInput,
): { id: number } {
  const inputType = parseInputType(input.type);
  const lane = parseRiskLane(input.lane);
  const result = db
    .prepare(
      `INSERT INTO intake (input_type, summary, risk_lane, risk_flags, affected_docs, story_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      inputType,
      input.summary,
      lane,
      input.flags ?? null,
      input.docs ?? null,
      input.story ?? null,
      input.notes ?? null,
    );
  return { id: Number(result.lastInsertRowid) };
}

export type StoryAddInput = {
  id: string;
  title: string;
  lane: string;
  contract?: string;
  verify?: string;
  notes?: string;
};

export function addStory(db: DatabaseSync, input: StoryAddInput): void {
  const lane = parseRiskLane(input.lane);
  const existing = db
    .prepare("SELECT id FROM story WHERE id = ?")
    .get(input.id) as { id: string } | undefined;
  if (existing) {
    throw new Error(`Story ${input.id} already exists. Use story update.`);
  }
  db.prepare(
    `INSERT INTO story (id, title, risk_lane, contract_doc, verify_command, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.title,
    lane,
    input.contract ?? null,
    input.verify ?? null,
    input.notes ?? null,
  );
}

export type StoryUpdateInput = {
  id: string;
  status?: string;
  evidence?: string;
  unit?: string;
  integration?: string;
  e2e?: string;
  platform?: string;
  verify?: string;
  title?: string;
  notes?: string;
  contract?: string;
};

export function updateStory(db: DatabaseSync, input: StoryUpdateInput): void {
  const row = db
    .prepare("SELECT id FROM story WHERE id = ?")
    .get(input.id) as { id: string } | undefined;
  if (!row) {
    throw new Error(`Story ${input.id} not found`);
  }

  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  if (input.status !== undefined) {
    sets.push("status = ?");
    values.push(parseStoryStatus(input.status));
  }
  if (input.evidence !== undefined) {
    sets.push("evidence = ?");
    values.push(input.evidence);
  }
  if (input.unit !== undefined) {
    sets.push("unit_proof = ?");
    values.push(parseProofFlag(input.unit, "unit"));
  }
  if (input.integration !== undefined) {
    sets.push("integration_proof = ?");
    values.push(parseProofFlag(input.integration, "integration"));
  }
  if (input.e2e !== undefined) {
    sets.push("e2e_proof = ?");
    values.push(parseProofFlag(input.e2e, "e2e"));
  }
  if (input.platform !== undefined) {
    sets.push("platform_proof = ?");
    values.push(parseProofFlag(input.platform, "platform"));
  }
  if (input.verify !== undefined) {
    sets.push("verify_command = ?");
    values.push(input.verify);
  }
  if (input.title !== undefined) {
    sets.push("title = ?");
    values.push(input.title);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    values.push(input.notes);
  }
  if (input.contract !== undefined) {
    sets.push("contract_doc = ?");
    values.push(input.contract);
  }

  if (sets.length === 0) {
    throw new Error("story update requires at least one field to change");
  }

  values.push(input.id);
  db.prepare(`UPDATE story SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export type DecisionAddInput = {
  id: string;
  title: string;
  status?: string;
  doc?: string;
  verify?: string;
  notes?: string;
};

export function addDecision(db: DatabaseSync, input: DecisionAddInput): void {
  const status: DecisionStatus = input.status
    ? parseDecisionStatus(input.status)
    : "accepted";
  const existing = db
    .prepare("SELECT id FROM decision WHERE id = ?")
    .get(input.id) as { id: string } | undefined;
  if (existing) {
    throw new Error(`Decision ${input.id} already exists`);
  }
  db.prepare(
    `INSERT INTO decision (id, title, status, doc_path, verify_command, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.title,
    status,
    input.doc ?? null,
    input.verify ?? null,
    input.notes ?? null,
  );
}

export type BacklogAddInput = {
  title: string;
  while?: string;
  pain?: string;
  suggestion?: string;
  risk?: string;
  predicted?: string;
  notes?: string;
};

export function addBacklog(
  db: DatabaseSync,
  input: BacklogAddInput,
): { id: number } {
  const risk: RiskLane | null = input.risk ? parseRiskLane(input.risk) : null;
  const result = db
    .prepare(
      `INSERT INTO backlog (
         title, discovered_while, current_pain, suggested_improvement,
         risk, predicted_impact, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.while ?? null,
      input.pain ?? null,
      input.suggestion ?? null,
      risk,
      input.predicted ?? null,
      input.notes ?? null,
    );
  return { id: Number(result.lastInsertRowid) };
}

export type BacklogCloseInput = {
  id: string;
  status?: string;
  outcome?: string;
};

export function closeBacklog(db: DatabaseSync, input: BacklogCloseInput): void {
  const id = Number(input.id);
  if (!Number.isFinite(id)) {
    throw new Error(`Invalid backlog id "${input.id}"`);
  }
  const row = db.prepare("SELECT id FROM backlog WHERE id = ?").get(id) as
    | { id: number }
    | undefined;
  if (!row) {
    throw new Error(`Backlog item ${input.id} not found`);
  }
  const status: BacklogStatus = input.status
    ? parseBacklogStatus(input.status)
    : "implemented";
  if (status !== "implemented" && status !== "rejected") {
    throw new Error(
      `backlog close status must be implemented or rejected (got ${status})`,
    );
  }
  db.prepare(
    `UPDATE backlog SET status = ?, actual_outcome = ? WHERE id = ?`,
  ).run(status, input.outcome ?? null, id);
}

type StoryRow = {
  id: string;
  title: string;
  status: string;
  risk_lane: string;
  unit_proof: number;
  integration_proof: number;
  e2e_proof: number;
  platform_proof: number;
  evidence: string | null;
  contract_doc: string | null;
};

export function queryMatrix(db: DatabaseSync, numeric = false): string {
  const rows = db
    .prepare(
      `SELECT id, title, status, unit_proof, integration_proof, e2e_proof,
              platform_proof, evidence
       FROM story ORDER BY id`,
    )
    .all() as StoryRow[];

  return formatTable(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      unit: proofDisplay(r.unit_proof, numeric),
      integ: proofDisplay(r.integration_proof, numeric),
      e2e: proofDisplay(r.e2e_proof, numeric),
      plat: proofDisplay(r.platform_proof, numeric),
      evidence: r.evidence ?? "",
    })),
    ["id", "title", "status", "unit", "integ", "e2e", "plat", "evidence"],
  );
}

export function queryStories(db: DatabaseSync): string {
  const rows = db
    .prepare(
      `SELECT id, title, status, risk_lane, contract_doc
       FROM story ORDER BY id`,
    )
    .all() as StoryRow[];

  return formatTable(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      lane: laneDisplay(r.risk_lane),
      contract: r.contract_doc ?? "",
    })),
    ["id", "title", "status", "lane", "contract"],
  );
}

export function queryStats(db: DatabaseSync): string {
  const count = (table: string) => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    };
    return row.n;
  };
  const lines = [
    "=== Harness Stats ===",
    formatTable(
      [
        {
          intakes: count("intake"),
          stories: count("story"),
          decisions: count("decision"),
          backlog_items: count("backlog"),
          traces: count("trace"),
        },
      ],
      ["intakes", "stories", "decisions", "backlog_items", "traces"],
    ),
  ];
  return lines.join("\n");
}

export function queryIntakes(db: DatabaseSync): string {
  const rows = db
    .prepare(
      `SELECT id, created_at, input_type, risk_lane, summary
       FROM intake ORDER BY id DESC LIMIT 50`,
    )
    .all() as Array<{
    id: number;
    created_at: string;
    input_type: string;
    risk_lane: string;
    summary: string;
  }>;

  return formatTable(
    rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      input_type: r.input_type,
      risk_lane: laneDisplay(r.risk_lane),
      summary: r.summary,
    })),
    ["id", "created_at", "input_type", "risk_lane", "summary"],
  );
}

export function queryDecisions(db: DatabaseSync): string {
  const rows = db
    .prepare(
      `SELECT id, title, status, doc_path, last_verified_at, last_verified_result
       FROM decision ORDER BY id`,
    )
    .all() as Array<{
    id: string;
    title: string;
    status: string;
    doc_path: string | null;
    last_verified_at: string | null;
    last_verified_result: string | null;
  }>;

  return formatTable(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      doc: r.doc_path ?? "",
      last_verified_at: r.last_verified_at ?? "",
      last_verified_result: r.last_verified_result ?? "",
    })),
    [
      "id",
      "title",
      "status",
      "doc",
      "last_verified_at",
      "last_verified_result",
    ],
  );
}

export function queryBacklog(
  db: DatabaseSync,
  filter: "all" | "open" | "closed" = "all",
): string {
  let sql = `SELECT id, title, risk, status, predicted_impact, actual_outcome
             FROM backlog`;
  if (filter === "open") {
    sql += ` WHERE status IN ('proposed','accepted')`;
  } else if (filter === "closed") {
    sql += ` WHERE status IN ('implemented','rejected')`;
  }
  sql += ` ORDER BY id DESC`;

  const rows = db.prepare(sql).all() as Array<{
    id: number;
    title: string;
    risk: string | null;
    status: string;
    predicted_impact: string | null;
    actual_outcome: string | null;
  }>;

  return formatTable(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      risk: r.risk ? laneDisplay(r.risk) : "",
      status: r.status,
      predicted: r.predicted_impact ?? "",
      outcome: r.actual_outcome ?? "",
    })),
    ["id", "title", "risk", "status", "predicted", "outcome"],
  );
}

// re-export types used by CLI for convenience
export type { InputType, RiskLane, StoryStatus };
