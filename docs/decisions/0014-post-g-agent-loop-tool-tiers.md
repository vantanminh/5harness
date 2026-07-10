---
id: 0014-post-g-agent-loop-tool-tiers
type: decision
title: Post-G agent-loop tool tiers (E12-E14)
status: accepted
doc: docs/decisions/0014-post-g-agent-loop-tool-tiers.md
verify: null
notes: "Accepted 2026-07-10. After E11 dashboard, next product work is agent-loop tools in three tiers (not more entity CRUD). Tier1 (E12, near-term): doctor, status, next, context, inbound tool register/check/remove (TOOL_REGISTRY.md). Tier2 (E13): story start/done/block, worklog/PR linkage, intake run structured pipeline, dashboard mutations only via same CLI code paths. Tier3 (E14, post-1.0-friendly): harness MCP server, export changelog, watch reindex, session handoff. Non-goals unchanged from 0011: no cloud registry, no vector-primary search, no Electron. Implementation order Tier1 then Tier2 then Tier3. Stories US-018..US-030; intake IN-003. Declaration-only at acceptance time."
created_at: "2026-07-10T09:34:39.933Z"
updated_at: "2026-07-10T09:34:39.933Z"
links:
  - IN-003
  - 0011-global-tool-markdown-durable-index
---

# Post-G agent-loop tool tiers (E12-E14)
