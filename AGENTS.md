# Agent Instructions

## What This Repo Is

This repository (`harness/`) is an **independent product rewrite**: an
**npm-native** agent-ready repository harness. It is **not** a fork that ships
or depends on the upstream installer/`harness-cli` binary long-term.

**Target user UX (product direction — decision 0011):**

```bash
npm i -g npm-harness     # preferred: global CLI (bin: harness)
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

Users install via **npm** (`-g` preferred). They should not need `.ps1`
installers, curl pipelines, or manual `.exe` paths.

**Agent mutation rule (mandatory):** agents change operational durable state
**only** through harness CLI tools — never by hand-editing story/decision/intake
/backlog markdown.

**Implemented on product CLI:** `init`, `migrate`, `link`, `unlink`, `projects`,
`intake`, `story add|update|verify|verify-all`, `decision add|verify`,
`backlog add|close`, `trace`, `score-trace`, `audit`, `propose`,
`query matrix|stats|intakes|decisions|stories|backlog|traces|tools`.

Durable store is still SQLite MVP (v0.5); global registry is v0.6 (`HARNESS_HOME`).

**Target next (0011):** markdown SoT, `reindex`/`get`/`search`/`links`, init
auto-register, dashboard.

**Tracking:** implement order and story status live in
`docs/product/roadmap.md` and `docs/stories/README.md` (US-006 → US-014).

## Workspace Layout (critical)

This repo lives next to the upstream reference clone:

```text
D:\code\npm-harness\                 # workspace root (not the product)
├── repository-harness\              # UPSTREAM REFERENCE (read-only inspiration)
└── harness\                         # THIS product repo (implement here only)
```

From this repo, the upstream tree is:

```text
../repository-harness
```

### Upstream reference policy

| Rule | Detail |
| --- | --- |
| Role of upstream | **Reference only** — product ideas, operating model, CLI surface, SQLite durable concepts, intake/story/decision flows |
| Write target | **Only this repo** (`harness/`). Do not modify `../repository-harness` unless the human explicitly asks |
| Copy policy | Prefer re-implementing. Do not bulk-copy source, installer scripts, or branding. Docs prose and code should be original |
| When to open upstream | Planning or implementing parity with known harness behavior; resolving ambiguity about durable commands, schema intent, or agent workflows |
| What not to inherit blindly | Rust-only distribution, `scripts/bin/harness-cli` as permanent contract, curl/ps1 installers, Symphony/web-ui scope, GitHub-specific release tags |
| Source of truth for *this* product | `README.md`, `docs/product/*`, `docs/decisions/*`, and this file — **not** upstream README |

Suggested upstream entry points (read, do not edit):

- `../repository-harness/README.md`
- `../repository-harness/docs/HARNESS.md`
- `../repository-harness/docs/FEATURE_INTAKE.md`
- `../repository-harness/docs/ARCHITECTURE.md` (generic rules; our stack differs)
- `../repository-harness/docs/decisions/` (especially durable layer + CLI distribution)
- `../repository-harness/crates/harness-cli/` (command surface / domain behavior reference)
- `../repository-harness/scripts/schema/` (schema ideas only; we own our migrations)

## Product Direction (locked — see decision 0011)

1. **Independent rewrite** of the agent-repository operating harness concept.
2. **Distribution:** npm package with `harness` bin; **preferred `npm i -g`**.
3. **Init + link:** `init` scaffolds project markdown and registers the path in
   `~/.harness`; `link` registers an existing clone for dashboard/query.
4. **Durable SoT:** **markdown entities in the project** (Git-backed). Derived
   index is local/rebuildable. Traces are machine-local by default.
5. **Agents:** mutate durable state **only via CLI tools**; use
   get/search/links/query for reads (no whole-vault dumps).
6. **Dashboard (future):** browser UI over machine-local registry + project paths.
7. **Engine:** TypeScript and/or Rust behind the npm bin is allowed.
8. **Out of near-term scope:** cloud registry, Symphony/Electron parity,
   vector RAG as primary search, project SQLite as SoT (superseded).

Bootstrap note: this repo may still have upstream `scripts/bin/harness-cli.exe`
from early setup. Prefer the product CLI (`npm run harness -- …` or
`node dist/cli.js …`) for new durable work. Do not treat the bootstrap binary as
the user-facing contract.

## Project Skills

If `.codex/skills/harness-intake-griller/SKILL.md` exists, use it when a request
needs discussion, feature intake, docs, or story shaping. The skill is
project-scoped; do not use a global copy as the source of truth.

<!-- HARNESS:BEGIN -->
## Harness

This repo uses Harness. Before work, read:

- `README.md`
- `docs/product/overview.md`
- `docs/HARNESS.md`
- `docs/FEATURE_INTAKE.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTEXT_RULES.md`
- `docs/TOOL_REGISTRY.md`
- `npm run harness -- query matrix` (or `node dist/cli.js query matrix` after build)

Use the **product** CLI (`harness` / `npm run harness -- …`) as the main
operational tool for durable records. Bootstrap
`scripts/bin/harness-cli[.exe]` is legacy only.

When implementing product behavior that should match known harness semantics,
consult `../repository-harness` as reference (read-only) after reading this
repo's product docs and decisions.
<!-- HARNESS:END -->
