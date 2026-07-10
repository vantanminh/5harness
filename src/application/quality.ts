import {
  computeEntropy,
  formatAudit,
  type AuditFinding,
  type AuditResult,
} from "../domain/audit.js";
import { asString } from "../domain/frontmatter.js";
import {
  formatScoreResult,
  scoreTrace,
  type TraceScoreResult,
} from "../domain/trace-score.js";
import {
  listEntityFiles,
  readEntityById,
  writeEntityFile,
} from "../infrastructure/entities.js";
import { runVerifyCommand } from "../infrastructure/verify.js";
import { buildCatalog } from "./catalog.js";
import {
  appendLocalTrace,
  getLocalTrace,
  listLocalTraces,
  queryTracesMd,
  type LocalTrace,
} from "./local-traces.js";
import { buildProjectIndex, linksFor } from "./index-store.js";

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
  projectRoot: string,
  storyId: string,
): StoryVerifyResult {
  const file = readEntityById(projectRoot, "story", storyId);
  if (!file) {
    throw new Error(`Story ${storyId} not found`);
  }
  const title = asString(file.data, "title") ?? storyId;
  const verify = asString(file.data, "verify");
  if (!verify?.trim()) {
    return {
      id: storyId,
      title,
      pass: true,
      skipped: true,
      reason: "no verify_command configured",
    };
  }

  const run = runVerifyCommand(verify, projectRoot);
  const result = run.pass ? "pass" : "fail";
  const data = {
    ...file.data,
    last_verified_at: new Date().toISOString(),
    last_verified_result: result,
    updated_at: new Date().toISOString(),
  };
  writeEntityFile(projectRoot, file.relativePath, data, file.body);

  if (run.stdout.trim()) process.stdout.write(run.stdout);
  if (run.stderr.trim()) process.stderr.write(run.stderr);

  return {
    id: storyId,
    title,
    pass: run.pass,
    skipped: false,
    command: verify,
    exitCode: run.exitCode,
  };
}

export function verifyAllStories(projectRoot: string): StoryVerifyResult[] {
  const files = listEntityFiles(projectRoot, "story");
  const withCmd = files.filter((f) => {
    const v = asString(f.data, "verify");
    return Boolean(v?.trim());
  });
  return withCmd.map((f) =>
    verifyStory(projectRoot, asString(f.data, "id") ?? f.relativePath),
  );
}

export type DecisionVerifyResult = {
  id: string;
  title: string;
  pass: boolean;
  skipped: boolean;
  reason?: string;
};

