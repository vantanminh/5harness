# Init Payload (Phase A)

Files and directories `harness init` installs into a **target project**.

This product owns the payload shipped inside the npm package (templates), not
the upstream installer manifest. Upstream
`../repository-harness/scripts/harness-install-files.txt` is **reference only**.

## Goals

- Make a target repo agent-ready with a small, coherent operating set.
- Initialize durable SQLite state in the target.
- Avoid scaffolding application code, CI, or fake product domains.

## Phase A payload (minimum)

### Always create (if missing)

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Agent shim with Harness reading list (product wording) |
| `docs/HARNESS.md` | Collaboration model |
| `docs/FEATURE_INTAKE.md` | Intake lanes |
| `docs/ARCHITECTURE.md` | Generic architecture discovery template |
| `docs/CONTEXT_RULES.md` | Context engineering rules |
| `docs/TEST_MATRIX.md` | Empty matrix placeholder |
| `docs/README.md` | Docs index |
| `docs/product/README.md` | Empty product docs index |
| `docs/stories/README.md` | Stories index |
| `docs/decisions/README.md` | Decisions index |
| `docs/templates/story.md` | Story template |
| `docs/templates/decision.md` | Decision template |
| `docs/templates/validation-report.md` | Validation template |
| `docs/templates/spec-intake.md` | Spec intake template |
| `.gitignore` entries | `harness.db`, wal/shm (merge rules carefully) |

### Durable layer

| Path | Purpose |
| --- | --- |
| Package-internal SQL migrations | Versioned schema applied by `init` / `migrate` |
| `<target>/harness.db` | Created and migrated (gitignored) |

### Explicitly out of Phase A payload

- Full upstream phase docs (HARNESS_MATURITY, benchmark, Symphony, …) unless a
  later story adds them.
- Upstream decisions 0001–0007 content (optional later; do not require).
- Application `src/`, package scripts for the **target** app, CI workflows.
- Shipping `scripts/bin/harness-cli` binary into the target (users use npm CLI).

## Conflict policy (Phase A)

- If protected paths already exist (`AGENTS.md`, `docs/`), **stop** with a clear
  message unless `--force` (and then backup before overwrite) **or** a later
  story implements `--merge`.
- `.gitignore`: append harness rules if file exists; do not wipe user rules.

## Manifest

Implementation should declare payload once (e.g. `templates/manifest.json` or
equivalent) so tests can assert exact file set without scanning ad hoc lists in
code.
