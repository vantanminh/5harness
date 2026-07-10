---
id: 0015-mcp-monitoring
type: decision
title: MCP server monitoring
status: accepted
doc: docs/decisions/0015-mcp-monitoring.md
verify: null
notes: null
created_at: "2026-07-10T16:09:43.139Z"
updated_at: "2026-07-10T16:09:43.139Z"
---

# MCP server monitoring

Date: 2026-07-10

## Status

Accepted

## Context

The harness MCP server (US-027) enables AI agents to call harness tools via the Model Context Protocol. As agents increasingly use MCP for project operations, there was no observability into which tools agents call, call duration, error rates, and input arguments. Without monitoring, debugging agent behavior is difficult.

## Decision

1. **JSONL storage**: MCP call records stored in `.harness/local/mcp-calls.jsonl` (same JSONL pattern as traces in `local-traces.ts`).
2. **Record shape**: id, timestamp, method, tool_name, input_summary (truncated 500 chars), duration_ms, status, error_message, project_root.
3. **Instrumentation**: `dispatch()` returns both JSON-RPC response + callInfo. `handleMcpRequest()` accepts optional `onCall` callback. `createMonitoredMcpHandler()` wraps for auto-persist.
4. **Dashboard**: `/api/mcp-calls`, `/api/mcp-stats`, `/monitor?id=<project>` with summary cards, SVG timeline chart, tool usage bars, error list, call log.
5. **Privacy**: Arguments truncated at 500 chars. Monitoring write failures are non-fatal.

## Alternatives

- SQLite storage (rejected — JSONL matches traces pattern, simpler)
- In-memory only (rejected — lost on restart)
- stdout structured logging (rejected — harder to query)

## Follow-Up

- Retention policy (max 10K records)
- Per-agent session tracking
- Error rate alert thresholds

