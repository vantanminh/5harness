/**
 * MCP (Model Context Protocol) handler for harness — HTTP transport.
 * Pure request/response: takes JSON-RPC 2.0 body, returns response string.
 * Used by dashboard at POST /mcp and standalone `harness mcp` HTTP server.
 *
 * Read tools (US-027) + mutation tools (US-041) share the same application
 * layer as the CLI so agents need not fall back to shell-only harness.
 * Auth/trust: local only (loopback / project-bound).
 */
import { VERSION } from "../version.js";
import { buildStatus, formatStatus } from "./status.js";
import { buildHandoff, formatHandoff } from "./handoff.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import {
  executeGet,
  executeSearch,
  executeLinks,
  executeReindex,
} from "../commands/index-tools.js";
import { executeContext } from "../commands/context.js";
import { executeQuery } from "../commands/query.js";
import { executeIntake } from "../commands/intake.js";
import {
  executeStoryAdd,
  executeStoryUpdate,
} from "../commands/story.js";
import { executeDecisionAdd } from "../commands/decision.js";
import { executeBacklogAdd } from "../commands/backlog.js";
import type { McpCallInput } from "../domain/mcp-call-record.js";
import { appendMcpCall } from "./mcp-monitor.js";
import {
  getProjectRole,
  hasProjectPeers,
  listProjectPeers,
  resolveProjectPeer,
} from "./project-link.js";
import type { RegistryIoOptions } from "../infrastructure/registry.js";

type RpcReq = {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
};
type RpcRes = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
};
export type McpTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

/** Read-only tools (US-027) + durable mutations (US-041). */
export const MCP_TOOLS: McpTool[] = [
  // --- reads ---
  {
    name: "harness_get",
    description: "Get a durable entity by ID or path.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, summary: { type: "boolean" } },
      required: ["id"],
    },
  },
  {
    name: "harness_search",
    description: "Search entity catalog with ranked hits and snippets.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "harness_links",
    description: "Show outbound links, backlinks, and broken targets.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "harness_context",
    description: "Budgeted entity context pack: body + links + proof.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        depth: { type: "number" },
        maxChars: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "harness_status",
    description:
      "Project snapshot: stories, intakes, backlog, version, index.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_query_matrix",
    description: "Story matrix: all stories with status, proof, evidence.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_query_stats",
    description: "Summary counts by category.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_handoff",
    description:
      "Session handoff: recent traces, worklog, status, next steps.",
    inputSchema: {
      type: "object",
      properties: { storyId: { type: "string" } },
    },
  },
  {
    name: "harness_doctor",
    description:
      "Workspace health checks (index, registry, entity dirs). Same as CLI doctor.",
    inputSchema: {
      type: "object",
      properties: { json: { type: "boolean" } },
    },
  },
  {
    name: "harness_reindex",
    description: "Rebuild derived markdown index from entity files.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_project_role",
    description: "Show the calling project's configured role and stack tags.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_project_peers",
    description:
      "List configured Project Link peers and machine-local resolution state.",
    inputSchema: { type: "object", properties: {} },
  },
  // --- mutations (same application layer as CLI; US-041) ---
  {
    name: "harness_intake",
    description:
      "Record a feature intake (type, summary, lane). Mutates durable markdown.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string" },
        summary: { type: "string" },
        lane: { type: "string" },
        flags: { type: "string" },
        docs: { type: "string" },
        story: { type: "string" },
        notes: { type: "string" },
        links: { type: "string" },
      },
      required: ["type", "summary", "lane"],
    },
  },
  {
    name: "harness_story_add",
    description: "Add a story entity. Mutates durable markdown.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        lane: { type: "string" },
        contract: { type: "string" },
        verify: { type: "string" },
        notes: { type: "string" },
        links: { type: "string" },
      },
      required: ["id", "title", "lane"],
    },
  },
  {
    name: "harness_story_update",
    description:
      "Update story status, proof flags, evidence. Mutates durable markdown.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
        evidence: { type: "string" },
        unit: { type: "string" },
        integration: { type: "string" },
        e2e: { type: "string" },
        platform: { type: "string" },
        verify: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        contract: { type: "string" },
        links: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "harness_decision_add",
    description: "Record a durable decision. Mutates markdown.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        status: { type: "string" },
        doc: { type: "string" },
        verify: { type: "string" },
        notes: { type: "string" },
        links: { type: "string" },
        force: { type: "boolean", description: "If true, overwrite an existing decision with the same id" },
      },
      required: ["id", "title"],
    },
  },
  {
    name: "harness_backlog_add",
    description: "Add a backlog improvement item. Mutates durable markdown.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        while: { type: "string" },
        pain: { type: "string" },
        suggestion: { type: "string" },
        risk: { type: "string" },
        predicted: { type: "string" },
        notes: { type: "string" },
        links: { type: "string" },
      },
      required: ["title"],
    },
  },
];

