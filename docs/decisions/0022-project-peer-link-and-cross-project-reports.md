---
id: 0022-project-peer-link-and-cross-project-reports
type: decision
title: Project peer links + role/stack markers + cross-project reports
status: accepted
doc: docs/decisions/0022-project-peer-link-and-cross-project-reports.md
verify: null
notes: "Accepted 2026-07-14 (declaration). (1) Feature name Project Link; CLI must NOT overload registry harness link. (2) Opt-in only: init unchanged until user sets role/peers. (3) Role+optional stack as AGENTS harness markers (like project id); peers as harness-peer markers keyed by durable project_id. (4) Path resolve via ~/.5harness registry only; fail closed if unresolved. (5) Peer reads reuse local search/get/context/links with peer projectRoot; token budgets identical; no vault dumps; no peer-of-peer. (6) New durable entity type report under docs/reports/ SoT on TARGET project; lifecycle open|acked|fixed|wontfix|needs_info; reporter writes via harness report add --to; target updates status/resolution. (7) Peer writes limited to reports in v1 — no cross-project story/decision mutation. (8) MCP tools dynamic when peers exist; OAuth project bind remains for calling project (0020). (9) Bidirectional reverse marker best-effort. (10) Upgrade must preserve role/stack/peer markers. Spec: docs/product/project-link.md. Stories US-059..063. Intake IN-019."
created_at: "2026-07-14T15:45:40.572Z"
updated_at: "2026-07-14T15:45:40.573Z"
links:
  - IN-019
  - 0011-global-tool-markdown-durable-index
  - 0017-agent-hard-fail-contract
  - 0020-mcp-project-binding-at-authorization
  - US-006
  - US-009
  - US-027
  - US-041
  - US-050
---

# Project peer links + role/stack markers + cross-project reports

Date: 2026-07-14

## Status

Accepted (declaration — implementation via US-059…US-063)

## Context

Full-stack products often split into multiple harnessed Git repos (frontend +
backend, mobile + API, etc.). Agents need:

1. A compact signal of **what this project is** (role / stack) without guessing.
2. **Token-safe** reads of peer durable docs (search/get/context), not vault dumps.
3. A durable **cross-project report** channel so FE findings reach BE agents and
   fix status flows back — without humans pasting docs between repos.

Existing `harness link` only registers a clone in the machine-local registry
(decision 0011). Overloading that verb would collide semantics.

## Decision

1. **Feature name:** Project Link. **CLI namespace:** `project role`,
   `project peer`, `peer *`, `report *` — never overload registry `link`.
2. **Opt-in:** `init` stays unchanged. Role, stack, and peers appear only when
   configured.
3. **Identity markers** in the AGENTS harness block (alongside project id):
   - `harness-project-role`
   - `harness-project-stack` (optional)
   - `harness-peer: id=…;role=…` (one per peer, keyed by durable project id)
4. **Path resolution:** peer id → absolute path via `~/.5harness` registry only;
   missing/unhealthy peer **fails closed**.
5. **Peer reads:** reuse local index tools with peer `projectRoot`; same token
   budgets; no peer-of-peer; no whole-tree dumps.
6. **Reports:** new durable entity type `report` under `docs/reports/` on the
   **target** project. Lifecycle:
   `open | acked | fixed | wontfix | needs_info`.
   Reporter creates via `report add --to`; target updates status/resolution.
7. **Cross-project writes (v1):** reports only — no peer story/decision/intake
   mutation.
8. **MCP:** expose peer/report tools dynamically when peers exist; OAuth project
   bind still applies to the **calling** project (decision 0020).
9. **Reverse edges:** best-effort write peer marker on the other project when
   its path is writable.
10. **`harness upgrade`:** must preserve role/stack/peer markers.

Canonical product behavior: `docs/product/project-link.md`.

## Alternatives Considered

1. **Reuse registry `harness link` for peers** — rejected: different meaning
   (machine registration vs repo-to-repo product relationship).
2. **Full second vault copy / monorepo force** — rejected: breaks existing
   multi-repo workflows; high token cost.
3. **Cloud shared inbox** — deferred (BL-003 / BL-006); local-first remains.
4. **Store peers only in `~/.5harness`** — rejected: clone would lose peer intent;
   markers in AGENTS keep git-backed intent; path stays machine-local.
5. **Reuse story/backlog for FE→BE notes** — rejected: pollutes product matrix;
   reports have distinct lifecycle and from/to project fields.

## Consequences

Positive:

- Agents know role/stack without human re-explanation.
- FE can search BE contracts and file structured mismatches.
- BE can fix and FE can read resolution — enterprise-like loop on local machine.
- Users who never peer remain on today’s simple init UX.

Tradeoffs:

- Both repos must be registered on the same machine for path resolve (v1).
- New entity type (`report`) expands catalog/index surface.
- MCP tool list becomes config-dependent (must document for clients).

## Follow-Up

- Implement US-059 → US-060 → US-061 ∥ US-062 → US-063.
- Backlog: BL-006 (cross-machine), BL-007 (path allowlist hardening).
- Update SECURITY.md and cli-contract.md when coding starts.
