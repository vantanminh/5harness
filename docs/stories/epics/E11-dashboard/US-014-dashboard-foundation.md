# US-014 Dashboard foundation

## Status

done

## Lane

normal

## Product Contract

A **local** dashboard (browser) discovers projects from the global registry and
displays read-only operational summaries from each project’s markdown (and
index). No cloud dependency.

## Relevant Product Docs

- `docs/product/global-registry.md`
- `docs/product/roadmap.md`
- Decision 0011

## Acceptance Criteria

- `harness dashboard` (or `harness serve`) starts a local HTTP server (localhost).
- Home view: list linked projects from registry (name, path, stale warning).
- Project view: matrix/stats (and optionally recent decisions) from markdown
  store/catalog.
- Does not require committing index; may reindex on open or use existing index.
- Basic security: bind localhost only by default; no auth required for v1 local.
- Smoke test or scripted HTTP check in CI if feasible.
- Docs: how to run after clone+link.

## Design Notes

- Depends on: US-006, US-008 (US-009 nice for speed)
- Stack: keep minimal (Node http + static HTML/JSON API) unless product chooses
  otherwise in a decision
- Mutations via dashboard are **out of scope** for this story (read-only)
- Full polish/UX can follow; foundation first

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | API serializers |
| Integration | registry → project summary |
| E2E | start server + fetch JSON/HTML |
| Platform | Windows localhost |
| Release | optional extra package files |

## Harness Delta

- First web surface of this product
- Still secondary to CLI

## Evidence

- `harness dashboard` — localhost HTTP; `/`, `/api/projects`, `/api/project?id=`
- Tests: `tests/dashboard.test.ts` (handlers + live HTTP smoke)
