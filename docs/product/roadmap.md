# Product Roadmap (tracking)

Canonical product pivot: [decision 0011](../decisions/0011-global-tool-markdown-durable-index.md).

This file is the **implementation tracking map**. Story packets under
`docs/stories/epics/` are the work units. Update both when status changes.

## North star

```text
npm i -g 5harness
harness init | link          # project MD (git) + global registry (machine)
harness story|decision|…     # tools-only writes → markdown entities
harness search|get|links     # index, not whole-file dumps
harness dashboard            # multi-project browser view
```

Collaborator path:

```text
git clone → npm i -g → harness link → reindex → same history + dashboard
```

## Status legend

| Status | Meaning |
| --- | --- |
| done | Shipped in a released version |
| implemented | Code and story acceptance are complete; release is pending |
| planned | Accepted, not started |
| in_progress | Active implementation |
| blocked | Waiting on dependency |
| deferred | Intentionally later |

## Phase map

| Phase | Epic | Focus | Status |
| --- | --- | --- | --- |
| A | E01 | npm package + `init` (SQLite MVP) | **done** (v0.1) |
| B | E02 | Durable commands (SQLite) | **done** (v0.2) |
| C | E03 | verify / trace / audit | **done** (v0.3) |
| D | E04 | release hardening | **done** (v0.4) |
| E | E05 | propose + tools | **done** (v0.5) |
| F1 | E06 | Global registry + link | **done** (v0.6) |
| F2 | E07 | Markdown entity store | **done** (US-007/008 v0.7.x) |
| F3 | E08 | Agent index (get/search/links) | **done** (v0.7.2) |
| F4 | E09 | Init/link payload pivot | **done** (v0.8.0) |
| F5 | E10 | Quality commands on new store | **done** (US-012/013 v0.8) |
| G | E11 | Dashboard foundation | **done** (v0.9.0) |
| H1 | E12 | Agent loop Tier 1 (doctor/status/next/context + inbound tools) | **done** (v0.10) |
| H2 | E13 | Agent loop Tier 2 (lifecycle, worklog, intake run, dashboard mutations) | **done** (v0.10) |
| H3 | E14 | Agent loop Tier 3 (MCP, export, watch, handoff) | **done** (v0.10.1) |
| I | E16 | Project Link (peer projects + cross-project reports) | **implemented** (unreleased; IN-019 / 0022) |

## Dependency graph

```text
E06 registry/link ──────────────────────────────┐
                                                 ├──► E09 init pivot ──► E10 quality rewire
E07 markdown store ──► E08 agent index ──────────┘         │
                                                           ▼
                                                        E11 dashboard
                                                           │
                          ┌────────────────────────────────┤
                          ▼                                ▼
                   E12 Tier 1 loop                   (optional E13/E14)
                   doctor/status/next/context
                   inbound tool registry
                          │
                          ├──► E13 Tier 2 lifecycle / worklog / intake run / dash mutations
                          └──► E14 Tier 3 MCP / export / watch / handoff
                                      │
                                      └──► E16 Project Link / peer reports
```

**Implemented order:** E06 → E07 → E08 → E09 → E10 → E11 →
**E12 → E13 → E14 → E16**.

Rationale:

1. Registry/link is small and unlocks the clone workflow early.
2. Markdown store is the SoT pivot; queries must read MD before dropping SQLite.
3. Index tools depend on entity files existing.
4. Init payload changes last among F* so mid-migration still works.
5. Quality (verify/trace/audit) rewired once store+index stable.
6. Dashboard only needs registry + readable project state.
7. Agent-loop tools (decision **0014** / intake **IN-003**) establish the MCP
   and health surfaces that E16 extends with opt-in peer reads and reports.

## Story checklist (Phase F–G)

| ID | Epic | Title | Depends on | Status |
| --- | --- | --- | --- | --- |
| [US-006](../stories/epics/E06-global-registry/US-006-global-registry-and-link.md) | E06 | Global registry + link/unlink/projects | — | **done** |
| [US-007](../stories/epics/E07-markdown-store/US-007-markdown-entity-writes.md) | E07 | Markdown entity writes | US-006 optional | **done** |
| [US-008](../stories/epics/E07-markdown-store/US-008-markdown-query-reads.md) | E07 | Query/matrix from markdown | US-007 | **done** |
| [US-009](../stories/epics/E08-agent-index/US-009-reindex-get-search-links.md) | E08 | reindex / get / search / links | US-007 | **done** |
| [US-010](../stories/epics/E09-init-link-pivot/US-010-init-payload-and-registration.md) | E09 | Init scaffold MD + auto-register | US-006, US-007 | **done** |
| [US-011](../stories/epics/E09-init-link-pivot/US-011-target-templates-agent-policy.md) | E09 | Target templates + tools-only policy | US-010 | **done** |
| [US-012](../stories/epics/E10-quality-on-md/US-012-quality-on-markdown-store.md) | E10 | verify/trace/audit/propose on new store | US-008, US-009 | **done** |
| [US-013](../stories/epics/E10-quality-on-md/US-013-sqlite-retirement-and-import.md) | E10 | Retire project SQLite SoT + optional import | US-012 | **done** |
| [US-014](../stories/epics/E11-dashboard/US-014-dashboard-foundation.md) | E11 | Local multi-project dashboard foundation | US-006, US-008 | **done** |

## Story checklist (Phase H — post-G agent loop)

