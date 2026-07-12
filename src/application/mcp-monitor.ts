/**
 * MCP Monitor — local JSONL storage for MCP call records.
 * File: `.5harness/local/mcp-calls.jsonl`
 * Pattern follows local-traces.ts (same JSONL approach).
 */
import fs from "node:fs";
import path from "node:path";
import type { McpCallFilter, McpCallInput, McpCallRecord, McpCallStats } from "../domain/mcp-call-record.js";
import { projectLocalDir, projectMcpCallsPath } from "../domain/paths.js";

/** Soft cap for retained records (decision 0015 follow-up). */
export const MCP_CALLS_RETENTION = 10_000;

export function mcpCallsPath(projectRoot: string): string {
  return projectMcpCallsPath(projectRoot);
}

function ensureDir(projectRoot: string): void {
  fs.mkdirSync(projectLocalDir(projectRoot), { recursive: true });
}

/** Read and parse all call records (no filter/limit). Corrupt lines skipped. */
export function readAllMcpCalls(projectRoot: string): McpCallRecord[] {
  const file = mcpCallsPath(projectRoot);
  if (!fs.existsSync(file)) return [];
  const lines = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  const out: McpCallRecord[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as McpCallRecord);
    } catch {
      // skip corrupt lines
    }
  }
  return out;
}

export function nextMcpCallId(projectRoot: string): number {
  const all = readAllMcpCalls(projectRoot);
  let max = 0;
  for (const r of all) {
    if (typeof r.id === "number" && r.id > max) max = r.id;
  }
  return max + 1;
}

export function listMcpCalls(
  projectRoot: string,
  filter?: McpCallFilter,
): McpCallRecord[] {
  const out = readAllMcpCalls(projectRoot).filter((rec) => {
    if (filter?.method && rec.method !== filter.method) return false;
    if (filter?.tool_name && rec.tool_name !== filter.tool_name) return false;
    if (filter?.status && rec.status !== filter.status) return false;
    return true;
  });
  // newest first
  out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const offset = filter?.offset ?? 0;
  const limit = filter?.limit ?? 50;
  return out.slice(offset, offset + limit);
}

/**
 * Append one MCP call record. ID/timestamp auto-generated when omitted.
 * Non-atomic append is intentional (same as traces); failures should be
 * caught by callers and treated as non-fatal.
 *
 * Uses a single full-file read for next id + optional retention rewrite.
 */
export function appendMcpCall(
  projectRoot: string,
  record: McpCallInput,
): McpCallRecord {
  ensureDir(projectRoot);
  const existing = readAllMcpCalls(projectRoot);
  let maxId = 0;
  for (const r of existing) {
    if (typeof r.id === "number" && r.id > maxId) maxId = r.id;
  }
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

  const file = mcpCallsPath(projectRoot);
  if (existing.length + 1 <= MCP_CALLS_RETENTION) {
    fs.appendFileSync(file, `${JSON.stringify(full)}\n`, "utf8");
  } else {
    // Over soft cap: keep newest N including this record (oldest→newest on disk)
    const merged = [...existing, full].sort((a, b) =>
      a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
    );
    const kept = merged.slice(0, MCP_CALLS_RETENTION).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    fs.writeFileSync(
      file,
      kept.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf8",
    );
  }
  return full;
}

/**
 * Keep only the newest `keep` records on disk (rewrites file when over cap).
 */
export function pruneMcpCalls(projectRoot: string, keep: number = MCP_CALLS_RETENTION): void {
  const file = mcpCallsPath(projectRoot);
  if (!fs.existsSync(file)) return;
  const all = readAllMcpCalls(projectRoot);
  if (all.length <= keep) return;
  all.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const kept = all.slice(0, keep);
  // write oldest→newest so append order stays chronological
  kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  fs.writeFileSync(
    file,
    kept.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
}

export function getMcpStats(projectRoot: string): McpCallStats {
  // Full set for accurate totals (capped by retention, not list default limit)
  const all = readAllMcpCalls(projectRoot);
  const total_calls = all.length;
  const errors = all.filter((r) => r.status === "error");
  const error_count = errors.length;
  const error_rate = total_calls > 0 ? error_count / total_calls : 0;
  const totalDuration = all.reduce((s, r) => s + (Number(r.duration_ms) || 0), 0);
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
    if (Number.isNaN(t)) continue;
    const hoursAgo = Math.floor((now - t) / oneHour);
    if (hoursAgo >= 0 && hoursAgo < 24) {
      calls_per_hour[23 - hoursAgo]++;
    }
  }

  const recent_errors = [...errors]
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
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
