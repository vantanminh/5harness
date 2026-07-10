# US-013 SQLite retirement and import

## Status

done

## Lane

normal

## Product Contract

Project `harness.db` is no longer the durable source of truth. Optional import
converts an existing SQLite DB into markdown entities once. Migrations SQL for
project SoT are removed or marked legacy.

## Relevant Product Docs

- `docs/product/durable-layer.md`
- `docs/product/distribution.md`
- Decision 0011 (supersedes 0004 for SoT)

## Acceptance Criteria

- No new feature requires writing operational SoT rows only to SQLite.
- `harness migrate` either removed, no-ops with message, or only maintains
  **index** engines — documented clearly.
- Optional: `harness import-sqlite` (or `link --import-db`) converts stories/
  decisions/backlog/intakes from `harness.db` into entity files; safe if
  entities already exist (no silent clobber without `--force`).
- Pack:check / published files updated (drop project migrations if unused).
- Node engine constraint re-evaluated (may keep >=22.5 if index still uses
  `node:sqlite`).
- Docs and CHANGELOG: breaking change notes for 0.8-style bump.
- This product repo’s own history: either import once or re-seed from story
  markdown packets.

## Design Notes

- Depends on: US-012
- Product path remains the npm CLI (`harness`)

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | import mapping |
| Integration | sample db → entity files |
| E2E | post-import query matrix |
| Platform | — |
| Release | pack:check without obsolete artifacts |

## Harness Delta

- End of SQLite-as-SoT era for this product

## Evidence

- Init no longer creates harness.db; migrate is legacy-only messaging
- `harness import-sqlite` non-clobber import; dual-write removed from write CLI
- Tests: import-sqlite.test.ts, init/cli e2e updated
