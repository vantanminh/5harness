import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import {
  buildChangelog,
  formatChangelog,
} from "../application/export-changelog.js";

export type ExportCliOptions = TargetOptions & {
  since?: string;
  stdout?: boolean;
  json?: boolean;
};

export function executeExportChangelog(options: ExportCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const entries = buildChangelog(targetDir, options.since);
  const output = formatChangelog(entries, Boolean(options.json));
  console.log(output);
}
