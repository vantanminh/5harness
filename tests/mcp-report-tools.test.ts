import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMonitoredMcpHandler,
  handleMcpRequest,
} from "../src/application/mcp-server.js";
import { listMcpCalls } from "../src/application/mcp-monitor.js";
import { configureProjectPeer } from "../src/application/project-link.js";
import { linkProject } from "../src/application/registry.js";
import { loadProjectIndex } from "../src/application/index-store.js";
import {
  setProjectRoleMarkers,
  type ProjectRole,
} from "../src/domain/project-link.js";
import { readEntityById } from "../src/infrastructure/entities.js";

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

function createProject(root: string, id: string, role: ProjectRole): void {
  fs.mkdirSync(root, { recursive: true });
  let agents = [
    "<!-- HARNESS:BEGIN -->",
    "<!-- harness-version: 0.20.0 -->",
    `<!-- harness-project-id: ${id} -->`,
    "## Harness",
    "<!-- HARNESS:END -->",
    "",
  ].join("\n");
  agents = setProjectRoleMarkers(agents, role, []);
  fs.writeFileSync(path.join(root, "AGENTS.md"), agents, "utf8");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: path.basename(root) }),
    "utf8",
  );
}

type RpcResponse = {
  result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }> };
  error?: { code: number; message: string };
};

function request(
  method: string,
  params?: Record<string, unknown>,
): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
}

function rpc(
  root: string,
  home: string,
  method: string,
  params?: Record<string, unknown>,
): RpcResponse {
  return JSON.parse(
    handleMcpRequest(request(method, params), root, undefined, {
      harnessHome: home,
    }),
  ) as RpcResponse;
}

function textOf(response: RpcResponse): string {
  expect(response.error, response.error?.message).toBeUndefined();
  return response.result?.content?.map((content) => content.text).join("\n") ?? "";
}

