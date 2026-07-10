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

## Commands deferred (Phase B+)

`intake`, `story`, `decision`, `backlog`, `query`, `trace`, `audit`, etc.

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
