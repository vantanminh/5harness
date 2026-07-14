import {
  entityRelativePath,
  parseLinksCsv,
} from "../domain/entities.js";
import {
  asString,
  type FrontmatterData,
} from "../domain/frontmatter.js";
import { parseProjectId } from "../domain/project-id.js";
import {
  PROJECT_ROLES,
  parseProjectRole,
  type ProjectRole,
} from "../domain/project-link.js";
import {
  parseReportId,
  parseReportSeverity,
  parseReportStatus,
  type ReportSeverity,
  type ReportStatus,
} from "../domain/report.js";
import {
  ensureEntityDirs,
  listEntityFiles,
  nextNumericEntityId,
  readEntityById,
  writeEntityFile,
  type EntityFile,
} from "../infrastructure/entities.js";
import { withMutationLock } from "../infrastructure/lockfile.js";
import { readProjectId } from "../infrastructure/project-id.js";
import type { RegistryIoOptions } from "../infrastructure/registry.js";
import {
  getProjectRole,
  resolveProjectPeer,
  type ProjectPeerSelector,
  type ResolvedProjectPeer,
} from "./project-link.js";

export const REPORT_FIELD_LIMITS = {
  summary: 500,
  api: 200,
  expected: 2_000,
  actual: 2_000,
  context: 8_000,
  resolution: 4_000,
} as const;

export type ReportAddInput = {
  id?: string;
  summary: string;
  fromProjectId: string;
  fromRole?: string;
  toProjectId: string;
  severity?: string;
  api?: string;
  expected?: string;
  actual?: string;
  context?: string;
  related?: string;
};

export type ReportUpdateInput = {
  id: string;
  status?: string;
  resolution?: string;
  related?: string;
};

export type ReportListItem = {
  id: string;
  status: ReportStatus;
  severity: ReportSeverity;
  summary: string;
  updated_at: string;
};

export type PeerReportAddInput = Omit<
  ReportAddInput,
  "fromProjectId" | "fromRole" | "toProjectId"
> & {
  to: string;
};

export type PeerReportAddResult = {
  file: EntityFile;
  target: ResolvedProjectPeer;
};

function nowIso(): string {
  return new Date().toISOString();
}

function requiredSingleLine(
  value: string,
  field: "summary",
  maxLength: number,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Report ${field} must not be empty.`);
  }
  if (normalized.includes("\0")) {
    throw new Error(`Report ${field} must not contain null bytes.`);
  }
  if (/\r|\n/.test(normalized)) {
    throw new Error(`Report ${field} must be one line.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(
      `Report ${field} must be at most ${maxLength} characters.`,
    );
  }
  return normalized;
}

function optionalText(
  value: string | undefined,
  field: keyof typeof REPORT_FIELD_LIMITS,
  options: { singleLine?: boolean } = {},
): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.includes("\0")) {
    throw new Error(`Report ${field} must not contain null bytes.`);
  }
  if (options.singleLine && /\r|\n/.test(normalized)) {
    throw new Error(`Report ${field} must be one line.`);
  }
  const maxLength = REPORT_FIELD_LIMITS[field];
  if (normalized.length > maxLength) {
    throw new Error(
      `Report ${field} must be at most ${maxLength} characters.`,
    );
  }
  return normalized;
}

function verifyTargetProject(
  projectRoot: string,
  expectedProjectId: string,
): string {
  const expected = parseProjectId(expectedProjectId);
  const actual = readProjectId(projectRoot).id;
  if (actual !== expected) {
    throw new Error(
      `Report target project id ${expected} does not match AGENTS.md id ${actual}.`,
    );
  }
  return actual;
}

function reportFile(projectRoot: string, rawId: string): EntityFile {
  const id = parseReportId(rawId);
  const file = readEntityById(projectRoot, "report", id);
  if (!file || file.data.type !== "report") {
    throw new Error(`Report ${id} not found.`);
  }
  const storedId = asString(file.data, "id");
  if (!storedId || parseReportId(storedId) !== id) {
    throw new Error(`Report ${id} has invalid durable identity metadata.`);
  }
  return file;
}

function reportRelated(raw: string | undefined): string[] {
  return parseLinksCsv(raw) ?? [];
}

export function projectPeerSelectorFromToken(
  raw: string,
): ProjectPeerSelector {
  const token = raw.trim();
  if (!token) {
    throw new Error("A configured peer role or project id is required.");
  }
  const role = token.toLowerCase();
  if ((PROJECT_ROLES as readonly string[]).includes(role)) {
    return { role };
  }
  return { peerId: token };
}

export function resolveReportPeer(
  token: string,
  pathInput?: string,
  options: RegistryIoOptions & { cwd?: string } = {},
): ResolvedProjectPeer {
  return resolveProjectPeer(
    projectPeerSelectorFromToken(token),
    pathInput,
    options,
  );
}

