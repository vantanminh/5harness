# Product Overview

## Name

Working name: **Harness** (npm-native rewrite).  
CLI bin name (target): `harness`.  
npm package name: **TBD** (placeholder `@harness/cli` in docs only).

## One-Liner

An independent, npm-distributed repository harness that makes coding agents
reliable by installing operating context and a durable operational database into
any project.

## Problem

Coding agents enter repos with chat prompts and shallow file snapshots. Without
repo-level operating structure they:

- edit before understanding product intent
- lose constraints that lived only in chat
- skip validation expectations
- repeat architecture debates
- skip story-sized decomposition

## Solution

Ship a **single npm CLI** that:

1. **Initializes** a target project with agent docs, templates, and conventions.
2. **Records** intake, stories, decisions, backlog, and traces in local SQLite.
3. **Queries** matrix/status so agents and humans share one operational truth.
4. Stays **usable without** shell installer scripts or manual binary tagging.

## Users

| User | Need |
| --- | --- |
| Human maintainer | `npx harness init` in a repo; durable history of agent work |
| Coding agent | Stable commands + docs to read before changing code |
| Contributor to this product | Clear rewrite scope; upstream as reference only |

## Non-Goals (v0)

- Being a drop-in binary-compatible replacement of upstream `harness-cli` flags
  in every detail (semantic alignment is enough; exact flag parity is a later
  choice).
- Shipping Symphony / Electron board in v0.
- Forcing every target project to become a Node application — Node/npm is
  required only as the **distribution runtime** for the harness tool.

## Success Criteria (v0)

1. A user with Node.js can install the package and run `harness init` in an
   empty folder; they get AGENTS/docs/templates + working SQLite durable layer.
2. Core durable commands work without invoking `.ps1` or bare `.exe` paths.
3. Agents working **in this product repo** know to implement here and consult
   `../repository-harness` read-only when needed (`AGENTS.md`).
4. At least one decision records distribution and engine strategy.

## Surfaces

| Surface | v0 |
| --- | --- |
| CLI (`harness`) | Yes — primary |
| Markdown operating files in target repos | Yes — installed by `init` |
| Local SQLite DB in target repos | Yes |
| Web UI / Symphony | No |
| Global vs local install | Local `devDependency` + `npx` preferred; global optional |

## Upstream Relationship

Upstream project: sibling directory `../repository-harness` (or the public
`repository-harness` project it was cloned from).

- **Inspiration source**, not a runtime dependency of the product we ship.
- Capability ideas and flows may be compared during design.
- Implementation, packaging, and user docs are owned by this repo.

## Roadmap Sketch

| Phase | Outcome |
| --- | --- |
| A — Foundation | Product docs, decisions, package skeleton, `harness init` + migrate |
| B — Durable MVP | intake, story, decision, backlog, query matrix/stats |
| C — Quality | verify commands, traces, audit baseline |
| D — Hardening | multi-platform publish, checksums if native, docs polish |
| E — Optional | advanced parity, automation UI — only with explicit stories |

## Open Questions

- Final npm scope/name and registry.
- Engine: TypeScript-first vs Rust core + npm wrapper for v0.
- Whether `init` copies templates from package contents or generates them.
- Exact compatibility level with upstream CLI flags.
