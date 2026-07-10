# Agent Instructions

## What This Repo Is

This repository (`harness/`) is an **independent product rewrite**: an
**npm-native** agent-ready repository harness. It is **not** a fork that ships
or depends on the upstream installer/`harness-cli` binary long-term.

**Target user UX (product direction):**

```bash
npm i -D npm-harness    # package name; bin is `harness`
npx harness init        # scaffold operating files + durable DB in a target repo
npx harness intake --type spec_slice --summary "..." --lane normal
npx harness story add --id US-001 --title "..." --lane normal
npx harness query matrix
npx harness query stats
```

Users install and run via **npm / npx** only. They should not need to run
`.ps1` installers, curl pipelines, or manual `.exe` paths.

**Implemented on product CLI:** `init`, `migrate`, `intake`, `story add|update`,
`decision add`, `backlog add|close`, `query matrix|stats|intakes|decisions|stories|backlog`.

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
