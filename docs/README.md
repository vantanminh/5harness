# Documentation Map

This directory is the operating harness **for the @vantanminh/harness product**
itself and the product contracts shipped to target repos via `init`.

## Start here

| Doc | Role |
| --- | --- |
| [`product/roadmap.md`](./product/roadmap.md) | Implementation tracking |
| [`product/overview.md`](./product/overview.md) | Product identity |
| [`decisions/0011-global-tool-markdown-durable-index.md`](./decisions/0011-global-tool-markdown-durable-index.md) | Locked pivot |
| [`stories/README.md`](./stories/README.md) | Epic/story index |
| [`TEST_MATRIX.md`](./TEST_MATRIX.md) | Proof matrix |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Stack and layering |
| [`HARNESS.md`](./HARNESS.md) | Collaboration model |

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
| `templates/` | Story/decision/intake templates used in *this* repo |

Payload templates shipped to **target** projects live in repo-root
`templates/` (npm package), not only under `docs/templates/`.

## Current state

- **Shipped:** Phases A–G (US-001–US-014), markdown SoT, registry, index, dashboard — **v0.9.1**.
- **Locked direction:** decision 0011 (global tool, markdown SoT, index, dashboard).