const PEER_MCP_TOOLS: McpTool[] = [
  {
    name: "harness_peer_search",
    description:
      "Search one configured peer's entity index with ranked, bounded snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        peer_id: { type: "string" },
        role: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "harness_peer_get",
    description: "Get one durable entity from a configured peer.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        peer_id: { type: "string" },
        role: { type: "string" },
        summary: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "harness_peer_context",
    description:
      "Build a maxChars-budgeted context pack for one configured peer entity.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        peer_id: { type: "string" },
        role: { type: "string" },
        depth: { type: "number" },
        maxChars: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "harness_peer_links",
    description:
      "Show outbound links, backlinks, and broken targets for one peer entity.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        peer_id: { type: "string" },
        role: { type: "string" },
      },
      required: ["id"],
    },
  },
];

export function getMcpTools(
  projectRoot?: string,
  _options: RegistryIoOptions = {},
): McpTool[] {
  if (!projectRoot) return [...MCP_TOOLS];
  try {
    return hasProjectPeers(projectRoot)
      ? [...MCP_TOOLS, ...PEER_MCP_TOOLS]
      : [...MCP_TOOLS];
  } catch {
    return [...MCP_TOOLS];
  }
}

const SERVER_INFO = { name: "harness-mcp", version: VERSION };

function capture(fn: () => void): string {
  const s = console.log;
  const b: string[] = [];
  console.log = (...a: unknown[]) => b.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    console.log = s;
  }
  return b.join("\n");
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  return String(v);
}

function peerRootForArgs(
  root: string,
  args: Record<string, unknown>,
  options: RegistryIoOptions,
): string {
  return resolveProjectPeer(
    {
      peerId: optStr(args, "peer_id"),
      role: optStr(args, "role"),
    },
    root,
    options,
  ).path;
}

function callTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
  options: RegistryIoOptions,
): { content: Array<{ type: "text"; text: string }> } {
  let t = "";
  switch (name) {
    case "harness_get":
      t = capture(() =>
        executeGet(String(args.id ?? ""), {
          dir: root,
          summary: Boolean(args.summary),
        } as never),
      );
      break;
    case "harness_search":
      t = capture(() =>
        executeSearch(String(args.query ?? ""), { dir: root } as never),
      );
      break;
    case "harness_links":
      t = capture(() =>
        executeLinks(String(args.id ?? ""), { dir: root } as never),
      );
      break;
    case "harness_context":
      t = capture(() =>
        executeContext(String(args.id ?? ""), {
          dir: root,
          depth: String(args.depth ?? "0"),
          maxChars: String(args.maxChars ?? "8000"),
        } as never),
      );
      break;
    case "harness_status":
      t = formatStatus(buildStatus(root), false);
      break;
    case "harness_query_matrix":
      t = capture(() => executeQuery("matrix", { dir: root } as never));
      break;
    case "harness_query_stats":
      t = capture(() => executeQuery("stats", { dir: root } as never));
      break;
    case "harness_handoff": {
      const sid = args.storyId ? String(args.storyId) : undefined;
      t = formatHandoff(buildHandoff(root, sid), false);
      break;
    }
    case "harness_doctor": {
      // Use application layer directly — avoid process.exitCode side effects.
      const report = runDoctor(root, options);
      t = formatDoctorReport(report, Boolean(args.json));
      if (!report.healthy) {
        t = `${t}\n\n(doctor: unhealthy — exit code 1 equivalent; hard-fail if required)`;
      }
      break;
    }
    case "harness_reindex":
      t = capture(() => executeReindex({ dir: root } as never));
      break;
    case "harness_project_role": {
      const project = getProjectRole(root);
      t = JSON.stringify({ role: project.role, stack: project.stack });
      break;
    }
    case "harness_project_peers":
      t = JSON.stringify(listProjectPeers(root, options));
      break;
    case "harness_peer_search":
      t = capture(() =>
        executeSearch(String(args.query ?? ""), {
          dir: peerRootForArgs(root, args, options),
          limit: optStr(args, "limit"),
        } as never),
      );
      break;
    case "harness_peer_get":
      t = capture(() =>
        executeGet(String(args.id ?? ""), {
          dir: peerRootForArgs(root, args, options),
          summary: Boolean(args.summary),
        } as never),
      );
      break;
    case "harness_peer_context":
      t = capture(() =>
        executeContext(String(args.id ?? ""), {
          dir: peerRootForArgs(root, args, options),
          depth: String(args.depth ?? "0"),
          maxChars: String(args.maxChars ?? "8000"),
        } as never),
      );
      break;
    case "harness_peer_links":
      t = capture(() =>
        executeLinks(String(args.id ?? ""), {
          dir: peerRootForArgs(root, args, options),
        } as never),
      );
      break;
    case "harness_intake":
      t = capture(() =>
        executeIntake({
          dir: root,
          type: String(args.type ?? ""),
          summary: String(args.summary ?? ""),
          lane: String(args.lane ?? ""),
          flags: optStr(args, "flags"),
          docs: optStr(args, "docs"),
          story: optStr(args, "story"),
          notes: optStr(args, "notes"),
          links: optStr(args, "links"),
        }),
      );
      break;
    case "harness_story_add":
      t = capture(() =>
        executeStoryAdd({
          dir: root,
          id: String(args.id ?? ""),
          title: String(args.title ?? ""),
          lane: String(args.lane ?? ""),
          contract: optStr(args, "contract"),
          verify: optStr(args, "verify"),
          notes: optStr(args, "notes"),
          links: optStr(args, "links"),
        }),
      );
      break;
    case "harness_story_update":
      t = capture(() =>
        executeStoryUpdate({
          dir: root,
          id: String(args.id ?? ""),
          status: optStr(args, "status"),
          evidence: optStr(args, "evidence"),
          unit: optStr(args, "unit"),
          integration: optStr(args, "integration"),
          e2e: optStr(args, "e2e"),
          platform: optStr(args, "platform"),
          verify: optStr(args, "verify"),
          title: optStr(args, "title"),
          notes: optStr(args, "notes"),
          contract: optStr(args, "contract"),
          links: optStr(args, "links"),
        }),
      );
      break;
    case "harness_decision_add":
      t = capture(() =>
        executeDecisionAdd({
          dir: root,
          id: String(args.id ?? ""),
          title: String(args.title ?? ""),
          status: optStr(args, "status"),
          doc: optStr(args, "doc"),
          verify: optStr(args, "verify"),
          notes: optStr(args, "notes"),
          links: optStr(args, "links"),
          force: Boolean(args.force),
        }),
      );
      break;
    case "harness_backlog_add":
      t = capture(() =>
        executeBacklogAdd({
          dir: root,
          title: String(args.title ?? ""),
          while: optStr(args, "while"),
          pain: optStr(args, "pain"),
          suggestion: optStr(args, "suggestion"),
          risk: optStr(args, "risk"),
          predicted: optStr(args, "predicted"),
          notes: optStr(args, "notes"),
          links: optStr(args, "links"),
        }),
      );
      break;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
  return { content: [{ type: "text", text: t || "(empty result)" }] };
}

function err(id: number | string, code: number, msg: string): RpcRes {
  return { jsonrpc: "2.0", id, error: { code, message: msg } };
}

/**
 * Input summary for monitoring (truncated JSON, max 500 chars).
 */
function summarizeInput(
  method: string,
  params?: Record<string, unknown>,
): string | null {
  if (!params || method !== "tools/call") return null;
  const args = params.arguments as Record<string, unknown> | undefined;
  if (!args) return null;
  const s = JSON.stringify(args);
  return s.length > 500 ? s.slice(0, 497) + "..." : s;
}

function dispatch(
  root: string | undefined,
  req: RpcReq,
  options: RegistryIoOptions = {},
): { result: RpcRes | null; callInfo?: McpCallInput } {
  const { id, method, params } = req;
  if (id === undefined) return { result: null };
  const startMs = Date.now();
  const inputSum = summarizeInput(method, params);
  const recordRoot = root ?? "";
  try {
    switch (method) {
      case "initialize":
        return {
          result: {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              serverInfo: SERVER_INFO,
              capabilities: { tools: {} },
            },
          },
          callInfo: {
            method,
            tool_name: null,
            input_summary: null,
            duration_ms: Date.now() - startMs,
            status: "success",
            error_message: null,
            project_root: recordRoot,
          },
        };
      case "tools/list":
        return {
          result: {
            jsonrpc: "2.0",
            id,
            result: { tools: getMcpTools(root, options) },
          },
          callInfo: {
            method,
            tool_name: null,
            input_summary: null,
            duration_ms: Date.now() - startMs,
            status: "success",
            error_message: null,
            project_root: recordRoot,
          },
        };
      case "tools/call": {
        const p = params as { name?: string; arguments?: Record<string, unknown> };
        if (!root) {
          const message =
            "MCP project is unbound. Complete OAuth project authorization before calling tools.";
          return {
            result: err(id, -32001, message),
            callInfo: {
              method,
              tool_name: p?.name ?? null,
              input_summary: inputSum,
              duration_ms: Date.now() - startMs,
              status: "error",
              error_message: message,
              project_root: recordRoot,
            },
          };
        }
        if (!p?.name) {
          return {
            result: err(id, -32602, "Missing tool name"),
            callInfo: {
              method,
              tool_name: null,
              input_summary: inputSum,
              duration_ms: Date.now() - startMs,
              status: "error",
              error_message: "Missing tool name",
              project_root: recordRoot,
            },
          };
        }
        try {
          if (!getMcpTools(root, options).some((tool) => tool.name === p.name)) {
            throw new Error(`Tool not available for this project: ${p.name}`);
          }
          const toolResult = callTool(
            root,
            p.name,
            p.arguments ?? {},
            options,
          );
          return {
            result: { jsonrpc: "2.0", id, result: toolResult },
            callInfo: {
              method,
              tool_name: p.name,
              input_summary: inputSum,
              duration_ms: Date.now() - startMs,
              status: "success",
              error_message: null,
              project_root: recordRoot,
            },
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            result: err(id, -32603, msg),
            callInfo: {
              method,
              tool_name: p.name,
              input_summary: inputSum,
              duration_ms: Date.now() - startMs,
              status: "error",
              error_message: msg,
              project_root: recordRoot,
            },
          };
        }
      }
      default:
        return {
          result: err(id, -32601, `Method not found: ${method}`),
          callInfo: {
            method,
            tool_name: null,
            input_summary: null,
            duration_ms: Date.now() - startMs,
            status: "error",
            error_message: `Method not found: ${method}`,
            project_root: recordRoot,
          },
        };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      result: err(id, -32603, msg),
      callInfo: {
        method,
        tool_name: null,
        input_summary: null,
        duration_ms: Date.now() - startMs,
        status: "error",
        error_message: msg,
        project_root: recordRoot,
      },
    };
  }
}

