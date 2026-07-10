# CLI Contract (v0 target)

User-facing bin name: `harness`.

Install (preferred):

```bash
npm i -D npm-harness
npx harness <command>
```

Package name: **`npm-harness`**. Bin name: **`harness`**.

## Commands in scope for Phase A (US-001)

| Command | Behavior |
| --- | --- |
| `harness --version` / `-V` | Print CLI version from package |
| `harness --help` / `-h` | Top-level help |
| `harness init [options]` | Scaffold operating files + create/migrate durable DB in a target directory |
| `harness migrate` | Apply pending SQL migrations to the resolved DB |

## `harness init` options (Phase A)

| Option | Meaning |
| --- | --- |
| `[directory]` or `--dir <path>` | Target project root (default: cwd) |
| `--yes` / `-y` | Non-interactive; do not prompt |
| `--dry-run` | Print planned writes; write nothing |
| `--force` | Overwrite conflicting non-protected files after backup (define precisely in story) |

Merge/override policy for existing `AGENTS.md` / `docs/` may be a follow-up story if Phase A only supports empty or non-conflicting targets. **Phase A minimum:** refuse to clobber protected paths unless `--force`, with a clear error.

## Commands in scope for Phase B (US-002)

| Command | Behavior |
| --- | --- |
| `harness intake` | Record feature intake (`--type`, `--summary`, `--lane`, …) |
| `harness story add` | Add a story matrix row |
| `harness story update` | Update status, proof flags (`0\|1`), evidence, verify command |
| `harness decision add` | Add a decision row |
| `harness backlog add` | Add a backlog item |
| `harness backlog close` | Close backlog (`implemented` / `rejected`) |
| `harness query matrix` | Story matrix (`--numeric` for 0/1) |
| `harness query stats` | Summary counts |
| `harness query intakes` | Recent intakes |
| `harness query decisions` | Decisions |
| `harness query stories` | Story list |
| `harness query backlog` | Backlog (`--open` / `--closed`) |

Most durable commands accept `-d, --dir <path>` for the target project (default: cwd).
They auto-migrate an existing DB; if the DB is missing, run `harness init` first.

## Commands deferred (Phase C+)

`story verify`, `trace`, `score-trace`, `audit`, `propose`, tool registry, changesets, etc.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Usage / validation / operational error |
| 2 | Reserved (optional: partial success) |

## Environment

| Variable | Meaning |
| --- | --- |
| `HARNESS_DB_PATH` | Override path to SQLite DB (optional; default `<target>/harness.db`) |

## Non-contract (bootstrap only)

`scripts/bin/harness-cli[.exe]` in this product repo is temporary and must not
appear in user-facing CLI docs for the npm package.
