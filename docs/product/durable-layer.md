# Durable Layer

> **Locked by** [decision 0011](../decisions/0011-global-tool-markdown-durable-index.md).
> Supersedes the v0.5 SQLite-as-SoT description.

## Source of truth

Operational records live as **markdown entity files inside the project**
(committed to Git). Humans and agents share the same history via clone/push.

| Type | Path | Id form |
| --- | --- | --- |
| Story | `docs/stories/<id>.md` | caller id (e.g. `US-001`) |
| Decision | `docs/decisions/<id>.md` (or `--doc`) | caller id |
| Intake | `docs/intakes/IN-###.md` | auto `IN-001`… |
| Backlog | `docs/backlog/BL-###.md` | auto `BL-001`… |
| Report | `docs/reports/RP-###.md` | auto or caller-supplied `RP-###` |

Frontmatter always includes `id`, `type`, plus type-specific fields. Optional
`links:` (or CLI `--links`) for graph edges.

Write commands use markdown directly. A legacy `harness.db` can be imported,
but it is not dual-written and is never the current source of truth.

Derived artifacts (search index, optional FTS database) are **rebuildable** and
are **not** the source of truth.

## What is committed vs local

| Kind | Location (illustrative) | Git |
| --- | --- | --- |
| Stories | `docs/stories/<id>.md` | Yes |
| Decisions | `docs/decisions/<id>-….md` | Yes |
| Intakes | `docs/intakes/<id>.md` | Yes |
| Backlog items | `docs/backlog/<id>.md` | Yes |
| Cross-project reports | `docs/reports/<id>.md` in the target project | Yes |
| Policy docs / templates | `docs/*`, `AGENTS.md` | Yes |
| Derived index | `.5harness/index/` | No |
| Traces / noisy runtime | `.5harness/local/` (or global project cache) | No |

These paths and the **commit policy** are part of the current product contract.

## Entity rules

1. **One entity = one file** with YAML frontmatter (`id`, `type`, status fields…).
2. **Links** via wikilinks `[[…]]` and/or frontmatter `links`.
3. **Only Harness CLI or MCP tools** create or update operational entities.
4. Agents **must not** hand-edit operational markdown; they call tools only.

Project Link reports are target-owned entities. Their lifecycle is
`open | acked | fixed | wontfix | needs_info`. `harness report add` writes the
report into the configured target peer and reindexes that target; local
`report update` reindexes the target project again so peer reads see the new
status and resolution.

## Commands (semantics preserved from v0)

| Command | Purpose |
| --- | --- |
| `harness intake` | Classify work before implementation |
| `harness story add\|update\|verify\|verify-all` | Story matrix, proof flags, verification |
| `harness decision add\|verify` | Decision records + optional verify |
| `harness backlog add\|close` | Harness improvement backlog |
| `harness report add\|list\|get\|update` | Target-owned cross-project report lifecycle |
| `harness trace` / `score-trace` | Execution traces (local-only storage) |
| `harness audit` | Drift findings + entropy score |
| `harness query …` | matrix, stats, intakes, decisions, backlog, stories, traces |
| `harness get` / `search` / `links` / `reindex` | Agent retrieval over the vault (0011) |

## Project resolution

1. Target directory: `--dir` / cwd.
2. Project must be initialized (or linked after clone).
3. Writes go to markdown under the selected project and auto-reindex its local
   derived index. A cross-project `report add` selects and reindexes the target
   peer, not the calling project.

Legacy: `HARNESS_DB_PATH` / `harness.db` applied to the **pre-0011** SQLite MVP
only. New code paths do not use project SQLite as SoT.

## Lanes

CLI accepts `tiny`, `normal`, `high-risk` (also `high_risk`). Stored as
`tiny` | `normal` | `high_risk`.

## Proof flags

`story update` uses numeric booleans: `--unit 1 --integration 0 --e2e 0 --platform 0`.

## Migration note (from v0.5 SQLite)

The store rewrite has shipped. `harness import-sqlite` remains only as a
non-clobbering migration path for old projects; new features must use markdown
entities rather than extending `harness.db`.
