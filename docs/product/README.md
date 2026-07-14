# Product Docs

Product contract files for **5harness**. Prefer small, domain-named
docs over one monolithic SPEC.

## Current Product Contracts

| Doc | Role |
| --- | --- |
| `roadmap.md` | Phases, deps, story tracking map |
| `overview.md` | Product identity, goals, non-goals |
| `cli-contract.md` | Target `harness` CLI surface |
| `init-payload.md` | Files and init/link behavior for target projects |
| `durable-layer.md` | Markdown SoT + command semantics (decision 0011) |
| `global-registry.md` | Machine-local project registry + clone→link workflow |
| `agent-index.md` | Derived index + get/search/links for agents |
| `mcp-project-binding.md` | OAuth project grant + durable project id |
| `project-link.md` | Peer projects + role/stack + cross-project reports (planned) |
| `distribution.md` | npm packaging, global-first install, release checklist |

## Update Rule

When behavior changes:

1. Update the affected product doc.
2. Update or create the story packet.
3. Update durable proof status with the product CLI (`harness …` / `npm run harness -- …`).
4. Record a decision if architecture, scope, risk, or a settled product rule
   changes.

## Not Product Truth Here

Operating process docs under `docs/HARNESS.md` describe collaboration; product
behavior still belongs under `docs/product/`.
