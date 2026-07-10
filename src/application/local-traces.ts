import fs from "node:fs";
import path from "node:path";
import { formatTable } from "../infrastructure/table.js";

export type LocalTrace = {
  id: number;
  created_at: string;
  task_summary: string;
  outcome: string | null;
  intake_id: string | null;
  story_id: string | null;
  agent: string | null;
  actions_taken: string | null;
  files_read: string | null;
  files_changed: string | null;
  decisions_made: string | null;
  errors: string | null;
  duration_ms: number | null;
  notes: string | null;
  harness_friction: string | null;
  risk_lane?: string | null;
};

export function localTracesDir(projectRoot: string): string {
  return path.join(projectRoot, ".harness", "local");
}

export function localTracesPath(projectRoot: string): string {
  return path.join(localTracesDir(projectRoot), "traces.jsonl");
}

export function ensureLocalTracesDir(projectRoot: string): void {
  fs.mkdirSync(localTracesDir(projectRoot), { recursive: true });
}

export function listLocalTraces(projectRoot: string): LocalTrace[] {
  const file = localTracesPath(projectRoot);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const out: LocalTrace[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as LocalTrace);
    } catch {
      // skip corrupt lines
    }
  }
  return out;
}

export function nextTraceId(projectRoot: string): number {
  const traces = listLocalTraces(projectRoot);
  let max = 0;
  for (const t of traces) {
    if (typeof t.id === "number" && t.id > max) max = t.id;
  }
  return max + 1;
}

export function appendLocalTrace(
  projectRoot: string,
  trace: Omit<LocalTrace, "id" | "created_at"> & {
    id?: number;
    created_at?: string;
  },
): LocalTrace {
  ensureLocalTracesDir(projectRoot);
  const full: LocalTrace = {
    id: trace.id ?? nextTraceId(projectRoot),
    created_at: trace.created_at ?? new Date().toISOString(),
    task_summary: trace.task_summary,
    outcome: trace.outcome ?? null,
    intake_id: trace.intake_id ?? null,
    story_id: trace.story_id ?? null,
    agent: trace.agent ?? null,
    actions_taken: trace.actions_taken ?? null,
    files_read: trace.files_read ?? null,
    files_changed: trace.files_changed ?? null,
    decisions_made: trace.decisions_made ?? null,
    errors: trace.errors ?? null,
    duration_ms: trace.duration_ms ?? null,
    notes: trace.notes ?? null,
    harness_friction: trace.harness_friction ?? null,
    risk_lane: trace.risk_lane ?? null,
  };
  fs.appendFileSync(
    localTracesPath(projectRoot),
    `${JSON.stringify(full)}\n`,
    "utf8",
  );
  return full;
}

export function getLocalTrace(
  projectRoot: string,
  id: number,
): LocalTrace | null {
  return listLocalTraces(projectRoot).find((t) => t.id === id) ?? null;
}

export function queryTracesMd(projectRoot: string): string {
  const rows = [...listLocalTraces(projectRoot)]
    .sort((a, b) => b.id - a.id)
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      created_at: r.created_at,
      outcome: r.outcome ?? "",
      story: r.story_id ?? "",
      summary: r.task_summary,
      friction: r.harness_friction ?? "",
    }));
  return formatTable(rows, [
    "id",
    "created_at",
    "outcome",
    "story",
    "summary",
    "friction",
  ]);
}
