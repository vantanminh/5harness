# Test Matrix

This file maps product behavior to proof.

No product behavior has been defined or implemented yet. Do not mark a row
implemented until tests or validation evidence exist.

## Status Values

| Status | Meaning |
| --- | --- |
| planned | Accepted as intended behavior, not implemented |
| in_progress | Actively being built |
| implemented | Implemented and proof exists |
| changed | Contract changed after earlier implementation |
| retired | No longer part of the product contract |

## Matrix

| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US-001 | npm package exposes `harness`; `init` scaffolds Phase A payload + SQLite; `migrate` applies schema | yes | yes | yes | yes | implemented | `npm test`; `npm run build`; Windows init smoke; `npm pack --dry-run` |
| US-002 | Durable commands: intake, story, decision, backlog, query matrix/stats | yes | yes | yes | yes | implemented | `npm test`; durable CLI e2e; `npm run build` |
| US-003 | story verify, trace, score-trace, audit, query traces | yes | yes | yes | yes | implemented | `npm test`; quality CLI e2e; schema v2 |
| US-004 | LICENSE, CHANGELOG, pack:check, CI, distribution docs | yes | yes | yes | yes | implemented | `npm run pack:check`; `npm test`; CI workflow |
| US-005 | propose, propose --commit, query tools | yes | yes | yes | yes | implemented | `npm test`; propose/tools CLI e2e |

## Evidence Rules

- Unit proof covers pure domain and application rules.
- Integration proof covers backend enforcement, data integrity, provider
  behavior, jobs, or service contracts.
- E2E proof covers user-visible browser flows.
- Platform proof covers only shell, deployment, mobile, desktop, or runtime
  behavior that cannot be proven in lower layers.
- A story can be implemented without every proof column if the story packet
  explains why.
