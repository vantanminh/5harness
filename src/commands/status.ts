import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { buildStatus, formatStatus } from "../application/status.js";

export type StatusCliOptions = TargetOptions & {
  json?: boolean;
};

export function executeStatus(options: StatusCliOptions = {}): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const snapshot = buildStatus(targetDir);
  const output = formatStatus(snapshot, Boolean(options.json));
  console.log(output);
}
