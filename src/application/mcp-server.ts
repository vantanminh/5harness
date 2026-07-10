/**
 * MCP (Model Context Protocol) handler for harness — HTTP transport.
 * Pure request/response: takes JSON-RPC 2.0 body, returns response string.
 * Used by dashboard at POST /mcp and standalone `harness mcp` HTTP server.
 */
import { buildStatus, formatStatus } from "./status.js";
import { buildHandoff, formatHandoff } from "./handoff.js";
import { executeGet, executeSearch, executeLinks } from "../commands/index-tools.js";
import { executeContext } from "../commands/context.js";
import { executeQuery } from "../commands/query.js";
import type { McpCallInput } from "../domain/mcp-call-record.js";
import { appendMcpCall } from "./mcp-monitor.js";

type RpcReq = { jsonrpc: "2.0"; id?: number | string; method: string; params?: Record<string, unknown> };
type RpcRes = { jsonrpc: "2.0"; id: number | string; result?: unknown; error?: { code: number; message: string } };
type McpTool = { name: string; description: string; inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] } };

export const MCP_TOOLS: McpTool[] = [
  { name: "harness_get", description: "Get a durable entity by ID or path.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, summary: { type: "boolean" } }, required: ["id"] } },
  { name: "harness_search", description: "Search entity catalog with ranked hits and snippets.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "harness_links", description: "Show outbound links, backlinks, and broken targets.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "harness_context", description: "Budgeted entity context pack: body + links + proof.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, depth: { type: "number" }, maxChars: { type: "number" } }, required: ["id"] } },
  { name: "harness_status", description: "Project snapshot: stories, intakes, backlog, version, index.",
    inputSchema: { type: "object", properties: {} } },
  { name: "harness_query_matrix", description: "Story matrix: all stories with status, proof, evidence.",
    inputSchema: { type: "object", properties: {} } },
  { name: "harness_query_stats", description: "Summary counts by category.",
    inputSchema: { type: "object", properties: {} } },
  { name: "harness_handoff", description: "Session handoff: recent traces, worklog, status, next steps.",
    inputSchema: { type: "object", properties: { storyId: { type: "string" } } } },
];

const SERVER_INFO = { name: "harness-mcp", version: "0.10.2" };

function capture(fn: () => void): string {
  const s = console.log; const b: string[] = [];
  console.log = (...a: unknown[]) => b.push(a.map(String).join(" "));
  try { fn(); } finally { console.log = s; }
  return b.join("\n");
}

function callTool(root: string, name: string, args: Record<string, unknown>): { content: Array<{ type: "text"; text: string }> } {
  let t = "";
  switch (name) {
    case "harness_get":
      t = capture(() => executeGet(String(args.id ?? ""), { dir: root, summary: Boolean(args.summary) } as never)); break;
    case "harness_search":
      t = capture(() => executeSearch(String(args.query ?? ""), { dir: root } as never)); break;
    case "harness_links":
      t = capture(() => executeLinks(String(args.id ?? ""), { dir: root } as never)); break;
    case "harness_context":
      t = capture(() => executeContext(String(args.id ?? ""), { dir: root, depth: String(args.depth ?? "0"), maxChars: String(args.maxChars ?? "8000") } as never)); break;
    case "harness_status":
      t = formatStatus(buildStatus(root), false); break;
    case "harness_query_matrix":
      t = capture(() => executeQuery("matrix", { dir: root } as never)); break;
    case "harness_query_stats":
      t = capture(() => executeQuery("stats", { dir: root } as never)); break;
    case "harness_handoff": {
      const sid = args.storyId ? String(args.storyId) : undefined;
      t = formatHandoff(buildHandoff(root, sid), false); break; }
    default: throw new Error(`Unknown tool: ${name}`);
  }
  return { content: [{ type: "text", text: t || "(empty result)" }] };
}

function err(id: number | string, code: number, msg: string): RpcRes {
  return { jsonrpc: "2.0", id, error: { code, message: msg } };
}

/**
 * Input summary for monitoring (truncated JSON, max 500 chars).
 */
function summarizeInput(method: string, params?: Record<string, unknown>): string | null {
  if (!params || method !== "tools/call") return null;
  const args = params.arguments as Record<string, unknown> | undefined;
  if (!args) return null;
  const s = JSON.stringify(args);
  return s.length > 500 ? s.slice(0, 497) + "..." : s;
}
function dispatch(root: string, req: RpcReq): { result: RpcRes | null; callInfo?: McpCallInput } {
  const { id, method, params } = req;
  if (id === undefined) return { result: null };
  const startMs = Date.now();
  const inputSum = summarizeInput(method, params);
  try {
    switch (method) {
      case "initialize":
        return {
          result: { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: SERVER_INFO, capabilities: { tools: {} } } },
          callInfo: { method, tool_name: null, input_summary: null, duration_ms: Date.now() - startMs, status: "success", error_message: null, project_root: root },
        };
      case "tools/list":
        return {
          result: { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } },
          callInfo: { method, tool_name: null, input_summary: null, duration_ms: Date.now() - startMs, status: "success", error_message: null, project_root: root },
        };
      case "tools/call": {
        const p = params as { name?: string; arguments?: Record<string, unknown> };
        if (!p?.name) {
          return {
            result: err(id, -32602, "Missing tool name"),
            callInfo: { method, tool_name: null, input_summary: inputSum, duration_ms: Date.now() - startMs, status: "error", error_message: "Missing tool name", project_root: root },
          };
        }
        try {
          const toolResult = callTool(root, p.name, p.arguments ?? {});
          return {
            result: { jsonrpc: "2.0", id, result: toolResult },
            callInfo: { method, tool_name: p.name, input_summary: inputSum, duration_ms: Date.now() - startMs, status: "success", error_message: null, project_root: root },
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            result: err(id, -32603, msg),
            callInfo: { method, tool_name: p.name, input_summary: inputSum, duration_ms: Date.now() - startMs, status: "error", error_message: msg, project_root: root },
          };
        }
      }
      default:
        return {
          result: err(id, -32601, `Method not found: ${method}`),
          callInfo: { method, tool_name: null, input_summary: null, duration_ms: Date.now() - startMs, status: "error", error_message: `Method not found: ${method}`, project_root: root },
        };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      result: err(id, -32603, msg),
      callInfo: { method, tool_name: null, input_summary: null, duration_ms: Date.now() - startMs, status: "error", error_message: msg, project_root: root },
    };
  }
}

