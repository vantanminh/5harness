import {
  addTrace,
  formatTraceScore,
  scoreTraceById,
} from "../application/quality.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";

export type TraceCliOptions = TargetOptions & {
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
  score?: boolean;
};

export function executeTrace(options: TraceCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const { id } = addTrace(targetDir, {
    summary: options.summary,
    outcome: options.outcome,
    intake: options.intake,
    story: options.story,
    agent: options.agent,
    duration: options.duration,
    actions: options.actions,
    read: options.read,
    changed: options.changed,
    decisions: options.decisions,
    errors: options.errors,
    friction: options.friction,
    notes: options.notes,
  });
  console.log(`Trace #${id} recorded.`);

  if (options.score !== false) {
    const score = scoreTraceById(targetDir, id);
    console.log(formatTraceScore(score));
  }
}

export type ScoreTraceCliOptions = TargetOptions & {
  id?: string;
};

export function executeScoreTrace(options: ScoreTraceCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const id = options.id !== undefined ? Number(options.id) : undefined;
  if (options.id !== undefined && !Number.isFinite(id)) {
    throw new Error(`Invalid --id "${options.id}"`);
  }
  const score = scoreTraceById(targetDir, id);
  console.log(formatTraceScore(score));
}
