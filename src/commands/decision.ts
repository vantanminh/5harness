import { addDecisionMd } from "../application/md-durable.js";
import {
  withOptionalHarnessDb,
  type TargetOptions,
} from "../infrastructure/context.js";

export type DecisionAddCliOptions = TargetOptions & {
  id: string;
  title: string;
  status?: string;
  doc?: string;
  verify?: string;
  notes?: string;
  links?: string;
};

export function executeDecisionAdd(options: DecisionAddCliOptions): void {
  if (!options.id || !options.title) {
    throw new Error("decision add requires --id and --title");
  }
  const file = withOptionalHarnessDb(options, (db, { targetDir }) =>
    addDecisionMd(
      { projectRoot: targetDir, db },
      {
        id: options.id,
        title: options.title,
        status: options.status,
        doc: options.doc,
        verify: options.verify,
        notes: options.notes,
        links: options.links,
      },
    ),
  );
  console.log(`Decision ${options.id} added.`);
  console.log(`  file: ${file.relativePath}`);
}
