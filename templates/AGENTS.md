# Agent Instructions

<!-- HARNESS:BEGIN -->
## Harness

This repo uses **Harness** (`@vantanminh/harness`, bin `harness`).

### Install / day-to-day

```bash
# preferred on a machine that works on many projects
npm i -g @vantanminh/harness
harness --help

# after cloning a repo that already has harness markdown history:
harness link
harness reindex   # link may do this automatically
```

### Before work — read

- `README.md` (if present)
- `docs/HARNESS.md`
- `docs/FEATURE_INTAKE.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTEXT_RULES.md`
- Active story packet under `docs/stories/` when implementing a story

### Mutation rule (mandatory)

**Do not** create or edit operational durable markdown by hand
(stories / decisions / intakes / backlog entities).

Use the CLI only, for example:

```bash
harness intake --type … --summary "…" --lane normal
harness story add --id US-… --title "…" --lane normal
harness story update --id US-… --status implemented --unit 1 --integration 1 --e2e 0 --platform 0
harness decision add --id … --title "…" --doc docs/decisions/….md
harness query matrix
```

### Read with tools (prefer over dumping large trees)

```bash
harness search "…"
harness get <id>
harness links <id>
harness query matrix
harness query stats
harness reindex
```

Classify work with feature intake before large edits. Record durable decisions
when architecture or product rules change.
<!-- HARNESS:END -->
