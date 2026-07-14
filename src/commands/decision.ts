import { addDecisionMd } from "../application/md-durable.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { maybeReindex } from "./_reindex-helper.js";

export type DecisionAddCliOptions = TargetOptions & {
  id: string;
  title: string;
  status?: string;
  doc?: string;
  verify?: string;
  notes?: string;
  links?: string;
  force?: boolean;
};

export function executeDecisionAdd(options: DecisionAddCliOptions): void {
  if (!options.id || !options.title) {
    throw new Error("decision add requires --id and --title");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const file = addDecisionMd(
    { projectRoot: targetDir },
    {
      id: options.id,
      title: options.title,
      status: options.status,
      doc: options.doc,
      verify: options.verify,
      notes: options.notes,
      links: options.links,
      force: options.force,
    },
  );
  console.log(`Decision ${options.id} added.`);
  console.log(`  file: ${file.relativePath}`);
  maybeReindex(targetDir);
}
