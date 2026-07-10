import { addBacklog, closeBacklog } from "../application/durable.js";
import { withHarnessDb, type TargetOptions } from "../infrastructure/context.js";

export type BacklogAddCliOptions = TargetOptions & {
  title: string;
  while?: string;
  pain?: string;
  suggestion?: string;
  risk?: string;
  predicted?: string;
  notes?: string;
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
  const { id } = withHarnessDb(options, (db) =>
    addBacklog(db, {
      title: options.title,
      while: options.while,
      pain: options.pain,
      suggestion: options.suggestion,
      risk: options.risk,
      predicted: options.predicted,
      notes: options.notes,
    }),
  );
  console.log(`Backlog #${id} added.`);
}

export function executeBacklogClose(options: BacklogCloseCliOptions): void {
  if (!options.id) {
    throw new Error("backlog close requires --id");
  }
  withHarnessDb(options, (db) => {
    closeBacklog(db, {
      id: options.id,
      status: options.status,
      outcome: options.outcome,
    });
  });
  console.log(`Backlog #${options.id} closed.`);
}
