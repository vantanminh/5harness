# US-009 reindex, get, search, links

## Status

done

## Lane

normal

## Product Contract

Agents discover and load durable knowledge through retrieval tools backed by a
**derived index** (catalog + link graph + text search). Index is rebuildable and
not the source of truth.

## Relevant Product Docs

- `docs/product/agent-index.md`
- `docs/product/cli-contract.md`
- `docs/decisions/0011-global-tool-markdown-durable-index.md`

## Acceptance Criteria

- `harness reindex` scans entity markdown, writes `.harness/index/` (path may be
  finalized in implementation; must be gitignored by US-010/011).
- Index includes: id → path, type, title, status, mtime; link edges + backlinks.
- `harness get <id|path>` prints one entity; `--summary` (or default summary mode)
  can limit to frontmatter.
- `harness search <query>` returns ranked hits with **path + snippet**, not full
  vault dump. Empty query handling is clear.
- `harness links <id>` shows outbound and backlinks.
- Broken wikilinks can be listed or ignored with a note; do not crash.
- `harness link` (US-006) **should** trigger reindex when a markdown store is
  present (wire-up when both exist).
- Unit + e2e tests on temp project with linked entities.
- No embedding/vector DB required for this story.

## Design Notes

- Depends on: US-007 (entities exist)
- Optional: SQLite FTS **only** inside `.harness/index/` as engine
- Incremental index is nice-to-have; full rebuild is enough for v1
- Token discipline is a hard requirement for `search` output

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | link parse, rank snippets |
| Integration | reindex artifacts on disk |
| E2E | reindex → search → get → links |
| Platform | — |
| Release | version when shipped |

## Harness Delta

- New CLI commands; agent docs emphasize tools over bulk reads
- query tools registry includes get/search/links

## Evidence

- `src/application/index-store.ts`, `src/domain/wikilinks.ts`, `src/commands/index-tools.ts`
- CLI: `reindex`, `get`, `search`, `links`; `link` triggers reindex when MD present
- Tests: `tests/index-tools.test.ts`, `tests/index-tools-cli.e2e.test.ts`
