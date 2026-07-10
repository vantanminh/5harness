import { addBacklogMd, closeBacklogMd } from "../application/md-durable.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { maybeReindex } from "./_reindex-helper.js";

export type BacklogAddCliOptions = TargetOptions & {
  title: string;
  while?: string;
  pain?: string;
  suggestion?: string;
  risk?: string;
  predicted?: string;
  notes?: string;
  links?: string;
};

export type BacklogCloseCliOptions = TargetOptions & {
  id: string;
  status?: string;
  outcome?: string;
};

export function executeBacklogAdd(options: BacklogAddCliOptions): void {
  if (!options.title) {
    throw new Error("backlog add requires --title");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const result = addBacklogMd(
    { projectRoot: targetDir },
    {
      title: options.title,
      while: options.while,
      pain: options.pain,
      suggestion: options.suggestion,
      risk: options.risk,
      predicted: options.predicted,
      notes: options.notes,
      links: options.links,
    },
  );
  console.log(`Backlog ${result.id} added.`);
  console.log(`  file: ${result.file.relativePath}`);
  maybeReindex(targetDir);
}

export function executeBacklogClose(options: BacklogCloseCliOptions): void {
  if (!options.id) {
    throw new Error("backlog close requires --id");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const file = closeBacklogMd(
    { projectRoot: targetDir },
    {
      id: options.id,
      status: options.status,
      outcome: options.outcome,
    },
  );
  console.log(`Backlog ${options.id} closed.`);
  console.log(`  file: ${file.relativePath}`);
  maybeReindex(targetDir);
}
