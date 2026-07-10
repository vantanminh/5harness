# US-002 Durable commands on harness CLI

## Status

implemented

## Lane

normal

## Product Contract

After `harness init`, a user can record intakes, stories, decisions, and backlog
items and query matrix/stats/intakes/decisions/backlog via `npx harness …`
without the upstream bootstrap binary.

## Relevant Product Docs

- `docs/product/cli-contract.md`
- `docs/product/durable-layer.md`
- `docs/product/overview.md`

## Acceptance Criteria

- `harness intake --type … --summary … --lane …` inserts an intake row.
- `harness story add|update` manage story matrix rows and proof flags (0/1).
- `harness decision add` records decisions.
- `harness backlog add|close` manage backlog items.
- `harness query matrix|stats|intakes|decisions|backlog|stories` print tables.
- Missing DB fails with a clear hint to run `harness init` or `migrate`.
- Lane CLI form accepts `tiny|normal|high-risk` (and `high_risk`).
- Automated tests cover write + query round-trips in a temp init dir.
- README / CLI contract document Phase B commands.

## Design Notes

- Reuse `HARNESS_DB_PATH` and target dir resolution from Phase A.
- Auto-apply pending migrations when opening an existing DB for durable cmds.
- Defer `story verify`, `trace`, `audit` to Phase C.

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | lane/input normalization, proof flag parsing |
| Integration | temp DB round-trip for each command family |
| E2E | CLI process: init → intake → story → query |
| Platform | Windows smoke in this workspace |
| Release | `npm test` + `npm run build` |

## Evidence

```text
npm test
  ✓ 25 tests (enums, durable app layer, durable CLI e2e, Phase A suite)
npm run build
  ✓ dist includes intake/story/decision/backlog/query
node dist/cli.js init <temp>
  → intake / story / decision / backlog / query matrix|stats
```
