import { formatAuditResult, runAudit } from "../application/quality.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";

export function executeAudit(options: TargetOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  console.log(formatAuditResult(runAudit(targetDir)));
}
