# E08 — Agent index (Obsidian-lite)

## Goal

Derived, rebuildable index so agents retrieve small slices via tools instead of
reading entire markdown trees. Link graph for related context.

## Product docs

- `docs/product/agent-index.md`
- Decision 0011

## Stories

| ID | Title | Status |
| --- | --- | --- |
| US-009 | reindex / get / search / links | planned |

## Exit criteria

- `reindex` builds catalog + link graph under `.harness/index/` (gitignored).
- `get`, `search`, `links` return bounded payloads suitable for agent context.
