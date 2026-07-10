# Durable Layer

> **Locked by** [decision 0011](../decisions/0011-global-tool-markdown-durable-index.md).
> Supersedes the v0.5 SQLite-as-SoT description.

## Source of truth

Operational records live as **markdown entity files inside the project**
(committed to Git). Humans and agents share the same history via clone/push.

Derived artifacts (search index, optional FTS database) are **rebuildable** and
are **not** the source of truth.

## What is committed vs local

| Kind | Location (illustrative) | Git |
| --- | --- | --- |
| Stories | `docs/stories/<id>.md` | Yes |
| Decisions | `docs/decisions/<id>-….md` | Yes |
| Intakes | `docs/intakes/<id>.md` | Yes |
| Backlog items | `docs/backlog/<id>.md` | Yes |
| Policy docs / templates | `docs/*`, `AGENTS.md` | Yes |
| Derived index | `.harness/index/` | No |
| Traces / noisy runtime | `.harness/local/` (or global project cache) | No |

Exact paths are finalized in the store implementation story; this doc locks the
**commit policy**.

## Entity rules

1. **One entity = one file** with YAML frontmatter (`id`, `type`, status fields…).
2. **Links** via wikilinks `[[…]]` and/or frontmatter `links`.
3. **Only the harness CLI** creates or updates operational entities.
4. Agents **must not** hand-edit operational markdown; they call tools only.

## Commands (semantics preserved from v0)

| Command | Purpose |
| --- | --- |
| `harness intake` | Classify work before implementation |
| `harness story add\|update\|verify\|verify-all` | Story matrix, proof flags, verification |
| `harness decision add\|verify` | Decision records + optional verify |
| `harness backlog add\|close` | Harness improvement backlog |
| `harness trace` / `score-trace` | Execution traces (local-only storage) |
| `harness audit` | Drift findings + entropy score |
| `harness query …` | matrix, stats, intakes, decisions, backlog, stories, traces |
| `harness get` / `search` / `links` / `reindex` | Agent retrieval over the vault (0011) |

## Project resolution

1. Target directory: `--dir` / cwd.
2. Project must be initialized (or linked after clone).
3. Writes go to markdown under the project; then index is updated (incrementally
   or via reindex).

Legacy: `HARNESS_DB_PATH` / `harness.db` applied to the **pre-0011** SQLite MVP
only. New code paths do not use project SQLite as SoT.

## Lanes

CLI accepts `tiny`, `normal`, `high-risk` (also `high_risk`). Stored as
`tiny` | `normal` | `high_risk`.

## Proof flags

`story update` uses numeric booleans: `--unit 1 --integration 0 --e2e 0 --platform 0`.

## Migration note (from v0.5 SQLite)

Existing SQLite-backed implementations remain until the store rewrite ships.
New features should follow this markdown SoT design; do not extend `harness.db`
as the long-term durable store.
