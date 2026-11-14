---
name: harness
description: Use the 5harness CLI for project intake, durable work tracking, bounded context reads, cross-repo workspace orchestration, and agent handoffs. Activate when working in a 5harness repository or a parent workspace directory containing multiple repositories.
---

# Harness

You are a coding agent. **5harness** (`harness`) is how you discover project
history, record durable work, and coordinate multi-repo changes. Stories,
decisions, intakes, backlog, and reports are Git-backed markdown. **Never
hand-edit those operational markdown files** — always mutate via `harness` CLI
or MCP tools.

## 1. Cold start: orient by directory type

Run the minimum read needed for where you are — do **not** dump
`docs/HARNESS.md`, `AGENTS.md`, or the entire repository tree first.

1. **Inside a harnessed repository** (has `AGENTS.md` with `harness-project-id`):
   ```bash
   harness doctor --json
   harness status --json
   harness next --json
   ```
   If `doctor` reports unlinked, run `harness link` once.
2. **Inside a repository without `AGENTS.md`:** do **not** auto-run
   `harness init`; ask the user before initializing.
3. **In a parent workspace folder** (no Git repo, holds multiple child repos):
   stay at the parent and use **Parent Workspace Mode** below instead of
   grepping all child folders.

## 2. Bounded reads (prefer `--json`)

```bash
harness search "…" --limit 10 --json
harness get <id> --json
harness links <id> --json
harness context <id> --max-chars 8000 --json
harness query matrix --json
harness query decisions --json
harness query reports --json
```

## 3. Single-repo work loop

```bash
harness intake --type <type> --summary "…" --lane tiny|normal|high-risk
harness story add --id US-… --title "…" --lane normal --contract "openapi/v1.yaml"
harness story start US-…                 # also accepts: --id US-…
# implement and verify the slice, then commit only slice files
git add <slice files> && git commit -m "feat: …"
harness story done US-…
harness story update --id US-… --status implemented --unit 1 --integration 1 --e2e 0 --platform 0
harness decision add --id … --title "…" --doc docs/decisions/….md
harness decision update --id … --status accepted --notes "…"
harness backlog add --title "…" --pain "…"
```

`story add` / `update` require `--id`. `story start` / `done` / `block` take a
positional id (`--id` also works). Every mutation auto-reindexes.

## 4. Parent workspace mode (multi-repo orchestration)

Workspace metadata lives in `$HARNESS_HOME/workspaces.json` (zero silent files
in your parent folder). Always preview before linking:

```bash
# Discover & link selected child repos (bounded depth, deduplicates worktrees)
harness workspace discover --depth 2 --json
harness workspace link --project backend --project apps/web --dry-run --json
harness workspace link --project backend --project apps/web --yes

# Bounded composite context & health (resilient if one child repo fails)
harness workspace status --json
harness workspace context --task "OAuth" --role backend --limit 5 --max-chars 8000 --json

# Cross-repo dependencies & impact gate
harness workspace dep add --from backend --to web --kind api_contract --contract-path openapi/
harness workspace impact check --source backend --story US-001 --create --emit-reports --json
harness workspace impact list --status pending --json
harness workspace impact update IMP-001 --status updated --note "Updated web client"
harness workspace impact update IMP-002 --status no_change_needed --reason "Internal refactor only"
harness workspace impact gate US-001 --source backend --json

# Recovery when child repos move or store is damaged
harness workspace reconcile --depth 3 --json
harness workspace doctor --repair --json
```

When `policy.impact_gate` is `required` (default), `harness story done` fails
with `HARNESS_E_IMPACT_GATE` until required `pending` impacts are resolved (or
explicitly `waived` / `no_change_needed` with `--reason`).

## 5. Hard-fail contract (decision 0017)

If any `harness` command or MCP call exits non-zero: **HARD STOP**. Recover
with `harness --version`, `harness doctor`, `harness link`, `harness reindex`,
then retry. Never bypass failures by editing entity markdown by hand.

## 6. Commit after each completed slice

When a slice (code + tests/docs) is done: `git add` only that slice's files and
`git commit` with a conventional message. Never commit `.5harness/`, secrets, or
unrelated dirty files. Do not `git push` unless the user asks.

## 7. MCP & skill setup

- **Repo MCP:** prefer CLI; if using MCP, pass `X-Harness-Project: <project-id>`
  (from `harness project id`) and use `harness_next`, `harness_get`, `harness_query_*`.
- **Workspace MCP:** start `harness mcp --workspace` and bind
  `X-Harness-Project: <workspace-id>` to enable `harness_workspace_status`,
  `harness_workspace_context`, `harness_workspace_impact_list|check|update`.
- **Hosted Cloud Plan:** when asked `please implement plan from harness --TOKEN`,
  run `harness plan get TOKEN --json` (default `https://5harness.knotree.com/mcp`).
- **Install this skill globally across AI agents:** run `harness skill add --global`
  (or target one agent, e.g. `-a claude-code`, `-a antigravity`, `-a cursor`).
- **Command contract (decision 0023):** never invent flags — run `harness --help`,
  `harness workspace --help`, or `harness skill --help`.
