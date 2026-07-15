import {
  addIntakeMd,
  updateIntakeMd,
} from "../application/md-durable.js";
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
  stories?: string;
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
      stories: options.stories,
      notes: options.notes,
      links: options.links,
    },
  );
  console.log(`Intake ${result.id} recorded.`);
  console.log(`  file: ${result.file.relativePath}`);
  maybeReindex(targetDir);
}

export type IntakeUpdateCliOptions = TargetOptions & {
  id: string;
  status?: string;
  stories?: string;
  notes?: string;
};

export function executeIntakeUpdate(options: IntakeUpdateCliOptions): void {
  if (!options.id) {
    throw new Error("intake update requires --id");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const file = updateIntakeMd(
    { projectRoot: targetDir },
    {
      id: options.id,
      status: options.status,
      stories: options.stories,
      notes: options.notes,
    },
  );
  console.log(`Intake ${options.id} updated.`);
  console.log(`  status: ${String(file.data.status ?? "pending")}`);
  console.log(`  file: ${file.relativePath}`);
  maybeReindex(targetDir);
}

export function executeIntakeClose(
  id: string,
  options: Omit<IntakeUpdateCliOptions, "id" | "status">,
): void {
  executeIntakeUpdate({ ...options, id, status: "completed" });
}

export function executeIntakeDismiss(
  id: string,
  options: Omit<IntakeUpdateCliOptions, "id" | "status">,
): void {
  executeIntakeUpdate({ ...options, id, status: "dismissed" });
}
