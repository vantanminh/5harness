# Documentation Map

This directory is the operating harness **for the 5harness product**
itself and the product contracts shipped to target repos via `init`.

## Start here

| Doc | Role |
| --- | --- |
| [`product/roadmap.md`](./product/roadmap.md) | Implementation tracking |
| [`product/overview.md`](./product/overview.md) | Product identity |
| [`product/project-link.md`](./product/project-link.md) | Project Link roles, configured peers, bounded reads, and reports |
| [`decisions/0011-global-tool-markdown-durable-index.md`](./decisions/0011-global-tool-markdown-durable-index.md) | Locked pivot |
| [`stories/README.md`](./stories/README.md) | Epic/story index |
| [`TEST_MATRIX.md`](./TEST_MATRIX.md) | Proof matrix |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Stack and layering |
| [`HARNESS.md`](./HARNESS.md) | Collaboration model |
| [`WORKFLOW_VI.md`](./WORKFLOW_VI.md) | Workflow guide (Tiếng Việt) |
| [`EXAMPLES.md`](./EXAMPLES.md) | New project walkthrough (EN) |
| [`EXAMPLES_VI.md`](./EXAMPLES_VI.md) | New project walkthrough (Tiếng Việt) |
| [`EXAMPLES_EXISTING.md`](./EXAMPLES_EXISTING.md) | Existing project walkthrough (EN) |
| [`EXAMPLES_EXISTING_VI.md`](./EXAMPLES_EXISTING_VI.md) | Existing project walkthrough (Tiếng Việt) |

## Main files

- `HARNESS.md` — how humans and agents collaborate.
- `FEATURE_INTAKE.md` — tiny / normal / high-risk lanes.
- `ARCHITECTURE.md` — architecture and boundaries.
- `CONTEXT_RULES.md` — what to read by phase/lane.
- `TEST_MATRIX.md` — story → proof map.
- `GLOSSARY.md` — shared terms (if present).
- `TOOL_REGISTRY.md` — tool inventory (evolve with CLI).

## Folders

| Folder | Role |
| --- | --- |
| `product/` | **Product truth** for this CLI (contracts + roadmap) |
| `stories/` | Feature packets and backlog |
| `decisions/` | Durable decisions |
| `reports/` (when populated) | Target-owned Project Link report entities |
| `templates/` | Story/decision/intake templates used in *this* repo |

Payload templates shipped to **target** projects live in repo-root
`templates/` (npm package), not only under `docs/templates/`.

## Current state

- **Shipped:** markdown SoT, registry, index, dashboard, agent loop, and
  project-bound MCP through Phase H.
- **Implemented (unreleased):** Phase I / E16 Project Link (US-059–US-063).
- **Locked direction:** decisions 0011 (global tool + markdown SoT) and 0022
  (configured peers + target-owned reports).
