# 0009 Standalone Product Repository

Date: 2026-07-10

## Status

Accepted (amended: product is fully standalone)

## Context

Agents and contributors need a single source of truth for this product. This
repository owns implementation, packaging, and docs end-to-end.

## Decision

1. **All product implementation and harness deltas land in this repo only.**
2. **Source of truth** for this product is:
   - `AGENTS.md`
   - `README.md`
   - `docs/product/*`
   - `docs/decisions/*`
3. External projects may be studied for ideas, but they are **not** runtime
   dependencies, packaging sources, or documentation sources of truth for this
   product.
4. Prefer original prose and re-implementation over bulk-copy of third-party
   branding, installers, or READMEs.

## Alternatives Considered

1. **Vendoring another tree as product truth** — Rejected: blurs ownership.
2. **Monorepo merge with unrelated products** — Rejected: confuses identity.

## Consequences

Positive:

- One clear product identity for users and agents.
- Docs and packaging can evolve without external layout coupling.

## Follow-Up

- Keep `AGENTS.md` and product docs aligned with shipped CLI behavior.