/**
 * Streamable HTTP status for a `handleMcpRequest` result body.
 *
 * MCP Streamable HTTP requires notification-only POSTs (no JSON-RPC response)
 * to return **202 Accepted with no body**. Returning `200` + empty
 * `application/json` body breaks strict clients such as Codex CLI (rmcp),
 * which try to deserialize the empty body and fail at
 * `notifications/initialized`.
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */
export function mcpStreamableHttpStatus(responseBody: string): 200 | 202 {
  return responseBody.length === 0 ? 202 : 200;
}

/** Handle a JSON-RPC body string (single request or batch array), return the response string (or "" for notifications-only). */
export function handleMcpRequest(
  body: string,
  projectRoot?: string,
  onCall?: (info: McpCallInput) => void,
  options: RegistryIoOptions = {},
): string {
  const recordRoot = projectRoot ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    const resp = JSON.stringify(err(0, -32700, "Parse error"));
    if (onCall)
      onCall({
        method: "<parse-error>",
        tool_name: null,
        input_summary: body.slice(0, 200),
        duration_ms: 0,
        status: "error",
        error_message: "Parse error",
        project_root: recordRoot,
      });
    return resp;
  }

  // JSON-RPC 2.0 batch: array of request objects → process sequentially, return array of responses.
  // Notifications (id: undefined) are processed but produce no response entry.
  if (Array.isArray(parsed)) {
    const batch = parsed as RpcReq[];
    if (batch.length === 0) {
      return JSON.stringify(err(0, -32600, "Invalid Request: empty batch"));
    }
    const responses: RpcRes[] = [];
    for (const req of batch) {
      if (!req || typeof req !== "object") {
        responses.push(err(0, -32600, "Invalid Request: non-object in batch"));
        continue;
      }
      // Process sequentially — mutations must not race.
      const { result, callInfo } = dispatch(projectRoot, req, options);
      if (result) responses.push(result);
      if (callInfo && onCall) onCall(callInfo);
    }
    return responses.length > 0 ? JSON.stringify(responses) : "";
  }

  const req = parsed as RpcReq;
  if (!req || typeof req !== "object" || req.jsonrpc !== "2.0") {
    const id = (req as RpcReq)?.id ?? 0;
    const resp = JSON.stringify(err(id, -32600, "Invalid Request"));
    if (onCall)
      onCall({
        method: (req as RpcReq)?.method ?? "<invalid>",
        tool_name: null,
        input_summary: null,
        duration_ms: 0,
        status: "error",
        error_message: "Invalid Request",
        project_root: recordRoot,
      });
    return resp;
  }
  const { result, callInfo } = dispatch(projectRoot, req, options);
  if (callInfo && onCall) onCall(callInfo);
  return result ? JSON.stringify(result) : "";
}

/**
 * Create a wrapped MCP handler that automatically persists call records to disk.
 * Used by the dashboard HTTP server (which has the project root context).
 */
export function createMonitoredMcpHandler(
  projectRoot: string,
  binding?: { projectId: string; projectMode: "single" | "all" },
  options: RegistryIoOptions = {},
): (body: string) => string {
  return (body: string) => {
    return handleMcpRequest(
      body,
      projectRoot,
      (info) => {
        try {
          appendMcpCall(projectRoot, {
            ...info,
            project_id: binding?.projectId ?? null,
            project_mode: binding?.projectMode ?? null,
          });
        } catch {
          // monitoring write failures are non-fatal
        }
      },
      options,
    );
  };
}
