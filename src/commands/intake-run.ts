import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { runIntakePlan, formatIntakePlan } from "../application/intake-run.js";
import { executeIntake } from "./intake.js";

export type IntakeRunCliOptions = TargetOptions & {
  prompt?: string;
  summary?: string;
  json?: boolean;
  commit?: boolean;
};

export function executeIntakeRun(options: IntakeRunCliOptions): void {
  const summary = options.prompt ?? options.summary;
  if (!summary?.trim()) {
    throw new Error("intake run requires --prompt or --summary");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const plan = runIntakePlan(summary.trim(), targetDir);

  if (options.commit) {
    // Auto-create intake from plan
    executeIntake({
      type: plan.suggestedType as "new_spec" | "spec_slice" | "change_request" | "new_initiative" | "maintenance" | "harness_improvement",
      summary: summary.trim(),
      lane: plan.suggestedLane,
      directory: targetDir,
    });
    console.log("Intake record created.");
  }

  const output = formatIntakePlan(plan, Boolean(options.json));
  console.log(output);
}
