import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleMcpRequest,
  MCP_TOOLS,
} from "../src/application/mcp-server.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-mcp-mut-"));
  // Minimal entity dirs so writes succeed
  for (const d of ["docs/stories", "docs/decisions", "docs/intakes", "docs/backlog"]) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  tempDirs.push(dir);
  return dir;
}

function rpc(
  root: string,
  method: string,
  params?: Record<string, unknown>,
  id = 1,
): { result?: unknown; error?: { code: number; message: string } } {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });
  const raw = handleMcpRequest(body, root);
  return JSON.parse(raw) as {
    result?: unknown;
    error?: { code: number; message: string };
  };
}

function toolText(res: {
  result?: unknown;
  error?: { code: number; message: string };
}): string {
  expect(res.error, JSON.stringify(res.error)).toBeUndefined();
  const r = res.result as {
    content?: Array<{ type: string; text: string }>;
  };
  return r.content?.map((c) => c.text).join("\n") ?? "";
}

describe("MCP mutation tools (US-041)", () => {
  it("fails closed instead of falling back to cwd when unbound", () => {
    const raw = handleMcpRequest(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "harness_status", arguments: {} },
      }),
    );
    const response = JSON.parse(raw) as {
      error?: { code: number; message: string };
    };
    expect(response.error?.code).toBe(-32001);
    expect(response.error?.message).toMatch(/project is unbound/i);
  });

  it("lists mutation tools alongside reads", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toContain("harness_get");
    expect(names).toContain("harness_intake");
    expect(names).toContain("harness_story_add");
    expect(names).toContain("harness_story_update");
    expect(names).toContain("harness_decision_add");
    expect(names).toContain("harness_backlog_add");
    expect(names).toContain("harness_reindex");
    expect(names).toContain("harness_doctor");
    expect(names.length).toBeGreaterThanOrEqual(15);
  });

  it("tools/list returns expanded tool set", () => {
    const root = tmp();
    const res = rpc(root, "tools/list");
    const tools = (res.result as { tools: { name: string }[] }).tools;
    expect(tools.some((t) => t.name === "harness_story_add")).toBe(true);
  });

  it("intake + story_add + story_update via same CLI layer", () => {
    const root = tmp();
    const intake = toolText(
      rpc(root, "tools/call", {
        name: "harness_intake",
        arguments: {
          type: "spec_slice",
          summary: "MCP mutation smoke",
          lane: "tiny",
        },
      }),
    );
    expect(intake).toMatch(/Intake IN-\d+/);

    const add = toolText(
      rpc(root, "tools/call", {
        name: "harness_story_add",
        arguments: {
          id: "US-MCP-1",
          title: "MCP story",
          lane: "tiny",
        },
      }),
    );
    expect(add).toContain("Story US-MCP-1 added");
    expect(
      fs.existsSync(path.join(root, "docs", "stories", "US-MCP-1.md")),
    ).toBe(true);

    const upd = toolText(
      rpc(root, "tools/call", {
        name: "harness_story_update",
        arguments: {
          id: "US-MCP-1",
          status: "implemented",
          unit: "1",
          evidence: "mcp unit test",
        },
      }),
    );
    expect(upd).toContain("Story US-MCP-1 updated");
    const body = fs.readFileSync(
      path.join(root, "docs", "stories", "US-MCP-1.md"),
      "utf8",
    );
    expect(body).toContain("implemented");
    expect(body).toContain("mcp unit test");
  });

  it("decision_add and backlog_add write entity files", () => {
    const root = tmp();
    const d = toolText(
      rpc(root, "tools/call", {
        name: "harness_decision_add",
        arguments: {
          id: "mcp-dec-1",
          title: "MCP decisions work",
          status: "accepted",
        },
      }),
    );
    expect(d).toContain("Decision mcp-dec-1 added");

    const b = toolText(
      rpc(root, "tools/call", {
        name: "harness_backlog_add",
        arguments: { title: "Improve MCP docs", risk: "tiny" },
      }),
    );
    expect(b).toMatch(/Backlog BL-\d+ added/);
  });

  it("reindex and doctor run without process exit", () => {
    const root = tmp();
    const re = toolText(
      rpc(root, "tools/call", { name: "harness_reindex", arguments: {} }),
    );
    expect(re.toLowerCase()).toMatch(/reindex/);

    const doc = toolText(
      rpc(root, "tools/call", { name: "harness_doctor", arguments: {} }),
    );
    expect(doc.length).toBeGreaterThan(10);
  });

  it("returns JSON-RPC error on invalid mutation args", () => {
    const root = tmp();
    const res = rpc(root, "tools/call", {
      name: "harness_story_add",
      arguments: { id: "X" }, // missing title/lane
    });
    expect(res.error).toBeDefined();
    expect(res.error!.message).toMatch(/story add requires/i);
  });
});
