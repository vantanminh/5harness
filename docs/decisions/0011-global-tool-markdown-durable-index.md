# 0011 Global Tool, Markdown Durable Store, and Agent Index

Date: 2026-07-10

## Status

Accepted

## Context

v0.5 of this product followed upstream decision **0004**: operational records in
per-project SQLite (`harness.db`, gitignored), with markdown policy docs only.

That model has two product mismatches for this rewrite:

1. **Distribution** — the original harness installs tooling *into* each repo.
   This product is an **npm global CLI**: one install on the machine, used
   across many projects.
2. **Portability / collaboration** — SQLite is hard to review and backup on
   GitHub. When another person clones a harnessed repo, they should regain
   operational history by **installing the CLI + linking the clone**, not by
   copying a binary database.

Agents also must not hand-edit large or fragile markdown tables. Structured
writes belong to the CLI; agents need **search/get/links tools** so they do not
load entire vaults into context.

## Decision

### 1. Distribution: global-first CLI

| Choice | Detail |
| --- | --- |
| Preferred install | `npm i -g npm-harness` |
| Project-local install | Allowed (`devDependency` + `npx`) but not the primary story |
| Tool location | System-wide CLI; **not** vendored into each target as the long-term model |

### 2. Init creates project files **and** registers the project

`harness init` in a project:

1. Scaffolds operating markdown (policy + empty durable tree).
2. Registers that project path in a **machine-local global registry**
   (`~/.harness/` — exact layout implementation-defined).

`harness link` (or `init --link-only` if combined) registers an **existing**
harnessed project without re-scaffolding. Required for the clone workflow.

### 3. Clone → link → dashboard workflow (locked intent)

```text
Person A: harness init in repo → commits durable markdown → pushes GitHub
Person B: git clone → npm i -g npm-harness → harness link
          → reindex → local dashboard can list/query that project
```

- **GitHub holds durable history** (markdown entities).
- **Global registry holds only pointers** (absolute path, display name, optional
  git remote, last index time) so the dashboard can discover projects on *this*
  machine.
- Registry is **not** the multi-machine source of truth; the repo is.

### 4. Durable source of truth: markdown in the project

| Record type | Storage | Commit to Git? |
| --- | --- | --- |
| Stories, decisions, intakes, backlog | One entity per markdown file + YAML frontmatter | **Yes** |
| Policy docs (`HARNESS.md`, templates, …) | Markdown | **Yes** |
| Link edges between entities | Wikilinks and/or frontmatter `links` | **Yes** (in the entity files) |
| Full-text / catalog index | Derived under `.harness/index/` (or equivalent) | **No** (rebuild with `reindex`) |
| Execution traces (high volume) | Machine-local under project `.harness/local/` or `~/.harness/projects/<id>/` | **No** by default |
| Global project registry | `~/.harness/registry` (or equivalent) | **No** |

This **supersedes decision 0004** for *this product*: SQLite is **not** the
project durable source of truth.

SQLite (or another local engine) **may** still be used **only** as a *derived*
index (e.g. FTS), always rebuildable from markdown, never required to clone
history.

### 5. Agents mutate durable state only through tools

**Mandatory rule:**

- Coding agents **must not** create/edit/delete operational durable markdown by
  hand (stories, decisions, intakes, backlog entities).
- Agents **must** call harness CLI tools (`story add`, `decision add`, …).
- Humans may use the same CLI; optional human editing of policy docs remains OK.
- CLI validates schema (frontmatter fields, enums, ids) on every write.

### 6. Obsidian-lite index for agents (not a second SoT)

Index layers (minimum):

1. **Catalog** — id → path, type, status, title, mtime.
2. **Link graph** — outbound + backlinks (wikilink `[[…]]` and frontmatter links).
3. **Text search** — start with frontmatter filters + content search; FTS/BM25
   later if needed. Embeddings are **out of scope** until proven necessary.

Agent-facing tools (contract direction):

| Tool | Purpose |
| --- | --- |
| `harness get <id\|path>` | Load one entity (or summary) |
| `harness search <query>` | Ranked hits with path + snippet |
| `harness links <id>` | Outbound and backlinks |
| `harness query matrix\|…` | Aggregates from catalog |
| `harness reindex` | Rebuild derived index from markdown |

### 7. Entity file conventions

- **One entity = one file** under typed directories (e.g. `docs/stories/`,
  `docs/decisions/`, `docs/intakes/`, `docs/backlog/`).
- Required YAML frontmatter: `id`, `type`, `status` (where applicable), plus
  type-specific fields.
- Body = human-readable prose; agents read body only after `get`/`search`
  selects the file.
- Prefer wikilinks `[[type/id]]` plus optional frontmatter `links: []` for
  explicit edges the indexer must honor.

### 8. Dashboard (future, design-locked)

- Runs on the **local machine** (browser UI later).
- Discovers projects via **global registry**.
- Reads each project’s durable markdown (and derived index) at the linked path.
- After clone + `link`, Person B’s dashboard can control that project **because
  history is already in the clone**, not because global state was synced.

## Alternatives Considered

1. **Keep SQLite as SoT + export MD** — Rejected: two truths; Git history still
   second-class; export drift.
2. **Commit SQLite** — Rejected: binary merge/review nightmare; poor GitHub UX.
3. **JSON/JSONL entity store** — Rejected as primary human surface; markdown +
   frontmatter is reviewable on GitHub and agent-friendly with tools.
4. **Vector RAG only** — Deferred: non-deterministic retrieval is harder to
   debug; catalog + links + FTS first.
5. **Agents edit markdown freely** — Rejected: breaks validation and causes
   table/frontmatter corruption (original 0004 pain returns).
6. **Cloud multi-user registry** — Out of scope; clone + GitHub is the share path.

## Consequences

Positive:

- Durable history travels with `git clone`.
- Global install matches multi-project dashboard direction.
- Agents stay on tools; token use stays bounded via search/get.
- Index is disposable; no binary SoT to backup.

Tradeoffs:

- Rewrite of current SQLite-backed application layer (v0.5 semantics stay;
  storage changes).
- Concurrent writers still need CLI-level care (file write discipline).
- Traces not in Git by default — observability is machine-local unless we add
  an explicit export later.
- Stale registry entries when projects move (need `unlink` / path check).

## Follow-Up

- Implement registry + `link` / `unlink` / `reindex`.
- Replace SQLite durable writes with markdown entity store.
- Ship `get` / `search` / `links` tools.
- Update init payload, gitignore rules, templates, tests.
- Supersede product docs that still describe `harness.db` as SoT.
- Dashboard story after store + registry stabilize.

## Supersedes

- **0004 SQLite Durable Layer** — for this product’s *source of truth*. SQLite
  may remain only as an optional derived index engine.
- Product docs that state “preferred install is project-local + SQLite SoT”
  are updated to match this decision.
