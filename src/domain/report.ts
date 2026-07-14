export const REPORT_STATUSES = [
  "open",
  "acked",
  "fixed",
  "wontfix",
  "needs_info",
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_SEVERITIES = ["low", "medium", "high"] as const;

export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

export function parseReportStatus(raw: string): ReportStatus {
  const value = raw.trim().toLowerCase();
  if ((REPORT_STATUSES as readonly string[]).includes(value)) {
    return value as ReportStatus;
  }
  throw new Error(
    `Invalid report status "${raw}". Use ${REPORT_STATUSES.join(" | ")}`,
  );
}

export function parseReportSeverity(raw: string): ReportSeverity {
  const value = raw.trim().toLowerCase();
  if ((REPORT_SEVERITIES as readonly string[]).includes(value)) {
    return value as ReportSeverity;
  }
  throw new Error(
    `Invalid report severity "${raw}". Use ${REPORT_SEVERITIES.join(" | ")}`,
  );
}

export function parseReportId(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (!/^RP-\d{3,}$/.test(value)) {
    throw new Error(`Invalid report id "${raw}". Use RP-###.`);
  }
  return value;
}
