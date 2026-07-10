# Agent Instructions

## What This Repo Is

This repository is **@vantanminh/harness** — an **npm-native** agent-ready
repository harness. Users install a global CLI and operate durable history as
**Git-backed markdown** in each project.

**Target user UX (decision 0011):**

```bash
npm i -g @vantanminh/harness
cd /path/to/project
harness init             # scaffold markdown + register project on this machine
# after someone else clones a harnessed repo:
harness link             # register clone + reindex committed history

harness intake --type spec_slice --summary "..." --lane normal
harness story add --id US-001 --title "..." --lane normal
harness query matrix
harness search "verify story"
harness get US-001
```

Users install via **npm** (`-g` preferred).

**Agent mutation rule (mandatory):** agents change operational durable state
**only** through harness CLI tools — never by hand-editing story/decision/intake
/backlog markdown.

**Implemented CLI surface:** `init`, `migrate`, `link`, `unlink`, `projects`,
`intake`, `story add|update|verify|verify-all`, `decision add|verify`,
`backlog add|close`, `trace`, `score-trace`, `audit`, `propose`,
`query matrix|stats|intakes|decisions|stories|backlog|traces|tools`,
`reindex`, `get`, `search`, `links`, `import-sqlite`, `dashboard`.

**Tracking:** `docs/product/roadmap.md` and `docs/stories/README.md`.

## Product Direction (locked — decision 0011)

1. **Distribution:** npm package with `harness` bin; preferred `npm i -g`.
2. **Init + link:** `init` scaffolds project markdown and registers the path in
   `~/.harness`; `link` registers an existing clone for dashboard/query.
3. **Durable SoT:** markdown entities in the project (Git-backed). Derived index
   is local/rebuildable. Traces are machine-local by default.
4. **Agents:** mutate durable state only via CLI tools; use get/search/links/
   query for reads (no whole-vault dumps).
5. **Dashboard:** browser UI over machine-local registry + project paths.
6. **Out of near-term scope:** cloud registry, vector RAG as primary search,
   project SQLite as SoT (superseded).

## Project Skills

If `.codex/skills/harness-intake-griller/SKILL.md` exists, use it when a request
needs discussion, feature intake, docs, or story shaping. The skill is
project-scoped; do not use a global copy as the source of truth.

<!-- HARNESS:BEGIN -->
<!-- harness-version: 0.10.2 -->
## Harness

This repo uses **Harness** (`@vantanminh/harness`, bin `harness`).

### Install / day-to-day

```bash
# preferred on a machine that works on many projects
npm i -g @vantanminh/harness
harness --help

# after cloning a repo that already has harness markdown history:
harness link
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

All mutation commands auto-reindex after writing. You do NOT need to call
`harness reindex` manually after mutations.

### Read with tools (prefer over dumping large trees)

```bash
harness search "…"
harness get <id>
harness links <id>
harness query matrix
harness query stats
```

Classify work with feature intake before large edits. Record durable decisions
when architecture or product rules change.

### Upgrade

When a newer harness CLI version is installed (`npm i -g @vantanminh/harness`),
run `harness upgrade` to update the harness block in this AGENTS.md.
Only the section between `<!-- HARNESS:BEGIN -->` and `<!-- HARNESS:END -->