export function verifyDecision(
  projectRoot: string,
  decisionId: string,
): DecisionVerifyResult {
  const file = readEntityById(projectRoot, "decision", decisionId);
  if (!file) {
    throw new Error(`Decision ${decisionId} not found`);
  }
  const title = asString(file.data, "title") ?? decisionId;
  const verify = asString(file.data, "verify");
  if (!verify?.trim()) {
    return {
      id: decisionId,
      title,
      pass: true,
      skipped: true,
      reason: "no verify_command configured",
    };
  }

  const run = runVerifyCommand(verify, projectRoot);
  const result = run.pass ? "pass" : "fail";
  const data = {
    ...file.data,
    last_verified_at: new Date().toISOString(),
    last_verified_result: result,
    updated_at: new Date().toISOString(),
  };
  writeEntityFile(projectRoot, file.relativePath, data, file.body);

  if (run.stdout.trim()) process.stdout.write(run.stdout);
  if (run.stderr.trim()) process.stderr.write(run.stderr);

  return {
    id: decisionId,
    title,
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
  projectRoot: string,
  input: TraceInput,
): { id: number; trace: LocalTrace } {
  if (!input.summary?.trim()) {
    throw new Error("trace requires --summary");
  }
  const outcome = input.outcome ? parseOutcome(input.outcome) : null;
  let durationMs: number | null = null;
  if (input.duration) {
    durationMs = Number(input.duration);
    if (!Number.isFinite(durationMs)) {
      throw new Error(`Invalid --duration "${input.duration}"`);
    }
  }

  let risk_lane: string | null = null;
  if (input.story) {
    const story = readEntityById(projectRoot, "story", input.story);
    risk_lane = story ? (asString(story.data, "lane") ?? null) : null;
  }

  const trace = appendLocalTrace(projectRoot, {
    task_summary: input.summary,
    outcome,
    intake_id: input.intake ?? null,
    story_id: input.story ?? null,
    agent: input.agent ?? null,
    actions_taken: input.actions ?? null,
    files_read: input.read ?? null,
    files_changed: input.changed ?? null,
    decisions_made: input.decisions ?? null,
    errors: input.errors ?? null,
    duration_ms: durationMs,
    notes: input.notes ?? null,
    harness_friction: input.friction ?? null,
    risk_lane,
  });
  return { id: trace.id, trace };
}

function loadTraceScoreSource(
  projectRoot: string,
  id: number,
): Parameters<typeof scoreTrace>[0] {
  const row = getLocalTrace(projectRoot, id);
  if (!row) {
    throw new Error(`Trace #${id} not found`);
  }
  let risk_lane = row.risk_lane ?? null;
  if (!risk_lane && row.story_id) {
    const story = readEntityById(projectRoot, "story", row.story_id);
    risk_lane = story ? (asString(story.data, "lane") ?? null) : null;
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
    risk_lane,
  };
}

export function scoreTraceById(
  projectRoot: string,
  id?: number,
): TraceScoreResult {
  let traceId = id;
  if (traceId === undefined) {
    const traces = listLocalTraces(projectRoot);
    if (traces.length === 0) {
      throw new Error("No traces recorded yet");
    }
    traceId = Math.max(...traces.map((t) => t.id));
  }
  return scoreTrace(loadTraceScoreSource(projectRoot, traceId));
}

export function formatTraceScore(result: TraceScoreResult): string {
  return formatScoreResult(result);
}

export function queryTraces(projectRoot: string): string {
  return queryTracesMd(projectRoot);
}

export function runAudit(projectRoot: string): AuditResult {
  const catalog = buildCatalog(projectRoot);
  const traces = listLocalTraces(projectRoot);
  const storyIdsWithTrace = new Set(
    traces.map((t) => t.story_id).filter(Boolean) as string[],
  );

  const orphanedStories = catalog.byType.story
    .filter(
      (s) =>
        (s.status === "planned" || s.status === "in_progress") &&
        !storyIdsWithTrace.has(s.id),
    )
    .map((s): AuditFinding => ({ id: s.id, title: s.title }));

  const unverifiedStories = catalog.byType.story
    .filter((s) => {
      const cmd = asString(s.data, "verify");
      if (!cmd?.trim()) return false;
      return asString(s.data, "last_verified_result") !== "pass";
    })
    .map((s): AuditFinding => ({ id: s.id, title: s.title }));

  const unverifiedDecisions = catalog.byType.decision
    .filter((d) => {
      const cmd = asString(d.data, "verify");
      if (!cmd?.trim()) return false;
      return asString(d.data, "last_verified_result") !== "pass";
    })
    .map((d): AuditFinding => ({ id: d.id, title: d.title }));

  const backlogWithoutOutcomes = catalog.byType.backlog
    .filter((b) => {
      if (b.status !== "proposed" && b.status !== "accepted") return false;
      const outcome = asString(b.data, "outcome");
      return !outcome?.trim();
    })
    .map((b): AuditFinding => ({ id: b.id, title: b.title }));

  // broken links (best-effort)
  let brokenLinkFindings: AuditFinding[] = [];
  try {
    const index = buildProjectIndex(projectRoot);
    for (const row of index.catalog) {
      const view = linksFor(index, row.id);
      if (view.broken.length > 0) {
        brokenLinkFindings.push({
          id: row.id,
          title: `broken links: ${view.broken.join(", ")}`,
        });
      }
    }
  } catch {
    brokenLinkFindings = [];
  }

  // fold broken links into orphaned-ish noise via unverified stories? keep separate
  // by attaching to backlogWithoutOutcomes weight is wrong — add to orphaned for entropy
  // Prefer listing in orphanedStories extra lines is confusing. Add as audit section via
  // existing fields: put high-signal broken as unverifiedDecisions? No.
  // Extend format later; for entropy, count broken as unverifiedStories weight 5.
  const brokenAsUnverified = brokenLinkFindings;

  const base = {
    orphanedStories,
    unverifiedStories: [...unverifiedStories, ...brokenAsUnverified],
    unverifiedDecisions,
    backlogWithoutOutcomes,
  };

  return {
    ...base,
    entropyScore: computeEntropy(base),
  };
}

export function formatAuditResult(result: AuditResult): string {
  return formatAudit(result);
}
