# Agent Instructions

## What This Repo Is

This repository (`harness/`) is an **independent product rewrite**: an
**npm-native** agent-ready repository harness. It is **not** a fork that ships
or depends on the upstream installer/`harness-cli` binary long-term.

**Target user UX (product direction):**

```bash
npm i -D @harness/cli   # name may change; local install preferred
npx harness init        # scaffold operating files + durable DB in a target repo
npx harness intake ...
npx harness story add ...
npx harness query matrix
```

Users install and run via **npm / npx** only. They should not need to run
`.ps1` installers, curl pipelines, or manual `.exe` paths.

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

## Product Direction (locked for v0)

1. **Independent rewrite** of the agent-repository operating harness concept.
2. **Distribution:** npm package with a `harness` CLI bin.
3. **Primary commands (MVP):** `init`, `intake`, `story`, `decision`, `backlog`,
   `query`, `migrate` (and related durable ops as needed).
4. **Durable layer:** SQLite local to each target project (`harness.db`,
   gitignored), schema versioned in-repo.
5. **Operating files:** agent shim + docs/templates installed by `harness init`
   into target projects.
6. **Engine:** implementation may be TypeScript and/or Rust behind the npm bin
   (prebuilt native binary + thin JS wrapper is allowed). Choose for correctness
   and maintainability; do not optimize for microbenchmarks early.
7. **Out of v0 scope:** Symphony local runner, Electron board, full Phase 4/5
   parity, copying upstream release automation as-is.

Bootstrap note: this repo currently still uses the **temporary** upstream
`scripts/bin/harness-cli.exe` only to operate *this* workspace's durable layer
while the product CLI is unbuilt. New product code must not treat that path as
the long-term user contract.

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
- `scripts/bin/harness-cli query matrix` on macOS/Linux, or `.\scripts\bin\harness-cli.exe query matrix` on Windows

Use the Rust Harness CLI at `scripts/bin/harness-cli` on macOS/Linux or
`scripts/bin/harness-cli.exe` on Windows as the main operational tool **for this
repo's durable records until the product CLI replaces it**. Before a step that
could use an external tool, run `scripts/bin/harness-cli query tools
--capability <name> --status present` to see what is equipped; an absent
capability is a clean skip.

When implementing product behavior that should match known harness semantics,
consult `../repository-harness` as reference (read-only) after reading this
repo's product docs and decisions.
<!-- HARNESS:END -->
