# US-003 Phase C quality commands

## Status

implemented

## Lane

normal

## Product Contract

Operators can run story verification commands, record agent traces, score trace
quality, and run a drift audit with an entropy score — all via `harness`.

## Acceptance Criteria

- `harness story verify <id>` runs `verify_command` in the target dir; records pass/fail.
- `harness story verify-all` runs every story with a verify_command (skips empty).
- `harness decision verify <id>` runs decision verify_command when set.
- `harness trace` records a trace with summary, outcome, files, etc.
- `harness score-trace [--id]` scores a trace tier (minimal/standard/detailed).
- `harness query traces` lists recent traces.
- `harness audit` prints drift findings and entropy score (0–100).
- Migration adds story last_verified_* (and optional friction) for older DBs.
- Tests cover verify pass/fail, trace+score, audit counts.

## Design Notes

- Verify uses shell spawn with target project as cwd; non-zero exit = fail.
- Trace outcomes: completed | blocked | partial | failed.
- Audit: orphaned stories (no traces), unverified stories with verify_command,
  open backlog without outcomes, unimplemented stories long-lived optional skip.
- score-trace is advisory (prints missing fields); does not block by default.

## Evidence

```text
npm test
  ✓ 31 tests (quality unit + CLI e2e + prior suites)
npm run build
  ✓ v0.3.0 with migrations/002-quality.sql
```
