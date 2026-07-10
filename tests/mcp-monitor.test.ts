import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { McpCallInput } from "../src/domain/mcp-call-record.js";
import {
  appendMcpCall,
  clearMcpCalls,
  getMcpStats,
  listMcpCalls,
} from "../src/application/mcp-monitor.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-mcp-monitor-"));
  tempDirs.push(dir);
  return dir;
}

function makeCall(overrides?: Partial<McpCallInput>): McpCallInput {
  return {
    method: "tools/call",
    tool_name: "harness_get",
    input_summary: null,
    duration_ms: 42,
    status: "success",
    error_message: null,
    project_root: overrides?.project_root ?? "",
    ...overrides,
  };
}

describe("MCP monitor storage", () => {
  it("stores and retrieves MCP call records", () => {
    const root = tmp();
    const call = appendMcpCall(root, makeCall({ project_root: root }));
    expect(call.id).toBe(1);
    expect(call.method).toBe("tools/call");
    expect(call.tool_name).toBe("harness_get");
    expect(call.duration_ms).toBe(42);
    expect(call.status).toBe("success");
    expect(call.timestamp).toBeTruthy();

    const calls = listMcpCalls(root);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe(1);
  });

  it("auto-increments IDs across multiple calls", () => {
    const root = tmp();
    appendMcpCall(root, makeCall({ project_root: root }));
    appendMcpCall(root, makeCall({ project_root: root, tool_name: "harness_search" }));
    appendMcpCall(root, makeCall({ project_root: root, tool_name: "harness_status" }));
    expect(listMcpCalls(root)).toHaveLength(3);
    expect(listMcpCalls(root).map((c) => c.id)).toEqual([3, 2, 1]);
  });

  it("returns calls newest-first and respects limit", () => {
    const root = tmp();
    for (let i = 0; i < 10; i++) {
      appendMcpCall(root, makeCall({ project_root: root, method: "initialize" }));
    }
    const all = listMcpCalls(root);
    expect(all).toHaveLength(10);
    expect(all[0]!.id).toBe(10);
    expect(all[9]!.id).toBe(1);

    const limited = listMcpCalls(root, { limit: 3 });
    expect(limited).toHaveLength(3);
    expect(limited[0]!.id).toBe(10);
  });

  it("filters by method, tool_name, and status", () => {
    const root = tmp();
    appendMcpCall(root, makeCall({ project_root: root, method: "initialize", tool_name: null }));
    appendMcpCall(root, makeCall({ project_root: root, method: "tools/list", tool_name: null }));
    appendMcpCall(root, makeCall({ project_root: root, method: "tools/call", tool_name: "harness_get" }));
    appendMcpCall(root, makeCall({ project_root: root, method: "tools/call", tool_name: "harness_search", status: "error", error_message: "fail" }));
    appendMcpCall(root, makeCall({ project_root: root, method: "tools/call", tool_name: "harness_get" }));

    expect(listMcpCalls(root, { method: "initialize" })).toHaveLength(1);
    expect(listMcpCalls(root, { tool_name: "harness_get" })).toHaveLength(2);
    expect(listMcpCalls(root, { status: "error" })).toHaveLength(1);
    expect(listMcpCalls(root, { status: "success" })).toHaveLength(4);
  });

  it("computes accurate stats", () => {
    const root = tmp();
    appendMcpCall(root, makeCall({ project_root: root, tool_name: "harness_get", duration_ms: 10 }));
    appendMcpCall(root, makeCall({ project_root: root, tool_name: "harness_get", duration_ms: 20 }));
    appendMcpCall(root, makeCall({ project_root: root, tool_name: "harness_search", duration_ms: 30 }));
    appendMcpCall(root, makeCall({ project_root: root, tool_name: "harness_status", duration_ms: 40, status: "error", error_message: "timeout" }));

    const stats = getMcpStats(root);
    expect(stats.total_calls).toBe(4);
    expect(stats.error_count).toBe(1);
    expect(stats.error_rate).toBeCloseTo(0.25, 2);
    expect(stats.avg_duration_ms).toBeCloseTo(25, 0);
    expect(stats.by_tool["harness_get"]).toBe(2);
    expect(stats.by_tool["harness_search"]).toBe(1);
    expect(stats.by_tool["harness_status"]).toBe(1);
    expect(stats.recent_errors).toHaveLength(1);
    expect(stats.recent_errors[0]!.error_message).toBe("timeout");
  });

  it("clearMcpCalls removes the file", () => {
    const root = tmp();
    appendMcpCall(root, makeCall({ project_root: root }));
    expect(fs.existsSync(path.join(root, ".harness", "local", "mcp-calls.jsonl"))).toBe(true);
    clearMcpCalls(root);
    expect(fs.existsSync(path.join(root, ".harness", "local", "mcp-calls.jsonl"))).toBe(false);
    expect(listMcpCalls(root)).toHaveLength(0);
  });

  it("empty project returns empty results", () => {
    const root = tmp();
    expect(listMcpCalls(root)).toHaveLength(0);
    const stats = getMcpStats(root);
    expect(stats.total_calls).toBe(0);
    expect(stats.error_count).toBe(0);
    expect(stats.error_rate).toBe(0);
    expect(stats.avg_duration_ms).toBe(0);
    expect(Object.keys(stats.by_tool)).toHaveLength(0);
  });
});
