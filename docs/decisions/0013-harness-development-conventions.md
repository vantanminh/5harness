---
id: 0013-harness-development-conventions
type: decision
title: Harness Development Conventions
status: accepted
doc: docs/decisions/0013-harness-development-conventions.md
verify: null
notes: "Accepted 2026-07-10. Establishes auto-reindex invariance, version tracking discipline, backward-compatible upgrade, harness block ownership, and testing conventions."
created_at: "2026-07-10T08:30:00.000Z"
updated_at: "2026-07-10T08:30:00.000Z"
---

# Harness Development Conventions

Date: 2026-07-10

## Status

Accepted

## Context

As the harness codebase grows, consistent development patterns are needed to
ensure:

1. **Auto-reindex invariance:** Every mutation command that writes durable markdown
   must auto-reindex so agents never need to call `harness reindex` manually.
2. **Version tracking:** Every template change that affects AGENTS.md must bump
   the harness version marker so repos can detect they need an upgrade.
3. **Backward compatibility:** Any new CLI version must be able to detect and
   upgrade repos created with any older version.
4. **Harness block discipline:** The `<!-- HARNESS:BEGIN/END -->` block in
   AGENTS.md is the only harness-managed section. Changes outside this block
   belong to the project owner.
5. **Testing discipline:** Every new feature needs unit tests (domain) + e2e
   tests (CLI), following existing conventions.

Without these conventions, the codebase will accumulate divergence between
template behavior, CLI behavior, and agent expectations.

## Decision

### 1. Auto-reindex invariance (mutation commands)

Every CLI command that **writes** durable markdown entities (intake, story
add/update, decision add, backlog add/close) must call `maybeReindex()` after
a successful write. The shared helper in `src/commands/_reindex-helper.ts`
encapsulates the pattern.

Read-only commands (query, search, get, links, audit, propose) do NOT reindex.

Traces write to `.harness/local/` (not markdown SoT) and are excluded.

### 2. Version marker discipline

- The `templates/AGENTS.md` must contain `<!-- harness-version: X.Y.Z -->`
  immediately after `<!-- HARNESS:BEGIN -->`.
- When template AGENTS.md content changes in a way that target repos should
  receive, bump `src/version.ts` AND the marker in `templates/AGENTS.md`.
- The marker is the **single source of truth** for what version a repo was
  last upgraded to.

### 3. Backward-compatible upgrade

- `harness upgrade` reads the version marker from the target repo's AGENTS.md.
- If missing (pre-0.9.7 repos), it prints guidance to re-init.
- If present and older, it replaces only the `<!-- HARNESS:BEGIN/END -->` block
  with the current template block.
- User content outside the block is **never modified**.
- A timestamped backup is written to `.harness-backup/` before modification.

### 4. Harness block ownership

```
AGENTS.md:
  [project-customized agent instructions]  ← project owner
  <!-- HARNESS:BEGIN -->
  <!-- harness-version: X.Y.Z -->
  [harness-managed CLI reference]           ← harness upgrade manages this
  <!-- HARNESS:END -->
  [optional project-customized additions]   ← project owner
```

### 5. Development workflow

1. Record an intake via `harness intake --type harness_improvement`
2. Create stories via `harness story add`
3. Implement with small, focused commits (one commit per logical change)
4. Use `harness trace` to record work
5. Update stories via `harness story update --status implemented`
6. Run `npm test` before each commit
7. Use `harness decision add` for architectural decisions

### 6. Testing conventions

| Layer | Test file pattern | Coverage |
|---|---|---|
| Domain | `tests/<name>.test.ts` | Pure logic, no FS/network |
| Infrastructure | `tests/<name>.test.ts` | FS/DB with temp dirs |
| CLI e2e | `tests/<name>-cli.e2e.test.ts` or `*.e2e.test.ts` | Full CLI spawn with temp dirs |

- Use `vitest` (`describe`/`it`/`expect`)
- Temp dirs cleaned in `afterEach`
- No test depends on global state or real `~/.harness`

## Alternatives Considered

1. **Let agents call `harness reindex` manually.** Rejected: creates an
   inconsistent experience where `init` and `link` auto-reindex but mutations
   don't. Agents forget to reindex, leading to stale query results.

2. **Store version in a separate `.harness-version` file.** Rejected: adds
   another file to manage. Embedding in AGENTS.md keeps it in one place that
   agents already read.

3. **Full AGENTS.md replacement on upgrade.** Rejected: would destroy project-
   specific agent instructions. Block-only replacement is safer.

## Consequences

Positive:
- Consistent agent experience: never call `harness reindex` manually
- Version tracking enables smooth future template evolution
- Clear development conventions for contributors
- Backward-compatible upgrade path for all repos

Tradeoffs:
- `harness upgrade` replaces the harness block entirely (not a smart diff).
  This is acceptable because the block is harness-managed content.
- Pre-0.9.7 repos need a one-time manual step (`harness init --force` or
  manual marker insertion) to become upgrade-trackable.

## Follow-Up

- None.
