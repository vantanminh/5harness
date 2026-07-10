# US-011 Target templates and agent policy

## Status

done

## Lane

tiny

## Product Contract

Files installed into **target** projects teach agents: global/npx harness UX,
tools-only mutation of durable entities, and retrieval via get/search/links.

## Relevant Product Docs

- `docs/product/init-payload.md`
- `docs/product/agent-index.md`
- Decision 0011

## Acceptance Criteria

- `templates/AGENTS.md` (and related HARNESS snippets) state:
  - preferred `npm i -g` / `harness` usage
  - **must not** hand-edit operational entity markdown
  - use `search` / `get` / `links` / `query` for reads
  - use write commands for mutations
- `docs/HARNESS.md` template (target payload) describes markdown SoT + link
  workflow, not SQLite-as-SoT / Rust binary paths.
- Init dry-run/tests still pass with updated templates.
- Short note in FEATURE_INTAKE or CONTEXT_RULES if needed for risk lanes.

## Design Notes

- Depends on: US-010 (or can land with it)
- Keep templates short; point to commands not essays

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | — |
| Integration | template content assertions in init tests |
| E2E | — |
| Platform | — |
| Release | pack includes templates |

## Harness Delta

- Target-facing policy text aligned with 0011

## Evidence

- AGENTS.md tools-only + get/search/links/reindex; HARNESS.md MD SoT (no Rust binary SoT)
