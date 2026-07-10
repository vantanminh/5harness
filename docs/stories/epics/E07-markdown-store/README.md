# E07 — Markdown durable store

## Goal

Replace project SQLite as **source of truth** for intake, stories, decisions,
and backlog with **one markdown entity file per record** (Git-backed). CLI is
the only writer for operational entities.

## Product docs

- `docs/product/durable-layer.md`
- `docs/product/agent-index.md` (consumes entities)
- Decision 0011

## Stories

| ID | Title | Status |
| --- | --- | --- |
| US-007 | Markdown entity writes | planned |
| US-008 | Query/matrix reads from markdown | planned |

## Exit criteria

- `intake` / `story` / `decision` / `backlog` persist to markdown entities.
- `query matrix|stats|…` for those types read from markdown (or catalog built from it).
- Agents never need to hand-edit entity files.
- Frontmatter schema documented and validated on write.
