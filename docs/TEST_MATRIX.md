# Test Matrix

This file maps product behavior to proof.

Update a row when a story moves to `implemented` (or `changed` / `retired`).
Detailed contracts live in story packets under `docs/stories/epics/`.
Roadmap: `docs/product/roadmap.md`.

## Status Values

| Status | Meaning |
| --- | --- |
| planned | Accepted as intended behavior, not implemented |
| in_progress | Actively being built |
| implemented | Implemented and proof exists |
| changed | Contract changed after earlier implementation |
| retired | No longer part of the product contract |

## Matrix — shipped (SQLite MVP)

| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US-001 | npm package exposes `harness`; `init` scaffolds payload + SQLite MVP; `migrate` | yes | yes | yes | yes | implemented | `npm test`; `npm run build`; pack dry-run |
| US-002 | Durable commands: intake, story, decision, backlog, query | yes | yes | yes | yes | implemented | durable CLI e2e |
| US-003 | story verify, trace, score-trace, audit, query traces | yes | yes | yes | yes | implemented | quality CLI e2e |
| US-004 | LICENSE, CHANGELOG, pack:check, CI, distribution docs | yes | yes | yes | yes | implemented | pack:check; CI workflow |
| US-005 | propose, propose --commit, query tools | yes | yes | yes | yes | implemented | propose/tools e2e |

## Matrix — Phase F–G (decision 0011)

| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US-006 | Global registry; link / unlink / projects; HARNESS_HOME | | | | | planned | |
| US-007 | Markdown entity writes for intake/story/decision/backlog | | | | | planned | |
| US-008 | query matrix/stats/… from markdown SoT | | | | | planned | |
| US-009 | reindex, get, search, links (derived index) | | | | | planned | |
| US-010 | init MD dirs + gitignore + auto-register | | | | | planned | |
| US-011 | Target templates: tools-only + global UX | | | | | planned | |
| US-012 | verify/trace/audit/propose on MD + local traces | | | | | planned | |
| US-013 | Retire project SQLite SoT; optional import | | | | | planned | |
| US-014 | Local dashboard foundation (registry + matrix) | | | | | planned | |

## Evidence Rules

- Unit proof covers pure domain and application rules.
- Integration proof covers filesystem store, registry, index integrity.
- E2E proof covers CLI user-visible flows (and HTTP for dashboard).
- Platform proof covers Windows path/home behavior and runtime edges.
- A story can be implemented without every proof column if the story packet
  explains why.
