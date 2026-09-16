---
created_at: "2026-09-05T13:25:55.761701392+00:00"
doc: docs/decisions/0025-mcp-bearer-token-boundary.md
id: 0025-mcp-bearer-token-boundary
notes: The Rust v0.26 transport requires a per-process bearer token and X-Harness-Project matching the bound project for every tools/call. Dashboard /mcp is discovery-only. OAuth design documents are retained as future protocol work until a real authorization server ships.
status: accepted
title: MCP bearer token and project selector boundary
type: decision
updated_at: "2026-09-05T13:25:55.761706251+00:00"
verify: null
---

# MCP bearer token and project selector boundary
