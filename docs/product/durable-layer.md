# Durable Layer

Operational records live in per-project SQLite (`harness.db`, gitignored).

## Commands (Phase B + C)

| Command | Purpose |
| --- | --- |
| `harness intake` | Classify work before implementation |
| `harness story add\|update\|verify\|verify-all` | Story matrix, proof flags, verification |
| `harness decision add\|verify` | Decision log rows + optional verify |
| `harness backlog add\|close` | Harness improvement backlog |
| `harness trace` / `score-trace` | Execution traces and quality tiers |
| `harness audit` | Drift findings + entropy score |
| `harness query …` | matrix, stats, intakes, decisions, backlog, stories, traces |

## Lanes

CLI accepts `tiny`, `normal`, `high-risk` (also `high_risk`). Stored as
`tiny` | `normal` | `high_risk`.

## Proof flags

`story update` uses numeric booleans: `--unit 1 --integration 0 --e2e 0 --platform 0`.

## DB resolution

1. `HARNESS_DB_PATH` if set
2. Else `<cwd or --dir>/harness.db`

Durable commands auto-migrate pending SQL when the DB file already exists.
If the DB is missing, run `harness init` first.
