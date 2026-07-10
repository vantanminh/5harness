import {
  addStoryMd,
  updateStoryMd,
} from "../application/md-durable.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { maybeReindex } from "./_reindex-helper.js";
import { appendLocalTrace } from "../application/local-traces.js";

export type StoryAddCliOptions = TargetOptions & {
  id: string;
  title: string;
  lane: string;
  contract?: string;
  verify?: string;
  notes?: string;
  links?: string;
};

export type StoryUpdateCliOptions = TargetOptions & {
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
  links?: string;
};

export function executeStoryAdd(options: StoryAddCliOptions): void {
  if (!options.id || !options.title || !options.lane) {
    throw new Error("story add requires --id, --title, and --lane");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const file = addStoryMd(
    { projectRoot: targetDir },
    {
      id: options.id,
      title: options.title,
      lane: options.lane,
      contract: options.contract,
      verify: options.verify,
      notes: options.notes,
      links: options.links,
    },
  );
  console.log(`Story ${options.id} added.`);
  console.log(`  file: ${file.relativePath}`);
  maybeReindex(targetDir);
}

export function executeStoryUpdate(options: StoryUpdateCliOptions): void {
  if (!options.id) {
    throw new Error("story update requires --id");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const file = updateStoryMd(
    { projectRoot: targetDir },
    {
      id: options.id,
      status: options.status,
      evidence: options.evidence,
      unit: options.unit,
      integration: options.integration,
      e2e: options.e2e,
      platform: options.platform,
      verify: options.verify,
      title: options.title,
      notes: options.notes,
      contract: options.contract,
      links: options.links,
    },
  );
  console.log(`Story ${options.id} updated.`);
  console.log(`  file: ${file.relativePath}`);
  maybeReindex(targetDir);
}

export type StoryLifecycleOptions = TargetOptions & {
  id?: string;
  evidence?: string;
  reason?: string;
};

function doLifecycle(
  options: StoryLifecycleOptions,
  status: string,
  verb: string,
): void {
  if (!options.id) {
    throw new Error(`story ${verb} requires an entity id (positional arg)`);
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const updateInput: Record<string, string> = { id: options.id, status };
  if (options.evidence) updateInput.evidence = options.evidence;
  if (options.reason) updateInput.notes = options.reason;

  const file = updateStoryMd(
    { projectRoot: targetDir },
    {
      id: options.id,
      status,
      evidence: options.evidence,
      notes: options.reason,
    },
  );

  // Record optional trace
  try {
    appendLocalTrace(targetDir, {
      task_summary: `story ${verb}: ${options.id}`,
      story_id: options.id,
      outcome: status === "implemented" ? "completed" : status === "blocked" ? "blocked" : "partial",
      notes: options.reason ?? null,
      actions_taken: `harness story ${verb} ${options.id}`,
      intake_id: null,
      agent: null,
      files_read: null,
      files_changed: null,
      decisions_made: null,
      errors: null,
      duration_ms: null,
      harness_friction: null,
    });
  } catch {
    // Trace is optional; fail-open
  }

  console.log(`Story ${options.id} ${verb}.`);
  console.log(`  status: ${status}`);
  console.log(`  file: ${file.relativePath}`);
  if (options.evidence) console.log(`  evidence: ${options.evidence}`);
  maybeReindex(targetDir);
}

export function executeStoryStart(
  id: string,
  options: StoryLifecycleOptions = {},
): void {
  doLifecycle({ ...options, id }, "in_progress", "started");
}

export function executeStoryDone(
  id: string,
  options: StoryLifecycleOptions = {},
): void {
  doLifecycle({ ...options, id }, "implemented", "done");
}

export function executeStoryBlock(
  id: string,
  options: StoryLifecycleOptions = {},
): void {
  const reason = options.reason ?? options.evidence ?? "no reason given";
  doLifecycle({ ...options, id, reason }, "blocked", "blocked");
}
