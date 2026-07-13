---
id: 0020-mcp-project-binding-at-authorization
type: decision
title: MCP project binding at OAuth authorization (not at process start)
status: accepted
doc: docs/decisions/0020-mcp-project-binding-at-authorization.md
verify: null
notes: "Accepted 2026-07-13. (1) harness and harness mcp start UNBOUND — no cwd/--dir tool project bind. (2) Human OAuth consent selects project_mode=single|all; single embeds one project_id; all allows any currently linked healthy project. (3) Single grant: all MCP tools use that project only; reject mismatched client project id. (4) All grant: client MUST pass project id (X-Harness-Project or ?project=); fail closed if missing/unknown. (5) Canonical project id is random opaque, stored in AGENTS.md harness block as harness-project-id marker; not path-hash. (6) CLI: harness project id [--json] [--ensure]. (7) Registry maps id→path; sync on init/link/ensure. (8) Extends 0019 grants; does not replace OAuth/PKCE. Spec: docs/product/mcp-project-binding.md. Supersedes implicit bind in US-027 mcp start and resolveMcpProjectRoot cwd/first fallback as authz."
created_at: "2026-07-13T07:39:23.023Z"
updated_at: "2026-07-13T07:39:23.024Z"
links:
  - IN-012
  - US-027
  - US-041
  - US-045
  - US-046
  - 0019-mcp-oauth-21-pkce
  - 0015-mcp-monitoring
---

# MCP project binding at OAuth authorization (not at process start)
