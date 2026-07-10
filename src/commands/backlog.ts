import { addBacklogMd, closeBacklogMd } from "../application/md-durable.js";
import {
  withOptionalHarnessDb,
  type TargetOptions,
} from "../infrastructure/context.js";

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
  const result = withOptionalHarnessDb(options, (db, { targetDir }) =>
    addBacklogMd(
      { projectRoot: targetDir, db },
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
    ),
  );
  const label = result.numericId
    ? `Backlog ${result.id} (#${result.numericId}) added.`
    : `Backlog ${result.id} added.`;
  console.log(label);
  console.log(`  file: ${result.file.relativePath}`);
}

export function executeBacklogClose(options: BacklogCloseCliOptions): void {
  if (!options.id) {
    throw new Error("backlog close requires --id");
  }
  const file = withOptionalHarnessDb(options, (db, { targetDir }) =>
    closeBacklogMd(
      { projectRoot: targetDir, db },
      {
        id: options.id,
        status: options.status,
        outcome: options.outcome,
      },
    ),
  );
  console.log(`Backlog ${options.id} closed.`);
  console.log(`  file: ${file.relativePath}`);
}
