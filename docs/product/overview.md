# Product Overview

## Name

Working name: **Harness** (npm-native rewrite).  
CLI bin name (target): `harness`.  
npm package name: **`npm-harness`**.

## One-Liner

A **global npm CLI** that turns any software repo into an agent-ready workspace:
project markdown as durable, Git-backed history; machine-local registry for
multi-project dashboard; retrieval tools so agents never dump whole vaults.

## Problem

Coding agents enter repos with chat prompts and shallow file snapshots. Without
repo-level operating structure they:

- edit before understanding product intent
- lose constraints that lived only in chat
- skip validation expectations
- repeat architecture debates
- skip story-sized decomposition

Binary/local-only operational DBs also fail collaboration: history does not
travel with `git clone`.

## Solution

Ship a **single npm CLI** (preferred **global** install) that:

1. **Initializes** a target project with agent docs, templates, and conventions.
2. **Links** the project into a machine-local global registry (for dashboard).
3. **Records** intake, stories, decisions, and backlog as **markdown entities**
   (committed with the repo).
4. **Indexes** entities + links so agents **search/get** instead of reading
   giant files.
5. Keeps **traces** machine-local (high volume, not default Git noise).

Agents **only** mutate durable state through CLI tools (mandatory).

## Users

| User | Need |
| --- | --- |
| Human maintainer | `npm i -g` once; `harness init` / `link` per repo; history on GitHub |
| Collaborator | Clone repo → install CLI → `harness link` → same history + dashboard |
| Coding agent | Stable tools: write via commands, read via get/search/links/query |
| Contributor to this product | Clear rewrite scope; upstream as reference only |

## Non-Goals (near-term)

- Drop-in binary-compatible replacement of upstream `harness-cli` flags.
- Cloud multi-user registry (GitHub + clone is the share path).
- Shipping full dashboard UI in the first store rewrite (design is locked).
- Vector RAG as the primary retrieval path.
- Forcing every target project to be a Node app — Node is only required to
  run the harness tool.

## Success Criteria (post-0011 direction)

1. Global install works; `harness init` scaffolds MD + registers the project.
2. Durable story/decision/intake/backlog history is **reviewable in Git**.
3. After clone + `harness link`, query tools see committed history (reindex).
4. Agents can work without reading entire markdown trees (search/get/links).
5. Agents never need to hand-edit operational markdown.

## Surfaces

| Surface | Direction |
| --- | --- |
| CLI (`harness`) | Primary |
| Markdown entities in target repos | **SoT**, committed |
| Derived index (`.harness/index/`) | Local, rebuildable |
| Global registry (`~/.harness/`) | Pointers for multi-project + dashboard |
| Browser dashboard | Future; reads registry + project paths |
| Project SQLite as SoT | **Retired** (decision 0011) |

## Upstream Relationship

Upstream project: sibling directory `../repository-harness`.

- **Inspiration source**, not a runtime dependency.
- Capability ideas and flows may be compared during design.
- Implementation, packaging, and user docs are owned by this repo.
- Do **not** inherit “SQLite SoT + install binary into each repo” as product law.

## Roadmap Sketch

| Phase | Outcome |
| --- | --- |
| A–E (v0.1–0.5) | **Done** — SQLite MVP (semantics reference; store superseded) |
| F — Pivot store | Markdown SoT + registry + link + reindex + get/search/links |
| G — Dashboard | Local browser multi-project view |
| Optional | Trace export, FTS upgrades, native engine |

## Open Questions

- Final public registry scope/org name (currently `npm-harness`).
- Exact on-disk entity paths and frontmatter schema versioning.
- Whether `TEST_MATRIX.md` remains a generated view or is removed in favor of
  `query matrix` only.
