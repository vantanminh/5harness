# Story Backlog

## Product initiative (active)

**Markdown durable store + global registry + agent index + dashboard**  
Locked by decision **0011**. Tracking: `docs/product/roadmap.md`.

| Epic | Description | Status |
| --- | --- | --- |
| E06 | Global registry + `link` | planned (US-006) |
| E07 | Markdown entity SoT | planned (US-007–008) |
| E08 | Agent index tools | planned (US-009) |
| E09 | Init/template pivot | planned (US-010–011) |
| E10 | Quality rewire + SQLite retire | planned (US-012–013) |
| E11 | Local dashboard | planned (US-014) |

## Completed initiative

| Epic | Description | Status |
| --- | --- | --- |
| E01–E05 | npm CLI MVP (SQLite SoT) | done v0.1–0.5 |

## Future candidates (not sliced)

| Idea | Notes | Status |
| --- | --- | --- |
| Public npm publish automation | Ops once package name/org fixed | unsliced |
| Native Rust engine | Optional; decision 0008/0010 allow later | unsliced |
| Vector / embedding search | Only if FTS insufficient | unsliced |
| Cloud multi-user registry | Explicitly deferred (0011) | rejected near-term |
| Dashboard mutations | Read-only first (US-014) | unsliced |
| Trace export to Git | Optional summaries only | unsliced |

## Rules

- Do not create every possible story packet up front beyond the active roadmap.
- When picking work: open the next **planned** story in implement order, set
  `in_progress`, implement, then mark `implemented` + matrix evidence.
