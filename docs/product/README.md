# Product Docs

Product contract files for **this** npm-native Harness rewrite. Prefer small,
domain-named docs over one monolithic SPEC.

## Current Product Contracts

| Doc | Role |
| --- | --- |
| `overview.md` | Product identity, goals, non-goals, roadmap, upstream relationship |

## Planned (create when a story needs them)

Examples only — do not invent domains early:

- `cli-contract.md` — stable `harness` command surface
- `init-payload.md` — files `harness init` installs into target projects
- `durable-layer.md` — SQLite schema and operational records
- `distribution.md` — npm packaging, optional native artifacts

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
