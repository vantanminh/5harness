import { addIntakeMd } from "../application/md-durable.js";
import {
  withOptionalHarnessDb,
  type TargetOptions,
} from "../infrastructure/context.js";

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
  const result = withOptionalHarnessDb(options, (db, { targetDir }) =>
    addIntakeMd(
      { projectRoot: targetDir, db },
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
    ),
  );
  const label = result.numericId
    ? `Intake ${result.id} (#${result.numericId}) recorded.`
    : `Intake ${result.id} recorded.`;
  console.log(label);
  console.log(`  file: ${result.file.relativePath}`);
}
