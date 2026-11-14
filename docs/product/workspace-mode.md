# Workspace Mode (`harness workspace`)

**Decision:** [0028 — Workspace mode orchestration layer](../decisions/0028-workspace-mode-orchestration.md)

Workspace mode lets AI coding agents and developers coordinate multiple repositories from a **parent workspace directory** that may **not** be a Git repository and has **no** Harness project identity (`AGENTS.md`) of its own.

## Core Principles

1. **Zero silent files in the parent workspace directory:** Workspace registrations, dependencies, policy, and cross-project impact obligations are stored in `$HARNESS_HOME/workspaces.json` (versioned schema `v1`), not dropped into the parent folder. Exportable portable manifests (`harness workspace manifest export|apply`) are strictly opt-in.
2. **Reuse single-project durability:** Each project remains its own source of truth (`docs/stories/`, `docs/decisions/`, `docs/reports/`). Target-owned `RP-###` reports stay inside the downstream project and respect `HARNESS_PEER_WRITE_ROOTS`.
3. **Never auto-init or assume every folder is a project:** Discovery probes only Harness markers and `.git` top-levels with bounded traversal (`--depth`, default `2`, max `5`, dir cap `500`), skipping cache/vendor/output folders (`node_modules`, `target`, `dist`, `build`, `vendor`, `.venv`, etc.), deduplicating Git worktrees via `git rev-parse --git-common-dir`, flagging nested repos, and refusing duplicate `harness-project-id` values. Unharnessed child repos stay untouched unless `--init-missing` is explicitly selected.
4. **Partial-failure resilient:** A missing folder, unreadable permission, corrupt child index, or `project_id` mismatch degrades that member's status row without discarding sibling projects in `status` or `context`.

## Command Reference

```bash
# 1. Preview repositories under a non-repo parent folder (read-only)
harness workspace discover --json
harness workspace link --dry-run --json

# 2. Confirm and save workspace registration (fails closed in non-TTY without --yes/--all/--project)
harness workspace link --yes
harness workspace link --project backend --project apps/web --yes

# 3. Inspect health & bounded composite context (safe from parent or any child repo)
harness workspace status --json
harness workspace context --task "OAuth" --role backend --limit 5 --max-chars 8000 --json

# 4. Declare directed cross-repo dependencies (cycle-checked)
harness workspace dep add --from backend --to web --kind api_contract --contract-path openapi/ --contract-path src/routes/
harness workspace dep add --from backend --to mobile --kind api_contract --contract-path openapi/ --optional
harness workspace dep list --json

# 5. Hybrid impact detection (declared deps + story contract + git diff + advisory hints)
harness workspace impact check --source backend --story US-001 --create --emit-reports --json
harness workspace impact list --status pending --json

# 6. Disposition downstream obligations (mandatory --reason for waived / no_change_needed)
harness workspace impact update IMP-001 --status updated --note "Updated web login client"
harness workspace impact update IMP-002 --status waived --reason "Additive optional field; mobile unaffected"

# 7. Gate check & recovery
harness workspace impact gate US-001 --source backend --json
harness workspace reconcile --depth 3 --json        # Relink moved child repos by project_id
harness workspace doctor --repair --json            # Back up corrupt/unknown-version store before reset
harness workspace policy --impact-gate required --require-contract-story true

# 8. Optional portable manifest
harness workspace manifest export --out .harness-workspace.json
harness workspace manifest apply --file .harness-workspace.json
```

## Impact Gating Rules

When a project belongs to a workspace whose `policy.impact_gate` is `required` (default):

1. Any `required` impact in `pending` state for the completing story (or with no `source_ref` in that source member) blocks `harness story done`, `harness story update --status implemented`, and MCP `harness_story_update` with `HARNESS_E_IMPACT_GATE`.
2. If the completing story declares `--contract "..."` and `policy.require_impact_on_contract_story` is `true` (default), required outbound dependencies from that member must have a recorded assessment for that story (`workspace impact check --source <member> --story <id> --create` or `workspace impact add`) before the story can become `implemented`.
3. Dispositions `no_change_needed` and `waived` require a non-empty `--reason`; `updated` requires `--note`, `--target-story`, or `--reason`.
4. `impact_gate` can be set to `advisory` (warn only) or `off` via `harness workspace policy`.

## MCP & Dashboard Parity

- Start MCP in a parent workspace directory with `harness mcp --workspace` (or `harness mcp` without `AGENTS.md`). Bind `X-Harness-Project: <ws-id>` (or a harnessed member's `project_id`) on `tools/call`.
- When bound to `<ws-id>`, workspace tools (`harness_workspace_status`, `harness_workspace_context`, `harness_workspace_impact_list`, `harness_workspace_impact_check`, `harness_workspace_impact_update`) are enabled while local single-project mutations fail closed until a member `project_id` is selected.
- Dashboard exposes `GET /api/workspaces` and renders a **Workspaces** table alongside **Projects** without mutating parent workspace directories.
