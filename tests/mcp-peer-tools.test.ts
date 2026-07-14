import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMonitoredMcpHandler,
  handleMcpRequest,
} from "../src/application/mcp-server.js";
import { configureProjectPeer } from "../src/application/project-link.js";
import { linkProject } from "../src/application/registry.js";
import { addDecisionMd, addStoryMd } from "../src/application/md-durable.js";
import { setProjectRoleMarkers, type ProjectRole } from "../src/domain/project-link.js";

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

function rpc(
  root: string,
  home: string,
  method: string,
  params?: Record<string, unknown>,
): RpcResponse {
  return JSON.parse(
    handleMcpRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      root,
      undefined,
      { harnessHome: home },
    ),
  ) as RpcResponse;
}

function textOf(response: RpcResponse): string {
  expect(response.error, response.error?.message).toBeUndefined();
  return response.result?.content?.map((content) => content.text).join("\n") ?? "";
}

describe("Project Link dynamic MCP peer tools", () => {
  const frontendId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const backendId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const serviceId = "cccccccccccccccccccccccccccccccc";

  it("hides and rejects peer reads when the calling project has no peers", () => {
    const home = temp("harness-mcp-peer-empty-home-");
    const frontend = temp("harness-mcp-peer-empty-fe-");
    createProject(frontend, frontendId, "frontend");
    linkProject(frontend, { harnessHome: home });

    const listed = rpc(frontend, home, "tools/list");
    const names = listed.result?.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain("harness_project_role");
    expect(names).toContain("harness_project_peers");
    expect(names).not.toContain("harness_peer_search");

    const direct = rpc(frontend, home, "tools/call", {
      name: "harness_peer_search",
      arguments: { query: "anything", role: "backend" },
    });
    expect(direct.error?.message).toMatch(/not available for this project/);

    expect(JSON.parse(textOf(rpc(frontend, home, "tools/call", {
      name: "harness_project_role",
      arguments: {},
    })))).toEqual({ role: "frontend", stack: [] });
    expect(JSON.parse(textOf(rpc(frontend, home, "tools/call", {
      name: "harness_project_peers",
      arguments: {},
    })))).toEqual([]);
  });

  it("exposes bounded reads for configured peers and rejects arbitrary registry ids", () => {
    const home = temp("harness-mcp-peer-home-");
    const frontend = temp("harness-mcp-peer-fe-");
    const backend = temp("harness-mcp-peer-be-");
    const service = temp("harness-mcp-peer-svc-");
    createProject(frontend, frontendId, "frontend");
    createProject(backend, backendId, "backend");
    createProject(service, serviceId, "service");
    for (const project of [frontend, backend, service]) {
      linkProject(project, { harnessHome: home });
    }
    configureProjectPeer(backendId, undefined, frontend, { harnessHome: home });
    // B -> C exists, but A must not traverse B's peer graph.
    configureProjectPeer(serviceId, undefined, backend, { harnessHome: home });

    addStoryMd(
      { projectRoot: frontend },
      {
        id: "US-SAME",
        title: "Frontend local entity",
        lane: "normal",
        notes: "frontend-local-token",
      },
    );
    addDecisionMd(
      { projectRoot: backend },
      { id: "D-BE", title: "Backend decision" },
    );
    addStoryMd(
      { projectRoot: backend },
      {
        id: "US-SAME",
        title: "Backend peer entity",
        lane: "normal",
        notes: "backend-peer-token",
        links: "D-BE",
      },
    );

    const listed = rpc(frontend, home, "tools/list");
    const names = listed.result?.tools?.map((tool) => tool.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining([
        "harness_peer_search",
        "harness_peer_get",
        "harness_peer_context",
        "harness_peer_links",
      ]),
    );

    const peers = JSON.parse(
      textOf(
        rpc(frontend, home, "tools/call", {
          name: "harness_project_peers",
          arguments: {},
        }),
      ),
    ) as Array<{ id: string; role: string; resolved: boolean }>;
    expect(peers).toEqual([
      expect.objectContaining({ id: backendId, role: "backend", resolved: true }),
    ]);

    const search = textOf(
      rpc(frontend, home, "tools/call", {
        name: "harness_peer_search",
        arguments: { query: "backend-peer-token", role: "backend", limit: 5 },
      }),
    );
    expect(search).toContain("US-SAME");
    expect(search).toContain("backend-peer-token");
    expect(search).not.toContain("frontend-local-token");
    expect(search.length).toBeLessThan(1500);

    const get = textOf(
      rpc(frontend, home, "tools/call", {
        name: "harness_peer_get",
        arguments: { id: "US-SAME", peer_id: backendId, summary: true },
      }),
    );
    expect(get).toContain("Backend peer entity");
    expect(get).not.toContain("Frontend local entity");

    const context = textOf(
      rpc(frontend, home, "tools/call", {
        name: "harness_peer_context",
        arguments: { id: "US-SAME", role: "backend", maxChars: 200 },
      }),
    );
    expect(context).toContain("Backend peer entity");
    expect(context).toContain("max-chars=200");

    const links = textOf(
      rpc(frontend, home, "tools/call", {
        name: "harness_peer_links",
        arguments: { id: "US-SAME", role: "backend" },
      }),
    );
    expect(links).toContain("D-BE");

    const peerOfPeer = rpc(frontend, home, "tools/call", {
      name: "harness_peer_get",
      arguments: { id: "US-NOPE", peer_id: serviceId },
    });
    expect(peerOfPeer.error?.message).toMatch(/not a configured peer/);
  });

  it("uses the supplied registry context while monitoring the calling project", () => {
    const home = temp("harness-mcp-peer-monitor-home-");
    const frontend = temp("harness-mcp-peer-monitor-fe-");
    const backend = temp("harness-mcp-peer-monitor-be-");
    createProject(frontend, frontendId, "frontend");
    createProject(backend, backendId, "backend");
    linkProject(frontend, { harnessHome: home });
    linkProject(backend, { harnessHome: home });
    configureProjectPeer(backendId, undefined, frontend, { harnessHome: home });
    addStoryMd(
      { projectRoot: backend },
      { id: "US-MON", title: "Monitored peer entity", lane: "normal" },
    );

    const handle = createMonitoredMcpHandler(
      frontend,
      { projectId: frontendId, projectMode: "single" },
      { harnessHome: home },
    );
    const response = JSON.parse(
      handle(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "harness_peer_get",
            arguments: { id: "US-MON", peer_id: backendId },
          },
        }),
      ),
    ) as RpcResponse;
    expect(textOf(response)).toContain("Monitored peer entity");

    const logPath = path.join(
      frontend,
      ".5harness",
      "local",
      "mcp-calls.jsonl",
    );
    const call = JSON.parse(fs.readFileSync(logPath, "utf8").trim()) as {
      project_id: string;
      project_root: string;
      tool_name: string;
    };
    expect(call).toMatchObject({
      project_id: frontendId,
      project_root: path.resolve(frontend),
      tool_name: "harness_peer_get",
    });
  });
});
