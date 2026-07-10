# Story Backlog

## Product initiative (active)

**Post-G agent-loop tools (3 tiers)**  
Locked by decision **0014** / intake **IN-003**. Tracking: `docs/product/roadmap.md`.

| Epic | Description | Stories | Status |
| --- | --- | --- | --- |
| E12 | Tier 1 — doctor, status, next, context, inbound tools | US-018–022 | **planned** |
| E13 | Tier 2 — story lifecycle, worklog, intake run, dash mutations | US-023–026 | **planned** |
| E14 | Tier 3 — MCP, export changelog, watch, handoff | US-027–030 | **planned** |

Implement order: **E12 → E13 → E14**. No code until a story is picked `in_progress`.

## Completed initiatives

| Epic | Description | Status |
| --- | --- | --- |
| E01–E05 | npm CLI MVP (SQLite SoT) | done v0.1–0.5 |
| E06 | Global registry + `link` | done |
| E07 | Markdown entity SoT | done |
| E08 | Agent index tools | done |
| E09 | Init/template pivot | done |
| E10 | Quality rewire + SQLite retire | done |
| E11 | Local dashboard | done |

## Deferred / rejected (backlog entities)

| ID | Idea | Status |
| --- | --- | --- |
| BL-002 | Vector embeddings as primary search | deferred (0011/0014) |
| BL-003 | Cloud multi-user registry | deferred (0011/0014) |

## Rules

- Do not create every possible story packet up front beyond the active roadmap.
- Durable entities: **CLI only** (`harness story|decision|intake|backlog`).
- When picking work: open the next **planned** story in implement order, set
  `in_progress`, implement, then mark `implemented` + matrix evidence.
