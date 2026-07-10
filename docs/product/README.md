# Product Docs

Product contract files for **this** npm-native Harness rewrite. Prefer small,
domain-named docs over one monolithic SPEC.

## Current Product Contracts

| Doc | Role |
| --- | --- |
| `roadmap.md` | **Phases, deps, US-006–014 tracking map** |
| `overview.md` | Product identity, goals, non-goals, upstream relationship |
| `cli-contract.md` | Target `harness` CLI surface |
| `init-payload.md` | Files and init/link behavior for target projects |
| `durable-layer.md` | Markdown SoT + command semantics (decision 0011) |
| `global-registry.md` | Machine-local project registry + clone→link workflow |
| `agent-index.md` | Derived index + get/search/links for agents |
| `distribution.md` | npm packaging, global-first install, release checklist |

## Planned (create when a story needs them)

- Dashboard UI contract
- Native distribution notes when/if a Rust engine ships

## Update Rule

When behavior changes:

1. Update the affected product doc.
2. Update or create the story packet.
3. Update durable proof status with the bootstrap CLI (`scripts/bin/harness-cli`)
   until the product CLI exists; then use `npx harness ...`.
4. Record a decision if architecture, scope, risk, or a settled product rule
   changes.

## Not Product Truth Here

- `../repository-harness` docs describe **upstream**, not this product.
- Bootstrap operating docs under `docs/HARNESS.md` describe collaboration
  process; product behavior still belongs under `docs/product/`.
