---
id: 0017
type: decision
title: "Agent hard-fail contract: harness CLI errors must stop agent work"
status: accepted
doc: docs/decisions/0017-agent-hard-fail-contract.md
verify: null
notes: "Accepted 2026-07-12 (US-032). AGENTS.md + CLI make harness failures non-skippable for agents. Structured errors, recovery, no hand-edit fallback. Links: IN-005"
created_at: "2026-07-12T06:05:31.802Z"
updated_at: "2026-07-12T06:05:31.802Z"
links:
  - IN-005
---

# Agent hard-fail contract: harness CLI errors must stop agent work

Date: 2026-07-12

## Status

Accepted

## Context

Coding agents often treat shell/tool failures as soft signals and continue by
improving around the failure: hand-editing markdown entities, inventing IDs, or
skipping durable writes. That breaks the product invariant from decision
**0011**: operational durable state is mutated **only** through harness tools,
and the derived index stays consistent with those tools.

Today `templates/AGENTS.md` states the mutation rule but does not spell out a
**hard stop** when `harness` (CLI or MCP) fails. Agents need an unambiguous
contract: failure is not skippable, recovery is explicit, and hand-edit is never
a fallback.

Related: US-033 will add machine-readable error codes and debug logging; this
decision locks the **agent policy** and template wording that US-033 must not
contradict.

## Decision

### 1. Hard-fail is mandatory for agents

If any of the following occurs, the agent **must HARD STOP** the current
mutation or durable-write path:

1. `harness` CLI exits non-zero.
2. Harness MCP tool returns an error / is unavailable when required for the task.
3. Required harness install or project link is missing (`command not found`,
   not a harness project, not linked when the workflow requires it).

**Forbidden fallbacks:**

- Creating or editing story / decision / intake / backlog entity markdown by hand
- “Best effort” durable writes outside the CLI
- Silently skipping intake, story updates, or reindex when tools fail
- Inventing entity IDs or statuses not returned by harness tools

**Allowed after stop:** diagnose with recovery commands (below), fix environment
or command usage, re-run harness tools, then continue. Pure product code edits
that do not touch operational durable entities may continue only if the task
does not require a failed harness step.

### 2. Recovery steps (ordered)

When harness fails, agents should attempt diagnosis in this order (and report
what they tried):

| Step | Command | Purpose |
| --- | --- | --- |
| 1 | `harness --version` | Confirm CLI is installed and on PATH |
| 2 | `harness doctor` / `harness doctor --json` | Workspace health (store, index, link, engines) |
| 3 | `harness link` | Register clone / restore registry pointer |
| 4 | `harness reindex` | Rebuild derived index from committed markdown |
| 5 | `harness status` / `harness next` | Confirm project is usable |

If doctor reports hard failures, fix those before any durable mutation. Do not
hand-edit entities to “repair” index drift — use reindex and CLI writes.

### 3. Exit codes agents must honor

| Code | Meaning | Agent action |
| --- | --- | --- |
| 0 | Success | Continue |
| 1 | Usage, validation, or operational error | **HARD STOP** for the failed step; recover then retry |
| 2 | Reserved (e.g. partial success / soft fail modes) | Treat as non-success unless docs for that command say otherwise; do not invent success |

Doctor may use non-zero only for hard-fail modes and warn on soft issues (see
US-018). Agents must not treat stderr warnings alone as success when exit code
is non-zero.

### 4. Where the contract lives

| Surface | Role |
| --- | --- |
| `templates/AGENTS.md` harness block | **Shipped** agent-facing contract for every `init` / `upgrade` |
| Project `AGENTS.md` (HARNESS block) | Same text after upgrade; project prose outside the block may reinforce but must not weaken |
| This decision (0017) | Durable product rule |
| `docs/product/cli-contract.md` | Exit-code table aligned with this decision |

Policy docs outside operational entities (`HARNESS.md`, product docs) may
restate the rule; they do not replace the AGENTS hard-fail section.

### 5. Out of scope for this decision

- Full `HARNESS_E_*` structured error taxonomy and log files → **US-033**
- Expanding MCP mutation tools → **US-041**
- Atomic index / locks → **US-034**

## Consequences

- Template and upgrade path must include an explicit **HARD STOP** section so
  agents that only read the harness block still see the rule.
- Version marker in `templates/AGENTS.md` bumps when this block text changes
  (decision 0013).
- Reviews may reject agent sessions that hand-edit operational entities after a
  harness failure.
- CLI implementations should keep exit codes stable and documented; richer
  structured errors remain complementary, not a substitute for hard-fail policy.

## Links

- IN-005 — production hardening wave
- 0011 — markdown SoT + tools-only mutation
- 0013 — harness block / version discipline
- US-032 — implement this contract in templates and policy
- US-018 — `harness doctor` hard vs soft exit behavior
