import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleDashboardRequest,
  type DashboardOptions,
} from "../src/application/dashboard.js";
import { appendMcpCall } from "../src/application/mcp-monitor.js";
import { addStoryMd } from "../src/application/md-durable.js";
import { linkProject } from "../src/application/registry.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("dashboard MCP monitor API and page", () => {
  function setup(): { home: string; project: string; opts: DashboardOptions } {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-mcp-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-mcp-proj-"));
    tempDirs.push(home, project);

    addStoryMd(
      { projectRoot: project },
      { id: "US-MCP", title: "MCP story", lane: "tiny" },
    );
    linkProject(project, { env: { ...process.env, HARNESS_HOME: home } });

    // Add some MCP call records
    appendMcpCall(project, {
      method: "initialize",
      tool_name: null,
      input_summary: null,
      duration_ms: 5,
      status: "success",
      error_message: null,
      project_root: project,
    });
    appendMcpCall(project, {
      method: "tools/call",
      tool_name: "harness_get",
      input_summary: '{"id":"US-MCP"}',
      duration_ms: 42,
      status: "success",
      error_message: null,
      project_root: project,
    });
    appendMcpCall(project, {
      method: "tools/call",
      tool_name: "harness_search",
      input_summary: '{"query":"test"}',
      duration_ms: 100,
      status: "error",
      error_message: "not found",
      project_root: project,
    });

    return {
      home,
      project,
      opts: { env: { ...process.env, HARNESS_HOME: home } },
    };
  }

  it("serves MCP calls API", () => {
    const { project, opts } = setup();
    const res = handleDashboardRequest(
      "GET",
      `/api/mcp-calls?project=${encodeURIComponent(project)}`,
      opts,
    );
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("json");
    const data = JSON.parse(res.body) as Array<{ method: string; tool_name: string | null; status: string }>;
    expect(data).toHaveLength(3);
    expect(data[0]!.method).toBe("tools/call");
    expect(data[0]!.tool_name).toBe("harness_search");
    expect(data[1]!.method).toBe("tools/call");
    expect(data[2]!.method).toBe("initialize");
  });

  it("serves MCP stats API", () => {
    const { project, opts } = setup();
    const res = handleDashboardRequest(
      "GET",
      `/api/mcp-stats?project=${encodeURIComponent(project)}`,
      opts,
    );
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("json");
    const stats = JSON.parse(res.body) as {
      total_calls: number;
      error_count: number;
      error_rate: number;
      by_tool: Record<string, number>;
    };
    expect(stats.total_calls).toBe(3);
    expect(stats.error_count).toBe(1);
    expect(stats.error_rate).toBeCloseTo(1 / 3, 2);
    expect(stats.by_tool["harness_get"]).toBe(1);
    expect(stats.by_tool["harness_search"]).toBe(1);
  });

  it("returns 404 for unknown project", () => {
    const res = handleDashboardRequest(
      "GET",
      "/api/mcp-calls?project=nonexistent",
    );
    expect(res.status).toBe(404);

    const statsRes = handleDashboardRequest(
      "GET",
      "/api/mcp-stats?project=nonexistent",
    );
    expect(statsRes.status).toBe(404);
  });

  it("serves MCP monitor HTML page", () => {
    const { project, opts } = setup();
    const res = handleDashboardRequest(
      "GET",
      `/monitor?id=${encodeURIComponent(project)}`,
      opts,
    );
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("html");
    expect(res.body).toMatch(/MCP Monitor/);
    expect(res.body).toMatch(/Total Calls/);
    expect(res.body).toMatch(/Error Rate/);
    expect(res.body).toMatch(/Avg Duration/);
    expect(res.body).toMatch(/Tools Used/);
    expect(res.body).toMatch(/Call Log/);
    expect(res.body).toMatch(/Recent Errors/);
    expect(res.body).toMatch(/harness_get/);
    expect(res.body).toMatch(/harness_search/);
    expect(res.body).toMatch(/not found/);
  });

  it("shows 'No MCP calls recorded yet' for empty project", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-mcp-empty-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dash-mcp-empty-proj-"));
    tempDirs.push(home, project);
    linkProject(project, { env: { ...process.env, HARNESS_HOME: home } });
    const opts = { env: { ...process.env, HARNESS_HOME: home } };

    const res = handleDashboardRequest(
      "GET",
      `/monitor?id=${encodeURIComponent(project)}`,
      opts,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/No MCP calls recorded/);
  });
});
