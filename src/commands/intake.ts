import { addIntakeMd } from "../application/md-durable.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { maybeReindex } from "./_reindex-helper.js";

export type IntakeCliOptions = TargetOptions & {
  type: string;
  summary: string;
  lane: string;
  flags?: string;
  docs?: string;
  story?: string;
  notes?: string;
  links?: string;
};

export function executeIntake(options: IntakeCliOptions): void {
  if (!options.type || !options.summary || !options.lane) {
    throw new Error("intake requires --type, --summary, and --lane");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const result = addIntakeMd(
    { projectRoot: targetDir },
    {
      type: options.type,
      summary: options.summary,
      lane: options.lane,
      flags: options.flags,
      docs: options.docs,
      story: options.story,
      notes: options.notes,
      links: options.links,
    },
  );
  console.log(`Intake ${result.id} recorded.`);
  console.log(`  file: ${result.file.relativePath}`);
  maybeReindex(targetDir);
}
