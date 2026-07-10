import { addDecision } from "../application/durable.js";
import { withHarnessDb, type TargetOptions } from "../infrastructure/context.js";

export type DecisionAddCliOptions = TargetOptions & {
  id: string;
  title: string;
  status?: string;
  doc?: string;
  verify?: string;
  notes?: string;
};

export function executeDecisionAdd(options: DecisionAddCliOptions): void {
  if (!options.id || !options.title) {
    throw new Error("decision add requires --id and --title");
  }
  withHarnessDb(options, (db) => {
    addDecision(db, {
      id: options.id,
      title: options.title,
      status: options.status,
      doc: options.doc,
      verify: options.verify,
      notes: options.notes,
    });
  });
  console.log(`Decision ${options.id} added.`);
}
