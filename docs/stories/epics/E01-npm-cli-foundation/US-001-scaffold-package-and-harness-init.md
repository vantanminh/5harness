# US-001 Scaffold npm package and harness init

## Status

implemented

## Lane

normal

## Product Contract

A contributor can develop this repo as an npm package that exposes a `harness`
CLI. A user with Node.js can install that package and run `harness init` in a
target directory to receive Phase A operating files plus an initialized SQLite
durable database — without curl, PowerShell installers, or manual binary paths.

## Relevant Product Docs

- `docs/product/overview.md`
- `docs/product/cli-contract.md`
- `docs/product/init-payload.md`
- `docs/ARCHITECTURE.md`
- `docs/decisions/0008-independent-npm-native-rewrite.md`
- `docs/decisions/0009-upstream-reference-only.md`

## Acceptance Criteria

### Package scaffold

- Repository has a root (or `packages/cli`) `package.json` with:
  - a publishable `name` (finalize in implementation; document in README)
  - `"bin": { "harness": "<entrypoint>" }`
  - build script producing the runnable entrypoint if TypeScript is used
- `npx harness --version` (or `node path/to/bin --version`) prints a semver.
- `harness --help` lists at least `init` and `migrate`.
- TypeScript (or chosen stack) builds cleanly; unit test runner is wired.
- README documents local dev: install deps, build, run CLI against a temp dir.

### `harness init`

- `harness init` defaults to the current working directory as target.
- `harness init --dir <path>` (or positional directory) targets another path.
- Creates the Phase A payload files listed in `docs/product/init-payload.md`
  when they do not already exist.
- Creates and migrates `<target>/harness.db` (or `HARNESS_DB_PATH`) to the
  current schema version.
- Appends harness ignore rules to target `.gitignore` without destroying
  existing content.
- `--dry-run` reports planned operations and writes nothing.
- Non-interactive conflict on protected existing paths fails clearly without
  `--force` (Phase A does not require full `--merge` UX).
- With `--force`, existing conflicting files are backed up before overwrite.
- Does **not** install an upstream `scripts/bin/harness-cli` binary into the
  target.
- Does **not** scaffold application source, CI, or fake product domains.

### `harness migrate`

- `harness migrate` applies pending migrations to the resolved DB path.
- Idempotent when already at latest schema version.

### Validation

- Automated tests cover: help/version, init dry-run, init into empty temp dir
  (files + DB openable), migrate no-op, conflict without `--force`.
- Manual or scripted smoke: pack or `npm link` / `node dist/... init` in temp
  directory succeeds on Windows (this workspace).

## Design Notes

- **Commands:** `harness --version`, `harness --help`, `harness init`,
  `harness migrate`
- **Queries:** none yet (no `query` command in this story)
- **API:** none
- **Tables:** minimal durable schema sufficient for later intake/story commands
  (at least schema_migrations / version bookkeeping; prefer a small v1 schema
  aligned with future durable needs rather than empty file-only)
- **Domain rules:**
  - Target path resolution (cwd, relative, absolute)
  - Protected paths: `AGENTS.md`, `docs/` tree policy as in init-payload
  - Payload comes from package-owned templates + single manifest
- **UI surfaces:** terminal only
- **Engine:** TypeScript-first for Phase A speed unless a short spike shows
  blocking issues; Rust engine deferred (see decision 0008). Record a decision
  if implementation locks TS tooling choices (e.g. tsup/tsx, commander/citty,
  better-sqlite3).
- **Upstream:** may read `../repository-harness` installer payload and schema
  for ideas; re-implement; do not call or vendor their binary in the product
  path.
- **Layout suggestion:**

```text
package.json
src/
  cli.ts                 # bin entry
  commands/init.ts
  commands/migrate.ts
  infrastructure/db.ts
  infrastructure/scaffold.ts
templates/               # init payload files
migrations/              # *.sql
tests/
```

## Validation

When updating durable proof status, use numeric booleans:
`scripts/bin/harness-cli story update --id <id> --unit 1 --integration 1 --e2e 0 --platform 0`.

| Layer | Expected proof |
| --- | --- |
| Unit | Path resolution, conflict policy, manifest expansion pure logic |
| Integration | Init writes files + migrates SQLite in temp dirs; migrate idempotent |
| E2E | CLI process smoke: `--help`, `init --dry-run`, `init` temp project |
| Platform | Windows smoke in this workspace (primary); note macOS/Linux as follow-up if not run |
| Release | `npm pack` succeeds; tarball includes templates, migrations, bin |

## Harness Delta

- Product docs: `cli-contract.md`, `init-payload.md` (this prep)
- Epic `E01-npm-cli-foundation` story index
- After implementation: update README status table; retire bootstrap-only
  wording where product CLI replaces it for *users* (bootstrap may remain for
  this repo until durable commands exist on product CLI)
- Optional decision: TypeScript toolchain + SQLite driver choice

## Evidence

```text
npm test
  ✓ 17 tests (paths, conflicts, init integration, CLI e2e)
npm run build
  ✓ dist/cli.js with shebang
npm pack --dry-run
  ✓ includes dist/, templates/, migrations/
node dist/cli.js init <temp> && node dist/cli.js migrate --dir <temp>
  ✓ Windows smoke in this workspace
```

## Implementation Checklist (for the implementing agent)

1. Intake already recorded or refresh if scope changes.
2. Scaffold package + toolchain.
3. Implement `init` + `migrate` against temp-dir tests.
4. Wire CI-less local scripts: `npm test`, `npm run build`.
5. Update README “Current Status”.
6. `story update` proof flags + trace with outcome `completed`.
