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
| US-063 | Conditional workflow; doctor/status/next hooks; release docs | yes | yes | yes | yes | done | Shipped v0.21+; Windows workflow/health/docs proof |

The durable matrix (`harness query matrix`) is canonical for US-015–US-068.
Those stories are implemented; do not treat this file as a second SoT.

## Matrix — Phase J / E17 1.0 maturity (IN-024)

| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US-069 | Shipped CLI is the command contract; no phantom commands in policy docs | yes | no | no | no | implemented | docs contract tests |
| US-070 | Policy/help match markdown SoT | yes | no | no | no | implemented | docs + init help |
| US-071 | Changelog/roadmap/matrix/story index current | yes | no | no | no | implemented | changelog hygiene |
| US-072 | No leftover debug scripts in the tree | yes | no | no | no | implemented | pack:check |
| US-073 | `--json` on agent reads | yes | yes | yes | no | implemented | durable JSON e2e |
| US-074 | MCP read parity | yes | yes | yes | no | implemented | MCP protocol e2e |
| US-075 | MCP lifecycle mutation parity | yes | yes | yes | no | implemented | MCP auth/mutation e2e |
| US-076 | `decision update` + `query reports` | yes | yes | yes | no | implemented | durable CLI e2e |
| US-078 | Official skill on init | yes | yes | no | no | implemented | init e2e |
| US-079 | `next` includes reports + blocked | yes | yes | no | no | implemented | next JSON e2e |
| US-080 | Derived search index | yes | yes | yes | no | implemented | search e2e |
| US-081 | Doctor depth | yes | yes | no | no | implemented | doctor JSON e2e |
| US-082 | No SQLite dual-write | yes | yes | yes | no | implemented | release tests |
| US-083 | Broken-link listing | yes | yes | no | no | implemented | links e2e |
| US-084 | Dashboard password hardening | yes | yes | yes | no | implemented | dashboard HTTP e2e |
| US-085 | Dashboard 2.0 | yes | yes | yes | yes | implemented | dashboard HTTP e2e |
| US-086 | Completions + harness-check action | yes | no | no | no | implemented | completion command |
| US-087 | 1.0 contract freeze | yes | yes | yes | yes | implemented | full release check |
| US-092 | Native npm artifacts + direct installers for Linux/macOS/Windows | yes | yes | yes | yes | implemented | `npm run release:check`; `npm run install:smoke`; CI native-binary and installer jobs |
| US-093 | Agent security, mutation, JSON, index, and command reliability hardening | yes | yes | yes | no | in_progress | hardening e2e; final audit pending |

## Evidence Rules

- Unit proof covers pure domain and application rules.
- Integration proof covers filesystem store, registry, index integrity.
- E2E proof covers CLI user-visible flows (and HTTP for dashboard).
- Platform proof covers Windows path/home behavior and runtime edges.
- A story can be implemented without every proof column if the story packet
  explains why.
