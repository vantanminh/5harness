# US-012 Quality on markdown store

## Status

done

## Lane

normal

## Product Contract

`story verify`, `decision verify`, `trace`, `score-trace`, `audit`, `propose`
work with markdown entities and **local** (non-git) trace storage.

## Relevant Product Docs

- `docs/product/durable-layer.md`
- `docs/product/agent-index.md`

## Acceptance Criteria

- Verify commands update story/decision entity frontmatter (last verified,
  pass/fail) via CLI writes only.
- Traces append to machine-local store (`.harness/local/traces` or
  `HARNESS_HOME/projects/<id>/traces`) — **not** committed by default.
- `query traces` reads local store.
- `audit` detects drift relevant to MD store (e.g. missing files, broken links,
  registry stale path) and still yields entropy-style score.
- `propose` / `propose --commit` still create backlog **entities**.
- Tests rewrite quality e2e off SQLite SoT.
- Gitignore ensures traces stay local.

## Design Notes

- Depends on: US-008, US-009
- Trace format: JSONL or one MD per trace under local dir — pick simple + append-friendly
- Scoring logic can stay domain-pure from v0.5

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | score-trace domain |
| Integration | local trace append + read |
| E2E | verify + trace + audit + propose |
| Platform | — |
| Release | version when shipped |

## Harness Delta

- Quality application ports to new stores

## Evidence

- verify/trace/audit/propose use MD entities + `.harness/local/traces.jsonl`
- Tests: quality.test.ts, quality-cli.e2e.test.ts, propose-tools.test.ts
