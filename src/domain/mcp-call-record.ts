/**
 * MCP (Model Context Protocol) call record — durable local log.
 * Stored in `.5harness/local/mcp-calls.jsonl` (JSONL format, same pattern as traces).
 */
export type McpCallRecord = {
  id: number;
  timestamp: string;
  method: string; // "initialize" | "tools/list" | "tools/call"
  tool_name: string | null; // only for "tools/call"
  /** Truncated JSON of input arguments (first 500 chars) */
  input_summary: string | null;
  duration_ms: number;
  status: "success" | "error";
  error_message: string | null;
  project_root: string;
};

/** Input type for appendMcpCall — id and timestamp are optional (auto-generated). */
export type McpCallInput = Omit<McpCallRecord, "id" | "timestamp"> & {
  id?: number;
  timestamp?: string;
};

export type McpCallStats = {
  total_calls: number;
  error_count: number;
  error_rate: number; // 0-1
  avg_duration_ms: number;
  by_tool: Record<string, number>;
  by_method: Record<string, number>;
  /** Calls per hour for the last 24h (array of 24 slots) */
  calls_per_hour: number[];
  /** Last 10 errors */
  recent_errors: McpCallRecord[];
};

export type McpCallFilter = {
  limit?: number;
  offset?: number;
  method?: string;
  tool_name?: string;
  status?: "success" | "error";
};