export function addReportToPeer(
  pathInput: string | undefined,
  input: PeerReportAddInput,
  options: RegistryIoOptions & { cwd?: string } = {},
): PeerReportAddResult {
  const target = resolveReportPeer(input.to, pathInput, options);
  const localRole = getProjectRole(target.localProjectRoot).role ?? undefined;
  const { to: _to, ...reportInput } = input;
  const file = addReport(target.path, {
    ...reportInput,
    fromProjectId: target.localProjectId,
    fromRole: localRole,
    toProjectId: target.id,
  });
  return { file, target };
}

export function addReport(
  projectRoot: string,
  input: ReportAddInput,
): EntityFile {
  const toProjectId = verifyTargetProject(projectRoot, input.toProjectId);
  const fromProjectId = parseProjectId(input.fromProjectId);
  if (fromProjectId === toProjectId) {
    throw new Error("A cross-project report cannot target its own project.");
  }

  const fromRole: ProjectRole | null = input.fromRole
    ? parseProjectRole(input.fromRole)
    : null;
  const summary = requiredSingleLine(
    input.summary,
    "summary",
    REPORT_FIELD_LIMITS.summary,
  );
  const severity = input.severity
    ? parseReportSeverity(input.severity)
    : "medium";
  const api = optionalText(input.api, "api", { singleLine: true });
  const expected = optionalText(input.expected, "expected");
  const actual = optionalText(input.actual, "actual");
  const context = optionalText(input.context, "context");
  const related = reportRelated(input.related);

  return withMutationLock(projectRoot, () => {
    ensureEntityDirs(projectRoot);
    const id = input.id
      ? parseReportId(input.id)
      : nextNumericEntityId(projectRoot, "report", "RP-");
    if (readEntityById(projectRoot, "report", id)) {
      throw new Error(`Report ${id} already exists.`);
    }

    const timestamp = nowIso();
    const data: FrontmatterData = {
      id,
      type: "report",
      status: "open",
      severity,
      summary,
      from_project_id: fromProjectId,
      from_role: fromRole,
      to_project_id: toProjectId,
      api,
      expected,
      actual,
      context,
      resolution: null,
      related,
      created_at: timestamp,
      updated_at: timestamp,
    };
    return writeEntityFile(
      projectRoot,
      entityRelativePath("report", id),
      data,
      `# ${id}: ${summary}\n\n`,
    );
  });
}

export function listReports(
  projectRoot: string,
  statusInput?: string,
): ReportListItem[] {
  const status = statusInput ? parseReportStatus(statusInput) : null;
  const items: ReportListItem[] = [];
  for (const file of listEntityFiles(projectRoot, "report")) {
    if (file.data.type !== "report") continue;
    const idRaw = asString(file.data, "id");
    const statusRaw = asString(file.data, "status");
    const severityRaw = asString(file.data, "severity");
    const summary = asString(file.data, "summary");
    if (!idRaw || !statusRaw || !severityRaw || !summary) continue;
    const item: ReportListItem = {
      id: parseReportId(idRaw),
      status: parseReportStatus(statusRaw),
      severity: parseReportSeverity(severityRaw),
      summary,
      updated_at: asString(file.data, "updated_at") ?? "",
    };
    if (!status || item.status === status) items.push(item);
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

export function getReport(projectRoot: string, id: string): EntityFile {
  return reportFile(projectRoot, id);
}

export function updateReport(
  projectRoot: string,
  input: ReportUpdateInput,
): EntityFile {
  if (
    input.status === undefined &&
    input.resolution === undefined &&
    input.related === undefined
  ) {
    throw new Error("Report update requires status, resolution, or related.");
  }
  const id = parseReportId(input.id);
  const requestedStatus = input.status
    ? parseReportStatus(input.status)
    : undefined;
  const requestedResolution =
    input.resolution === undefined
      ? undefined
      : optionalText(input.resolution, "resolution");
  const requestedRelated =
    input.related === undefined ? undefined : reportRelated(input.related);

  return withMutationLock(projectRoot, () => {
    const file = reportFile(projectRoot, id);
    const targetId = asString(file.data, "to_project_id");
    if (!targetId) {
      throw new Error(`Report ${id} has no target project id.`);
    }
    verifyTargetProject(projectRoot, targetId);

    const currentStatus = parseReportStatus(
      asString(file.data, "status") ?? "",
    );
    const nextStatus = requestedStatus ?? currentStatus;
    const currentResolution = asString(file.data, "resolution") ?? null;
    const nextResolution =
      requestedResolution === undefined
        ? currentResolution
        : requestedResolution;
    if (nextStatus === "fixed" && !nextResolution) {
      throw new Error(
        `Report ${nextStatus} status requires a non-empty resolution.`,
      );
    }

    const data: FrontmatterData = {
      ...file.data,
      id,
      type: "report",
      status: nextStatus,
      resolution: nextResolution,
      updated_at: nowIso(),
    };
    if (requestedRelated !== undefined) data.related = requestedRelated;
    return writeEntityFile(
      projectRoot,
      file.relativePath,
      data,
      file.body,
    );
  });
}
