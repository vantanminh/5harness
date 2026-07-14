# Product Overview

## Name

**Harness**  
CLI bin: `harness`  
npm package: **`5harness`**

## One-Liner

A **global npm CLI** that turns any software repo into an agent-ready workspace:
project markdown as durable, Git-backed history; machine-local registry for
multi-project dashboard; retrieval tools so agents never dump whole vaults;
and opt-in Project Link collaboration between configured peer repositories.

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
5. **Links configured peers** by durable project identity for bounded reads and
   target-owned cross-project reports.
6. Keeps **traces** machine-local (high volume, not default Git noise).

Agents **only** mutate durable state through CLI tools (mandatory).

## Users

| User | Need |
| --- | --- |
| Human maintainer | `npm i -g` once; `harness init` / `link` per repo; history on GitHub |
| Collaborator | Clone repo → install CLI → `harness link` → same history + dashboard |
| Coding agent | Stable tools: write via commands, read locally or from configured peers, and report cross-project mismatches |
| Contributor to this product | Clear product docs, decisions, and story packets in this repo |

## Non-Goals (near-term)

- Cloud multi-user registry (GitHub + clone is the share path).
- Vector RAG as the primary retrieval path.
- Forcing every target project to be a Node app — Node is only required to
  run the harness tool.

## Success Criteria

1. Global install works; `harness init` scaffolds MD + registers the project.
2. Durable story/decision/intake/backlog history is **reviewable in Git**.
3. After clone + `harness link`, query tools see committed history (reindex).
4. Agents can work without reading entire markdown trees (search/get/links).
5. Agents never need to hand-edit operational markdown.
6. Configured peers can exchange bounded context and target-owned reports
   without making every registered project accessible.

## Surfaces

| Surface | Direction |
| --- | --- |
| CLI (`harness`) | Primary |
| Markdown entities in target repos | **SoT**, committed |
| Derived index (`.5harness/index/`) | Local, rebuildable |
| Global registry (`~/.5harness/`) | Pointers for multi-project + dashboard |
| Browser dashboard | Localhost; reads registry + project paths |
| AGENTS Project Link metadata | Git-tracked role, optional stack, and peer ids |
| Reports (`docs/reports/`) | Git-tracked, target-owned cross-project findings |
| Project SQLite as SoT | **Retired** (decision 0011); optional `import-sqlite` |

## Roadmap sketch

| Phase | Outcome |
| --- | --- |
| A–E (v0.1–0.5) | **Done** — early CLI + quality surface |
| F — Store pivot | Markdown SoT + registry + link + reindex + get/search/links |
| G — Dashboard | Local browser multi-project view |
| H — Agent loop + MCP binding | Context, lifecycle, OAuth, and explicit project selection |
| I / E16 — Project Link | **Implemented (unreleased)** — roles, configured peers, bounded reads, reports |
| Optional | Trace export, FTS upgrades, native engine |

See [roadmap.md](./roadmap.md) for story tracking.
