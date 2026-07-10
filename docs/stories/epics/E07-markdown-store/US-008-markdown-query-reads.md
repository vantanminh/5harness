# US-008 Markdown query reads

## Status

planned

## Lane

normal

## Product Contract

`harness query matrix|stats|intakes|decisions|stories|backlog` read operational
state from markdown entities (or a catalog derived from them), not from project
SQLite as SoT.

## Relevant Product Docs

- `docs/product/durable-layer.md`
- `docs/product/cli-contract.md`

## Acceptance Criteria

- After US-007 writes, query commands return correct rows without requiring
  `harness.db`.
- `query matrix` shows story id, title, status, proof flags consistent with
  frontmatter.
- `query stats` counts match entity files.
- Filters (`--open` / `--closed` on backlog, etc.) still work.
- Performance: acceptable for hundreds of entities without loading full bodies
  when only frontmatter is needed (catalog or frontmatter-only parse).
- Tests cover empty project, multi-entity, and status filters.
- If dual-read fallback to SQLite exists, it is temporary, documented, and
  gated; default path is markdown.

## Design Notes

- Depends on: US-007
- May share catalog builder with US-009; avoid two divergent scanners
- Output table format should stay close to v0.5 for agent familiarity

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | catalog aggregation |
| Integration | scan temp entity tree |
| E2E | write via CLI → query matrix |
| Platform | — |
| Release | version when shipped |

## Harness Delta

- Query application paths switch to markdown store
- TEST_MATRIX may remain generated view or human summary only

## Evidence

_(fill when implemented)_
