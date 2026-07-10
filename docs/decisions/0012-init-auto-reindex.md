---
id: 0012-init-auto-reindex
type: decision
title: Init auto-reindexes after scaffolding
status: accepted
doc: docs/decisions/0012-init-auto-reindex.md
verify: null
notes: "Accepted 2026-07-10. Ensures harverness init leaves project query-ready, consistent with harverness link."
created_at: "2026-07-10T06:20:18.707Z"
updated_at: "2026-07-10T06:20:18.708Z"
---

# Init auto-reindexes after scaffolding

Date: 2026-07-10

## Status

Accepted

## Context

`harness init` scaffolds the Phase A operating files (AGENTS.md, docs/HARNESS.md,
etc.) and entity markdown directories but did **not** build the derived index.
This left the project in a half-ready state:

- `.harness/index/index.json` was missing entirely after `init`
- `harness query stats` and other queries fell back to an empty in-memory view
- The user had to discover and manually run `harness reindex`

By contrast, `harness link` already auto-reindexes when it detects a markdown
store (per US-009). This created an inconsistent first-run experience: `init`
and `link` should both leave the project in a query-ready state.

## Decision

After `harness init` completes scaffolding (non-dry-run), it calls the same
`writeProjectIndex()` function that `harness reindex` and `harness link` use.
This is guarded by a `hasMarkdownStore()` check and is wrapped in try/catch so
the index build itself cannot crash init.

On a fresh scaffold the index will have 0 entities and 0 edges — still valid
and query-ready.

## Alternatives Considered

1. **Do nothing and document that users must run `harness reindex` after
   `init`.** Rejected because it adds a manual step that `link` already avoids,
   and new users hit confusing query failures.

2. **Move reindex logic into `runInit` (infrastructure).** Rejected because
   the CLI layer (`executeInit`) is the right place for output composition,
   matching how `executeLink` triggers reindex.

## Consequences

Positive:

- `harness init` produces a query-ready project immediately.
- Behavior is consistent with `harness link`.
- Reindex is idempotent — calling it again later is safe.

Tradeoffs:

- Init is marginally slower (~ms) on large pre-populated repos; irrelevant on
  fresh scaffolds where the catalog is empty.

## Follow-Up

- None.