/** Handle a JSON-RPC body string, return the response string (or "" for notifications). */
export function handleMcpRequest(
  body: string,
  projectRoot?: string,
  onCall?: (info: McpCallInput) => void,
): string {
  const root = projectRoot ?? process.cwd();
  let req: RpcReq;
  try { req = JSON.parse(body) as RpcReq; } catch {
    const resp = JSON.stringify(err(0, -32700, "Parse error"));
    if (onCall) onCall({ method: "<parse-error>", tool_name: null, input_summary: body.slice(0, 200), duration_ms: 0, status: "error", error_message: "Parse error", project_root: root });
    return resp;
  }
  if (req.jsonrpc !== "2.0") {
    const resp = JSON.stringify(err(req.id ?? 0, -32600, "Invalid Request"));
    if (onCall) onCall({ method: req.method ?? "<invalid>", tool_name: null, input_summary: null, duration_ms: 0, status: "error", error_message: "Invalid Request", project_root: root });
    return resp;
  }
  const { result, callInfo } = dispatch(root, req);
  if (callInfo && onCall) onCall(callInfo);
  return result ? JSON.stringify(result) : "";
}

/**
 * Create a wrapped MCP handler that automatically persists call records to disk.
 * Used by the dashboard HTTP server (which has the project root context).
 */
export function createMonitoredMcpHandler(projectRoot: string): (body: string) => string {
  return (body: string) => {
    return handleMcpRequest(body, projectRoot, (info) => {
      try {
        appendMcpCall(projectRoot, info);
      } catch {
        // monitoring write failures are non-fatal
      }
    });
  };
}

