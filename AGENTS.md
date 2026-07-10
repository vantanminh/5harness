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
<!-- harness-version: 0.9.7 -->
## Harness

This repo uses **Harness** (`@vantanminh/harness`, bin `harness`).

### CLI (agents)

**Always** invoke the `harness` binary — do **not** use `npm run harness`,
`npx harness`, or `node dist/cli.js` for day-to-day durable operations.

```bash
harness --help
harness query matrix
harness search "…"
harness get <id>
harness links <id>
harness intake --type … --summary "…" --lane normal
harness story add --id US-… --title "…" --lane normal
harness decision add --id … --title "…" --doc docs/decisions/….md
```

If `harness` is missing: `npm i -g @vantanminh/harness` (or reinstall the
published package). Do not fall back to `npm run harness` unless the user
explicitly asks to run the **local source** CLI while developing this package.

### Before work — read

- `README.md`
- `docs/product/overview.md`
- `docs/HARNESS.md`
- `docs/FEATURE_INTAKE.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTEXT_RULES.md`
- `docs/TOOL_REGISTRY.md`
- Active story under `docs/stories/` when implementing a story

### Mutation rule

**Do not** hand-edit operational durable markdown (stories / decisions /
intakes / backlog entities). Use `harness` only.

All mutation commands auto-reindex after writing. Do NOT call `harness reindex`
manually after mutations.

### Upgrade

When a newer harness CLI version is installed, run `harness upgrade` in this
repo to update the harness block. Only the `<!-- HARNESS:BEGIN/END -->`
section is modified.

### Development Conventions

See [decision 0013](docs/decisions/0013-harness-development-conventions.md) for
harness development conventions: auto-reindex invariance, version tracking,
backward-compatible upgrade, harness block ownership, and testing discipline.
<!-- HARNESS:END -->
