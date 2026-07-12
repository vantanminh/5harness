# Harness Components

Taxonomy of responsibilities this product covers for agent-ready repositories.

Status values:

- **Covered**: explicit files, commands, or records support this area.
- **Partial**: some support; incomplete or not fully automated.
- **Missing**: no meaningful support yet.

## Responsibility Map

| # | Responsibility | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Task specification | Covered | Intake lanes, story packets, templates, `harness intake` / `story` |
| 2 | Context selection | Covered | `AGENTS.md`, `CONTEXT_RULES.md`, product docs, decisions |
| 3 | Tool access | Covered | `harness` CLI, `query tools`, `TOOL_REGISTRY.md` |
| 4 | Project memory | Covered | Markdown stories/decisions/intakes/backlog; Git-backed SoT |
| 5 | Task state | Covered | `query matrix`, story status + proof columns |
| 6 | Observability | Partial | `trace`, `score-trace`, local traces; dashboard MVP |
| 7 | Failure attribution | Partial | Trace friction, audit, backlog proposals |
| 8 | Verification | Covered | `story verify`, proof flags, release `pack:check` / CI |
| 9 | Permissions | Partial | Policy docs (tools-only mutation); no hard sandbox |
| 10 | Entropy auditing | Covered | `audit`, `propose`, backlog, maturity notes |
| 11 | Intervention recording | Partial | Trace/decision notes; not a dedicated intervention store |

## Surfaces

| Surface | Role |
| --- | --- |
| CLI (`harness`) | Primary operator interface |
| Markdown entities | Durable SoT in each project |
| `.5harness/index/` | Derived agent index |
| `~/.5harness/` | Machine-local project registry |
| `harness dashboard` | Local multi-project browser UI |
