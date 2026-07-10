# US-007 Markdown entity writes

## Status

implemented

## Lane

normal

## Product Contract

Durable write commands create/update **markdown entity files** with YAML
frontmatter under the target project. Schema is validated by the CLI. No agent
hand-edit path is required or supported for correctness.

## Relevant Product Docs

- `docs/product/durable-layer.md`
- `docs/product/cli-contract.md`
- `docs/decisions/0011-global-tool-markdown-durable-index.md`

## Acceptance Criteria

- Document and implement entity layout (illustrative defaults OK if tested):
  - `docs/stories/<id>.md`
  - `docs/decisions/<id>.md` (or keep human decision docs + frontmatter sync)
  - `docs/intakes/<id>.md`
  - `docs/backlog/<id>.md`
- Frontmatter always includes at least: `id`, `type`, plus type-specific fields
  (status, lane, proof flags, etc.).
- `harness intake|story add|story update|decision add|backlog add|backlog close`
  write/update files (same CLI flags as v0.5 where possible).
- Reject invalid enums/ids with exit code 1 and clear errors.
- Wikilink or `links:` field supported when provided.
- Tests: write round-trip on temp dir; no dependency on project `harness.db` for
  these entities after this story (dual-write to SQLite optional during transition
  but must be documented if present).
- Policy: document “agents use tools only” in AGENTS/product docs (full target
  template refresh may wait for US-011).

## Design Notes

- Application layer: `upsertEntity`, `parseFrontmatter`, `serializeEntity`
- Prefer atomic write (temp + rename)
- Decision records that already have long-form docs: either file-is-the-doc or
  frontmatter + body; pick one and document
- Trace writes are **out of scope** here (US-012 local store)

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | frontmatter serialize/parse/validate |
| Integration | filesystem entity create/update |
| E2E | CLI story add → file exists with fields |
| Platform | path separators Windows |
| Release | version when shipped |

## Harness Delta

- New store module; begin deprecation of SQLite writes for these tables
- Entity path conventions in product docs

## Evidence

```text
npm test   # frontmatter, md-durable, md-durable-cli e2e, dual-write matrix
npm run typecheck
npm run pack:check
```

Version: 0.7.0  
Dual-write to SQLite when DB present (documented).
