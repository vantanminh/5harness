import {
  formatAuditResult,
  runAudit,
} from "../application/quality.js";
import { withHarnessDb, type TargetOptions } from "../infrastructure/context.js";

export function executeAudit(options: TargetOptions): void {
  const text = withHarnessDb(options, (db) => formatAuditResult(runAudit(db)));
  console.log(text);
}
