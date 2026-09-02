---
id: 0023-shipped-cli-is-the-command-contract
type: decision
title: Shipped CLI is the command contract
status: accepted
doc: docs/decisions/0023-shipped-cli-is-the-command-contract.md
verify: null
notes: "Policy docs, TOOL_REGISTRY, GLOSSARY, and templates must only name commands that exist in the shipped CLI. score-context, intervention add, query interventions, and query friction are removed from docs and are not implemented. query reports is a missing real query (reports exist) and will be added. propose continues to use audit findings only."
created_at: "2026-09-02T04:31:57.110Z"
updated_at: "2026-09-02T04:31:57.111Z"
links:
  - IN-024
  - 0011-global-tool-markdown-durable-index
  - 0014-post-g-agent-loop-tool-tiers
  - 0007-improvement-proposal-rules
---

# Shipped CLI is the command contract

Date: 2026-09-02

## Status

Accepted

## Context

Policy docs (`docs/HARNESS.md`, `docs/TOOL_REGISTRY.md`, `docs/GLOSSARY.md`,
`docs/IMPROVEMENT_PROTOCOL.md`, `docs/WORKFLOW_VI.md`) named evolution commands
that the shipped TypeScript CLI never implemented:

- `harness score-context`
- `harness intervention add`
- `harness query interventions`
- `harness query friction`

`docs/product/cli-contract.md` already listed `score-context` as deferred.
Agents following policy docs will HARD STOP (decision 0017) on missing
commands. That is worse than omitting a future idea.

## Decision

1. **The shipped CLI is the command contract.** Policy docs, TOOL_REGISTRY,
   GLOSSARY, templates, and agent skills may only present commands that exist
   in `src/cli.ts` for the current version.
2. **Do not implement** `score-context`, `intervention add`,
   `query interventions`, or `query friction` in this program. Remove them
   from docs. If later traces prove need, open a new story.
3. **`harness propose`** continues to generate proposals from audit findings
   and recorded trace friction. It does not read an intervention store.
4. **`query reports` is not a phantom command.** Reports are a real entity
   type; adding a query view is in-scope (US-076).
5. Deferred later work remains: cloud registry, changesets, vector search as
   primary retrieval. Custom tool registration is already shipped
   (`harness tool register|check|remove`) and must not be listed as deferred.

## Alternatives Considered

1. Implement the missing commands to match the docs — rejected; they were
   never in the shipped surface and would delay the 1.0 agent loop.
2. Leave docs as aspirational — rejected; agents treat HARNESS.md as live
   procedure.

## Consequences

Positive:

- Agents stop calling commands that exit 1.
- 1.0 contract freeze has a single source of truth.

Tradeoffs:

- Improvement protocol is audit + backlog + traces only, without a dedicated
  intervention entity.

## Follow-Up

- US-069 removes the names from policy docs and adds a regression test.
- US-076 adds `query reports`.
- US-087 freezes the public CLI/MCP contract.
