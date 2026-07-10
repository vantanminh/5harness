# Architecture

## Stack Direction (this product)

| Concern | Direction |
| --- | --- |
| Product surface | CLI first (`harness` via npm `bin`) |
| User runtime to *use* the product | Node.js + npm (no Rust required for end users) |
| Implementation language | Open: TypeScript and/or Rust; see decisions |
| Durable storage | SQLite file per target project (`harness.db`) |
| Packaging | npm package(s); optional platform-specific native packages |
| Web/desktop | Out of v0 architecture |

Record locking choices under `docs/decisions/` when they constrain future work.

## System Context

```text
Human / Agent
    |
    v
npm / npx  →  harness CLI (bin)
    |
    +--→ Target project filesystem
    |      AGENTS.md, docs/, templates, schema
    |
    +--→ Target project SQLite
           harness.db (gitignored)
```

This **product repo** is developed under `harness/`. Upstream reference code may
be read from `../repository-harness` but is not linked as a library dependency.

## Discovery Before Shape

Before proposing implementation shape for a story, identify:

- Product surfaces: CLI only for v0; later maybe API/UI.
- Runtime stack: Node packaging always; native engine optional.
- Core domains: init/scaffold, intake, story lifecycle, decisions, backlog,
  traces, query, migrate.
- Boundary inputs: CLI args, env (`HARNESS_DB_PATH`, etc.), filesystem paths,
  migration SQL, optional native binary resolution.
- Validation ladder: unit tests for domain rules; integration for DB/CLI;
  e2e smoke for `init` + one durable round-trip; platform only if native bins
  ship.

## Default Layering

```text
domain
  <- application
      <- infrastructure
          <- interface (CLI)
```

| Layer | May depend on | Must not depend on |
| --- | --- | --- |
| domain | pure utilities only | filesystem, npm, process env, SQLite drivers |
| application | domain | CLI parsing frameworks, concrete DB drivers |
| infrastructure | domain, application | CLI presentation details |
| interface (CLI) | all inner layers | — |

## Candidate Repo Shape (product implementation)

Create folders only when a story implements them. Likely shape:

```text
packages/cli/                 # or repo root package
  package.json                # "bin": { "harness": "..." }
  src/
    domain/
    application/
    infrastructure/
      db/
      scaffold/
    interface/cli/
  templates/                  # files copied by `harness init`
  migrations/                 # SQL migrations

# optional if Rust engine is chosen later
crates/harness-core/
```

## Parse-First Boundary Rule

Unknown data must be parsed at boundaries before it enters inner code:

- CLI flags and positional args
- Environment variables
- SQLite rows
- Filesystem paths and template manifests
- Platform/binary resolution results

```text
unknown input
  -> parser / validator
  -> domain types
  -> use case
```

## Dependency Rule for Upstream

- **Do not** import or submodule upstream as a runtime dependency for the
  shipped CLI.
- **Do** read upstream docs/source when designing parity behavior.
- **Do not** edit `../repository-harness` during normal product work.

## Validation Ladder (expected)

```text
validate:quick     format, lint, typecheck, unit
test:integration   CLI + SQLite contracts
test:e2e           init + intake/story/query smoke in temp dir
test:platform      native binary resolution (only if applicable)
test:release       pack npm tarball / publish dry-run
```

Exact commands land when the package scaffold story is implemented.

## Bootstrap Architecture (temporary)

Until the product CLI exists, this repository uses an upstream-built
`scripts/bin/harness-cli` binary solely to manage **this repo's** durable
records. That binary is **not** part of the long-term architecture of the
product we ship.
