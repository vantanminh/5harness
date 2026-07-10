/**
 * MCP Monitor — local JSONL storage for MCP call records.
 * File: `.harness/local/mcp-calls.jsonl`
 * Pattern follows local-traces.ts (same JSONL approach).
 */
import fs from "node:fs";
import path from "node:path";
import type { McpCallFilter, McpCallInput, McpCallRecord, McpCallStats } from "../domain/mcp-call-record.js";

export function mcpCallsPath(projectRoot: string): string {
  return path.join(projectRoot, ".harness", "local", "mcp-calls.jsonl");
}

function ensureDir(projectRoot: string): void {
  fs.mkdirSync(path.join(projectRoot, ".harness", "local"), { recursive: true });
}

export function listMcpCalls(
  projectRoot: string,
  filter?: McpCallFilter,
): McpCallRecord[] {
  const file = mcpCallsPath(projectRoot);
  if (!fs.existsSync(file)) return [];
  const lines = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  const out: McpCallRecord[] = [];
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as McpCallRecord;
      if (filter?.method && rec.method !== filter.method) continue;
      if (filter?.tool_name && rec.tool_name !== filter.tool_name) continue;
      if (filter?.status && rec.status !== filter.status) continue;
      out.push(rec);
    } catch {
      // skip corrupt lines
    }
  }
  // newest first
  out.sort((a, b) => (a.id < b.id ? 1 : -1));
  const offset = filter?.offset ?? 0;
  const limit = filter?.limit ?? 50;
  return out.slice(offset, offset + limit);
}

export function appendMcpCall(
  projectRoot: string,
  record: McpCallInput,
): McpCallRecord {
  ensureDir(projectRoot);
  const all = listMcpCalls(projectRoot);
  const maxId = all.length > 0 ? Math.max(...all.map((r) => r.id)) : 0;
  const full: McpCallRecord = {
    id: record.id ?? maxId + 1,
    timestamp: record.timestamp ?? new Date().toISOString(),
    method: record.method,
    tool_name: record.tool_name ?? null,
    input_summary: record.input_summary ?? null,
    duration_ms: record.duration_ms,
    status: record.status,
    error_message: record.error_message ?? null,
    project_root: record.project_root,
  };
  fs.appendFileSync(
    mcpCallsPath(projectRoot),
    `${JSON.stringify(full)}\n`,
    "utf8",
  );
  return full;
}

export function getMcpStats(projectRoot: string): McpCallStats {
  const all = listMcpCalls(projectRoot, { limit: 10000 });
  const total_calls = all.length;
  const errors = all.filter((r) => r.status === "error");
  const error_count = errors.length;
  const error_rate = total_calls > 0 ? error_count / total_calls : 0;
  const totalDuration = all.reduce((s, r) => s + r.duration_ms, 0);
  const avg_duration_ms = total_calls > 0 ? totalDuration / total_calls : 0;

  const by_tool: Record<string, number> = {};
  const by_method: Record<string, number> = {};
  for (const r of all) {
    by_method[r.method] = (by_method[r.method] ?? 0) + 1;
    if (r.tool_name) {
      by_tool[r.tool_name] = (by_tool[r.tool_name] ?? 0) + 1;
    }
  }

  // calls per hour for last 24h
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const calls_per_hour = new Array<number>(24).fill(0);
  for (const r of all) {
    const t = new Date(r.timestamp).getTime();
    const hoursAgo = Math.floor((now - t) / oneHour);
    if (hoursAgo >= 0 && hoursAgo < 24) {
      calls_per_hour[23 - hoursAgo]++;
    }
  }

  const recent_errors = [...errors]
    .sort((a, b) => (a.id < b.id ? 1 : -1))
    .slice(0, 10);

  return {
    total_calls,
    error_count,
    error_rate,
    avg_duration_ms,
    by_tool,
    by_method,
    calls_per_hour,
    recent_errors,
  };
}

export function clearMcpCalls(projectRoot: string): void {
  const file = mcpCallsPath(projectRoot);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}
