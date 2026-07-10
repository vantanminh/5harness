import { addIntake } from "../application/durable.js";
import { withHarnessDb, type TargetOptions } from "../infrastructure/context.js";

export type IntakeCliOptions = TargetOptions & {
  type: string;
  summary: string;
  lane: string;
  flags?: string;
  docs?: string;
  story?: string;
  notes?: string;
};

export function executeIntake(options: IntakeCliOptions): void {
  if (!options.type || !options.summary || !options.lane) {
    throw new Error("intake requires --type, --summary, and --lane");
  }
  const { id } = withHarnessDb(options, (db) =>
    addIntake(db, {
      type: options.type,
      summary: options.summary,
      lane: options.lane,
      flags: options.flags,
      docs: options.docs,
      story: options.story,
      notes: options.notes,
    }),
  );
  console.log(`Intake #${id} recorded.`);
}