describe("Project Link dynamic MCP report tools", () => {
  const frontendId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const backendId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const serviceId = "cccccccccccccccccccccccccccccccc";

  it("hides and rejects all report tools when the project has no peers", () => {
    const home = temp("harness-mcp-report-empty-home-");
    const frontend = temp("harness-mcp-report-empty-fe-");
    createProject(frontend, frontendId, "frontend");
    linkProject(frontend, { harnessHome: home });

    const names =
      rpc(frontend, home, "tools/list").result?.tools?.map((tool) => tool.name) ??
      [];
    for (const name of [
      "harness_report_add",
      "harness_report_list",
      "harness_report_get",
      "harness_report_update",
    ]) {
      expect(names).not.toContain(name);
    }

    const direct = rpc(frontend, home, "tools/call", {
      name: "harness_report_add",
      arguments: { to: "backend", summary: "must remain unavailable" },
    });
    expect(direct.error?.message).toMatch(/not available for this project/);
  });

  it("round-trips reports with custom registry context and caller-root monitoring", () => {
    const home = temp("harness-mcp-report-home-");
    const frontend = temp("harness-mcp-report-fe-");
    const backend = temp("harness-mcp-report-be-");
    const service = temp("harness-mcp-report-svc-");
    createProject(frontend, frontendId, "frontend");
    createProject(backend, backendId, "backend");
    createProject(service, serviceId, "service");
    for (const project of [frontend, backend, service]) {
      linkProject(project, { harnessHome: home });
    }
    configureProjectPeer(backendId, undefined, frontend, { harnessHome: home });
    configureProjectPeer(serviceId, undefined, backend, { harnessHome: home });

    const names =
      rpc(frontend, home, "tools/list").result?.tools?.map((tool) => tool.name) ??
      [];
    expect(names).toEqual(
      expect.arrayContaining([
        "harness_report_add",
        "harness_report_list",
        "harness_report_get",
        "harness_report_update",
      ]),
    );

    const monitored = createMonitoredMcpHandler(
      frontend,
      { projectId: frontendId, projectMode: "single" },
      { harnessHome: home },
    );
    const added = JSON.parse(
      monitored(
        request("tools/call", {
          name: "harness_report_add",
          arguments: {
            to: "backend",
            summary: "Login response missing refresh_token",
            severity: "high",
            api: "POST /v1/auth/login",
            expected: "refresh_token:string",
            actual: "only access_token present",
            context: "sanitized frontend reproduction",
          },
        }),
      ),
    ) as RpcResponse;
    expect(textOf(added)).toContain(`Report RP-001 added to peer ${backendId}`);
    expect(readEntityById(frontend, "report", "RP-001")).toBeNull();
    expect(readEntityById(backend, "report", "RP-001")?.data).toMatchObject({
      status: "open",
      severity: "high",
      from_project_id: frontendId,
      from_role: "frontend",
      to_project_id: backendId,
    });
    expect(loadProjectIndex(backend)?.catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "RP-001", type: "report" }),
      ]),
    );
    expect(listMcpCalls(frontend)).toEqual([
      expect.objectContaining({
        tool_name: "harness_report_add",
        project_id: frontendId,
        project_mode: "single",
        project_root: path.resolve(frontend),
      }),
    ]);
    expect(listMcpCalls(backend)).toEqual([]);

    expect(
      JSON.parse(
        textOf(
          rpc(frontend, home, "tools/call", {
            name: "harness_report_list",
            arguments: {},
          }),
        ),
      ),
    ).toEqual([]);
    const backendRows = JSON.parse(
      textOf(
        rpc(backend, home, "tools/call", {
          name: "harness_report_list",
          arguments: { status: "open" },
        }),
      ),
    ) as Array<Record<string, unknown>>;
    expect(backendRows).toHaveLength(1);
    expect(Object.keys(backendRows[0]!).sort()).toEqual(
      ["id", "severity", "status", "summary", "updated_at"].sort(),
    );
    expect(JSON.stringify(backendRows)).not.toContain("access_token present");
    expect(JSON.stringify(backendRows)).not.toContain("frontend reproduction");

    const wrongOwner = rpc(frontend, home, "tools/call", {
      name: "harness_report_update",
      arguments: {
        id: "RP-001",
        status: "fixed",
        resolution: "must not mutate a peer report",
        to: backendId,
        peer_id: backendId,
      },
    });
    expect(wrongOwner.error?.message).toMatch(/Report RP-001 not found/);
    expect(readEntityById(backend, "report", "RP-001")?.data.status).toBe(
      "open",
    );

    textOf(
      rpc(backend, home, "tools/call", {
        name: "harness_report_update",
        arguments: { id: "RP-001", status: "acked" },
      }),
    );
    textOf(
      rpc(backend, home, "tools/call", {
        name: "harness_report_update",
        arguments: {
          id: "RP-001",
          status: "fixed",
          resolution: "Shipped mcp_report_resolution_marker_314159",
        },
      }),
    );
    const fromPeer = textOf(
      rpc(frontend, home, "tools/call", {
        name: "harness_report_get",
        arguments: { id: "RP-001", from: backendId },
      }),
    );
    expect(fromPeer).toContain("status: fixed");
    expect(fromPeer).toContain("mcp_report_resolution_marker_314159");
    expect(loadProjectIndex(backend)?.texts["RP-001"]).toContain(
      "mcp_report_resolution_marker_314159",
    );

    const peerOfPeer = rpc(frontend, home, "tools/call", {
      name: "harness_report_add",
      arguments: { to: serviceId, summary: "must not traverse peer graphs" },
    });
    expect(peerOfPeer.error?.message).toMatch(/not a configured peer/);
    expect(readEntityById(service, "report", "RP-001")).toBeNull();
    const peerOfPeerRead = rpc(frontend, home, "tools/call", {
      name: "harness_report_get",
      arguments: { id: "RP-001", from: serviceId },
    });
    expect(peerOfPeerRead.error?.message).toMatch(/not a configured peer/);
  });
});
