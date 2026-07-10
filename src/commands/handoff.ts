import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { buildHandoff, formatHandoff } from "../application/handoff.js";

export type HandoffCliOptions = TargetOptions & {
  story?: string;
  stdout?: boolean;
  json?: boolean;
};

export function executeHandoff(options: HandoffCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const summary = buildHandoff(targetDir, options.story);
  const output = formatHandoff(summary, Boolean(options.json));
  console.log(output);
}
