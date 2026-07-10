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

function dispatch(root: string, req: RpcReq): RpcRes | null {
  const { id, method, params } = req;
  if (id === undefined) return null;
  try {
    switch (method) {
      case "initialize":
        return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: SERVER_INFO, capabilities: { tools: {} } } };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
      case "tools/call": {
        const p = params as { name?: string; arguments?: Record<string, unknown> };
        if (!p?.name) return err(id, -32602, "Missing tool name");
        return { jsonrpc: "2.0", id, result: callTool(root, p.name, p.arguments ?? {}) };
      }
      default:
        return err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return err(id, -32603, e instanceof Error ? e.message : String(e));
  }
}

/** Handle a JSON-RPC body string, return the response string (or "" for notifications). */
export function handleMcpRequest(body: string, projectRoot?: string): string {
  const root = projectRoot ?? process.cwd();
  let req: RpcReq;
  try { req = JSON.parse(body) as RpcReq; } catch {
    return JSON.stringify(err(0, -32700, "Parse error"));
  }
  if (req.jsonrpc !== "2.0") {
    return JSON.stringify(err(req.id ?? 0, -32600, "Invalid Request"));
  }
  const res = dispatch(root, req);
  return res ? JSON.stringify(res) : "";
}
