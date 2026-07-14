# Test Matrix

This file maps product behavior to proof.

Update a row when a story moves to `implemented` (or `changed` / `retired`).
Detailed contracts live in story packets under `docs/stories/`.
Roadmap: `docs/product/roadmap.md`.

## Status Values

| Status | Meaning |
| --- | --- |
| planned | Accepted as intended behavior, not implemented |
| in_progress | Actively being built |
| implemented | Implemented and proof exists |
| changed | Contract changed after earlier implementation |
| retired | No longer part of the product contract |

## Matrix — historical foundation (v0.5 SQLite MVP)

These rows describe the early implementation at the time it shipped. Project
SQLite is no longer the source of truth; the active store is markdown.

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
| US-006 | Global registry; link / unlink / projects; HARNESS_HOME | yes | yes | yes | yes | implemented | `npm test` registry + registry-cli e2e; Windows paths |
| US-007 | Markdown entity writes for intake/story/decision/backlog | yes | yes | yes | yes | implemented | `npm test` frontmatter + md-durable + e2e |
| US-008 | query matrix/stats/… from markdown SoT | yes | yes | yes | no | implemented | shipped in v0.7–0.9 Phase F–G |
| US-009 | reindex, get, search, links (derived index) | yes | yes | yes | no | implemented | shipped in v0.7–0.9 Phase F–G |
| US-010 | init MD dirs + gitignore + auto-register | yes | yes | yes | no | implemented | shipped in v0.7–0.9 Phase F–G |
| US-011 | Target templates: tools-only + global UX | yes | yes | yes | no | implemented | shipped in v0.7–0.9 Phase F–G |
| US-012 | verify/trace/audit/propose on MD + local traces | yes | yes | yes | no | implemented | shipped in v0.7–0.9 Phase F–G |
| US-013 | Retire project SQLite SoT; optional import | yes | yes | yes | no | implemented | shipped in v0.7–0.9 Phase F–G |
| US-014 | Local dashboard foundation (registry + matrix) | yes | yes | yes | no | implemented | shipped in v0.7–0.9 Phase F–G |

## Matrix — Phase I / E16 Project Link

| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US-059 | Role + optional stack markers; project role CLI; init/upgrade preservation | yes | yes | yes | no | implemented | role domain, init, upgrade, and CLI suites |
| US-060 | Configured peers; registry resolution; reverse edge | yes | yes | yes | yes | implemented | peer domain/CLI suites; Windows path cases |
| US-061 | Bounded peer search/get/context/links through CLI and MCP | yes | yes | yes | yes | implemented | peer tool and project-binding suites |
| US-062 | Target-owned report entity and lifecycle through CLI and MCP | yes | yes | yes | yes | implemented | report store, round-trip CLI, and MCP suites |
| US-063 | Conditional workflow; doctor/status/next hooks; release docs | yes | yes | yes | yes | implemented (unreleased) | Windows workflow/health/docs proof; `release:check`: 65 files / 398 tests; pack check: 420 paths |

## Evidence Rules

- Unit proof covers pure domain and application rules.
- Integration proof covers filesystem store, registry, index integrity.
- E2E proof covers CLI user-visible flows (and HTTP for dashboard).
- Platform proof covers Windows path/home behavior and runtime edges.
- A story can be implemented without every proof column if the story packet
  explains why.
