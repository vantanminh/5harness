import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { extractProjectId } from "../src/domain/project-id.js";
import { readEntityById } from "../src/infrastructure/entities.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(repoRoot, "src", "cli.ts");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runHarness(args: string[], cwd: string, harnessHome: string) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HARNESS_HOME: harnessHome,
      HARNESS_NO_UPDATE_CHECK: "1",
    },
  });
}

function projectId(projectRoot: string): string {
  const id = extractProjectId(
    fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8"),
  );
  if (!id) throw new Error("missing test project id");
  return id;
}

function expectOk(result: ReturnType<typeof runHarness>): void {
  expect(result.status, result.stderr + result.stdout).toBe(0);
}

function initProject(
  project: string,
  role: "frontend" | "backend",
  home: string,
): void {
  expectOk(runHarness(["init", project, "--yes"], repoRoot, home));
  expectOk(
    runHarness(
      ["project", "role", "set", role, "--dir", project],
      repoRoot,
      home,
    ),
  );
}

function reportCount(project: string): number {
  const reportsDir = path.join(project, "docs", "reports");
  if (!fs.existsSync(reportsDir)) return 0;
  return fs
    .readdirSync(reportsDir)
    .filter((name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md")
    .length;
}

describe("Project Link report CLI e2e", () => {
  it("round-trips a target-owned report across two configured projects", () => {
    const home = temp("harness-report-cli-home-");
    const parent = temp("harness-report-cli-parent-");
    const frontend = path.join(parent, "frontend app");
    const backend = path.join(parent, "backend app");
    initProject(frontend, "frontend", home);
    initProject(backend, "backend", home);
    expectOk(
      runHarness(
        ["project", "peer", "add", backend, "--dir", frontend],
        repoRoot,
        home,
      ),
    );

    const frontendId = projectId(frontend);
    const backendId = projectId(backend);
    const add = runHarness(
      [
        "report",
        "add",
        "--to",
        "backend",
        "--summary",
        "Login response missing refresh_token",
        "--api",
        "POST /v1/auth/login",
        "--expected",
        "refresh_token:string",
        "--actual",
        "only access_token present",
        "--context",
        "Reproduced in frontend story US-012",
        "--severity",
        "high",
        "--related",
        "US-088",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expectOk(add);
    expect(add.stdout).toContain(`Report RP-001 added to peer ${backendId}`);
    expect(
      fs.existsSync(path.join(frontend, "docs", "reports", "RP-001.md")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(backend, "docs", "reports", "RP-001.md")),
    ).toBe(true);
    const stored = readEntityById(backend, "report", "RP-001");
    expect(stored?.data).toMatchObject({
      status: "open",
      severity: "high",
      from_project_id: frontendId,
      from_role: "frontend",
      to_project_id: backendId,
      api: "POST /v1/auth/login",
    });

    const frontendList = runHarness(
      ["report", "list", "--json", "--dir", frontend],
      repoRoot,
      home,
    );
    expectOk(frontendList);
    expect(JSON.parse(frontendList.stdout)).toEqual([]);

    const backendList = runHarness(
      ["report", "list", "--status", "open", "--json", "--dir", backend],
      repoRoot,
      home,
    );
    expectOk(backendList);
    const rows = JSON.parse(backendList.stdout) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["id", "severity", "status", "summary", "updated_at"].sort(),
    );
    expect(backendList.stdout).not.toContain("access_token present");
    expect(backendList.stdout).not.toContain("Reproduced in frontend");

    const backendStatus = runHarness(
      ["status", "--json", "--dir", backend],
      repoRoot,
      home,
    );
    expectOk(backendStatus);
    expect(JSON.parse(backendStatus.stdout).projectLink).toEqual({
      role: "backend",
      stack: [],
      peerCount: 1,
      openReportCount: 1,
    });
    const backendNext = runHarness(
      ["next", "--json", "--dir", backend],
      repoRoot,
      home,
    );
    expectOk(backendNext);
    expect(JSON.parse(backendNext.stdout)[0]).toMatchObject({
      id: "RP-001",
      type: "report",
      status: "open",
    });
    const frontendNext = runHarness(
      ["next", "--json", "--dir", frontend],
      repoRoot,
      home,
    );
    expectOk(frontendNext);
    expect(
      (JSON.parse(frontendNext.stdout) as Array<{ type: string }>).some(
        (item) => item.type === "report",
      ),
    ).toBe(false);

    fs.rmSync(path.join(backend, ".5harness", "index", "index.json"));
    const doctor = runHarness(
      ["doctor", "--json", "--dir", frontend],
      repoRoot,
      home,
    );
    expectOk(doctor);
    expect(
      (JSON.parse(doctor.stdout).checks as Array<{
        name: string;
        status: string;
      }>).find((check) => check.name === "project-peer-indexes"),
    ).toMatchObject({ status: "warn" });

    const localMiss = runHarness(
      ["report", "get", "RP-001", "--dir", frontend],
      repoRoot,
      home,
    );
    expect(localMiss.status).toBe(1);
    expect(localMiss.stderr).toContain("Report RP-001 not found");
    const wrongOwnerUpdate = runHarness(
      [
        "report",
        "update",
        "--id",
        "RP-001",
        "--status",
        "fixed",
        "--resolution",
        "must not cross the ownership boundary",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(wrongOwnerUpdate.status).toBe(1);
    expect(readEntityById(backend, "report", "RP-001")?.data.status).toBe(
      "open",
    );

    expectOk(
      runHarness(
        [
          "report",
          "update",
          "--id",
          "RP-001",
          "--status",
          "acked",
          "--dir",
          backend,
        ],
        repoRoot,
        home,
      ),
    );
    const fixed = runHarness(
      [
        "report",
        "update",
        "--id",
        "RP-001",
        "--status",
        "fixed",
        "--resolution",
        "Shipped report_resolution_marker_8675309",
        "--dir",
        backend,
      ],
      repoRoot,
      home,
    );
    expectOk(fixed);

    const peerGet = runHarness(
      [
        "report",
        "get",
        "RP-001",
        "--from",
        "backend",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expectOk(peerGet);
    expect(peerGet.stdout).toContain("status: fixed");
    expect(peerGet.stdout).toContain("report_resolution_marker_8675309");
    const peerSearch = runHarness(
      [
        "peer",
        "search",
        "report_resolution_marker_8675309",
        "--role",
        "backend",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expectOk(peerSearch);
    expect(peerSearch.stdout).toContain("RP-001");

    const explicit = runHarness(
      [
        "report",
        "add",
        "--to",
        backendId,
        "--id",
        "RP-010",
        "--summary",
        "Second peer-id-selected mismatch",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expectOk(explicit);
    expect(readEntityById(backend, "report", "RP-010")?.data.status).toBe(
      "open",
    );
    expect(reportCount(frontend)).toBe(0);
    expect(reportCount(backend)).toBe(2);
  }, 60_000);

  it("fails closed for unconfigured, ambiguous, unresolved, and invalid targets", () => {
    const home = temp("harness-report-cli-fail-home-");
    const frontend = temp("harness-report-cli-fail-fe-");
    const backendA = temp("harness-report-cli-fail-a-");
    const backendB = temp("harness-report-cli-fail-b-");
    initProject(frontend, "frontend", home);
    initProject(backendA, "backend", home);
    initProject(backendB, "backend", home);
    expectOk(
      runHarness(
        ["project", "peer", "add", backendA, "--dir", frontend],
        repoRoot,
        home,
      ),
    );

    const missingTarget = runHarness(
      ["report", "add", "--summary", "Missing target", "--dir", frontend],
      repoRoot,
      home,
    );
    expect(missingTarget.status).toBe(1);

    const arbitrary = runHarness(
      [
        "report",
        "add",
        "--to",
        projectId(backendB),
        "--summary",
        "Arbitrary linked project",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(arbitrary.status).toBe(1);
    expect(arbitrary.stderr).toContain("not a configured peer");

    const pathTarget = runHarness(
      [
        "report",
        "add",
        "--to",
        backendA,
        "--summary",
        "Paths are not capabilities",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(pathTarget.status).toBe(1);
    expect(pathTarget.stderr).toContain("Invalid harness project id");

    const invalidSeverity = runHarness(
      [
        "report",
        "add",
        "--to",
        projectId(backendA),
        "--summary",
        "Invalid severity",
        "--severity",
        "critical",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(invalidSeverity.status).toBe(1);
    expect(invalidSeverity.stderr).toContain("Invalid report severity");

    expectOk(
      runHarness(
        ["project", "peer", "add", backendB, "--dir", frontend],
        repoRoot,
        home,
      ),
    );
    const ambiguous = runHarness(
      [
        "report",
        "add",
        "--to",
        "backend",
        "--summary",
        "Ambiguous target",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(ambiguous.status).toBe(1);
    expect(ambiguous.stderr).toContain("ambiguous");

    expectOk(runHarness(["unlink", backendA], repoRoot, home));
    const unresolved = runHarness(
      [
        "report",
        "add",
        "--to",
        projectId(backendA),
        "--summary",
        "Unresolved target",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(unresolved.status).toBe(1);
    expect(unresolved.stderr).toContain("not linked on this machine");
    expect(reportCount(frontend)).toBe(0);
    expect(reportCount(backendA)).toBe(0);
    expect(reportCount(backendB)).toBe(0);
  });

  it("advertises report commands and their built-in tool entry", () => {
    const home = temp("harness-report-cli-help-");
    const help = runHarness(["report", "--help"], repoRoot, home);
    expectOk(help);
    for (const verb of ["add", "list", "get", "update"]) {
      expect(help.stdout).toContain(verb);
    }

    const tools = runHarness(
      ["query", "tools", "--capability", "tool-access"],
      repoRoot,
      home,
    );
    expectOk(tools);
    expect(tools.stdout).toContain("report add|list|get|update");
  });
});