Declared via harness CLI (decision **0014**, intake **IN-003**). Packets live under
`docs/stories/US-0xx.md` (tools-only writes).

| ID | Epic | Title | Depends on | Status |
| --- | --- | --- | --- | --- |
| [US-018](../stories/US-018.md) | E12 | `harness doctor` | E11 done | **done** |
| [US-019](../stories/US-019.md) | E12 | `harness status` | US-018 optional | **done** |
| [US-020](../stories/US-020.md) | E12 | `harness next` | US-019 | **done** |
| [US-021](../stories/US-021.md) | E12 | `harness context` | US-009 | **done** |
| [US-022](../stories/US-022.md) | E12 | Inbound tool registry | US-005, TOOL_REGISTRY.md | **done** |
| [US-023](../stories/US-023.md) | E13 | Story start/done/block | US-002 | **done** |
| [US-024](../stories/US-024.md) | E13 | Worklog + PR/commit link | — | **done** |
| [US-025](../stories/US-025.md) | E13 | `harness intake run` | FEATURE_INTAKE.md | **done** |
| [US-026](../stories/US-026.md) | E13 | Dashboard mutations (CLI paths) | US-014 | **done** |
| [US-027](../stories/US-027.md) | E14 | `harness mcp` | US-021 | **done** |
| [US-028](../stories/US-028.md) | E14 | Export changelog | — | **done** |
| [US-029](../stories/US-029.md) | E14 | `harness watch` reindex | US-009 | **done** |
| [US-030](../stories/US-030.md) | E14 | `harness handoff` | US-019, US-024 | **done** |
| [US-045](../stories/US-045.md) | E15 | OAuth 2.1 authorization core + PKCE S256 | US-027, US-042 | **done** |
| [US-046](../stories/US-046.md) | E15 | OAuth enforcement on MCP HTTP surfaces | US-045 | **done** |
| [US-047](../stories/US-047.md) | E15 | MCP OAuth hardening + interoperability docs | US-046 | **done** |
| [US-050](../stories/US-050.md) | E15 | Durable repository identity + `harness project id` | IN-012 | **done** |
| [US-051](../stories/US-051.md) | E15 | Start MCP servers without cwd project authorization | US-050 | **done** |
| [US-052](../stories/US-052.md) | E15 | OAuth consent project grant picker | US-051 | **done** |
| [US-053](../stories/US-053.md) | E15 | Enforce single/all project grants per MCP request | US-052 | **done** |
| [US-054](../stories/US-054.md) | E15 | Document project binding and agent id discovery | US-053 | **done** |

## Story checklist (Phase I — Project Link)

Declared via harness CLI (decision **0022**, intake **IN-019**). Spec:
`docs/product/project-link.md`. Implementation is complete and awaiting release.
Status: implemented (unreleased).

| ID | Epic | Title | Depends on | Status |
| --- | --- | --- | --- | --- |
| [US-059](../stories/US-059.md) | E16 | Project role + optional stack markers and CLI | US-050 | **implemented** |
| [US-060](../stories/US-060.md) | E16 | Peer add/remove/list + registry path resolution | US-059, US-006 | **implemented** |
| [US-061](../stories/US-061.md) | E16 | Peer read tools CLI + MCP (search/get/context/links) | US-060, US-009, US-027 | **implemented** |
| [US-062](../stories/US-062.md) | E16 | Cross-project report entity + lifecycle tools | US-060, US-007 | **implemented** |
| [US-063](../stories/US-063.md) | E16 | AGENTS workflow, doctor/status/next, product docs finish | US-061, US-062 | **implemented** (release proof pending) |

Dependency order: **US-059 → US-060 → (US-061 ∥ US-062) → US-063**.

## Versioning intent

| Version bump | When |
| --- | --- |
| 0.6.x | E06 registry/link usable |
| 0.7.x | E07–E08 markdown + index (dual-run or flag OK) |
| 0.8.x | E09–E10 init pivot + SQLite SoT retired |
| 0.9.x | E11 dashboard MVP |
| 0.10.x+ | E12+ agent-loop tools (incremental) |
| 0.21.x+ | First E16 Project Link release (role/peers/reports) |
| 1.0.0 | Public contract stable; publish confidence |

Exact versions may shift; keep `CHANGELOG.md` as release truth.

## Tracking rules for agents/humans

1. Before coding a story: set status `in_progress` in the story packet + matrix.
2. Prefer one story per PR/commit series.
3. Acceptance criteria in the story packet are the contract.
4. After done: `implemented`, fill Evidence, update matrix + epic README + this roadmap table.
5. Architecture/product rule changes → new `docs/decisions/*`.
6. Agents **must not** hand-edit operational entity files once MD store exists; use CLI.

## Out of roadmap (explicitly deferred)

- Cloud multi-user registry → backlog **BL-003**
- Vector embeddings as primary search → backlog **BL-002**
- Desktop/Electron shell
- Native engine behind npm bin (optional later)
- Public npm publish ops (shipped via GitHub Actions; not a product epic)

## Related product docs

| Doc | Role |
| --- | --- |
| [overview.md](./overview.md) | Identity and success criteria |
| [global-registry.md](./global-registry.md) | Registry + clone workflow |
| [durable-layer.md](./durable-layer.md) | Markdown SoT |
| [agent-index.md](./agent-index.md) | Index + retrieval tools |
| [cli-contract.md](./cli-contract.md) | Command surface |
| [init-payload.md](./init-payload.md) | Init files |
| [distribution.md](./distribution.md) | Install story |
