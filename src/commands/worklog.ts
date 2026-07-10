import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import {
  addWorklog,
  listWorklog,
  worklogFromGit,
  formatWorklog,
} from "../application/worklog.js";

export type WorklogCliOptions = TargetOptions & {
  story?: string;
  summary?: string;
  pr?: string;
  commit?: string;
  evidence?: string;
  since?: string;
  json?: boolean;
};

export function executeWorklogAdd(options: WorklogCliOptions): void {
  if (!options.story) throw new Error("--story is required");
  if (!options.summary) throw new Error("--summary is required");
  const { targetDir } = resolveTargetFromOptions(options);
  const entry = addWorklog(targetDir, {
    story_id: options.story,
    summary: options.summary,
    pr: options.pr,
    commit: options.commit,
    evidence: options.evidence,
  });
  console.log(`Worklog ${entry.id} added for story ${entry.story_id}.`);
}

export function executeWorklogList(options: WorklogCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const entries = listWorklog(targetDir);
  console.log(formatWorklog(entries, Boolean(options.json)));
}

export function executeWorklogFromGit(options: WorklogCliOptions): void {
  if (!options.story) throw new Error("--story is required");
  const { targetDir } = resolveTargetFromOptions(options);
  const entries = worklogFromGit(targetDir, options.story, options.since);
  if (entries.length === 0) {
    console.log(`No recent git commits for story ${options.story}.`);
  } else {
    console.log(
      `Linked ${entries.length} commit(s) to story ${options.story}:`,
    );
    console.log(formatWorklog(entries, Boolean(options.json)));
  }
}
