# Init Payload

Files and directories `harness init` installs into a **target project**.

This product owns the payload shipped inside the npm package (`templates/`).

## Goals

- Make a target repo agent-ready with a small, coherent operating set.
- Create durable **markdown** trees that can be committed to Git.
- **Register** the project in the machine-local global registry.
- Avoid scaffolding application code, CI, or fake product domains.

## Init behavior (0011)

1. Write / merge operating files from templates.
2. Ensure durable entity directories exist (stories, decisions, intakes, backlog).
3. Ensure `.gitignore` ignores derived index and local runtime data (not durable MD).
4. Register project path in `~/.harness` (global registry).
5. Build initial empty index (or on first query).

`harness link` skips scaffold (or only fills missing dirs) and does steps 4–5
for clones that already have committed harness files.

## Payload (minimum)

### Always create (if missing)

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Agent shim: read policy; **mutate only via harness tools** |
| `docs/HARNESS.md` | Collaboration model |
| `docs/FEATURE_INTAKE.md` | Intake lanes |
| `docs/ARCHITECTURE.md` | Generic architecture discovery template |
| `docs/CONTEXT_RULES.md` | Context engineering rules |
| `docs/README.md` | Docs index |
| `docs/product/README.md` | Empty product docs index |
| `docs/stories/` | Story entities (+ README) |
| `docs/decisions/` | Decision entities (+ README) |
| `docs/intakes/` | Intake entities (when store lands) |
| `docs/backlog/` | Backlog entities (when store lands) |
| `docs/templates/*` | story, decision, validation, spec-intake templates |
| `.gitignore` entries | `.harness/index/`, `.harness/local/`, legacy `harness.db*` |

### Explicitly out of init payload

- Extra product maturity / phase docs unless a later story adds them.
- Application `src/`, target-app CI, package scripts for the **target** app.
- Shipping a project-local harness binary as the primary UX.
- Committing derived index or trace dumps.

## Conflict policy

- If protected paths already exist (`AGENTS.md`, `docs/`), **stop** with a clear
  message unless `--force` (backup before overwrite) **or** a later
  `--merge` story.
- `.gitignore`: append harness rules if file exists; do not wipe user rules.

## Manifest

Implementation should declare payload once (e.g. `templates/manifest.json`) so
tests can assert exact file set without scanning ad hoc lists in code.

## Transition from v0.5

Current shipped init still creates `harness.db` (SQLite MVP). The 0011 target
removes project SQLite SoT in favor of markdown entities + registry registration.
Update templates/tests in the store-rewrite story; do not treat `harness.db` as
long-term product behavior.
