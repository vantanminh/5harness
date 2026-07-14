import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addReport,
  getReport,
  listReports,
  REPORT_FIELD_LIMITS,
  updateReport,
} from "../src/application/report.js";
import {
  buildProjectIndex,
  linksFor,
  searchIndex,
} from "../src/application/index-store.js";
import { addStoryMd } from "../src/application/md-durable.js";
import {
  parseReportId,
  parseReportSeverity,
  parseReportStatus,
} from "../src/domain/report.js";

const REPORTER_ID = "11111111111111111111111111111111";
const TARGET_ID = "22222222222222222222222222222222";
const OTHER_ID = "33333333333333333333333333333333";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempProject(projectId: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-report-"));
  tempDirs.push(root);
  fs.writeFileSync(
    path.join(root, "AGENTS.md"),
    [
      "<!-- HARNESS:BEGIN -->",
      "<!-- harness-version: 0.20.0 -->",
      `<!-- harness-project-id: ${projectId} -->`,
      "## Harness",
      "<!-- HARNESS:END -->",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

describe("report domain", () => {
  it("normalizes and validates ids, statuses, and severities", () => {
    expect(parseReportId(" rp-001 ")).toBe("RP-001");
    expect(parseReportStatus(" NEEDS_INFO ")).toBe("needs_info");
    expect(parseReportSeverity(" High ")).toBe("high");
    expect(() => parseReportId("RP-1")).toThrow(/RP-###/);
    expect(() => parseReportStatus("done")).toThrow(/needs_info/);
    expect(() => parseReportSeverity("critical")).toThrow(/medium/);
  });
});

describe("target-owned report store", () => {
  it("creates sequential reports with complete durable metadata", () => {
    const reporter = tempProject(REPORTER_ID);
    const target = tempProject(TARGET_ID);
    const context =
      "Payload:\r\n---\r\nkey: \"quoted\"\r\npath: C:\\work\\demo";

    const first = addReport(target, {
      summary: "Login response missing refresh_token",
      fromProjectId: REPORTER_ID,
      fromRole: "frontend",
      toProjectId: TARGET_ID,
      severity: "high",
      api: "POST /v1/auth/login",
      expected: "refresh_token:string",
      actual: "only access_token present",
      context,
      related: "US-088, decisions/0022",
    });
    const second = addReport(target, {
      summary: "Second mismatch",
      fromProjectId: REPORTER_ID,
      toProjectId: TARGET_ID,
    });

    expect(first.relativePath).toBe("docs/reports/RP-001.md");
    expect(second.relativePath).toBe("docs/reports/RP-002.md");
    expect(fs.existsSync(path.join(reporter, "docs", "reports"))).toBe(false);

    const stored = getReport(target, "rp-001");
    expect(stored.data).toMatchObject({
      id: "RP-001",
      type: "report",
      status: "open",
      severity: "high",
      summary: "Login response missing refresh_token",
      from_project_id: REPORTER_ID,
      from_role: "frontend",
      to_project_id: TARGET_ID,
      api: "POST /v1/auth/login",
      expected: "refresh_token:string",
      actual: "only access_token present",
      context,
      resolution: null,
      related: ["US-088", "decisions/0022"],
    });
    expect(stored.data.created_at).toBe(stored.data.updated_at);
    expect(stored.body).toContain("# RP-001: Login response");

    const rows = listReports(target);
    expect(rows.map((row) => row.id)).toEqual(["RP-001", "RP-002"]);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["id", "severity", "status", "summary", "updated_at"].sort(),
    );
    expect(listReports(target, "OPEN")).toHaveLength(2);
    expect(listReports(target, "fixed")).toEqual([]);
  });

  it("enforces target identity, report identity, and bounded inputs", () => {
    const target = tempProject(TARGET_ID);

    expect(() =>
      addReport(target, {
        summary: "Wrong target",
        fromProjectId: REPORTER_ID,
        toProjectId: OTHER_ID,
      }),
    ).toThrow(/does not match AGENTS.md/);
    expect(() =>
      addReport(target, {
        summary: "Self report",
        fromProjectId: TARGET_ID,
        toProjectId: TARGET_ID,
      }),
    ).toThrow(/cannot target its own project/);
    expect(() =>
      addReport(target, {
        summary: "two\nlines",
        fromProjectId: REPORTER_ID,
        toProjectId: TARGET_ID,
      }),
    ).toThrow(/one line/);
    expect(() =>
      addReport(target, {
        summary: "Bad role",
        fromProjectId: REPORTER_ID,
        fromRole: "database",
        toProjectId: TARGET_ID,
      }),
    ).toThrow(/Invalid project role/);
    expect(() =>
      addReport(target, {
        summary: "Too much context",
        fromProjectId: REPORTER_ID,
        toProjectId: TARGET_ID,
        context: "x".repeat(REPORT_FIELD_LIMITS.context + 1),
      }),
    ).toThrow(/at most 8000/);
    expect(listReports(target)).toEqual([]);

    addReport(target, {
      id: "RP-010",
      summary: "Explicit id",
      fromProjectId: REPORTER_ID,
      toProjectId: TARGET_ID,
    });
    expect(() =>
      addReport(target, {
        id: "rp-010",
        summary: "Duplicate",
        fromProjectId: REPORTER_ID,
        toProjectId: TARGET_ID,
      }),
    ).toThrow(/already exists/);
    expect(getReport(target, "RP-010").data.summary).toBe("Explicit id");
  });

  it("updates lifecycle locally while preserving identity and creation time", () => {
    const target = tempProject(TARGET_ID);
    const created = addReport(target, {
      summary: "Contract mismatch",
      fromProjectId: REPORTER_ID,
      toProjectId: TARGET_ID,
    });
    const createdAt = created.data.created_at;

    expect(() => updateReport(target, { id: "RP-001" })).toThrow(
      /requires status, resolution, or related/,
    );
    expect(() =>
      updateReport(target, { id: "RP-001", status: "fixed" }),
    ).toThrow(/requires a non-empty resolution/);
    expect(getReport(target, "RP-001").data.status).toBe("open");

    const acked = updateReport(target, {
      id: "rp-001",
      status: "acked",
      related: "US-123",
    });
    expect(acked.data.status).toBe("acked");
    expect(acked.data.related).toEqual(["US-123"]);
    expect(acked.data.created_at).toBe(createdAt);

    const fixed = updateReport(target, {
      id: "RP-001",
      status: "fixed",
      resolution: "Added the missing response field.",
    });
    expect(fixed.data.status).toBe("fixed");
    expect(fixed.data.resolution).toBe("Added the missing response field.");
    expect(fixed.data.created_at).toBe(createdAt);
    expect(listReports(target, "fixed")).toHaveLength(1);

    fs.writeFileSync(
      path.join(target, "AGENTS.md"),
      fs
        .readFileSync(path.join(target, "AGENTS.md"), "utf8")
        .replace(TARGET_ID, OTHER_ID),
      "utf8",
    );
    expect(() =>
      updateReport(target, { id: "RP-001", status: "open" }),
    ).toThrow(/does not match AGENTS.md/);
  });

  it("participates in catalog search and related-link indexing", () => {
    const target = tempProject(TARGET_ID);
    addStoryMd(
      { projectRoot: target },
      { id: "US-088", title: "Auth response", lane: "normal" },
    );
    addReport(target, {
      summary: "Login contract mismatch",
      fromProjectId: REPORTER_ID,
      toProjectId: TARGET_ID,
      context: "Observed server_payload_without_refresh_token",
      related: "US-088,NOPE",
    });
    updateReport(target, {
      id: "RP-001",
      status: "fixed",
      resolution: "Shipped resolution_marker_8675309",
    });

    const index = buildProjectIndex(target);
    const reportRow = index.catalog.find((row) => row.id === "RP-001");
    expect(reportRow).toMatchObject({
      type: "report",
      title: "Login contract mismatch",
      status: "fixed",
    });
    expect(searchIndex(index, "server_payload_without_refresh_token")[0]?.id).toBe(
      "RP-001",
    );
    expect(searchIndex(index, "resolution_marker_8675309")[0]?.id).toBe(
      "RP-001",
    );
    const links = linksFor(index, "RP-001");
    expect(links.outbound).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: "US-088", resolved: true }),
        expect.objectContaining({ to: "NOPE", resolved: false }),
      ]),
    );
    expect(linksFor(index, "US-088").backlinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "RP-001", resolved: true }),
      ]),
    );
  });
});
