# Agent Index (Obsidian-lite)

> **Locked by** [decision 0011](../decisions/0011-global-tool-markdown-durable-index.md).

## Problem

If all history is markdown, naive agents will open huge files or whole
directories and burn tokens. They need **tools** that return small, relevant
slices.

## Index is derived

```text
markdown entities (SoT, git) ──reindex──► .5harness/index/* (local, gitignored)
```

After `git clone` + `harness link`, run **reindex** (link may do this
automatically) so tools work without committing index files.

## Layers

| Layer | Contents | Use |
| --- | --- | --- |
| Catalog | id, type, path, status, title, mtime | `query matrix`, `get` resolution |
| Link graph | edges + backlinks | `links`, related-context for agents |
| Text index | optional FTS over frontmatter + body chunks | `search` |

Embeddings / vector DB: **not** required for the first implementation.

## Link model

- Wikilink: `[[stories/US-003]]` or `[[US-003]]` if unique.
- Frontmatter: `links: ["decisions/0011-…"]` for explicit edges.
- Indexer records both; broken links surface in `audit` later.

## Agent tool contract

| Tool | Returns | Token discipline |
| --- | --- | --- |
| `search` | Ranked list: id, path, score, **snippet** | No full file |
| `get` | One entity (optional `--summary` for frontmatter only) | Bounded |
| `links` | Out + back links with titles | Bounded |
| `query *` | Tables/aggregates from catalog | Bounded |
| `reindex` | Rebuild stats | — |

## Mutation rule (mandatory)

Agents **only** change durable entities through write commands
(`story add|update`, `decision add`, …). After a write, the CLI updates the
index (or marks dirty for next reindex).

Hand-editing operational markdown is a **policy violation** for agents (and
unsupported for correctness).

## Implementation notes

- Prefer deterministic ranking (keyword/FTS) over opaque ML for v1.
- Chunk large bodies if needed; store chunk offsets so snippets are stable.
- Optional engine: SQLite FTS **only inside** `.5harness/index/`, never as project
  SoT.
