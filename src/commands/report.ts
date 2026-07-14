import {
  addReportToPeer,
  getReport,
  listReports,
  resolveReportPeer,
  updateReport,
} from "../application/report.js";
import { parseReportId } from "../domain/report.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { formatTable } from "../infrastructure/table.js";
import { maybeReindex } from "./_reindex-helper.js";
import { executeGet } from "./index-tools.js";

export type ReportAddCliOptions = TargetOptions & {
  to: string;
  summary: string;
  id?: string;
  severity?: string;
  api?: string;
  expected?: string;
  actual?: string;
  context?: string;
  related?: string;
};

export type ReportListCliOptions = TargetOptions & {
  status?: string;
  json?: boolean;
};

export type ReportGetCliOptions = TargetOptions & {
  from?: string;
};

export type ReportUpdateCliOptions = TargetOptions & {
  id: string;
  status: string;
  resolution?: string;
  related?: string;
};

function localRoot(options: TargetOptions): string {
  return resolveTargetFromOptions(options).targetDir;
}

export function executeReportAdd(options: ReportAddCliOptions): void {
  const result = addReportToPeer(options.dir ?? options.directory, {
    to: options.to,
    id: options.id,
    summary: options.summary,
    severity: options.severity,
    api: options.api,
    expected: options.expected,
    actual: options.actual,
    context: options.context,
    related: options.related,
  });
  console.log(`Report ${String(result.file.data.id)} added to peer ${result.target.id}.`);
  console.log(`  file: ${result.file.relativePath}`);
  maybeReindex(result.target.path);
}

export function executeReportList(options: ReportListCliOptions = {}): void {
  const rows = listReports(localRoot(options), options.status);
  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(
    formatTable(rows, ["id", "status", "severity", "summary", "updated_at"]),
  );
}

export function executeReportGet(
  idInput: string,
  options: ReportGetCliOptions = {},
): void {
  const id = parseReportId(idInput);
  const root = options.from
    ? resolveReportPeer(
        options.from,
        options.dir ?? options.directory,
      ).path
    : localRoot(options);
  getReport(root, id);
  executeGet(id, { dir: root });
}

export function executeReportUpdate(options: ReportUpdateCliOptions): void {
  const root = localRoot(options);
  const file = updateReport(root, {
    id: options.id,
    status: options.status,
    resolution: options.resolution,
    related: options.related,
  });
  console.log(`Report ${String(file.data.id)} updated to ${String(file.data.status)}.`);
  console.log(`  file: ${file.relativePath}`);
  maybeReindex(root);
}
