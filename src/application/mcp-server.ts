/**
 * Minimal MCP (Model Context Protocol) server for harness.
 * JSON-RPC 2.0 over stdio. Local only, no auth.
 */
import * as readline from "node:readline";
import { buildStatus, formatStatus } from "./status.js";
import { buildHandoff, formatHandoff } from "./handoff.js";
import { executeGet, executeSearch, executeLinks } from "../commands/index-tools.js";
import { executeContext } from "../commands/context.js";
import { executeQuery } from "../commands/query.js";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
};
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
};
type McpTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

let projectRoot: string | null = null;

const TOOLS: McpTool[] = [
  {
    name: "harness_get",
    description: "Get a durable entity by ID or path. Returns frontmatter and body.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Entity ID (e.g. US-001) or relative path" },
        summary: { type: "boolean", description: "Return only frontmatter summary" },
      },
      required: ["id"],
    },
  },
  {
    name: "harness_search",
    description: "Search entity catalog. Returns ranked hits with id, type, title, score, snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
      },
      required: ["query"],
    },
  },
  {
    name: "harness_links",
    description: "Show outbound links, backlinks, and broken targets for an entity.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Entity ID to inspect links for" },
      },
      required: ["id"],
    },
  },
  {
    name: "harness_context",
    description: "Budgeted entity context pack: body + outbound/backlinks summaries + proof flags.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Entity ID to build context for" },
        depth: { type: "number", description: "Link depth: 0 = summaries, 1 = include excerpts" },
        maxChars: { type: "number", description: "Max character budget (default: 8000)" },
      },
      required: ["id"],
    },
  },
  {
    name: "harness_status",
    description: "Project snapshot: open/in-progress stories, recent intakes, backlog, version, index.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_query_matrix",
    description: "Story matrix: all stories with status, proof flags, evidence.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_query_stats",
    description: "Summary counts: stories by status, intakes, decisions, backlog, traces.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_handoff",
    description: "Session handoff summary: recent traces, worklog, status, next steps.",
    inputSchema: {
      type: "object",
      properties: {
        storyId: { type: "string", description: "Optional story ID to focus handoff on" },
      },
    },
  },
];

const SERVER_INFO = { name: "harness-mcp", version: "0.10.1" };

const CAPABILITIES = { tools: {} };

function respond(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + "\n");
}

function respondOk(id: number | string, result: unknown): void {
  respond({ jsonrpc: "2.0", id, result });
}

function respondErr(id: number | string, code: number, message: string): void {
  respond({ jsonrpc: "2.0", id, error: { code, message } });
}

function captureConsole(fn: () => void): string {
  const save = console.log;
  const buf: string[] = [];
  console.log = (...args: unknown[]) => {
    buf.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = save;
  }
  return buf.join("\n");
}

function callTool(
  name: string,
  args: Record<string, unknown>,
): { content: Array<{ type: "text"; text: string }> } {
  if (!projectRoot) throw new Error("Not initialized. Send initialize first.");
  const root = projectRoot;
  let text = "";

  switch (name) {
    case "harness_get": {
      const id = String(args.id ?? "");
      const summary = Boolean(args.summary);
      text = captureConsole(() => executeGet(id, { dir: root, summary } as never));
      break;
    }
    case "harness_search":
      text = captureConsole(() =>
        executeSearch(String(args.query ?? ""), { dir: root } as never));
      break;
    case "harness_links":
      text = captureConsole(() =>
        executeLinks(String(args.id ?? ""), { dir: root } as never));
      break;
    case "harness_context":
      text = captureConsole(() =>
        executeContext(String(args.id ?? ""), {
          dir: root,
          depth: String(args.depth ?? "0"),
          maxChars: String(args.maxChars ?? "8000"),
        } as never));
      break;
    case "harness_status":
      text = formatStatus(buildStatus(root), false);
      break;
    case "harness_query_matrix":
      text = captureConsole(() => executeQuery("matrix", { dir: root } as never));
      break;
    case "harness_query_stats":
      text = captureConsole(() => executeQuery("stats", { dir: root } as never));
      break;
    case "harness_handoff": {
      const storyId = args.storyId ? String(args.storyId) : undefined;
      text = formatHandoff(buildHandoff(root, storyId), false);
      break;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return { content: [{ type: "text", text: text || "(empty result)" }] };
}

function dispatch(req: JsonRpcRequest): void {
  const { id, method, params } = req;
  if (id === undefined) return;

  try {
    switch (method) {
      case "initialize": {
        projectRoot =
          ((params as Record<string, unknown> | undefined)?.projectRoot as string) ??
          process.cwd();
        respondOk(id, {
          protocolVersion: "2024-11-05",
          serverInfo: SERVER_INFO,
          capabilities: CAPABILITIES,
        });
        break;
      }
      case "tools/list":
        respondOk(id, { tools: TOOLS });
        break;
      case "tools/call": {
        const p = params as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        if (!p?.name) {
          respondErr(id, -32602, "Missing tool name");
          return;
        }
        respondOk(id, callTool(p.name, p.arguments ?? {}));
        break;
      }
      default:
        respondErr(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    respondErr(
      id,
      -32603,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function startMcpServer(dir?: string): void {
  if (dir) projectRoot = dir;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      process.stderr.write(
        `[harness-mcp] Invalid JSON: ${trimmed.slice(0, 100)}\n`,
      );
      return;
    }

    if (request.jsonrpc !== "2.0") {
      process.stderr.write(
        `[harness-mcp] Bad jsonrpc version: ${request.jsonrpc}\n`,
      );
      return;
    }

    dispatch(request);
  });

  rl.on("close", () => {
    process.stderr.write("[harness-mcp] stdin closed.\n");
    process.exit(0);
  });

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  process.stderr.write(
    `[harness-mcp] Server started (v${SERVER_INFO.version}).\n`,
  );
}

