# Architecture

## Stack Direction (this product)

| Concern | Direction |
| --- | --- |
| Product surface | CLI first (`harness` via npm `bin`); local dashboard later |
| Preferred install | `npm i -g npm-harness` (project-local `npx` allowed) |
| User runtime | Node.js + npm (no Rust required for end users) |
| Implementation language | TypeScript today; Rust engine optional later |
| **Durable SoT** | **Markdown entities in each project** (Git-backed) — decision 0011 |
| Derived index | `.harness/index/` rebuildable; may use SQLite FTS internally |
| Global registry | `HARNESS_HOME` / `~/.harness` project pointers only |
| Traces | Machine-local (not default Git) |
| Packaging | npm package; optional native packages later |
| Project SQLite as SoT | **Retired** (was v0.5 MVP; supersedes decision 0004 for this product) |

Record locking choices under `docs/decisions/`.

## System Context

```text
Human / Agent
    |
    v
npm i -g  →  harness CLI
    |
    +--→ HARNESS_HOME (~/.harness)
    |      registry.json  (linked project paths)
    |      optional caches / local traces per project id
    |
    +--→ Target project filesystem
           AGENTS.md, docs/ policy
           docs/stories|decisions|intakes|backlog/*.md   ← SoT (git)
           .harness/index/   ← derived (gitignore)
           .harness/local/   ← traces etc (gitignore)
    |
    +--→ (future) localhost dashboard
           reads registry + project markdown/index
```

Collaborator:

```text
git clone (gets MD history) → harness link → reindex → CLI/dashboard ready
```

## Discovery Before Shape

Before proposing implementation shape for a story, identify:

- Product surfaces: CLI; later dashboard.
- Core domains: init/link/registry, entity store, index/search, intake/story/
  decision/backlog, verify/trace/audit/propose, query.
- Boundary inputs: CLI args, `HARNESS_HOME`, project `--dir`, filesystem.
- Validation: unit for domain; integration for FS/registry/index; e2e CLI;
  platform for Windows paths.

## Default Layering

```text
domain
  <- application
      <- infrastructure
          <- interface (CLI [, HTTP dashboard])
```

| Layer | May depend on | Must not depend on |
| --- | --- | --- |
| domain | pure utilities only | filesystem, process env, DB drivers |
| application | domain | commander, concrete path layout details when avoidable |
| infrastructure | application, domain | CLI parsing frameworks |
| interface | all lower layers | — |

## Mutation policy

Operational durable entities are written **only** through application services
invoked by CLI (or future controlled API). Agents must not hand-edit entity
markdown. Policy docs (`HARNESS.md`, etc.) remain human-editable.

## This repo vs target projects

| | This product repo (`harness/`) | Target repos after `init` |
| --- | --- | --- |
| Purpose | Build the CLI | Consume the CLI |
| Story packets | Yes — track product work | Yes — track their app work |
| Upstream | `../repository-harness` reference only | N/A |

## Tracking

Implement order and story IDs: **`docs/product/roadmap.md`**.
